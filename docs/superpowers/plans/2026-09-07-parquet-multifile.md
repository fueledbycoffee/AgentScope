# Plan: Parquet reader, multi-file import, per-file mapping binding (issue #8)

Revision 3. Revision 2 answered the first Codex review
(`…-review-codex.md`, R1 to R12); the second review (`…-review-codex-2.md`,
still BLOCK) shaped the implementation directly, per the round-cap rule:
decoded budgets are enforced on the decoded Arrow buffers, not only the
footer; durations and times are exact decimal seconds so no `where` unit
guard exists; null wrapped values keep the wrapper shape; timestamp notes
propagate through both coercion paths; migration 0003 backfills per-file
counts and repairs historical double claims; the aggregate limits answer
`413`; a lost race is recorded as `duplicate` before the `409`; the sampler
bounds the sum of both tables' rows. Per-file record limit is 4 MiB (the
JSONL line limit), not 1 MiB.

Day 2, first issue. Gate contribution: "JSONL and Parquet import; overlapping
files do not inflate counts" — qualified as ADR-002 states it: exact-file
idempotency, never identity across rewritten or recompressed files (R12).
Everything sits on the pipeline merged in #25 and keeps its boundaries.

## 1. Parquet reader (infrastructure)

`infrastructure/readers/parquet.py`: `ParquetRecordReader` on pyarrow behind
the existing `RecordReader` port. A `FormatRouter` composes JSONL and Parquet
(`sniff`: magic bytes beat extension; `read`: dispatch on the format string).
The container wires the router; the port does not change. pyarrow is added
to the backend dependencies; pandas is not.

**Schema-aware conversion, not `to_pylist()` (R5, R11).** Values are converted
column by column from Arrow types with the schema in hand:

| Arrow type | Payload value |
|---|---|
| all integer types incl. uint64 | `int` (2^64−1 preserved; only integer *target* fields impose the int64 bound, ids may map to strings) |
| float16/32/64 | finite: `Decimal(repr(float(x)))`, documented as the shortest round-trip decimal of the stored double; NaN / ±Inf: `{"_arrow": "float", "value": "NaN" \| "Infinity" \| "-Infinity"}` so a mapping sees a non-numeric value and its `on_invalid` policy applies, never `on_missing` (R6) |
| decimal128/256 | `Decimal`, exact, any precision |
| bool, string, large_string | native |
| binary, large_binary, fixed_size_binary | `{"_arrow": "binary", "base64": "…"}` |
| timestamp, any unit, tz or naive | built from the int64 value and the schema unit, never from `as_py()`: `{"_arrow": "timestamp", "iso": "<ISO 8601, full unit precision, UTC 'Z' when tz-aware, no offset when naive>", "unit": "ns", "tz": "UTC" \| null, "value": <int64>}` |
| date32/64 | `"YYYY-MM-DD"` |
| time32/64 | `{"_arrow": "time", "value": <int>, "unit": "ms"}` |
| duration | `{"_arrow": "duration", "value": <int>, "unit": "us"}` |
| list, large_list, fixed_size_list | `list`; `None`, `[]` and `[None]` stay distinct |
| struct | `dict`; a null struct is `None`, never a dict of nulls |
| map | `[{"key": k, "value": v}, …]`, order and duplicates preserved (never `maps_as_pydicts`) |
| dictionary | decoded value, then converted recursively |
| null | `None` |
| extension types (UUID, JSON, others) | UUID → canonical string; JSON → `str` of the storage value; any other extension type → the file is refused as unsupported with the column name (R11) |

Wrapper keys are plain identifiers so DSL v1 paths reach them (R7):
`$.latency.value` with `convert_duration(unit_from="us", …)` and a mapping
`where` guard on `$.latency.unit`; the DSL is not extended. The wrappers and
one executable example mapping go into `docs/mapping/README.md`.

**Timestamp policy (R5).** Raw payloads keep full unit precision in `iso` and
`value`. The canonical schema is microsecond `datetime`; `parse_timestamp`
gains a `precision_reduced` warning when a string carries more than six
fractional digits, and naive timestamps keep today's "treated as UTC" behaviour
but now emit a `naive_timestamp` warning (small domain change, covered by the
existing property tests). Both warnings count in preview and report like any
interpreter warning.

