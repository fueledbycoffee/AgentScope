"""Batched SQLite claim index. Also usable with migration-local reflected tables."""

from __future__ import annotations

import json
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import asdict
from typing import Any

from sqlalchemy import Connection, Table, func, insert, select, text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from agentscope_app.domain.claims import COMPARISON_VERSION, ClaimCandidate, ClaimCondition

PAGE_SIZE = 128
TABLE_NAMES = (
    "claim_scopes",
    "claim_projections",
    "entity_claims",
    "claim_file_projections",
    "import_diagnostics",
    "import_claim_conditions",
)

# MATERIALIZED prevents SQLite from re-running probes when their aliases are used
# in the peer join and classification. Three seeks per incoming occurrence.
DETECTION_SQL = """
WITH candidates AS MATERIALIZED (
 SELECT c.*,
   (SELECT f.claim_id FROM claim_file_projections f
    WHERE f.scope_id=c.scope_id AND f.projection_sha256=c.projection_sha256
      AND f.file_sha256<>c.file_sha256 ORDER BY f.file_sha256 LIMIT 1) AS equal_id,
   (SELECT f.claim_id FROM claim_file_projections f
    WHERE f.scope_id=c.scope_id AND f.file_sha256<c.file_sha256
    ORDER BY f.file_sha256 DESC, f.projection_sha256 DESC LIMIT 1) AS lo_id,
   (SELECT f.claim_id FROM claim_file_projections f
    WHERE f.scope_id=c.scope_id AND f.file_sha256>c.file_sha256
    ORDER BY f.file_sha256, f.projection_sha256 LIMIT 1) AS hi_id
 FROM entity_claims c WHERE c.import_id=:import_id AND c.id>:after
 ORDER BY c.id LIMIT :limit
)
SELECT c.*, p.id AS peer_claim_id, p.import_id AS peer_import_id,
 p.file_sha256 AS peer_file_sha256, p.locator AS peer_locator,
 p.emission_path AS peer_emission_path, p.entity AS peer_entity
FROM candidates c LEFT JOIN entity_claims p ON p.id=coalesce(c.equal_id,c.lo_id,c.hi_id)
ORDER BY c.id
"""


def chunks[T](items: Sequence[T]) -> Iterator[Sequence[T]]:
    for start in range(0, len(items), PAGE_SIZE):
        yield items[start : start + PAGE_SIZE]


def locator_position(locator: str) -> int:
    tail = locator.rsplit(":", 1)[-1]
    return int(tail) if tail.isdecimal() else 0


class ClaimIndex:
    def __init__(self, connection: Connection, tables: Mapping[str, Table]) -> None:
        self.c, self.t = connection, tables

    def stage(
        self, import_id: str, bindings: Mapping[str, str], claims: Sequence[ClaimCandidate]
    ) -> None:
        scopes, projections, entities, files = (self.t[n] for n in TABLE_NAMES[:4])
        for page in chunks(claims):
            texts = sorted({c.scope_text for c in page})
            self.c.execute(
                sqlite_insert(scopes).on_conflict_do_nothing(),
                [{"version": COMPARISON_VERSION, "scope_text": s} for s in texts],
            )
            scope_ids = dict(
                self.c.execute(
                    select(scopes.c.scope_text, scopes.c.id).where(
                        scopes.c.version == COMPARISON_VERSION, scopes.c.scope_text.in_(texts)
                    )
                )
                .tuples()
                .all()
            )
            self.c.execute(
                sqlite_insert(projections).on_conflict_do_nothing(),
                [
                    {
                        "scope_id": scope_ids[c.scope_text],
                        "projection_sha256": c.projection_sha256,
                        "projection_text": c.projection_text,
                    }
                    for c in page
                ],
            )
            after = self.c.scalar(select(func.max(entities.c.id))) or 0
            self.c.execute(
                insert(entities),
                [
                    {
                        "scope_id": scope_ids[c.scope_text],
                        "projection_sha256": c.projection_sha256,
                        "import_id": import_id,
                        "mapping_id": bindings[c.occurrence.file_sha256],
                        "file_sha256": c.occurrence.file_sha256,
                        "locator": c.occurrence.locator,
                        "locator_position": locator_position(c.occurrence.locator),
                        "emission_path": c.occurrence.emission_path,
                        "rule_id": c.rule_id,
                        "entity": c.entity,
                    }
                    for c in page
                ],
            )
            inserted = (
                self.c.execute(
                    select(entities)
                    .where(entities.c.import_id == import_id, entities.c.id > after)
                    .order_by(entities.c.id)
                )
                .mappings()
                .all()
            )
            stmt = sqlite_insert(files)
            stmt = stmt.on_conflict_do_update(
                index_elements=["scope_id", "projection_sha256", "file_sha256"],
                set_={
                    "claim_id": stmt.excluded.claim_id,
                    "witness_sort": stmt.excluded.witness_sort,
                },
                where=stmt.excluded.witness_sort < files.c.witness_sort,
            )
            self.c.execute(
                stmt,
                [
                    {
                        "scope_id": r["scope_id"],
                        "projection_sha256": r["projection_sha256"],
                        "file_sha256": r["file_sha256"],
                        "claim_id": r["id"],
                        "witness_sort": f"{r['locator_position']:020d}:"
                        + json.dumps(
                            [r["locator"], r["emission_path"], r["entity"]], ensure_ascii=False
                        ),
                    }
                    for r in inserted
                ],
            )

    def detect(self, import_id: str) -> list[dict[str, Any]]:
        after = 0
        diagnostics: list[dict[str, Any]] = []
        while True:
            rows = (
                self.c.execute(
                    text(DETECTION_SQL),
                    {"import_id": import_id, "after": after, "limit": PAGE_SIZE},
                )
                .mappings()
                .all()
            )
            found = []
            for r in rows:
                if r["peer_claim_id"] is not None:
                    code = (
                        "matching_claim_equal_projection"
                        if r["equal_id"]
                        else "suspected_duplicate"
                    )
                    diagnostics.append({**r, "code": code})
                    found.append(
                        {
                            "import_id": import_id,
                            "claim_id": r["id"],
                            "peer_claim_id": r["peer_claim_id"],
                            "code": code,
                        }
                    )
            if found:
                self.c.execute(insert(self.t["import_diagnostics"]), found)
            if len(rows) < PAGE_SIZE:
                break
            after = rows[-1]["id"]
        return diagnostics

    def conditions(self, import_id: str, conditions: Sequence[ClaimCondition]) -> None:
        table = self.t["import_claim_conditions"]
        stmt = sqlite_insert(table)
        stmt = stmt.on_conflict_do_update(
            index_elements=["import_id", "file_sha256", "rule_id", "code"],
            set_={
                "affected_emissions": table.c.affected_emissions + stmt.excluded.affected_emissions
            },
        )
        for page in chunks(conditions):
            self.c.execute(stmt, [{"import_id": import_id, **asdict(c)} for c in page])
