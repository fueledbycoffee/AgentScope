# Plan: cross-file suspected duplicates (issue #33)

Phase 1, 2026-09-08. Branch: `feat/33-cross-file-duplicates`.
This change set contains this plan only. Implementation follows cross-review
and the coordinator's second-run instruction.

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

Implement pure functions and frozen dataclasses in `domain/claims.py`:

```python
prepare_claims(
    source: str,
    emissions: Sequence[Emission],
    specs_by_file: Mapping[str, MappingSpec],
) -> ClaimPreparation
canonical_projection(emission: Emission) -> str
```

`ClaimPreparation` contains `claims: tuple[ClaimCandidate, ...]` and scope
diagnostics. A candidate carries `SourceOccurrence`, entity, rule ID,
`scope_text`, `projection_text`, and comparison version. These functions know
nothing about the database or HTTP.

Claim scope is the exact canonical JSON tuple of comparison version, source
namespace, harness, entity kind, session external ID, and native-key definition
plus values. Key components are sorted by target field name (retaining all
components) and encoded as typed canonical values, not delimiter-joined strings.
Thus different key definitions do not accidentally collide; reordering a
composite key declaration does not change its meaning. Mapping revision, rule
name, filename, locator, and occurrence IDs are provenance, not scope. Compatible
mapping revisions can compare. Source is the import namespace, not the mapping
document's suggested source.

For sessions, use the declaration's own `external_id` and `agent`. For children,
resolve harness from session declarations with the same session external ID in
the same file: first the same record, if it has one unambiguous non-null harness;
otherwise the whole file, if it has exactly one non-null harness. Examine the
whole file before resolving, so a later declaration works. A conflicting
same-record declaration is unresolved, rather than overridden by a fallback.
Do not infer harness from model provider strings, parent model content, another
pending file, or the reducer seed. This also makes backfill independent of the
batch in which the file originally arrived.

Missing harness or ambiguous declarations mean comparison is unavailable for
that claimed emission: emit `claim_scope_unavailable` once with its occurrence,
and do not index an invented shared null harness. A child-only file without a
local harness declaration has this explicit limitation. Missing native keys
(including any null composite component) are simply ineligible; do not invent
claims from sequence, parent ID, or an empty tuple. A present empty string is a
literal value, distinct from null. Include tests for this decision.

Both model and tool claims are scoped to the session. A tool's parent occurrence
or parent projection is not part of its scope. This intentionally permits a
session-scoped tool-ID collision to be flagged across different parents; it does
not assert that those tools are the same invocation. A future validated contract
requiring parent-scoped IDs needs another comparison version.

Compare every field of the entity's target-schema-v1 projection, including its
canonical external ID and relationship session ID. For session emissions this
means the declaration, not the reduced aggregate or observed bounds/counts.
Freeze the version-1 field lists in the comparison module, rather than allowing
a future schema addition to silently change old projections:

| Kind | Projection fields |
| --- | --- |
| session | external_id, agent, repo, user, started_at, ended_at |
| model_call | session_external_id, external_id, sequence, provider, model, started_at, ended_at, token_semantics, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, reasoning_tokens, is_error, error_message |
| tool_call | session_external_id, external_id, sequence, tool_name, started_at, ended_at, wall_latency_ms, internal_latency_ms, is_error, exit_code, status |

Use sorted compact exact JSON, UTC timestamps with fixed microsecond precision,
canonical integer values, and JSON booleans. Unmapped optional fields and explicit
null both project to null; their existing `absent`/`null` warnings remain distinct.
Zero, false, empty string, and null are distinct. Preserve Unicode string values
without case-folding. Do not round integers through floating point. A tool
projection excludes all parent fields, raw JSON, mapping metadata, and generated
database IDs. Reordered raw keys or recompression cannot change a projection.

Equal scoped projections receive no `suspected_duplicate` warning and remain
accepted observations. Different scoped projections receive the warning, also
remaining accepted. This issue does not classify equal cross-file observations
as the record outcome `duplicate` or implement general reconciliation.

