Second adversarial review of issue #8, revision 2, 2026-09-07.
`plan` means `2026-09-07-parquet-multifile.md` in this directory; backend paths are relative to `backend/src/agentscope_app/`. Resolution below means a specified implementation contract, not implemented code.
Verification: read-only Python/PyArrow 25.0.1 and in-memory SQLite probes; no dependencies installed. Probes exercised the revised payload shapes against the current interpreter and the current database constraints.

1. **P1 — The decoded-byte budget still measures encoded data (R4)** (`plan:64–71,101–102`).
   A real dictionary-encoded Parquet probe with 10,000 copies of a 32-KiB string produced a 487-byte file and footer `total_byte_size=32,824`, yet represents 327,680,000 logical string bytes. Every row passes the 1-MiB check. Dictionary pages store values once and data pages store indices; removing compression does not expand the dictionary ([Parquet encoding specification](https://parquet.apache.org/docs/file-format/data-pages/encodings/#dictionary-encoding-plain_dictionary--2-and-rle_dictionary--8)).
   The check after conversion/`dumps_exact` cannot protect the preceding allocation, and commit still retains all payloads/emissions (`application/use_cases/imports.py:208–232`; `infrastructure/db/repositories.py:390–395,469–476`). Specify limits on logical expansion before materialization, total decoded bytes/emissions across pending files, and bounded staging/accumulation; exercise dictionary expansion, not only compression. Twenty separate footer limits do not bound aggregate memory.

2. **P1 — A unit `where` guard silently discards observations and accepts the wrong temporal kind (R7)** (`plan:32–44,170–171`).
   Keys are reachable, but `where` is a rule filter, not field validation (`domain/mapping/interpreter.py:94–100,114–127`). Executed probes: a null duration or `unit="ms"` against the proposed `"us"` guard emits nothing, with no reject/warning; `{"_arrow":"time","value":1000,"unit":"us"}` passes and becomes a 1-ms elapsed duration.
   Specify kind-and-unit mismatch diagnostics and preservation of observations whose optional latency is null; a positive duration example cannot establish this. Use the actual DSL `unit: {from, to}` contract, not an executable `convert_duration` transform (ADR-004:39–63). Add null/mismatch/time-of-day cases that assert entity counts and coverage (ADR-003:37–48,76–81).

3. **P1 — `add_results` still has no multi-file write contract (R1/R2)** (`plan:106–108,117–130`).
   The new primary key and DTO hashes do not specify whether step 4 calls storage per file or changes its signature. The current port accepts one `file_sha256`, which the repository copies into *both* raw rows and outcomes regardless of the outcome object; reject inserts omit it (`application/ports.py:86–94`; `infrastructure/db/repositories.py:241–289`).
   Specify per-file calls within the same transaction, or per-outcome/per-reject hashes used in every insert. Otherwise two `line:1` outcomes still collide under the first hash, and distinct locators can silently point at the wrong raw file. Assert both files' persisted payloads and filtered rejects, not just successful import counts.

4. **P2 — Timestamp warnings are named without a propagation contract (R5)** (`plan:46–52,158–171`).
   `parse_timestamp` returns only `datetime`, and `coerce` forwards it (`domain/units.py:102–129`). `_evaluate` and `_bounds` have separate coercion paths; bounds returns before ordinary field coercion (`domain/mapping/interpreter.py:177–211,324–330,382–385`). Python warnings or a changed timestamp return type do not automatically become located interpreter diagnostics.
   Define a domain result/diagnostic channel through both paths, including defaults and every bounds candidate, then assert preview and persisted report counts. Existing properties assert type/timezone, not these warnings (`backend/tests/domain/test_properties.py:76–87,107–114`). Also settle out-of-Python-range Arrow dates/timestamps: the type table promises any unit but still omits the supported ISO range and preservation/rejection policy requested in R5.

5. **P2 — Extracting wrapper members loses explicit-null diagnostics (new)** (`plan:30,38,41–50`).
   With null temporals represented as `None`, `$.ts.iso` and `$.latency.value` resolve identically for a null column and an absent column (`domain/mapping/paths.py:99–117`). The executed timestamp mapping reports `absent` for `{"ts": null}`; `_evaluate` cannot recover the source state (`domain/mapping/interpreter.py:331–337`).
   Specify a nullable wrapper/member representation or an explicit source-state mechanism and test absent versus null through mapping/preview/persistence. Preserving the distinction only in raw JSON does not satisfy ADR-003:22–40's diagnostics contract.

6. **P2 — Migration backfills are incomplete and can violate the retained index (R8)** (`plan:117–132`).
   No backfill is given for new per-file `records`, although historical single-file `imports.records` contains the counts and duplicate attempts have no outcomes to count (`application/use_cases/imports.py:203–205`; `infrastructure/db/repositories.py:187,304–307`). Define historical, skipped-duplicate and failed counts explicitly; retain hashes/FKs during the `record_results` rebuild.
   0002 adds default `source=''`/`committed=0` without repairing historical claims (`infrastructure/db/alembic/versions/0002_import_files_source_and_committed_.py:23–35`). Two historical committed attempts for the same bytes/source can therefore coexist, including empty/session-only races before the index existed. An in-memory probe confirms that backfilling both to committed violates `uq_import_files_committed_source` (`infrastructure/db/models.py:130–140`). Specify collision detection and an explicit repair/refusal policy before promoting claims; add this populated-upgrade case, with raw/outcome/reject retention assertions.

7. **P2 — Resource and race responses diverge from the API contract (R2/R4/R10)** (`plan:82–86,109–115`).
   Aggregate overflow is explicitly changed to `400`, but `docs/api/v0.1.md:138–142` requires `413`; the existing adapter already maps `LimitExceededError` to 413 (`interfaces/api/main.py:36–40`). Keep that error class.
   Step 5's “any failure” audit also needs an explicit race path: currently `ConflictError` bypasses failed-audit persistence (`application/use_cases/imports.py:257–262`). Require rollback, failed audit, then propagation of 409; preserve the index failure raised by finalization (`infrastructure/db/repositories.py:234–239`). Test races on empty/session-only/all-rejected files, where `traces.store` need not collide. The committed-lookup filters at `plan:114–115` are required edits, not current behavior (`repositories.py:154–174`).

8. **P2 — The sampler can certify outputs the batch importer refuses (additional first-review acceptance finding)** (`plan:145–154`).
   “Both row counts against 100,000” permits 1,000 session rows plus 99,500 conversation rows, violating the aggregate limit at `plan:84–85` and ADR-004:58–63. Require `sessions_rows + conversations_rows <= 100000`, each closed file <=25 MiB, and the reader's schema/decoded/row limits; otherwise an oversized conversation row can become a reject and defeat “whole sessions” after import.
   Specify a total selection/removal order across agents, then test the combined-row boundary with each table individually under it. Keep the closed-file rewrite loop, whole-session removal, oversize failure and both output hashes; acceptance must run the reader checks on the final outputs.

9. **P3 — The claimed reused JSONL line limit has the wrong value (new)** (`plan:69–71`).
   JSONL's existing limit is 4 MiB, not 1 MiB (`infrastructure/readers/jsonl.py:23,31,60–64`). Declare a separate Parquet limit or explicitly document/test a JSONL compatibility change; “reusing” currently specifies two inconsistent behaviors.

R1–R12 disposition against the first review:

| Finding | Revision-2 disposition |
|---|---|
| R1 | Partial: correct table rebuild/key and same-format test (`plan:117–125,173`); write-path gap in finding 3. |
| R2 | Partial: one insertion, pending-only finalization, duplicate exclusion and rollback tests specified (`plan:98–115,177–179`); findings 3 and 7 remain. Preserve `add_report`'s parent flush (`repositories.py:194`) and replace `update_report`'s blanket promotion (`:229–233`). |
| R3 | Resolved in the plan: hash grouping, same-mapping collapse, conflicting-mapping rejection and source-scoped replay (`plan:82–92,173–175`); persist the promised upload-ID aliases. |
| R4 | Open: findings 1, 7 and 8; the aggregate record rule alone is insufficient. |
| R5 | Partial: integer-backed temporals and explicit canonical precision policy (`plan:30,46–52`); findings 4 and 5. |
| R6 | Resolved for direct numeric-field mapping: tagged nonfinite values remain present and reach `on_invalid` (`plan:26,170–171`; `domain/units.py:139–174`; `domain/mapping/interpreter.py:331–385`). |
| R7 | Partial: member-key grammar fixed (`plan:41–44`; `domain/mapping/paths.py:15`); findings 2 and 5. |
| R8 | Partial: failed/pending states and GET reconstruction specified (`plan:94–132`); historical/count backfills remain incomplete, finding 6. |
| R9 | Resolved in the plan: hash-to-mapping storage input plus contribution assertion (`plan:103–105,176–177`), matching occurrence-owned hashes (`repositories.py:490–495`). |
| R10 | Partial: body adapter, shared source, preview invalidation and confirmation specified (`plan:79–86,136–140`); response compatibility remains, finding 7. |
| R11 | Resolved at design level: recursive schema-aware conversion, unsupported/collision rejection and value-fidelity tests (`plan:20–39,54–58,158–184`); these do not establish resource safety. |
| R12 | Resolved in the plan: absolute locators, uneven groups/two batch sizes, stable failure positions and exact-byte scope (`plan:7–9,60–62,164–166`). |

BLOCK
