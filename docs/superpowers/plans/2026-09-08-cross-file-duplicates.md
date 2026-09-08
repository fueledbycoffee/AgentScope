# Plan: cross-file suspected duplicates (issue #33)

Revised for Phase 2, 2026-09-08. Branch: `feat/33-cross-file-duplicates`.
The revision-only commit precedes implementation under the Phase 2 instruction.

## Goal

Flag suspected duplicates across *different* files (two exports of the same sessions with different bytes) without changing any count, per ADR-002: a suspected duplicate is a matching scoped claim with a *different canonical entity projection*, not a repeated native id.

## Current state

Verified in this worktree at `e71f3b093f24d4f81152293798031d32c10f399d`:

- `docs/adr/ADR-002-identities.md` distinguishes occurrences, native claims,
  entity projections, and derived sessions. Equal projections are not suspected
  duplicates. Parent-record hashes are explicitly unsuitable for child comparison.
- `docs/superpowers/plans/2026-09-07-import-accounting-review-codex.md`, findings
  1–4 and 11, explains the definition, attribution, indexing, order, and synthetic
  test gaps. Revision 2 of `2026-09-07-import-accounting.md` removes this work
  from #9; its records/rejects browsers and original-import links now exist.
- `backend/src/agentscope_app/domain/mapping/interpreter.py`: `Emission` contains
  entity, rule ID, fields, occurrence, optional composite `native_key`, and
  optional parent occurrence. `_emit` produces no key if any key component is
  null. `Diagnostic` and `RecordResult.warnings` already describe nonfatal issues.
- `backend/src/agentscope_app/domain/schema.py` defines the complete canonical
  fields. `backend/mappings/tracelab-v1.json` claims model calls by `trace_key`
  mapped to `external_id`, tools by `tool_call_id`, and maps provider to the
  session's `agent` harness label. Do not substitute `round_id` for this mapping.
- `backend/src/agentscope_app/application/use_cases/imports.py`: `CommitImport`
  groups exact bytes, reads all pending files, and collects accepted emissions
  before one transaction. It calls `existing_sessions(source, ids)`, then
  `reduce_sessions`, then `traces.store`. Mapping warning counts enter individual
  `RecordOutcome` objects and the attempt report. There is no file warning map.
- `backend/src/agentscope_app/domain/reducer.py` folds session declarations and
  accepted child counts/bounds. Seeds and accumulators are keyed by external ID;
  conflicting metadata keeps the first value. The current session storage key is
  `(source, external_id)`, despite ADR-002's harness-scoped contract. Reading a
  merged session's `agent` would make claim attribution depend on import order.
- `backend/src/agentscope_app/application/ports.py`: `TraceRepository.store`
  returns only `dict[str, int]` inserted-entity counts. `existing_sessions` is the
  existing merge point, not a native-claim lookup or a projection store.
- `backend/src/agentscope_app/infrastructure/db/models.py` and `repositories.py`:
  call claims are JSON `native_key`; indexes cover occurrences, sessions, and
  tool parents. Call rows omit canonical `external_id`; session rows contain
  merged values, not individual contribution projections. `EntityContribution`
  retains original mapping, file, locator, rule, and emission path; `RawRecord`
  retains decoded payload with the exact-number codec.
- `repositories.py` inserts in 500-row chunks. Exact-file uniqueness is enforced
  by `uq_import_files_committed_source`. `ImportFile` has per-file outcomes and
  committed status, but no warnings. `RecordResult` stores warning counts.
  Alembic currently ends at `0004_upload_profile.py` (revision `0004`).
- `application/use_cases/queries.py`, `interfaces/api/routers.py`, and
  `docs/api/v0.1.md`: import report/history, records, rejects, and raw-record
  routes exist. Records are paginated in SQL by file and numeric locator.
- `web/src/pages/Imports.tsx`: `ImportsPage`, `ReportPage`, `Records`, `Rejects`,
  and `CountPanel` exist. Report warnings are generic; history lacks a warning
  surface. `web/src/api/types.ts` exposes warnings on `ImportReport` only,
  although the backend history returns complete reports. `SourceRecordDialog`
  in `web/src/components/source.tsx` displays lossless `payload_text`.