### 2. Deterministic participation and counting

For an accepted incoming emission `e`, the predicate is:

```text
exists accepted peer p:
    scope(p) = scope(e)
    and file_sha256(p) != file_sha256(e)
    and projection(p) != projection(e)
```

Peers include committed observations and all accepted emissions from every
pending file in this attempt. Stage all candidate claims before detection, so
both files qualify in a mixed-projection batch, even inside the same chunk.
Count one warning per qualifying incoming emission, irrespective of peer count.
Repeated claims within one file cannot qualify each other, but each repetition
can independently qualify against another file. Rejected/ignored emissions and
exact-file replay bindings supply no new candidates. Accepted children of a
partial record participate normally.

Persist warnings only on incoming records and files. Earlier report snapshots
are not rewritten. Therefore A then B warns B; B then A warns A; importing A and
B together warns both. File order inside that same batch and chunk size must
produce identical warnings. Separate-attempt history is intentionally temporal.
An exact replay reports its existing duplicate outcomes and zero new diagnostic
warnings, with the existing original-import link.

Session declaration emissions participate under the same predicate; a warning
does not mean a new derived session was inserted. Reduction, conflict handling,
session IDs, all five record outcomes, entity insertion counts, token totals,
and observed bounds follow precisely the pre-feature path.

### 3. Indexed representation and bounded detection

Add migration `0005_cross_file_claims.py`, based on the verified `0004` head,
and corresponding ORM models. Coordinator resolves migration numbering if
another issue changes the head before implementation; do not merge/rebase here.

| Table/change | Columns and constraints |
| --- | --- |
| `claim_scopes` | integer `id` PK; `version` integer; exact `scope_text` TEXT with UNIQUE(version, scope_text) |
| `entity_claims` | integer `id` PK; `scope_id` FK; `import_id` FK; `mapping_id` FK; `file_sha256` FK; `locator`; numeric `locator_position`; `emission_path`; `rule_id`; `entity`; exact `projection_text` TEXT; UNIQUE(import_id, file_sha256, locator, emission_path, entity); index(import_id, id) |
| `claim_file_extrema` | `scope_id` FK + `file_sha256` FK composite PK; `min_projection` TEXT; `max_projection` TEXT; `min_claim_id` and `max_claim_id` FKs to entity_claims; indexes(scope_id, min_projection, file_sha256) and (scope_id, max_projection, file_sha256), BINARY collation |
| `import_diagnostics` | integer `id` PK; `import_id` FK; `file_sha256` FK; `locator`; numeric `locator_position`; `emission_path`; `rule_id`; `entity`; `code`; `message`; nullable `peer_claim_id` FK; UNIQUE(import_id, file_sha256, locator, emission_path, entity, code); index(import_id, code, file_sha256, locator_position, locator, emission_path, entity) |
| `import_files` | additive non-null JSON `warnings`, default `{}` |
| `imports` | additive nullable integer `duplicate_detection_version`; legacy/failed/replay-only attempts null; successfully checked new imports 1 |

The extrema table is a rebuildable acceleration index, with one row per scoped
claim per distinct file, even when a file repeats it thousands of times. Retain
every individual indexed claim and provenance in `entity_claims`. Exact canonical
text comparisons avoid making hash collision resistance part of projection
equality. The extra text index storage is a deliberate cost to measure.

Algorithm inside the existing commit transaction:

1. Prepare candidates outside SQL from the complete accepted emission set and
   file bindings. Keep `existing_sessions` and `reduce_sessions` for their current
   purpose; do not turn reducer conflicts into duplicate warnings.
2. Persist entities exactly as today. Insert all eligible claims in bounded
   executemany batches; intern scopes with UNIQUE-backed upserts. Update extrema
   for every `(scope, file)` represented, considering all staged rows. For equal
   extrema choose the witness by file, numeric locator, locator text, emission
   path, and entity, not insertion ID. Complete this for every file before step 3.
