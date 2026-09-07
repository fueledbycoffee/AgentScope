# Plan: import accounting (issue #9)

Day 2. Expected result (issue text): history lists attempts with record
outcomes and entity outcomes separately; rejects are browsable with rule,
path and explanation; an interrupted commit leaves nothing visible.

## Already true after #5/#6, #8 and #30

- Report model with the five record outcomes (accepted, partial, duplicate,
  rejected, ignored), entity counts, warning counts, per-file bindings,
  statuses and counts (`ImportReport`, `FileInfo`).
- Rejects endpoint with `code` and `file_sha256` filters and pagination.
- Transaction failure recovery: any failure rolls back and records `failed`
  with every file `failed`; a lost race records `failed` and answers `409`
  (tests on real SQLite with failure injection after `traces.store` and in
  `add_results`).
- Exact-file idempotency per source; overlapping *bytes* never inflate counts
  (duplicate files are skipped per file inside a batch).

## What #9 adds

### 1. Record outcomes are browsable (backend)

- `GET /api/imports/{id}/records?outcome=&file_sha256=&limit=&offset=` →
  `[{file_sha256, locator, outcome, entity_counts, warning_counts}]`, newest
  import first is irrelevant here: rows are ordered by file then locator
  (numeric part of `line:N` / `row:N`), so a browser reads a file in order.
  Port `ImportRepository.records(import_id, outcome, file_sha256, limit,
  offset)`; use case `ListRecordOutcomes` with the same 404 rule as rejects.
- `GET /api/imports/{id}/rejects/summary` → `{"codes": {code: n}, "rules":
  {rule_id: n}, "files": {sha256: n}}` so the rejects panel can offer a code
  select with counts and a file filter without paging through everything.
  Port `ImportRepository.reject_summary(import_id)`.
- Rejects gain a `rule_id` filter (`?rule_id=`), alongside `code` and
  `file_sha256`.

### 2. Suspected duplicates across different files (backend)

Two exports of the same sessions with different bytes are two files; ADR-002
counts their observations twice on purpose (recorded observations), but the
report must say so. `traces.store` computes, per file, the number of accepted
model-call and tool-call emissions whose native key (`source`, entity,
`external_id`) already existed in the database from a *different* file, and
returns it as `suspected_duplicate` in the entity counts; the use case writes
it into `warnings.suspected_duplicate` (attempt level) and into each file's
`records` as `suspected_duplicate`. Native ids that repeat *within* one file
are the source's own non-uniqueness (TraceLab `round_id`) and are not
flagged. Test: import file A, then file B that repeats half of A's native
keys with different bytes: counts include both, `suspected_duplicate` equals
the overlap, and the report's notice names it. Cost: one `IN` query per
insert chunk against the `(source, external_id)` index that already exists.

### 3. Report and history on the Console shell (web)

- **Report** (`/imports/:id`), per the design of record: status lead in the
  product's voice (committed: "Committed in 27 s. 4,770 of 4,770 records
  accepted, 0 rejected."; duplicate points at the original import; failed
  shows the exact error and "nothing inserted"), three count panels (source
  records with zeros muted, entities, warnings with an `i` explaining
  `absent` vs `null` and `suspected_duplicate`), the files table (mapping,
  status, counts, hash), a **Records** panel (outcome select from the
  summary counts, file filter when the batch has several files, rows with
  locator, outcome, entity and warning counts, "Raw payload" drawer), and the
  **Rejects** panel (code select with counts, rule and file filters, rows
  with rule, path, code, field, message, "Raw payload" drawer with the
  offending path highlighted when it appears in the text). Empty rejects is a
  sentence. `useFileBar` carries import id, source, mapping revision, start.
- **History** (`/imports`): one `DataTable`, newest first: id, status pill,
  source, files, mapping revision, records (accepted / rejected / duplicate),
  sessions, model calls, rejected (red when non-zero), started; dashes for
  entities on duplicate and failed rows. Empty: "No imports yet" with the
  Import action.
- **Import page**: unchanged behaviour; the confirm receipt already repeats
  file, hash, mapping revision and record count.

### 4. Tests

- Backend: records endpoint ordering and filters, rejects summary, rule
  filter, suspected duplicates across two files (and none within one file
  or for exact-file duplicates), 404s.
- Web: report lead sentences for the three statuses, records panel filter and
  drawer, rejects code select with counts, highlight of the offending path,
  history dashes and red rejected count.
- e2e: the day-1 test asserts the records endpoint for the fixture (4,770
  accepted) and the summary shape.

## Cost and order

1. Backend endpoints and repository queries, tests (0.3 day).
2. Suspected duplicates in `traces.store` with tests (0.2 day).
3. Report and history pages on the shell, tests (0.4 day).

About one day. Out of scope: a `running` status visible from the outside
(imports are synchronous in v0.1.0), streaming progress, the quality strip
(#10/#11), the outcome browser on the sessions side.

## Revision 2: what the Codex review changed (2026-09-07)

`2026-09-07-import-accounting-review-codex.md` (BLOCK, 12 findings). Per the
round-cap rule the findings shaped the implementation:

1. **Cross-file suspected duplicates are out of #9** (findings 1 to 4, 11):
   the proposed native-key overlap is not ADR-002's definition, there is no
   indexed claim representation, and chunk/file order made it
   non-deterministic. Filed as #33 with the decisions to make. Counts were
   already correct; nothing in #9 changes them.
2. **Records browser**: SQL ordering by file, then the integer suffix of the
   locator, then the locator text; pagination in the panel; the outcome
   select shows global counts from the summary. Replayed (duplicate) files
   have no stored record details; the panel says so and points at the
   original import (finding 5, 6).
3. **Rejects summary** counts reject rows, not rejected records (one row per
   rule that refused a record), documented as such; facets are global and
   labelled with their counts; a `rule_id` filter is added (finding 7).
4. **Original import reference**: `FileInfo.duplicate_of` carries the
   earliest committed import of the same bytes for the source, on the commit
   response and on read (finding 8). The file bar and the report say
   "n mappings" when a batch mixes revisions.
5. **History** keeps all five outcomes (non-zero ones, accepted always) and
   dashes for entities on attempts that inserted nothing (finding 9).
6. **No payload highlighting**: a reject's `path` is an emission path and
   `field` a target field, neither a JSON path; the drawer shows the exact
   `payload_text` and an undecodable record explains that it has no stored
   payload (finding 10).
7. Cost with this scope: one day, as estimated.