- Existing regression anchors: `backend/tests/infrastructure/test_database.py`,
  `test_multifile_import.py`, `backend/tests/interfaces/test_api_multifile.py`,
  `web/src/App.test.tsx`, and `web/e2e/smoke.spec.ts`. The smoke project only
  selects `smoke.spec.ts`; new browser coverage must actually be selected.
  The #9 review records 4,770 distinct fixture native IDs; synthetic collisions
  are necessary. No local `AGENTS.md` was found.

## Design

### 1. Claim and projection contract, version 1

Implement framework-free `domain/claims.py`: frozen `ClaimCandidate`,
`ClaimCondition`, `ClaimPreparation`, `prepare_claims(source, emissions,
specs_by_file)` and `canonical_projection(emission)`. Freeze these schema-v1 fields:

| Kind | Projection fields |
| --- | --- |
| session | external_id, agent, repo, user, started_at, ended_at |
| model_call | session_external_id, external_id, sequence, provider, model, started_at, ended_at, token_semantics, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, reasoning_tokens, is_error, error_message |
| tool_call | session_external_id, external_id, sequence, tool_name, started_at, ended_at, wall_latency_ms, internal_latency_ms, is_error, exit_code, status |

Canonical JSON uses sorted keys, compact separators, exact integers, UTC fixed
microseconds, unmodified Unicode and explicit null for absent optional fields.
Null, false, zero and empty strings remain distinct. Session projections describe
individual declarations, never reducer aggregates. Tools exclude parent model,
tokens and raw payload. Changed inherited session_external_id moves the child's
scope too; parent-independence tests use model/input_tokens, not session identity.

Scope includes version, source namespace, harness, entity, session external ID,
and sorted typed native components. Read values from emission.fields using
specs_by_file[file].rule(rule_id).native_key, never stringified Emission.native_key.
Reapply any-null-component ineligibility; empty strings are literal keys.
Fingerprint each key field's complete parsed mapping (paths, transforms, defaults,
conversion policies), selector and ancestor selectors. Rule names and mapping
revision IDs are excluded. Revisions with unchanged extraction compare; switching
from trace_key to round_id does not.

Retain ADR-002 harness scoping for all entities, deliberately stricter than the
reducer's (source, external_id) storage identity. Different declared agents do not
compare, although reduction still reports metadata conflicts. Provider changes
that change harness lose comparison coverage; unmapped providers yield a condition.
Agent stays in the projection despite being invariant within a scope. Do not change
counts or session identity to align these contracts in this issue.

Sessions use their own agent. Children resolve same-file session declarations:
prefer one unambiguous non-null agent in the same record, else one in the whole
file. Conflicting same-record declarations do not fall back. Gather declarations
before resolving, including later declarations. Never use reducer seeds, another
file, model providers or parent content as a harness substitute. No session rule
means implicit sessions still work, but claimed children cannot be compared.

Record claim_scope_unavailable once per (file, rule) with affected_emissions count
in import_claim_conditions, never in emission diagnostics or record/file/attempt
warning counters. Oversize canonical scope or projection (maximum 64 KiB UTF-8 each)
is skipped with aggregated claim_projection_too_large; never index truncations.

### 2. Participation, equality and accounting

Suspected means another file has the same scope **and no peer file holds an equal
projection**. Equal peers take precedence over differing peers. Equal matches get
matching_claim_equal_projection; otherwise a peer scope yields suspected_duplicate;
no peer yields no diagnostic. Both codes count once per incoming emission and
include one stable peer. Identical re-exports A={P1,P2}, B={P1,P2} get only the equal
code. These diagnostics never change the five record outcomes or entity counts.

Stage all pending files before detection, including accepted children of partial
records. Within-file repetitions cannot qualify one another. Batch results are
independent of file/chunk order. A then B changes only B's report; earlier reports
stay immutable. Exact replay adds no claims/warnings and retains its original link.
Preview remains sample-only and does not detect peers.