**Schema validation before conversion (R11).** Duplicate column names at any
nesting level, or a real struct that collides with a wrapper shape (a struct
with a string field literally named `_arrow`), refuse the file with
`invalid_input` naming the column. A corrupt footer or read error is
`invalid_input` with the pyarrow message.

**Locators (R12).** `row:<n>`, one absolute zero-based counter across every
batch and row group, independent of batch size. A conversion failure on one
row yields a `RawRecord` with `error` and does not shift later locators.

**Budgets (R4).** From the footer, before any row is decoded: row count above
`MAX_RECORDS_PER_FILE` → `413`; sum of row-group `total_byte_size`
(uncompressed) above a new `MAX_DECODED_BYTES` (256 MiB) → `413`; more than
64 columns or nesting deeper than 8 → `invalid_input` (documented product
limits, mirroring the JSONL line and decompression limits). Rows are decoded
in batches of 1,000 and the converted row is checked against
`MAX_RECORD_BYTES` (4 MiB, the JSONL line limit) via the length of
`dumps_exact`; a larger row is a `RawRecord` error, not an exception.

`payload_text` for a Parquet record is `dumps_exact` of the converted row and
the raw-record response carries `derived: "parquet-row"` so the UI labels it
"decoded row", not "source bytes".

## 2. Multi-file import with per-file mapping binding

**Request.** `POST /api/imports` accepts either the existing single-file body
or `{"source": "…", "files": [{"upload_id", "mapping_id"}, …]}` (1 to 20
entries); the single body is the batch of one and stays in the contract (R10).
Unknown upload or mapping ids remain `404`; a mapping whose `input_format`
differs from its upload's format, two bindings of the same bytes to different
mappings, or an aggregate record count above 100,000 (duplicates excluded from
the count, as they are not read) are `400` (R3, R4). Every mapping in the batch
must declare the request's `source`; otherwise `400` naming the mismatch (R10).

**Grouping by bytes (R3).** Bindings are grouped by `sha256` before anything
runs: two uploads of the same bytes with the same mapping are one file in the
attempt (both upload ids recorded on its row); with different mappings the
request is refused. A hash committed under *another* source is importable
here, as today.

**Per-file rows and the commit protocol (R2, R8).** `import_files` gets
`mapping_id` (FK), `status` (`pending` | `committed` | `duplicate` |
`failed`) and `records` (JSON counts). The protocol becomes:

1. Insert the import row (`running`) and every file row once, with
   `status = duplicate` and `committed = 0` for files already committed for
   this source, `pending` for the others; flush.
2. Read and map the pending files with their own mappings; one
   `reduce_sessions` over all emissions, seeded from the database.
3. `traces.store(..., bindings={sha256: mapping_id})` so each entity
   contribution carries its file's mapping (R9); the partial unique index
   stays the race guard.
4. Finalise: pending files → `committed = 1, status = committed` with their
   counts; duplicates untouched; import row → `committed` (or `duplicate` when
   every file was a duplicate). `add_results` writes outcomes and rejects.
5. Any failure rolls the transaction back; a separate transaction records the
   attempt as `failed` with every file row `failed` and `committed = 0`, so
   the audit trail keeps the attempt (R8) and a wholly duplicate batch keeps
   its report while adding no entities.

`find_committed` / `find_committed_any` filter on `committed = 1` only, which
already excludes duplicate and failed rows.

**Record identity across files (R1).** `record_results` already has
`file_sha256`; its primary key becomes `(import_id, file_sha256, locator)` via
a SQLite table rebuild in migration `0003`. `rejects` gains `file_sha256`,
backfilled from the attempt's single file. `import_files` rows from 0002 with
`source = ''` are backfilled from `imports.source` and `committed` from
`imports.status = 'committed'`; `mapping_id` is backfilled from
`imports.mapping_id`; `status` is derived from `imports.status`. Migration
tests run 0001→0002→0003 and 0002→0003 on populated databases with committed,
duplicate and failed attempts, FKs on, and read the reports back.