3. Select current-attempt candidate IDs in chunks of at most 128. One SQL
   detection SELECT per chunk uses four correlated, indexed range probes against
   extrema: `min_projection < incoming`, `min_projection > incoming`,
   `max_projection < incoming`, and `max_projection > incoming`, each constrained
   to the scope and a different file, ordered by indexed projection then file,
   `LIMIT 1`. At most one row in each projection range belongs to the incoming
   file, because `(scope, file)` is unique. Thus even a hot repeated claim does
   not require scanning all observations or returning all peers. Select one
   stable witness from the at-most-four results; join that claim for provenance.
4. Return at most one suspected diagnostic per candidate. Scope-unavailable
   diagnostics join the same typed transport. No candidate-by-candidate SQL
   round trips and no unbounded `IN`/tuple-IN over raw keys. Use at most 128
   candidate-ID parameters plus fixed predicates (below SQLite's conservative
   999-variable ceiling). Batched writes use executemany, not one giant VALUES
   statement with one bind per field per row.

Why extrema suffice: a file has any projection different from P iff its minimum
or maximum projection differs from P. Four strict ranges implement that without
a scan over a bucket of identical projections. Equal extrema provide no warning.
Exact SQL text ordering need not be semantic ordering; it only needs to be a
stable total order shared by the canonical strings and extrema indexes.

The single detection query per chunk is separate from batched claim writes and
scope interning. Intern distinct scope texts with batched upserts and bounded
bulk ID reads, never one read per emission. Record these separately in
performance evidence, rather than advertising one total database query. Keep claim helpers in
`infrastructure/db/claims.py` to contain the SQL. No new dependency is required.

### 4. Migration and backfill

Backfill all committed entity contributions, including session declarations,
using stored mapping revisions and `raw_records` joined by file and locator.
Read payloads with the exact-number codec. Replay only the mapping interpreter
against stored decoded records to recover original per-emission fields, key
definitions, and local harness declarations; never rerun the importer/reducer,
read uploaded files, call an assistant, or write observations/metric totals.
Filter replayed emissions against the recorded contribution's entity, rule,
locator, and emission path. For calls verify the recovered native tuple and
every persisted canonical column against the stored call before indexing.
This recovery is needed because call `external_id` and original session values
are not stored in the call/aggregate columns.

Use a versioned `claim_backfill_v1.py` adapter with migration-local table
definitions rather than current ORM models. Process records with keyset batches
of 128, cache mapping parses, and use a first pass over declarations for
file-local harness resolution, followed by a claim pass. Do not materialize an
entire database of emissions. Backfill uses the same frozen projection contract
as new writes. Golden old-database tests pin interpreter replay behavior; any
future incompatible interpreter change must preserve this migration adapter.

If provenance is missing, a stored mapping is not executable, or replay disagrees
with a persisted call, fail upgrade with the affected import/file/locator and an
actionable provenance-repair message. Do not fabricate projections from merged
session values or silently label a partial backfill complete. Test transaction
rollback and rerunning upgrade after repair. Null keys and unresolved harnesses
are explicitly ineligible, not corrupt provenance.

Rebuild extrema from backfilled claims. Populate each historical file's warning
map by summing its existing record warning counts. Leave historical attempt and
record warning snapshots untouched: migration does not retrospectively detect
collisions, and `duplicate_detection_version = null` communicates that. Failed
and replay-only files have `{}`. Backfill must not promote any file's committed
flag or alter the existing exact-file unique index. Downgrade drops only the
new diagnostics/index tables and additive columns, in FK dependency order.

### 5. Typed diagnostics and accounting integration

Add frozen application DTOs:

```python
DiagnosticPeer(import_id, file_sha256, locator, emission_path, entity)
ImportDiagnostic(file_sha256, locator, emission_path, rule_id, entity,
                 code, message, peer: DiagnosticPeer | None)
TraceStoreResult(entity_counts: dict[str, int],
                 diagnostics: dict[tuple[str, str], tuple[ImportDiagnostic, ...]])
```