### 3. Bounded persisted representation

Migration 0005_cross_file_claims.py has parent 0004. Add ORM tables:

| Table | Shape |
| --- | --- |
| claim_scopes | id PK, version, scope_text UNIQUE(version,scope_text) |
| claim_projections | scope_id + projection_sha256 PK, exact projection_text (not indexed) |
| entity_claims | id PK, scope_id, projection_sha256, import_id, mapping_id, file_sha256, locator, locator_position, emission_path, rule_id, entity; unique incoming occurrence; index(import_id,id) |
| claim_file_projections | scope_id + projection_sha256 + file_sha256 PK, witness claim_id and witness_sort; index(scope_id,file_sha256,projection_sha256) |
| import_diagnostics | id PK, import_id, claim_id, peer_claim_id, code; UNIQUE(import_id,claim_id,code) |
| import_claim_conditions | import_id + file_sha256 + rule_id + code PK, affected_emissions, message |
| import_files | additive non-null warnings JSON default {} |
| imports | additive nullable duplicate_detection_version |

SHA-256 projection identity uses the same practical collision assumption as raw
file identity. Store exact text once per scoped digest, out of indexes. Scope text
is bounded to 64 KiB. The synthetic 100k-emission benchmark must keep new tables
plus indexes below 6 times existing entity/contribution tables; report actual bytes.

Use SQLite on_conflict_do_nothing for scopes/projections and deterministic witness
upserts for file projections. Intern scopes with batched inserts and bounded bulk
reads. Insert claims with executemany, read by import/id in 128-row keyset pages.
Add an import/file/locator index on entity_contributions for historical replay.
Choose within-file witnesses by numeric locator, locator text, emission path,
entity, independent of insert ID.

One indexed max-ID read bounds the detection pass, avoiding an extra empty page
when the candidate count is a multiple of 128. Each page runs one SELECT with
three indexed scalar probes: an equal projection in another file (skip at most one own-file row), and a scope witness
from file hashes strictly below/above the incoming file (each LIMIT 1). File-range
probes use index(scope_id,file_sha256,projection_sha256) and scan no own-file rows,
even if one file has many projections. Prefer equal witness, else a stable witness
from the two ranges. Projection ranges alone could skip many own-file projections,
so this strengthens the review's suggested bound. At most 128 diagnostic rows and
bounded parameters per page, no per-candidate SQL reads. Exact text is not indexed.

### 4. Migration and backfill

Use claim_backfill_v1.py with migration-local reflected tables, not live ORM,
the frozen v1 comparison functions and mapping interpreter. Read stored mappings
and exact decoded raw records, not uploads. Keyset-page records at 128, resolve
file-local declarations in a first pass, replay claims in a second pass. Filter
against recorded contributions by entity/rule/locator/path. Verify native tuples
and persisted canonical call fields, normalizing database datetime/boolean values.
Never replay reduction or change observations, metrics, outcomes or committed flags.

Missing raw/contribution/mapping provenance, non-executable mapping or replay
mismatch rolls back only that file's backfill savepoint, skips its claims and adds
claim_backfill_unavailable with the reason to conditions. Data conditions must
never abort startup. Historical duplicate_detection_version stays null even with
recovered peers: historical warnings were never checked. No retrospective collision
diagnostics. Historical file warning maps sum stored record warnings; failed/replay
files have {}. Downgrade removes only additions in dependency order; re-upgrade
rebuilds safely. Golden replay tests guard future interpreter compatibility.

### 5. Application and API

Frozen DTO additions: DiagnosticPeer(import_id,file_sha256,locator,emission_path,
entity), ImportDiagnostic(file_sha256,locator,emission_path,rule_id,entity,code,
message,peer), TraceStoreResult(entity_counts,diagnostics). Codes are typed as
suspected_duplicate or matching_claim_equal_projection. Add defaulted FileInfo.warnings,
FileInfo.claim_conditions and ImportReport.duplicate_detection_version: int | None.
Round-trip add_report/update_report/_to_dto. Conditions live separately and appear
per file in report/history and in the diagnostics envelope.