**Reports.** `ImportReport.files[]` gains `mapping` (`MappingRef`), `status`
and `records`; `imports.mapping_*` columns keep the first file's mapping for
display and the contract says so. `RejectRow` and `RecordOutcome` carry
`file_sha256`; `GET /imports/{id}/rejects` accepts `file_sha256`. Report
reconstruction on `GET` reads the file rows, so the shape is identical on
`POST` and later reads (R8).

## 3. Web (thin slice, minimal)

Preview stays per pair; "Add to batch" collects `(upload, mapping)` pairs and
invalidates that pair's preview when either changes; the batch panel shows
each binding, the shared source (taken from the mappings and refused in the UI
if they differ), the hashes and revisions at confirmation (R10). The report
table shows mapping, status and counts per file; rejects show the file column
when the batch has more than one file. The Console shell is #30, not here.

## 4. SWE-chat excerpt script (`scripts/sample_swe_chat.py`)

Deterministic, whole sessions only, stratified by `agent`: rank sessions by
a seeded hash of `session_id` within each agent and take round-robin. Selection
is validated on the **closed** outputs: write both tables, measure the final
files (footers included) against 25 MiB and both row counts against 100,000;
if either exceeds, drop the lowest-ranked session and rewrite; fail explicitly
if a single session cannot fit. Conversations are filtered by row-group
streaming (1.3 GB is never loaded). Manifest with upstream hashes, seed,
per-agent counts, sizes and output hashes. Unit tests on synthetic tables cover
uneven agents, non-contiguous conversation rows, over-limit reduction, the
single-oversized-session failure, and identical output on rerun.

## 5. Tests

- Reader: every row of the type table from tables written to real Parquet
  and read back (types change on disk), including uint64 above int64,
  decimal256 with 76 digits, timestamp[ns] with and without tz, negative
  epochs, non-UTC offsets, 1 ns, `None` / `[]` / `[None]` / `{"x": None}` /
  null struct, duplicate map keys, dictionary columns, UUID and JSON extension
  columns, an unsupported extension type, duplicate column names, a struct
  with an `_arrow` field, zero rows, uneven row groups crossing the 1,000-row
  boundary read with two batch sizes (identical locators and payloads), a row
  conversion failure that does not shift locators, corrupt footer, footer row
  count over the limit, decoded-size budget exceeded, a wide compressed file
  that inflates past the budget, a single 2 MiB row. Assert Arrow value →
  expected payload, not only JSON round-trip (R11).
- Domain: `precision_reduced` and `naive_timestamp` warnings; wrappers reach
  `on_invalid`; the example wrapper mapping executes.
- Use case, on real SQLite: mixed batch (JSONL + Parquet, one duplicate);
  two fresh JSONL files sharing `line:1` (R1); same bytes twice with the same
  mapping and with different mappings (R3); a hash committed under another
  source; all-duplicate batch keeps its report and inserts nothing; mapping
  source mismatch; aggregate limit; per-file contributions carry their mapping
  (R9); failure injected after `traces.store`, after finalisation and during
  `add_results` rolls back entities, session state and file claims and leaves
  one `failed` attempt (R2).
- API e2e: the day-1 test extended with a Parquet file in the batch, both
  request bodies, per-file shapes on `POST` and `GET`.
- Hypothesis: random Arrow tables from a bounded schema generator; `read`
  never raises on supported, within-budget schemas, every value is JSON-typed
  and `dumps_exact` round-trips.

## 6. Order and cost

1. Reader, router, schema validation, budgets, docs (0.5 day).
2. Migration 0003, DTO/port changes, use case protocol, repository (0.6 day).
3. API (both bodies) and web (0.3 day).
4. Excerpt script, e2e, property test (0.3 day).

About 1.7 days. Adversarial review: this revision is the second pass on the
plan; implementation gets at most two passes, then the property test closes
the reader's defect class (round-cap rule).

## 7. Out of scope

SWE-chat mapping and UI import (#16), the Console shell (#30), the record
outcome browser beyond the file column (#9), Parquet writing.