Diagnostic keys are `(file_sha256, locator)`; identity additionally includes
emission path, entity, and code. Code is typed as
`Literal['suspected_duplicate', 'claim_scope_unavailable']`. A suspected duplicate
requires one peer; unavailable scope has none. Peer IDs never imply replacement
or point at rejected observations.

Change `TraceRepository.store(..., claims: Sequence[ClaimCandidate])` to return
`TraceStoreResult`; update the real repository, fakes, and direct repository
test callers. The application combines preparation and stored diagnostics,
adds their counts to the matching immutable `RecordOutcome` via `replace`, and
persists diagnostic rows using `ImportRepository.add_diagnostics(import_id,
diagnostics)`. `FileInfo.warnings` is a defaulted additive dict. Compute all file
warnings from final outcomes, then the attempt warning map from file maps.

For each warning code C on a newly committed attempt:

```text
report.warnings[C] = sum(file.warnings[C])
file.warnings[C] = sum(record.warning_counts[C] for that file)
suspected_duplicate count = number of qualifying incoming emissions
```

Preserve mapping-generated `absent`, `null`, and other warnings. A record may
have two suspected emissions and still be one accepted/partial source record.
Use only `stored.entity_counts` for entity counters; `RECORD_OUTCOMES` stays
exactly accepted/partial/duplicate/rejected/ignored. Unavailable comparison is
also only a warning, never a reject or a failed import.

Claims, extrema, diagnostics, results, file warnings, report finalization, and
entities commit atomically in the existing UnitOfWork. Failure after any write
must roll them all back before the existing failed-attempt audit is stored.
Failed reports contain no success diagnostics/version. SQLite's writer
transaction protects the staged comparison; test lock/race failures as well as
the existing exact-file conflict. Do not broaden occurrence uniqueness errors
into native-ID conflicts. Future concurrent-backend semantics are out of scope.
Preview remains a sample-only mapping preview; collision diagnostics are commit
results, which the API documentation and UI must state.

### 6. Report, history, and evidence links

Add `ListImportDiagnostics.execute(import_id, code=None, file_sha256=None,
locator=None, limit=50, offset=0)` and corresponding repository method. Add:

```text
GET /api/imports/{id}/diagnostics?code=&file_sha256=&locator=&limit=&offset=
  -> {items: ImportDiagnostic[], total: int, comparison_version: int | null}
```

Filters are combined with AND; `total` counts matching emission diagnostics,
not records or peer pairs. Unknown import returns 404; an existing empty result
returns items `[]` and total 0, with the actual comparison version. Invalid
known-code filters return 400; limit/offset follow existing API bounds. Order
in SQL by file hash, numeric locator, locator text, emission path, entity, code
before pagination. Diagnostics are persisted, not recomputed on report GET.
Wire the use case in `interfaces/api/container.py` and document all additions.

Move the warnings property to TypeScript `ImportSummary` (reports inherit it),
add file warnings and nullable comparison version, plus typed diagnostics and
client `listImportDiagnostics`. Legacy responses missing version render as
unavailable; they must not become an apparent zero suspected count.

In `Imports.tsx`, reuse Console `Notice`, `DataTable`, `Pagination`, `IconButton`,
and `SourceRecordDialog`; add a bounded `ImportDiagnostics` component in
`web/src/components/importDiagnostics.tsx`:

- Report notice for N > 0: “N emitted observations have matching native claims
  with different values in another file. All observations were retained.”
  Link to the diagnostics panel. Add the precise definition to the warning
  explanation and show per-file warning counts with filtered evidence links.
- History adds a suspected count linked to
  `/imports/:id?diagnostic=suspected_duplicate#diagnostics`. Retain all five
  outcomes and current entity/status behavior. Version-null history shows
  “Unavailable” with an explanation; replay points at the original report.
- The diagnostics panel supports code and file filters, initializes them from
  URL parameters, and resets pagination on import/filter changes, including
  browser navigation. Use `?file_sha256=...&locator=...` for incoming record
  evidence links; link peer reports and offer raw-payload controls for both
  incoming and peer occurrences, including same-attempt peers.
