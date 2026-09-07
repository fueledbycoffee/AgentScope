"""Preview and commit imports: the domain engine applied to stored files."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterator, Sequence
from dataclasses import asdict
from typing import Any

from agentscope_app.application.dto import (
    MAX_PREVIEW_SAMPLE,
    EmissionSample,
    FileInfo,
    ImportReport,
    MappingRecord,
    MappingRef,
    PreviewReport,
    RawRecord,
    RejectRow,
    UploadInfo,
)
from agentscope_app.application.errors import InvalidInputError, NotFoundError
from agentscope_app.application.ports import (
    Clock,
    IdGenerator,
    RawFileStore,
    RecordReader,
    UnitOfWork,
    UnitOfWorkFactory,
)
from agentscope_app.domain.mapping.contract import MappingSpec
from agentscope_app.domain.mapping.interpreter import Emission, RecordResult, apply_mapping
from agentscope_app.domain.mapping.parser import parse_mapping
from agentscope_app.domain.reducer import reduce_sessions

RECORD_OUTCOMES = ("accepted", "partial", "duplicate", "rejected", "ignored")


def _load_mapping(uow: UnitOfWork, mapping_id: str) -> tuple[MappingRecord, MappingSpec]:
    record = uow.mappings.get(mapping_id)
    if record is None:
        raise NotFoundError(f"Mapping {mapping_id!r} does not exist")
    parsed = parse_mapping(record.document)
    if not parsed.is_executable or parsed.spec is None:
        raise InvalidInputError(
            f"Mapping {record.name!r} (revision {record.revision}) is not executable",
            [asdict(issue) for issue in parsed.errors],
        )
    return record, parsed.spec


def _load_upload(uow: UnitOfWork, upload_id: str) -> UploadInfo:
    info = uow.uploads.get(upload_id)
    if info is None:
        raise NotFoundError(f"Upload {upload_id!r} does not exist")
    return info


def _classify(result: RecordResult) -> str:
    if result.emissions and result.rejects:
        return "partial"
    if result.emissions:
        return "accepted"
    if result.rejects:
        return "rejected"
    return "ignored"


def _run_record(spec: MappingSpec, record: RawRecord, file_sha256: str) -> RecordResult:
    if record.payload is None:
        from agentscope_app.domain.identity import SourceOccurrence
        from agentscope_app.domain.mapping.interpreter import Reject

        occurrence = SourceOccurrence(file_sha256, record.locator, "record")
        message = record.error or "record could not be decoded"
        return RecordResult(rejects=(Reject("record", occurrence, "invalid_json", message),))
    return apply_mapping(spec, record.payload, file_sha256=file_sha256, locator=record.locator)


def _reject_rows(result: RecordResult, payload: Any) -> list[RejectRow]:
    return [
        RejectRow(
            locator=r.occurrence.locator,
            rule_id=r.rule_id,
            path=r.occurrence.emission_path,
            code=r.code,
            field=r.field,
            message=r.message,
            payload=payload,
        )
        for r in result.rejects
    ]


class PreviewImport:
    def __init__(
        self, uow_factory: UnitOfWorkFactory, store: RawFileStore, reader: RecordReader
    ) -> None:
        self._uow_factory = uow_factory
        self._store = store
        self._reader = reader

    def execute(self, upload_id: str, mapping_id: str, sample: int) -> PreviewReport:
        sample = max(1, min(sample, MAX_PREVIEW_SAMPLE))
        with self._uow_factory() as uow:
            info = _load_upload(uow, upload_id)
            _, spec = _load_mapping(uow, mapping_id)
        records: Counter[str] = Counter()
        entities: Counter[str] = Counter()
        warnings: Counter[str] = Counter()
        rejects: list[RejectRow] = []
        emissions: list[EmissionSample] = []
        sampled = 0
        with self._store.open(info.sha256) as stream:
            for record in _take(self._reader.read(stream, info.format), sample):
                sampled += 1
                result = _run_record(spec, record, info.sha256)
                records[_classify(result)] += 1
                for emission in result.emissions:
                    entities[emission.entity] += 1
                    if len(emissions) < 50:
                        emissions.append(
                            EmissionSample(
                                emission.entity,
                                emission.occurrence.emission_path,
                                record.locator,
                                dict(emission.fields),
                            )
                        )
                for warning in result.warnings:
                    warnings[warning.code] += 1
                if len(rejects) < 50:
                    rejects.extend(_reject_rows(result, record.payload)[: 50 - len(rejects)])
        counts = {k: records.get(k, 0) for k in ("accepted", "partial", "rejected", "ignored")}
        counts["sampled"] = sampled
        return PreviewReport(
            records=counts,
            entities=dict(entities),
            rejects=tuple(rejects),
            warnings=dict(warnings),
            emissions=tuple(emissions),
        )


class CommitImport:
    def __init__(
        self,
        uow_factory: UnitOfWorkFactory,
        store: RawFileStore,
        reader: RecordReader,
        clock: Clock,
        ids: IdGenerator,
    ) -> None:
        self._uow_factory = uow_factory
        self._store = store
        self._reader = reader
        self._clock = clock
        self._ids = ids

    def execute(self, upload_id: str, mapping_id: str, source: str) -> ImportReport:
        if not source.strip():
            raise InvalidInputError("source must be a non-empty name")
        started_at = self._clock.now()
        import_id = self._ids.new_id("imp")
        with self._uow_factory() as uow:
            info = _load_upload(uow, upload_id)
            mapping, spec = _load_mapping(uow, mapping_id)
            duplicates = uow.imports.find_committed(info.sha256, source)
        file_info = FileInfo(
            info.filename, info.sha256, info.size_bytes, info.format, info.record_count
        )
        base = dict(
            import_id=import_id,
            source=source,
            mapping=MappingRef(mapping.id, mapping.name, mapping.revision),
            started_at=started_at,
            files=(file_info,),
        )
        if duplicates:
            report = ImportReport(
                status="duplicate",
                finished_at=self._clock.now(),
                records=_counts(duplicate=info.record_count),
                entities={},
                warnings={},
                reject_count=0,
                **base,
            )
            self._persist(report, info.sha256, [], [])
            return report

        outcomes: list[tuple[str, str, dict[str, int], dict[str, int]]] = []
        rejects: list[RejectRow] = []
        emissions: list[Emission] = []
        records: Counter[str] = Counter()
        warnings: Counter[str] = Counter()
        try:
            with self._store.open(info.sha256) as stream:
                for record in self._reader.read(stream, info.format):
                    result = _run_record(spec, record, info.sha256)
                    outcome = _classify(result)
                    records[outcome] += 1
                    entity_counts = Counter(e.entity for e in result.emissions)
                    warning_counts = Counter(w.code for w in result.warnings)
                    warnings.update(warning_counts)
                    outcomes.append(
                        (record.locator, outcome, dict(entity_counts), dict(warning_counts))
                    )
                    rejects.extend(_reject_rows(result, record.payload))
                    emissions.extend(result.emissions)
            sessions = reduce_sessions(emissions)
            with self._uow_factory() as uow:
                stored = uow.traces.store(
                    import_id=import_id,
                    file_sha256=info.sha256,
                    source=source,
                    mapping_id=mapping.id,
                    emissions=emissions,
                    sessions=sessions,
                )
                report = ImportReport(
                    status="committed",
                    finished_at=self._clock.now(),
                    records=_counts(**records),
                    entities=dict(stored),
                    warnings=dict(warnings),
                    reject_count=len(rejects),
                    **base,
                )
                uow.imports.add_report(report)
                uow.imports.add_results(import_id, info.sha256, outcomes, rejects)
                uow.commit()
            return report
        except Exception as exc:  # noqa: BLE001 - a failed import is reported, never half-visible
            report = ImportReport(
                status="failed",
                finished_at=self._clock.now(),
                records=_counts(),
                entities={},
                warnings={},
                reject_count=0,
                error=f"{type(exc).__name__}: {exc}",
                **base,
            )
            self._persist(report, info.sha256, [], [])
            return report

    def _persist(
        self,
        report: ImportReport,
        file_sha256: str,
        outcomes: Sequence[tuple[str, str, dict[str, int], dict[str, int]]],
        rejects: Sequence[RejectRow],
    ) -> None:
        with self._uow_factory() as uow:
            uow.imports.add_report(report)
            uow.imports.add_results(report.import_id, file_sha256, outcomes, rejects)
            uow.commit()


def _counts(**values: int) -> dict[str, int]:
    return {k: values.get(k, 0) for k in RECORD_OUTCOMES}


def _take(records: Iterator[RawRecord], limit: int) -> Iterator[RawRecord]:
    for index, record in enumerate(records):
        if index >= limit:
            return
        yield record