TraceRepository.store(..., claims=()) returns TraceStoreResult. Prepare claims,
pass to storage, add diagnostic counts to immutable RecordOutcome values, sum
record -> file -> attempt warnings. Conditions do not enter that invariant. Persist
conditions and diagnostics with claims/entities/results/final report in the same
unit of work. Failed/replay-only version is null. Successful newly checked imports
use version 1, with conditions explaining any coverage holes.

Narrow IntegrityError translation in store to model/tool occurrence UNIQUE failures.
Unrelated claim/FK/integrity errors remain real failed-import causes, not 409 byte
races. Interning uses upserts. Test rollback and unchanged preexisting peers.

Add ListImportDiagnostics/repository method and wire container/router:
GET /api/imports/{id}/diagnostics?code=&file_sha256=&locator=&limit=&offset=
returns {items,total,conditions}. Version lives only on report/history. Total
supports warning reconciliation/pagination without fetching all rows; existing
list routes stay bare arrays. Conditions are bounded by file/rule, file-filtered,
separate from emission total/pagination. Only the two emission codes are accepted.
Unknown import is 404; invalid filters follow API validation. Stable SQL order:
file, numeric locator, locator text, emission path, entity, code. Peer references
resolve existing raw-record/report routes. Reads never recompute comparisons.

No web/src changes in this phase (owner instruction). PR_BODY.md describes report/
history notices, filters, evidence links and unavailable-state UI follow-up. Existing
generic warnings carry new codes. Session detail gets no new duplicate marker;
its reducer diagnostics remain separate. Docs describe shipped API, not completed
UI. An ADR-002 amendment pins equal-peer precedence. No session identity migration,
assistant or metric changes.

## Files touched

- This plan (revision-only first commit); review stays read-only.
- backend/src/agentscope_app/domain/claims.py (new).
- backend/src/agentscope_app/application/{dto.py,ports.py,use_cases/imports.py,use_cases/queries.py}.
- backend/src/agentscope_app/infrastructure/db/{models.py,repositories.py,claims.py,
  claim_backfill_v1.py,alembic/versions/0005_cross_file_claims.py} (last three new).
- backend/src/agentscope_app/interfaces/api/{container.py,routers.py}.
- backend/tests/domain/test_claims.py (new); backend/tests/infrastructure/
  test_cross_file_claims.py (new), test_database.py, test_multifile_import.py;
  backend/tests/application/{fakes.py,test_import_use_cases.py};
  backend/tests/interfaces/test_api_cross_file_diagnostics.py (new).
- docs/adr/ADR-002-identities.md (amendment only); docs/api/v0.1.md;
  docs/architecture/import-pipeline.md;
  docs/verification/2026-09-08-cross-file-duplicates.md (new).
- PR_BODY.md at root, deliberately uncommitted.

Replay tests and expected documents are read-only regression gates. No dependencies,
web/src, datasets, environment files, board, gh, pushes or other worktree changes.

## Tests

Synthetic cases (plus parametrized regressions):

- Domain: test_projection_v1_normalizes_null_and_utc_without_rounding,
  test_composite_claims_keep_names_types_and_boundaries,
  test_null_empty_and_missing_claim_parts, test_harness_resolution_is_file_local,
  test_changed_agent_and_provider_lose_coverage,
  test_compatible_mapping_revisions_compare,
  test_parent_changes_leave_child_projection_equal, test_projection_size_limit.
- Storage/import: test_equal_and_different_projections_across_committed_files,
  test_identical_reexport_with_repeated_native_keys_is_not_suspected,
  test_healthy_optional_unmapped_field_has_one_condition_per_file_rule,
  test_same_attempt_is_order_independent, test_matching_equal_projection_is_counted,
  test_detection_matches_bruteforce_oracle, test_lookup_uses_indexes_and_bounded_pages.
