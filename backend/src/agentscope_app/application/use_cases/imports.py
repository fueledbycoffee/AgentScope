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
    RecordOutcome,
    RejectRow,
    UploadInfo,
)
from agentscope_app.application.errors import ConflictError, InvalidInputError, NotFoundError
from agentscope_app.application.ports import (
    Clock,
    IdGenerator,
    RawFileStore,
    RecordReader,
    UnitOfWork,
    UnitOfWorkFactory,
)
from agentscope_app.domain.identity import SourceOccurrence
from agentscope_app.domain.mapping.contract import MappingSpec
from agentscope_app.domain.mapping.interpreter import (
    Emission,
    RecordResult,
    Reject,
    apply_mapping,
)
from agentscope_app.domain.mapping.parser import parse_mapping
from agentscope_app.domain.reducer import reduce_sessions

RECORD_OUTCOMES = ("accepted", "partial", "duplicate", "rejected", "ignored")
SAMPLE_LIMIT = 50


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
                    if len(emissions) < SAMPLE_LIMIT:
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
                if len(rejects) < SAMPLE_LIMIT:
                    room = SAMPLE_LIMIT - len(rejects)
                    rejects.extend(_reject_rows(result, record.payload)[:room])
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
        mapping_ref = MappingRef(mapping.id, mapping.name, mapping.revision)

        def build(
            status: str,
            records: dict[str, int],
            entities: dict[str, int],
            warnings: dict[str, int],
            reject_count: int,
            error: str | None = None,
        ) -> ImportReport:
            return ImportReport(
                import_id=import_id,
                status=status,
                source=source,
                mapping=mapping_ref,
                started_at=started_at,
                finished_at=self._clock.now(),
                files=(file_info,),
                records=records,
                entities=entities,
                warnings=warnings,
                reject_count=reject_count,
                error=error,
            )

        if duplicates:
            report = build("duplicate", _counts(duplicate=info.record_count), {}, {}, 0)
            self._persist(report, info.sha256, [], [])
            return report

        outcomes: list[RecordOutcome] = []
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
                        RecordOutcome(
                            record.locator,
                            outcome,
                            dict(entity_counts),
                            dict(warning_counts),
                            record.payload,
                        )
                    )
                    rejects.extend(_reject_rows(result, record.payload))
                    emissions.extend(result.emissions)
            with self._uow_factory() as uow:
                # Sessions known from earlier files seed the reducer, so cross-file
                # merging follows the same domain rules as within one file.
                ids = sorted({str(k) for k in _session_keys(emissions)})
                seeds = uow.traces.existing_sessions(source, ids)
                sessions = reduce_sessions(emissions, seeds)
                # The entity rows reference the import row, so it exists first as
                # "running" and is finalised with the counts in the same transaction.
                uow.imports.add_report(build("running", _counts(), {}, {}, 0))
                stored = uow.traces.store(
                    import_id=import_id,
                    file_sha256=info.sha256,
                    source=source,
                    mapping_id=mapping.id,
                    emissions=emissions,
                    sessions=sessions,
                )
                report = build(
                    "committed", _counts(**records), dict(stored), dict(warnings), len(rejects)
                )
                uow.imports.update_report(report)
                uow.imports.add_results(import_id, info.sha256, outcomes, rejects)
                uow.commit()
            return report
        except ConflictError:
            raise  # another import of the same bytes won the race: nothing was written
        except Exception as exc:  # noqa: BLE001 - a failed import is reported, never half-visible
            report = build("failed", _counts(), {}, {}, 0, error=f"{type(exc).__name__}: {exc}")
            self._persist(report, info.sha256, [], [])
            return report

    def _persist(
        self,
        report: ImportReport,
        file_sha256: str,
        outcomes: Sequence[RecordOutcome],
        rejects: Sequence[RejectRow],
    ) -> None:
        with self._uow_factory() as uow:
            uow.imports.add_report(report)
            uow.imports.add_results(report.import_id, file_sha256, outcomes, rejects)
            uow.commit()


def _session_keys(emissions: Sequence[Emission]) -> set[Any]:
    keys: set[Any] = set()
    for e in emissions:
        key = (
            e.fields.get("external_id")
            if e.entity == "session"
            else e.fields.get("session_external_id")
        )
        if key is not None:
            keys.add(key)
    return keys


def _counts(**values: int) -> dict[str, int]:
    return {k: values.get(k, 0) for k in RECORD_OUTCOMES}


def _take(records: Iterator[RawRecord], limit: int) -> Iterator[RawRecord]:
    for index, record in enumerate(records):
        if index >= limit:
            return
        yield record
