"""Frozen comparison contract v1. Observations are never removed or reconciled here."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from agentscope_app.domain.identity import SourceOccurrence
from agentscope_app.domain.mapping.contract import MappingSpec, Rule
from agentscope_app.domain.mapping.interpreter import Emission

COMPARISON_VERSION = 1
MAX_CANONICAL_BYTES = 64 * 1024
PROJECTION_FIELDS = {
    "session": ("external_id", "agent", "repo", "user", "started_at", "ended_at"),
    "model_call": (
        "session_external_id",
        "external_id",
        "sequence",
        "provider",
        "model",
        "started_at",
        "ended_at",
        "token_semantics",
        "input_tokens",
        "output_tokens",
        "cache_read_tokens",
        "cache_creation_tokens",
        "reasoning_tokens",
        "is_error",
        "error_message",
    ),
    "tool_call": (
        "session_external_id",
        "external_id",
        "sequence",
        "tool_name",
        "started_at",
        "ended_at",
        "wall_latency_ms",
        "internal_latency_ms",
        "is_error",
        "exit_code",
        "status",
    ),
}
ConditionCode = Literal[
    "claim_scope_unavailable", "claim_projection_too_large", "claim_backfill_unavailable"
]


@dataclass(frozen=True)
class ClaimCondition:
    file_sha256: str
    rule_id: str
    code: ConditionCode
    affected_emissions: int
    message: str


@dataclass(frozen=True)
class ClaimCandidate:
    occurrence: SourceOccurrence
    entity: str
    rule_id: str
    scope_text: str
    projection_text: str

    @property
    def projection_sha256(self) -> str:
        return hashlib.sha256(self.projection_text.encode()).hexdigest()


@dataclass(frozen=True)
class ClaimPreparation:
    claims: tuple[ClaimCandidate, ...]
    conditions: tuple[ClaimCondition, ...]


def _json(value: Any) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )


def _value(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError("claim timestamps must be timezone-aware")
        return value.astimezone(UTC).isoformat(timespec="microseconds")
    return value


def canonical_projection(emission: Emission) -> str:
    return _json(
        {key: _value(emission.fields.get(key)) for key in PROJECTION_FIELDS[emission.entity]}
    )


def _key_contract(spec: MappingSpec, rule: Rule) -> str:
    selectors = [asdict(rule.select)]
    ancestor = rule
    while ancestor.parent is not None:
        ancestor = spec.rule(ancestor.parent)
        selectors.append(asdict(ancestor.select))
    # Target names, paths, transforms and conversion policies are semantic; IDs are not.
    return hashlib.sha256(
        _json(
            {
                "selectors": selectors,
                "fields": {key: asdict(rule.fields[key]) for key in sorted(rule.native_key)},
            }
        ).encode()
    ).hexdigest()


@dataclass
class HarnessContext:
    """File-local declarations, reusable by the paged migration's second pass."""

    files: dict[tuple[str, str], set[str]] = field(default_factory=dict)
    records: dict[tuple[str, str, str], set[str]] = field(default_factory=dict)

    def add(self, emissions: Sequence[Emission]) -> None:
        for e in emissions:
            if e.entity != "session" or e.fields.get("agent") is None:
                continue
            sha, locator = e.occurrence.file_sha256, e.occurrence.locator
            sid, agent = str(e.fields["external_id"]), str(e.fields["agent"])
            self.files.setdefault((sha, sid), set()).add(agent)
            self.records.setdefault((sha, locator, sid), set()).add(agent)

    def resolve(self, e: Emission, sid: str) -> str | None:
        if e.entity == "session":
            agent = e.fields.get("agent")
            return None if agent is None else str(agent)
        sha, locator = e.occurrence.file_sha256, e.occurrence.locator
        agents = self.records.get((sha, locator, sid)) or self.files.get((sha, sid), set())
        return next(iter(agents)) if len(agents) == 1 else None


def prepare_claims(
    source: str,
    emissions: Sequence[Emission],
    specs_by_file: Mapping[str, MappingSpec],
    *,
    harnesses: HarnessContext | None = None,
) -> ClaimPreparation:
    if harnesses is None:
        harnesses = HarnessContext()
        harnesses.add(emissions)
    claims: list[ClaimCandidate] = []
    counts: Counter[tuple[str, str, ConditionCode]] = Counter()
    contracts: dict[tuple[str, str], str] = {}
    for e in emissions:
        sha = e.occurrence.file_sha256
        spec = specs_by_file[sha]
        rule = spec.rule(e.rule_id)
        if not rule.native_key or any(e.fields.get(k) is None for k in rule.native_key):
            continue
        sid = str(e.fields["external_id" if e.entity == "session" else "session_external_id"])
        harness = harnesses.resolve(e, sid)
        if harness is None:
            counts[sha, e.rule_id, "claim_scope_unavailable"] += 1
            continue
        contract_key = (sha, rule.id)
        if contract_key not in contracts:
            contracts[contract_key] = _key_contract(spec, rule)
        scope = _json(
            [
                COMPARISON_VERSION,
                source,
                harness,
                e.entity,
                sid,
                contracts[contract_key],
                [[k, _value(e.fields[k])] for k in sorted(rule.native_key)],
            ]
        )
        projection = canonical_projection(e)
        if max(len(scope.encode()), len(projection.encode())) > MAX_CANONICAL_BYTES:
            counts[sha, e.rule_id, "claim_projection_too_large"] += 1
            continue
        claims.append(ClaimCandidate(e.occurrence, e.entity, e.rule_id, scope, projection))
    messages = {
        "claim_scope_unavailable": "Comparison unavailable: no unambiguous file-local harness.",
        "claim_projection_too_large": "Comparison unavailable: scope or projection exceeds 64 KiB.",
    }
    return ClaimPreparation(
        tuple(claims),
        tuple(
            ClaimCondition(sha, rule, code, count, messages[code])
            for (sha, rule, code), count in sorted(counts.items())
        ),
    )