- Display entity, filename/hash, locator, emission path, explanation, and peer
  provenance. One witness is labelled “Example matching claim”; no implication
  that it is the only peer. Known zero has an empty-state sentence; unavailable
  scope and historical unchecked imports explain the limitation separately.
- Keep numeric claims/projection values in text: raw views use `payload_text`;
  do not parse raw IDs into JavaScript numbers. New icon-only controls use
  existing accessible names and visible tooltip behavior. Loading/error/retry
  states must leave the report and its counters usable.

No session identity migration, mapping DSL changes, assistant changes, generic
deduplication, dashboard metric changes, or replacement of #9's records/rejects
browser is included.

## Files touched

Phase 1 writes only this plan. Proposed implementation surface is exhaustive;
new files are marked `(new)`. Shared files below need coordinator sequencing
against other issues before the implementation run; this run edits none of them.

| Area | Paths |
| --- | --- |
| Plan | `docs/superpowers/plans/2026-09-08-cross-file-duplicates.md` (new) |
| Domain | `backend/src/agentscope_app/domain/claims.py` (new) |
| Application | `backend/src/agentscope_app/application/dto.py`; `backend/src/agentscope_app/application/ports.py`; `backend/src/agentscope_app/application/use_cases/imports.py`; `backend/src/agentscope_app/application/use_cases/queries.py` |
| Persistence | `backend/src/agentscope_app/infrastructure/db/models.py`; `backend/src/agentscope_app/infrastructure/db/repositories.py`; `backend/src/agentscope_app/infrastructure/db/claims.py` (new); `backend/src/agentscope_app/infrastructure/db/claim_backfill_v1.py` (new); `backend/src/agentscope_app/infrastructure/db/alembic/versions/0005_cross_file_claims.py` (new) |
| HTTP | `backend/src/agentscope_app/interfaces/api/routers.py`; `backend/src/agentscope_app/interfaces/api/container.py` |
| Backend tests | `backend/tests/domain/test_claims.py` (new); `backend/tests/application/fakes.py`; `backend/tests/application/test_import_use_cases.py`; `backend/tests/infrastructure/test_cross_file_claims.py` (new); `backend/tests/infrastructure/test_database.py`; `backend/tests/infrastructure/test_multifile_import.py`; `backend/tests/interfaces/test_api_cross_file_diagnostics.py` (new) |
| Web | `web/src/api/types.ts`; `web/src/api/index.ts`; `web/src/pages/Imports.tsx`; `web/src/components/importDiagnostics.tsx` (new) |
| Web tests | `web/src/api/index.test.ts`; `web/src/App.test.tsx`; `web/src/test/fixtures.ts`; `web/e2e/smoke.spec.ts` |
| Documentation | `docs/api/v0.1.md`; `docs/architecture/import-pipeline.md`; `docs/verification/2026-09-08-cross-file-duplicates.md` (new; synthetic benchmark and checks only) |

Read-only references include ADR-002/006, reducer/interpreter/schema, existing
mapping and fixture files. No dependency/lockfile, uploaded dataset, environment,
or other worktree changes are planned.

## Tests

Named implementation tests (synthetic fixtures generated inside tests):

