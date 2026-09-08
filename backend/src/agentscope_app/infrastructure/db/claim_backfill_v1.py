"""0005 data adapter: recover v1 claims without importing current ORM models.

A bad historical file loses only comparison coverage, never startup availability.
Keep replay parity tests when changing the interpreter or frozen claim contract.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Iterator, Mapping
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Connection, MetaData, Table, Text, and_, cast, select, update

from agentscope_app.domain.claims import (
    PROJECTION_FIELDS,
    ClaimCondition,
    HarnessContext,
    prepare_claims,
)
from agentscope_app.domain.mapping.contract import MappingSpec
from agentscope_app.domain.mapping.interpreter import Emission, apply_mapping
from agentscope_app.domain.mapping.parser import parse_mapping
from agentscope_app.infrastructure.db.claims import PAGE_SIZE, ClaimIndex


class UnrecoverableError(ValueError):
    """Historical provenance does not justify rebuilding claims for this file."""


def _records(c: Connection, t: Mapping[str, Table], f: Mapping[str, Any]) -> Iterator[list[Any]]:
    rr, raw = t["record_results"], t["raw_records"]
    after = ""
    while True:
        rows = (
            c.execute(
                select(rr, raw.c.id.label("raw_id"), raw.c.payload)
                .select_from(
                    rr.outerjoin(
                        raw,
                        and_(raw.c.file_sha256 == rr.c.file_sha256, raw.c.locator == rr.c.locator),
                    )
                )
                .where(
                    rr.c.import_id == f["import_id"],
                    rr.c.file_sha256 == f["sha256"],
                    rr.c.locator > after,
                )
                .order_by(rr.c.locator)
                .limit(PAGE_SIZE)
            )
            .mappings()
            .all()
        )
        if not rows:
            break
        yield list(rows)
        after = rows[-1]["locator"]


def _replay(spec: MappingSpec, row: Mapping[str, Any], sha: str) -> tuple[Emission, ...]:
    if row["raw_id"] is None:
        raise UnrecoverableError(f"Missing raw provenance at {row['locator']}")
    if row["payload"] is None:
        emissions: tuple[Emission, ...] = ()
    else:
        emissions = apply_mapping(
            spec, row["payload"], file_sha256=sha, locator=row["locator"]
        ).emissions
    if dict(Counter(e.entity for e in emissions)) != row["entity_counts"]:
        raise UnrecoverableError(f"Replay emission counts disagree at {row['locator']}")
    return emissions


def _normal(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return value


def _verify(
    c: Connection,
    t: Mapping[str, Table],
    f: Mapping[str, Any],
    emissions: list[Emission],
    locators: list[str],
) -> None:
    contributions = t["entity_contributions"]
    rows = (
        c.execute(
            select(contributions).where(
                contributions.c.import_id == f["import_id"],
                contributions.c.file_sha256 == f["sha256"],
                contributions.c.locator.in_(locators),
            )
        )
        .mappings()
        .all()
    )
    expected = {
        (e.occurrence.locator, e.occurrence.emission_path, e.rule_id, e.entity): e
        for e in emissions
    }
    if len(rows) != len(expected):
        raise UnrecoverableError("Missing or extra entity contribution provenance")
    calls: dict[str, Mapping[str, Any]] = {}
    for kind in ("model_call", "tool_call"):
        ids = [r[f"{kind}_id"] for r in rows if r[f"{kind}_id"] is not None]
        table = t[f"{kind}s"]
        # One source record can emit many children. Bound ID reads independently.
        for start in range(0, len(ids), PAGE_SIZE):
            calls.update(
                {
                    r["id"]: r
                    for r in c.execute(
                        select(table).where(table.c.id.in_(ids[start : start + PAGE_SIZE]))
                    ).mappings()
                }
            )
    session_ids = {r["session_id"] for r in rows if r["session_id"] is not None}
    session_ids.update(r["session_id"] for r in calls.values())
    sessions: dict[str, str] = {}
    table = t["sessions"]
    ordered = sorted(session_ids)
    for start in range(0, len(ordered), PAGE_SIZE):
        sessions.update(
            dict(
                c.execute(
                    select(table.c.id, table.c.external_id).where(
                        table.c.id.in_(ordered[start : start + PAGE_SIZE])
                    )
                )
                .tuples()
                .all()
            )
        )
    for r in rows:
        kind = (
            "tool_call" if r["tool_call_id"] else "model_call" if r["model_call_id"] else "session"
        )
        key = (r["locator"], r["emission_path"], r["rule_id"], kind)
        e = expected.pop(key, None)
        if e is None or r["mapping_id"] != f["mapping_id"]:
            raise UnrecoverableError("Contribution does not match mapping replay")
        if kind == "session":
            if sessions.get(r["session_id"]) != e.fields["external_id"]:
                raise UnrecoverableError("Session contribution identity disagrees")
            continue
        stored = calls.get(r[f"{kind}_id"])
        if stored is None or stored["native_key"] != (list(e.native_key) if e.native_key else None):
            raise UnrecoverableError("Missing call or native key disagreement")
        if stored["source"] != f["source"]:
            raise UnrecoverableError("Call source namespace disagrees")
        for field in ("import_id", "file_sha256", "locator", "emission_path"):
            if stored[field] != r[field]:
                raise UnrecoverableError("Call provenance disagrees")
        for field in PROJECTION_FIELDS[kind]:
            if field == "external_id":  # only replay can recover this column in 0004
                continue
            actual = (
                sessions.get(stored["session_id"])
                if field == "session_external_id"
                else stored[field]
            )
            if _normal(actual) != _normal(e.fields.get(field)):
                raise UnrecoverableError(f"Call projection disagrees at {r['locator']}: {field}")


def _file(
    c: Connection,
    tables: Mapping[str, Table],
    f: Mapping[str, Any],
    spec: MappingSpec,
    index: ClaimIndex,
) -> None:
    context = HarnessContext()
    seen = 0
    for rows in _records(c, tables, f):
        for r in rows:
            context.add(_replay(spec, r, f["sha256"]))
            seen += 1
    if seen != f["record_count"]:
        raise UnrecoverableError("Missing record-result provenance")
    for rows in _records(c, tables, f):
        emissions = [e for r in rows for e in _replay(spec, r, f["sha256"])]
        _verify(c, tables, f, emissions, [r["locator"] for r in rows])
        prepared = prepare_claims(f["source"], emissions, {f["sha256"]: spec}, harnesses=context)
        index.stage(f["import_id"], {f["sha256"]: f["mapping_id"]}, prepared.claims)
        index.conditions(f["import_id"], prepared.conditions)


def backfill(c: Connection) -> None:
    meta = MetaData()
    meta.reflect(c)
    t = meta.tables
    index = ClaimIndex(c, t)
    files, mappings = t["import_files"], t["mappings"]
    cache: dict[str, MappingSpec] = {}
    after = ""
    while True:
        batch = (
            c.execute(
                select(
                    files.c.id,
                    files.c.import_id,
                    files.c.sha256,
                    files.c.source,
                    files.c.mapping_id,
                    files.c.record_count,
                )
                .where(files.c.committed.is_(True), files.c.id > after)
                .order_by(files.c.id)
                .limit(PAGE_SIZE)
            )
            .mappings()
            .all()
        )
        if not batch:
            break
        for file_row in batch:
            f = dict(file_row)
            # Start a real outer write before the per-file SAVEPOINT on SQLite.
            c.execute(update(files).where(files.c.id == f["id"]).values(warnings={}))
            try:
                warnings: Counter[str] = Counter()
                for rows in _records(c, t, f):
                    for r in rows:
                        warnings.update(r["warning_counts"])
                c.execute(
                    update(files).where(files.c.id == f["id"]).values(warnings=dict(warnings))
                )
                with c.begin_nested():
                    mapping_id = f["mapping_id"]
                    if mapping_id not in cache:
                        # Reflection sees the historical JSON column, whose engine
                        # decoder produces Decimal. Match PlainJson's text read and
                        # stdlib decoder so mapping literals/defaults retain floats.
                        document = c.scalar(
                            select(cast(mappings.c.document, Text)).where(
                                mappings.c.id == mapping_id
                            )
                        )
                        if document is None:
                            raise UnrecoverableError("Missing mapping revision")
                        parsed = parse_mapping(json.loads(document))
                        if not parsed.is_executable or parsed.spec is None:
                            raise UnrecoverableError("Stored mapping revision is not executable")
                        cache[mapping_id] = parsed.spec
                    _file(c, t, f, cache[mapping_id], index)
            except Exception as exc:  # data replay is best effort; never block startup
                index.conditions(
                    f["import_id"],
                    [
                        ClaimCondition(
                            f["sha256"],
                            "*",
                            "claim_backfill_unavailable",
                            0,
                            f"Historical comparison unavailable: {type(exc).__name__}: {exc}"[
                                :1000
                            ],
                        )
                    ],
                )
        after = batch[-1]["id"]
