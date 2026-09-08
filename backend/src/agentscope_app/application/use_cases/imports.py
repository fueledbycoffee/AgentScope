"""Preview and commit imports: the domain engine applied to stored files."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterator, Sequence
from dataclasses import asdict, dataclass, replace
from typing import Any

from agentscope_app.application.dto import (
    MAX_BATCH_BYTES,
    MAX_FILES_PER_IMPORT,
    MAX_PREVIEW_SAMPLE,
    MAX_RECORDS_PER_FILE,
    EmissionSample,
    FileBinding,
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
from agentscope_app.application.errors import (
    ConflictError,
    InvalidInputError,
    LimitExceededError,
    NotFoundError,
)
from agentscope_app.application.ports import (
    Clock,
    IdGenerator,
    RawFileStore,
    RecordReader,
    UnitOfWork,
    UnitOfWorkFactory,
)
from agentscope_app.domain.claims import COMPARISON_VERSION, prepare_claims
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


def _reject_rows(result: RecordResult, payload: Any, file_sha256: str) -> list[RejectRow]:
    return [
        RejectRow(
            locator=r.occurrence.locator,
            rule_id=r.rule_id,
            path=r.occurrence.emission_path,
            code=r.code,
            field=r.field,
            message=r.message,
            payload=payload,
            file_sha256=file_sha256,
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
                    rejects.extend(_reject_rows(result, record.payload, info.sha256)[:room])
        counts = {k: records.get(k, 0) for k in ("accepted", "partial", "rejected", "ignored")}
        counts["sampled"] = sampled
        return PreviewReport(
            records=counts,
            entities=dict(entities),
            rejects=tuple(rejects),
            warnings=dict(warnings),
            emissions=tuple(emissions),
        )


@dataclass
class _FileGroup:
    """One distinct file of the attempt (bindings of the same bytes are merged)."""

    info: UploadInfo
    mapping: MappingRecord
    spec: MappingSpec
    upload_ids: list[str]
    duplicate: bool = False
    duplicate_of: str | None = None


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

    def execute(self, source: str, bindings: Sequence[FileBinding]) -> ImportReport:
        if not source.strip():
            raise InvalidInputError("source must be a non-empty name")
        if not bindings:
            raise InvalidInputError("An import needs at least one file")
        if len(bindings) > MAX_FILES_PER_IMPORT:
            raise LimitExceededError(
                f"An import can hold at most {MAX_FILES_PER_IMPORT} files; got {len(bindings)}"
            )
        started_at = self._clock.now()
        import_id = self._ids.new_id("imp")
        groups = self._load(source, bindings)
        pending = [g for g in groups.values() if not g.duplicate]
        total = sum(g.info.record_count for g in pending)
        if total > MAX_RECORDS_PER_FILE:
            raise LimitExceededError(
                f"The batch has {total} records to read; the limit is {MAX_RECORDS_PER_FILE}"
            )
        total_bytes = sum(g.info.size_bytes for g in pending)
        if total_bytes > MAX_BATCH_BYTES:
            raise LimitExceededError(
                f"The batch has {total_bytes} bytes to read; the limit is {MAX_BATCH_BYTES}"
            )
        first = next(iter(groups.values()))
        mapping_ref = _mapping_ref(first.mapping)

        def file_info(g: _FileGroup, status: str, records: dict[str, int]) -> FileInfo:
            return FileInfo(
                g.info.filename,
                g.info.sha256,
                g.info.size_bytes,
                g.info.format,
                g.info.record_count,
                mapping=_mapping_ref(g.mapping),
                status=status,
                records=records,
            )

        def duplicate_info(g: _FileGroup) -> FileInfo:
            info = file_info(g, "duplicate", _counts(duplicate=g.info.record_count))
            return replace(info, duplicate_of=g.duplicate_of)

        def build(
            status: str,
            records: dict[str, int],
            entities: dict[str, int],
            warnings: dict[str, int],
            reject_count: int,
            files: tuple[FileInfo, ...],
            error: str | None = None,
        ) -> ImportReport:
            return ImportReport(
                import_id=import_id,
                status=status,
                source=source,
                mapping=mapping_ref,
                started_at=started_at,
                finished_at=self._clock.now(),
                files=files,
                records=records,
                entities=entities,
                warnings=warnings,
                reject_count=reject_count,
                error=error,
            )

        duplicate_records = sum(g.info.record_count for g in groups.values() if g.duplicate)
        if not pending:
            files = tuple(duplicate_info(g) for g in groups.values())
            report = build("duplicate", _counts(duplicate=duplicate_records), {}, {}, 0, files)
            self._persist(report)
            return report

        outcomes: list[RecordOutcome] = []
        rejects: list[RejectRow] = []
        emissions: list[Emission] = []
        records: Counter[str] = Counter()
        warnings: Counter[str] = Counter()
        per_file: dict[str, Counter[str]] = {}
        try:
            for g in pending:
                sha = g.info.sha256
                counter = per_file[sha] = Counter()
                with self._store.open(sha) as stream:
                    for record in self._reader.read(stream, g.info.format):
                        result = _run_record(g.spec, record, sha)
                        outcome = _classify(result)
                        counter[outcome] += 1
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
                                file_sha256=sha,
                            )
                        )
                        rejects.extend(_reject_rows(result, record.payload, sha))
                        emissions.extend(result.emissions)
            prepared = prepare_claims(source, emissions, {g.info.sha256: g.spec for g in pending})
            with self._uow_factory() as uow:
                # Sessions known from earlier attempts seed the reducer, so merging
                # across files and attempts follows the same domain rules.
                ids = sorted({str(k) for k in _session_keys(emissions)})
                seeds = uow.traces.existing_sessions(source, ids)
                sessions = reduce_sessions(emissions, seeds)
                # The entity rows reference the import row, so it exists first as
                # "running" with every file row (duplicates are never marked committed),
                # and is finalised with the counts in the same transaction.
                running = tuple(
                    duplicate_info(g) if g.duplicate else file_info(g, "pending", _counts())
                    for g in groups.values()
                )
                uow.imports.add_report(build("running", _counts(), {}, {}, 0, running))
                stored = uow.traces.store(
                    import_id=import_id,
                    source=source,
                    bindings={g.info.sha256: g.mapping.id for g in pending},
                    emissions=emissions,
                    sessions=sessions,
                    claims=prepared.claims,
                )
                diagnostic_counts: dict[tuple[str, str], Counter[str]] = {}
                for diagnostic in stored.diagnostics:
                    key = (diagnostic.file_sha256, diagnostic.locator)
                    diagnostic_counts.setdefault(key, Counter())[diagnostic.code] += 1
                outcomes = [
                    replace(
                        o,
                        warning_counts=dict(
                            Counter(o.warning_counts)
                            + diagnostic_counts.get((o.file_sha256, o.locator), Counter())
                        ),
                    )
                    for o in outcomes
                ]
                file_warnings: dict[str, Counter[str]] = {}
                warnings.clear()
                for result_row in outcomes:
                    file_warnings.setdefault(result_row.file_sha256, Counter()).update(
                        result_row.warning_counts
                    )
                    warnings.update(result_row.warning_counts)
                uow.imports.add_claim_conditions(import_id, prepared.conditions)
                final = tuple(
                    duplicate_info(g)
                    if g.duplicate
                    else replace(
                        file_info(g, "committed", _counts(**per_file[g.info.sha256])),
                        warnings=dict(file_warnings.get(g.info.sha256, {})),
                        claim_conditions=tuple(
                            c for c in prepared.conditions if c.file_sha256 == g.info.sha256
                        ),
                    )
                    for g in groups.values()
                )
                all_records = _counts(**records)
                all_records["duplicate"] += duplicate_records
                report = build(
                    "committed",
                    all_records,
                    stored.entity_counts,
                    dict(warnings),
                    len(rejects),
                    final,
                )
                report = replace(report, duplicate_detection_version=COMPARISON_VERSION)
                uow.imports.update_report(report)
                uow.imports.add_results(import_id, outcomes, rejects)
                uow.commit()
            return report
        except ConflictError:
            # Another import of some of these bytes won the race: nothing of ours was
            # written, and which file collided is unknown, so every file is recorded
            # as failed (not duplicate) before the 409 propagates. Retrying is safe.
            files = tuple(file_info(g, "failed", _counts()) for g in groups.values())
            self._persist(
                build(
                    "failed",
                    _counts(),
                    {},
                    {},
                    0,
                    files,
                    error="ConflictError: lost a race with a concurrent import of the same bytes",
                )
            )
            raise
        except Exception as exc:  # noqa: BLE001 - a failed import is reported, never half-visible
            files = tuple(file_info(g, "failed", _counts()) for g in groups.values())
            report = build(
                "failed", _counts(), {}, {}, 0, files, error=f"{type(exc).__name__}: {exc}"
            )
            self._persist(report)
            return report

    def _load(self, source: str, bindings: Sequence[FileBinding]) -> dict[str, _FileGroup]:
        """Resolve and validate every binding; group bindings of the same bytes."""
        groups: dict[str, _FileGroup] = {}
        with self._uow_factory() as uow:
            for b in bindings:
                info = _load_upload(uow, b.upload_id)
                mapping, spec = _load_mapping(uow, b.mapping_id)
                if mapping.input_format != info.format:
                    raise InvalidInputError(
                        f"Mapping {mapping.name!r} reads {mapping.input_format}, "
                        f"but {info.filename!r} is {info.format}"
                    )
                group = groups.get(info.sha256)
                if group is None:
                    groups[info.sha256] = _FileGroup(info, mapping, spec, [b.upload_id])
                elif group.mapping.id != mapping.id:
                    raise InvalidInputError(
                        f"{info.filename!r} is bound to two different mappings in this batch"
                    )
                else:
                    group.upload_ids.append(b.upload_id)
            for g in groups.values():
                earlier = uow.imports.find_committed(g.info.sha256, source)
                g.duplicate = bool(earlier)
                g.duplicate_of = earlier[0].import_id if earlier else None
        return groups

    def _persist(self, report: ImportReport) -> None:
        with self._uow_factory() as uow:
            uow.imports.add_report(report)
            uow.imports.add_results(report.import_id, [], [])
            uow.commit()


def _mapping_ref(mapping: MappingRecord) -> MappingRef:
    return MappingRef(mapping.id, mapping.name, mapping.revision)


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