| File | Tests and decisive assertions |
| --- | --- |
| `tests/domain/test_claims.py` | `test_projection_v1_normalizes_null_and_utc_without_rounding`; `test_all_entity_fields_affect_only_their_own_projection` (parametrize all three field lists); `test_composite_claims_keep_names_types_and_boundaries`; `test_null_empty_and_missing_claim_parts`; `test_source_session_harness_and_entity_isolate_claims`; `test_harness_resolution_is_file_local_and_order_independent`; `test_ambiguous_or_missing_harness_is_unavailable`; `test_parent_changes_leave_child_projection_equal` |
| `tests/infrastructure/test_cross_file_claims.py` | `test_equal_and_different_projections_across_committed_files`; `test_same_attempt_flags_both_files_once_per_emission` (chunk sizes 1, 2, 128, 500; reversed binding and record order); `test_repeated_keys_within_file_need_another_file`; `test_equal_and_different_peers_choose_one_warning`; `test_session_contributions_compare_before_reduction`; `test_compatible_mapping_revisions_compare`; `test_parent_change_does_not_flag_unchanged_tool`; `test_extrema_query_matches_bruteforce_oracle` (generated scope/file/projection sets) |
| Same infrastructure file | `test_claim_lookup_uses_range_indexes_and_bounded_parameters`: EXPLAIN QUERY PLAN uses both named extrema indexes and no call-table/full-extrema scan; SQL capture proves ceil(N/128) detection SELECTs, <=999 binds each, <=128 output diagnostics per chunk. Exercise 100,000 repeated emissions, many files with equal projections, one changed projection, and many distinct claims; compare timings and SQLite VM steps at 10k/100k. Verify skipped own-file rows cannot grow with repeated emissions. Record index/database size and backfill duration. |
| Same infrastructure file | `test_0005_backfills_populated_0004_with_live_write_parity` (mixed JSONL/Parquet decoded rows, session conflicts, composite keys, custom source, multiple mapping revisions, null/unavailable scope); `test_0005_preserves_reports_outcomes_metrics_and_idempotency`; `test_0005_missing_provenance_or_replay_mismatch_rolls_back`; `test_0005_upgrade_downgrade_and_upgrade_again`; byte-identical v1 projections for backfilled and freshly written equivalent emissions |
| `tests/application/test_import_use_cases.py` | `test_diagnostics_reconcile_record_file_attempt_warnings`; `test_partial_record_counts_each_qualifying_emission`; `test_replay_and_mixed_batch_do_not_repeat_diagnostics`; retain absent/null warnings and five-outcome/entity-only key sets; compare token totals, accepted counts, and bounds to baseline with diagnostics absent |
| `tests/infrastructure/test_multifile_import.py` | Extend `test_failure_after_store_rolls_back_everything_and_records_failed` at claim insertion, extrema update, diagnostics/results insertion, and report finalization; extend `test_race_loser_is_recorded_as_failed_then_conflicts`; assert no new claim, extrema, warning, or entity state survives failure and preexisting rows remain unchanged. Add competing different-file writer test: successful serialized writer sees committed peers; lock failure leaves only failed audit. |
| `tests/infrastructure/test_database.py` | Update schema expectations and TraceStoreResult callers; retain `test_cross_file_session_merge_keeps_reducer_rules`, `test_cross_file_reduction_keeps_valid_timestamps_via_seeds`, fixture import/replay, exact integers, and occurrence uniqueness checks |
| `tests/interfaces/test_api_cross_file_diagnostics.py` | `test_commit_get_and_history_preserve_diagnostic_counts`; `test_diagnostics_filters_numeric_order_total_and_pages` (`line:2/10/100`, `row:0/2/10`, same locator across files); `test_diagnostics_unknown_import_invalid_filter_and_empty`; `test_legacy_report_marks_comparison_unavailable`; `test_peer_provenance_resolves_to_raw_record`; assert accepted/partial records stay in their original categories |
| `web/src/api/index.test.ts` | diagnostic query encoding and additive DTO response handling |
| `web/src/App.test.tsx` | notice wording and counts, history/per-file evidence links, URL filter initialization/navigation/reset, peer links and raw drawer, pagination, empty/unavailable/replay states, network retry, unchanged record/entity displays; integer ID above 2^53 survives text display; accessible names and tooltips for new controls |
| `web/e2e/smoke.spec.ts` | Append `cross-file diagnostics retain counts and link both source records` after existing unscoped fixture assertions: synthetic custom-source A/B/C uploads contain one differing projection and one equal projection; verify commit, report reload, history, evidence navigation, raw drawers, and exact replay. Scope metric assertions to this synthetic source so other smoke/assistant expectations remain valid. |

Implementation verification commands, run before handing the committed branch
to the coordinator (no PR or push from this worktree):

