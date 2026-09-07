# ADR-002: Occurrences, native claims and derived sessions

## Status

Accepted — 2026-09-07.

## Context

Trace exports can repeat native IDs and overlap without representing identical
events. A parent record can also change while one nested tool remains unchanged.
Treating native IDs or whole-record hashes as universal entity keys would lose
observations or incorrectly overwrite them.

The [verified dataset notes](../datasets/README.md#schema-caveats-and-redistribution-review)
cite TraceLab's pinned `DB_SCHEMA.md`: about **8,900 duplicated `round_id` IDs**,
**514 `trace_key` duplicates**, and a non-unique `(session_id, round_index)` pair.
These are upstream database-schema findings, not measurements of our fixture or
an exact contract for the released JSONL. TraceLab itself uses an ingestion
ordinal as a surrogate, as recorded in the consolidated plan.

## Decision

Keep three concepts separate:

| Concept | Meaning and use |
| --- | --- |
| Source-occurrence identity | `(raw file sha256, record locator, emission path)` identifies an observation emitted from immutable uploaded bytes. |
| Claimed native identity | Source values such as `session_id`, `round_id` and `tool_call_id`; retained, profiled and displayed as claims. |
| Entity projection comparison | Compare canonical fields of the same entity kind when scoped native claims match; do not compare parent-record hashes. |

Hash the raw file bytes, not a reserialised payload. Reader locators must be
deterministic (for example, a JSONL line or Parquet row locator). Emission paths
distinguish root and nested emissions, including array positions and distinct
rule emissions. Store raw provenance and the mapping revision for each entity
contribution so a decision can be traced back to its source.

The v0.1.0 guarantee is **exact-file idempotency**: re-importing an already
committed file adds no observations or metric totals. An import attempt may
still create audit outcomes. Mapping edits create revisions, not implicit
replacement of committed normalisation; bulk reprocessing is deferred.

Recompression, reordered rows or overlapping exports can change occurrence
identities. General reconciliation across such exports is deferred. The earlier
plan's overlap gate is not a stronger release guarantee than exact-file replay.

Use these distinctions in reconciliation diagnostics:

- **Duplicate**: an already accepted source occurrence; matching scoped native
  claims with equal canonical entity projections can also be classified as
  duplicates, with provenance retained. A native key alone proves neither case.
- **Suspected duplicate**: matching scoped native claims with different entity
  projections. Flag the ambiguity; do not silently overwrite or equate the
  distinct observations merely because their claimed IDs match.
- **Conflict**: incompatible contributions to an identity actually being reused,
  or an invalid relationship (for example a tool and parent in different
  sessions). Explain and reject the conflicting emission rather than overwrite
  accepted state. A suspected native-ID collision is not by itself proof of
  such a conflict.

Sessions are identity-reconciled derived entities. A validated source contract
declares the session key, scoped by source namespace and harness; the application
creates or reuses that session. TraceLab uses `session_id` and maps `provider`
to harness. Native claims may support session reconciliation only under that
validated contract, not a universal native-ID uniqueness assumption.

A fixed **domain reducer**, never the DSL, computes `observed_start_at` and
`observed_end_at` from accepted child timestamps. Bounds remain nullable where
evidence is unavailable. Their difference is the **observed span in imported
data**, not active time. Rejected children do not affect bounds.

Label counts **recorded model-call observations**. One TraceLab root row has
that grain; nested `tools[]` contribute tool observations. Verified data wins
over draft assumptions: `session_file` is absent throughout the release and
cannot supply identity. SWE-chat conversation entries are not proven model
invocations and must not be mapped as such without evidence of their grain.

## Consequences

Reports can explain exact duplicates, ambiguous claims and conflicts without
pretending to know the number of unique real-world invocations. Provenance
survives reconciliation. Cross-export counts carry the stated limitation.

Session identity and bounds stay consistent across mappings because identity
validation and reduction belong to fixed domain behavior. See
[ADR-004](ADR-004-mapping-dsl-v1.md) for the DSL boundary.

## Alternatives considered

- Native IDs as unique keys: contradicted by TraceLab's documented collisions.
- Whole-record hashes for nested entities: unrelated parent changes would distort tool comparison.
- Fuzzy cross-export deduplication: uncertain and outside the v0.1.0 guarantee.
- DSL grouping and aggregation for sessions: moves fixed identity and time semantics into user mappings.