- Migration: test_0005_backfill_matches_live_claims,
  test_0005_missing_provenance_upgrade_succeeds_unchecked,
  test_0005_replay_mismatch_upgrade_succeeds_unchecked,
  test_0005_upgrade_downgrade_upgrade; preserve snapshots/metrics/idempotency.
- Integration: extend failure-after-store rollback and race-loser tests with unrelated
  integrity errors; retain exact replay, partial records and warning rollup checks.
- API: test_commit_get_history_and_peer_evidence,
  test_diagnostics_filters_order_and_pages,
  test_diagnostics_unknown_import_invalid_filter_and_empty.
- Performance: synthetic 100k emissions, repeated/distinct scopes; EXPLAIN plans,
  statement/bind counts and numeric storage budget in verification document.

Every implementation commit must pass:

```sh
uv --directory backend run ruff format
uv --directory backend run ruff check src tests
uv --directory backend run mypy src
uv --directory backend run lint-imports
uv --directory backend run pytest -q
```

## Acceptance checks mapped to the issue's tasks

| Task | Evidence |
| --- | --- |
| Scoped comparison | Frozen field/type/harness/key-contract tests |
| Indexed claims and safe 0005 backfill | Parity, missing provenance, mismatch, downgrade, SQL plans |
| Equal/different/repeated/batch behavior | Oracle, equal multisets, order independence |
| Counted diagnostics, unchanged observations | Warning rollup, entity/outcome/replay/rollback regressions |
| Report/history/provenance | API round-trip/filter/evidence tests; UI deferred by owner |

## Risks

Harness identity differs from reducer storage; changed harnesses and child-only
files cannot compare. Conditions expose unavailable scope without flooding warnings.
Digests assume SHA-256 collision resistance. Oversize claims are explicitly skipped.
Missing historical provenance must not block startup. Versioned replay needs future
compatibility coverage. Separate-attempt reports remain temporal snapshots.

## Cost estimate

3–4 engineering days equivalent: comparison/indexing 1 day, backfill/integration
1–1.5 days, API/verification 1–1.5 days. UI outside this phase. Small green commits
separate domain, persistence, integration. Every commit ends with:

Co-Authored-By: Codex (gpt-6-astra) <noreply@openai.com>

## Revision after review

1. **P1 accepted:** one scope condition per file/rule with count, outside all warning
   counters; implicit sessions still work. Test a healthy optional-unmapped import.
2. **P1 accepted:** skip unrecoverable backfill files in savepoints; record reason,
   leave version null. Test missing-provenance upgrade succeeds.
3. **P1 accepted:** SQLite conflict upserts; only occurrence UNIQUE errors become
   byte races. Test unrelated integrity error yields failed with actual cause.
4. **P2 accepted:** no equal peer is required for suspected. Test identical repeated
   multisets. Use indexed file ranges for bounded witnesses.
5. **P2 decision:** retain ADR harness scope, document stricter identity than storage;
   test changed agent/provider coverage loss and unmapped condition.
6. **P2 accepted:** fingerprint extraction paths/transforms/policies/selectors;
   compatible revisions compare, different key source paths do not.
7. **P2 accepted:** matching_claim_equal_projection counts equal peers with evidence;
   no change to records, observations or metrics.
8. **P2 accepted:** digest indexes, exact projection once per scope/digest, 64 KiB
   limit with condition, numeric 6x storage budget at 100k synthetic emissions.
9. **P3 accepted:** typed fields and reapplied null eligibility, int/string composite test.
10. **P3 accepted:** envelope total for reconciliation/pagination; version on reports;
    existing Console Pagination does not consume total today.
11. **P3 accepted:** defaulted DTO fields and all persistence round-trips explicit.
12. **P3 accepted:** inherited session changes scope; independence uses model/tokens.
13. **P3 partly deferred by owner:** no web edits/e2e; UI follow-up specifies in-memory
    upload buffers plus POST /api/mappings and App.test.tsx warnings mock correction.
    Preserve replay expectations, correct API history wording, state no session marker.