```sh
uv --directory backend run ruff check src tests
uv --directory backend run ruff format --check src tests
uv --directory backend run mypy src
uv --directory backend run lint-imports
uv --directory backend run pytest -q
pnpm --dir web lint
pnpm --dir web typecheck
pnpm --dir web test
pnpm --dir web build
pnpm --dir web e2e
```

For this plan-only phase: verify referenced paths and current signatures, all
required sections, issue-task coverage, `git diff --check`, plan-only staged
diff, branch, and commit trailer. Do not claim implementation tests ran.

## Acceptance checks mapped to the issue's tasks

| Issue task | Acceptance evidence |
| --- | --- |
| Claim scope and projection comparison | Design 1; equal/different/null/composite/scope tests and independent child/session projection tests; source/harness/session isolation; explicit unavailable contract |
| Indexed representation, migration, backfill, bounded chunk lookup | Design 3–4; populated-0004 upgrade parity, query plans, query/bind/result counts, extrema-vs-oracle test, repeated-claim benchmark, downgrade/rollback tests |
| Same-attempt peers, once per emission, order and repetition | Design 2; both-file warnings independent of file/chunk order; within-file negatives, repeated-within-file positives against an external peer, sequential imports and exact replay |
| Typed diagnostics keyed by file/locator; record and file warnings only | Design 5; typed store result and persistence; warning-sum invariants; all five record outcomes and entity/token/bounds regression assertions; rollback/race tests |
| Report/history counts and links; synthetic equal/different projections | Design 6; API filters/counts/provenance tests; web notice/history/file links; selected Playwright smoke case; no reliance on fixture collisions |

## Risks

- The existing session key omits harness. This issue must isolate diagnostics
  using original declarations and explicitly leave reducer identity untouched;
  changing session uniqueness here would violate the count-preservation goal.
  Missing/ambiguous file-local harness means unavailable comparison, including
  some separate session/child-file exports. The review must approve this
  conservative coverage boundary rather than imply universal collision detection.
- Backfill is substantive work: original session fields and call external IDs
  require mapping replay with intact provenance. Migration failure on corrupt
  provenance is intentional and needs a precise error. Backfill and versioned
  interpreter compatibility tests are release gates, not optional cleanup.
- Exact text extrema indexes trade storage and comparison CPU for exact
  semantics and bounded lookup. Wide error messages/key strings may enlarge
  indexes. Measure disk growth, long-field cases, migration time, and hot-claim
  query behavior before accepting the implementation; do not silently truncate
  canonical values or replace them with lossy numbers/hashes.
- SQLite query-planner choices must be demonstrated on populated data. If it
  cannot perform the four range probes as designed, revise the index/query
  plan and re-review before calling the indexed-lookup criterion met.
- Diagnostic counts are emissions; files in the same batch can warn on both
  sides, while earlier audit snapshots stay immutable. UI wording and examples
  must prevent interpretation as deduplicated records or unique invocations.
- Shared DTO/repository/Imports.tsx changes overlap likely Wave 1 work. Keep
  implementation hunks restricted to #33 and coordinate application order;
  never edit another issue's plan or worktree. No cross-agent work is requested
  in this plan-only phase.

## Cost estimate

Approximately **4–5 engineering days**, excluding cross-review/coordinator wait:

| Work | Estimate |
| --- | --- |
| Freeze projection/scope contract and synthetic domain cases | 0.5 day |
| Indexed storage, extrema detector, populated migration/backfill and performance evidence | 1.5–2 days |
| Typed warning integration, read API, rollback/race coverage | 0.75 day |
| Console report/history/evidence surfaces and browser tests | 0.75 day |
| Full verification, documentation, and review corrections | 0.5–1 day |

Implementation commits should separate comparison/persistence, integration/API,
and UI/verification where each remains reviewable. Every commit ends with:

```text
Co-Authored-By: Codex (gpt-6-astra) <noreply@openai.com>
```

Phase 1 ends after committing this plan. No implementation, push, PR, GitHub
write, board change, rebase, or merge is authorized for this run.
