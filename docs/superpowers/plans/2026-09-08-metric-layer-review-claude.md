# Cross-vendor review — plan `2026-09-08-metric-layer.md` (issue #10, D2-03)

**Verdict: APPROVE WITH CHANGES**

Reviewer: Claude (Opus 5), read-only in `/Users/sean/dev/AgentScope-wt/10` at `bfae24c`.
Every path, symbol and behaviour the plan cites was opened and checked; nothing the plan claims
about the current code was found to be false. The design is sound and unusually careful about the
traps the issue names. The changes below are required before implementation: three of them would
produce wrong numbers or leave an issue task unmet, the rest are contract or coordination errors
that will surface as failing CI or as a blocked #11.

Findings are ordered by severity.

---

## P1 findings

### 1. (P1) "Unit mistakes" is tested only at registry-construction time, never through the adapter

*Where:* plan §Tests, `test_registry_rejects_duplicate_ids_bad_fields_and_units`; acceptance table
row "Unit mistakes".

*What is wrong:* the issue's third task names four executed traps: join multiplication,
missing-as-zero, **unit mistakes**, filter correctness after join. The plan's only unit test is a
registry test: it asserts that a `MetricDefinition` declaring tokens with unit `ms` is rejected at
construction, and that "valid distinct wall/internal definitions remain separate". That catches a
mistake in the *declaration*. It cannot catch the mistake that actually happens: the **view or the
column allowlist swapping two same-unit columns**. `metric_tool_calls_v1` is planned to project
both `wall_latency_ms` and `internal_latency_ms` (plan §3 table); ADR-003 line 62 says internal
latency is "never a fallback for wall latency", and `tool_calls` carries both as
`Mapped[int | None]` (`backend/src/agentscope_app/infrastructure/db/models.py:271-272`). If the
view DDL writes `internal_latency_ms AS wall_latency_ms`, every registry test still passes and
every reference test that only exercises token metrics still passes.

*Evidence checked:* `models.py:271-272`; `domain/schema.py:97-100` (both fields registered with
`unit="ms"`, so unit validation cannot distinguish them); plan §Tests has no case that executes a
latency definition against SQL.

*Required change:* make wall/internal an **executed** SQL-vs-oracle case. Ship (or at minimum
construct in the reference matrix) `tool_wall_latency_ms` and `tool_internal_latency_ms`
definitions, populate a fixture where the two columns hold **different** values on the same row
(e.g. wall 1500, internal 400), and assert each definition returns its own column's total. Add the
same shape for `input_tokens` vs `output_tokens` vs `cache_read_tokens` on one model call with
three distinct values — a same-unit column swap in the view is otherwise invisible.

### 2. (P1) View column types are unspecified; SQLite will silently mis-compare any non-UTC-aware time bound

*Where:* plan §3 ("`infrastructure/db/trace_query.py` binds allowlisted SQLAlchemy view columns");
plan §2 ("Validate … reversed or timezone-naive date bounds").

*What is wrong:* this repository stores datetimes through a custom TypeDecorator,
`UtcDateTime` (`backend/src/agentscope_app/infrastructure/db/models.py:41-55`), whose whole reason
for existing is that "SQLite stores naive text, so we re-attach UTC": `process_bind_param` refuses
naive values and calls `.astimezone(UTC).replace(tzinfo=None)`; `process_result_value` re-attaches
UTC. If the adapter declares the view's `started_at` / `ended_at` / `observed_*` columns with a
plain `sqlalchemy.DateTime` (the obvious thing to do for a hand-built `Table` over a view, and the
only thing reflection would give you), two things break at once:

- **Binding.** SQLAlchemy's SQLite `DATETIME` bind processor formats the datetime from its struct
  fields and ignores `tzinfo` entirely. A bound `started_from = 2026-06-04T00:00+02:00` is compared
  as the text `2026-06-04 00:00:00.000000` — i.e. the offset is silently dropped rather than
  converted, which is exactly the "no implicit local timezone" failure ADR-003 line 44-46 forbids.
  The plan validates *naive* bounds but says nothing about tz-aware non-UTC bounds, which are the
  ones an HTTP client will actually send.
- **Return.** Group keys and drill metadata come back naive, so the API would emit day/interval
  boundaries without a `Z`, and the `[started_from, started_before)` interval the chart hands back
  on a drill would no longer be the interval that produced the bucket.

*Evidence checked:* `models.py:41-55`; `models.py:240-241, 269-270, 215-216` (every time column is
`Mapped[datetime | None]`, i.e. `UtcDateTime` via `Base.type_annotation_map` at `models.py:77`).

*Required change:* state in the plan that every time column on the three view `Table` objects is
declared with `UtcDateTime` (imported from `infrastructure.db.models`), never bare `DateTime` and
never reflected. Add a named test that passes a `+02:00` bound and a `Z` bound denoting the same
instant and asserts identical results, and one asserting returned bucket boundaries are
UTC-aware.

### 3. (P1) The registry omits indicators the design of record needs, so #11 cannot render the Overview it is specified to render

*Where:* plan §1 "Initial definitions" (five: sessions, model_calls, tool_calls, input_tokens,
output_tokens); plan §4 bullet 6 (#11 handoff).

*What is wrong:* the issue's expected verifiable result is "**Every** indicator has a definition …
in the domain", and ADR-003 line 87 puts these definitions in the domain, "not chart code". The
Console design of record — which the plan itself names as the target — specifies indicators the
registry does not contain, and #11 owns no domain surface with which to add them:

- `research/design/claude/3-console/README.md:110`: "The definition popover holds the definition,
  unit, coverage, the exact number, the by-semantics split **and cache-read tokens**
  (`Unavailable` outside tracelab-claude)." There is no `cache_read_tokens` definition. The column
  exists (`models.py:244`, `schema.py:82`, and the plan already projects it into
  `metric_model_calls_v1`), so this is registry data only — precisely the extensibility the plan
  claims in §1.
- `README.md:110` and `:39`: the quality strip is "rejects, **missing usage**, **unknown
  timestamps**, **unlinked tools**", each with "List these sessions". The plan supplies coverage
  (missing usage) and an excluded-unknown count (timestamps) as *side outputs of a token query*,
  but supplies no definition, no dimension and no scope flag for **unlinked tools**
  (`tool_calls.model_call_id IS NULL`, `models.py:259`), and §Risks explicitly says "Avoid adding
  unrelated quality filters in this issue".
- `README.md:110`: "Sessions (with the number of imports in scope)" — no imports-in-scope count
  exists anywhere in the plan.

*Required change:* either add `cache_read_tokens` (and, for symmetry with the popover,
`cache_creation_tokens` and `reasoning_tokens`) to the initial registry, and name the concrete
mechanism the quality strip's four counters and the imports-in-scope count will use — a
`tool_calls` definition with a `linked` dimension plus a `tool_is_unlinked` scope flag is the
cheapest, since the drill-to-sessions path already exists — or state explicitly, in the plan and
in `docs/api/v0.1.md`, which of the Console's indicators #10 deliberately does not supply and
where #11 must get them. Silence here is what makes #11 invent chart-code definitions, which is
the exact thing ADR-003 forbids.

---

## P2 findings

### 4. (P2) The plan promises 422 for malformed dates and enums; this application never returns 422

*Where:* plan §4, `/api/metrics/query` bullet: "Invalid IDs/spec combinations return the
established `400 invalid_input`; malformed HTTP dates/enums return 422."

*What is wrong:* `backend/src/agentscope_app/interfaces/api/main.py:112-121` installs a
`RequestValidationError` handler that returns **400** with
`{"error": {"code": "invalid_input", …}}`. `docs/api/v0.1.md` (Errors section) states it as a
contract: "FastAPI's own 422 shape is never returned." A test written to the plan's sentence
(`assert response.status_code == 422`) fails, and `web/src/api/index.ts:23-33` reads only the
envelope, so a genuine 422 would surface to the user as a generic `http_error`.

*Required change:* replace that sentence with "every malformed query parameter — bad ISO date, bad
enum, unsupported dimension, invalid metric id — returns `400` with code `invalid_input` and
`details` of `{path, message}`", and add that assertion to
`test_metrics_http_metadata_coverage_and_exact_text`.

### 5. (P2) Adding `known_text`/`total_text` to `Coverage` breaks an existing exact-equality assertion the "exhaustive" file list does not cover

*Where:* plan §4 bullet 3 ("every numeric display has an authoritative `value_text`, `known_text`,
`total_text`"); plan §Files touched, declared exhaustive.

*What is wrong:* `backend/tests/interfaces/test_api_e2e.py:101` asserts
`metrics["input_tokens"]["coverage"] == {"known": 4770, "total": 4770}` — an exact dict equality.
`Coverage` is a frozen dataclass (`application/dto.py:191-195`) serialised whole by FastAPI, so any
added field breaks that assertion. `test_api_e2e.py` is **not** in the plan's Files-touched table,
which the plan calls exhaustive; the table lists only `tests/infrastructure/test_database.py` for
existing-assertion updates.

Separately, the requirement itself is over-applied. Coverage numerators/denominators are counts of
rows in one SQLite database; they cannot approach 2^53. Only token sums can (the plan's own
`test_exact_sum_exceeds_js_and_sqlite_integer_ranges` is about sums). Putting text twins on every
count is churn that breaks an existing contract for no exactness gain.

*Required change:* limit exact-text fields to values that can exceed 2^53 — the metric value and
each semantics partition's value — and leave `Coverage` shaped `{known, total}` exactly as
`docs/api/v0.1.md:278` documents it. If the review disagrees and text twins stay on coverage, add
`backend/tests/interfaces/test_api_e2e.py` to the Files-touched table and say which assertions
change.

### 6. (P2) `TARGET_SCHEMA` cannot validate the dimensions and identity columns the plan validates against it

*Where:* plan §1 ("Validate … field/grain membership, canonical unit, coverage field and semantics
field at construction against `TARGET_SCHEMA`"); plan §2 ("Allowlisted dimensions initially:
source, agent, model …").

*What is wrong:* `backend/src/agentscope_app/domain/schema.py:48-105` is a *mapping* target schema,
not a storage schema. It does **not** contain:

- `source` — a namespace, not a mapped field, yet it is the plan's first allowlisted dimension and
  the first scope filter;
- `id`, `session_id`, `import_id` — yet `count` is specified as counting "canonical entity IDs";
- `observed_start_at` / `observed_end_at` — the columns `metric_sessions_v1` projects.

Worse, the names that *are* present do not mean what the view exposes: `session.started_at` in
TARGET_SCHEMA is the **declared** start (`schema.py:52` "Start time declared by the source (not
observed)"), which maps to `sessions.declared_started_at` (`models.py:213`), while the planned view
exposes only `observed_start_at`. A definition declared over `session.started_at` would pass
registry validation and then fail — or, worse, silently resolve to the observed bound, which is
exactly the declared/observed conflation ADR-003 and `domain/reducer.py` are built to prevent.

This also falsifies the plan's extensibility claim ("Adding a definition over an existing canonical
integer field … changes registry data only"): it is true only for the intersection of TARGET_SCHEMA
and the view projections.

*Required change:* add to the plan an explicit **field-name → view-column mapping table** owned by
the adapter, state that identity and provenance columns (`id`, `session_id`, `import_id`, `source`)
are storage dimensions validated against a registry-owned allowlist rather than TARGET_SCHEMA, and
state that `session.started_at`/`ended_at` are **not** resolvable in this layer (declared bounds are
not exposed by `metric_sessions_v1`) so that a definition naming them fails at registry
construction, not at query time. Add a test that a definition naming an unresolvable field is
rejected on construction.

### 7. (P2) `by_semantics` is specified two incompatible ways at once

*Where:* plan §1 ("Return each partition with its own value and coverage, **including partitions
whose values are all null**") versus ("Retain legacy `value`/`by_semantics` **numeric** summary
fields for compatibility").

*What is wrong:* `Metric.by_semantics` is typed `dict[str, int]` (`application/dto.py:203`) and is
populated today only from rows where `input_tokens IS NOT NULL`
(`infrastructure/db/repositories.py:847`). Two existing assertions depend on that:
`backend/tests/infrastructure/test_database.py:228` (`set(by_semantics) == {"tracelab-claude",
"tracelab-codex"}`) and `:229` (`sum(by_semantics.values()) == input_tokens.value`) — `sum()`
raises `TypeError` the moment a `None` partition appears. `web/src/api/types.ts:109` already
tolerates `Record<string, number | null>`, but the Python DTO and the FastAPI response model do
not.

*Required change:* say plainly that legacy `by_semantics` keeps its exact current meaning and type
(`dict[str, int]`, known-value contributors only, no all-null partitions) and that partitions with
null values, their own coverage and their exact text live in a **new, separately named** field.
Name that field in the plan so #11 and this issue agree on it.

### 8. (P2) Session-list rows will show unfiltered per-row counts under a filtered scope

*Where:* plan §3 ("Batch per-session metrics for session lists"); plan §4 last bullet ("#11 will
also thread the shared `TraceScope` through the summary route's additional scope parameters" and
owns `/api/sessions` scope wiring).

*What is wrong:* `SessionSummary.model_call_count` / `tool_call_count` are read from the **cached
all-time columns** on the sessions row (`repositories.py:727-728` → `models.py:217-218`), not
computed under scope. The plan correctly forbids "substitut[ing] cached all-time session counts for
filtered counts" for the *metric* path, but leaves the session-list path returning them, and hands
`/api/sessions` scope wiring to #11. The result of that handoff is a session list filtered to
`model=gpt-5.5-codex` whose every row reports its all-time model-call count — a number that will
not add up to the Model calls KPI above it, which is the single most visible way for a trust
dashboard to lose trust.

*Required change:* decide it here, in the layer that owns definitions. Either the port returns
scoped per-row counts (the plan already commits to batching per-session metrics, so this is the
same query with a `GROUP BY session_id`), or the plan states that `model_call_count` /
`tool_call_count` are all-time by definition, registers them as such in the registry with that
scope wording, and tells #11 to label them. Add the corresponding assertion to
`test_session_metrics_match_summary_definition_and_partitions`.

### 9. (P2) SQL views over `sessions` / `model_calls` / `tool_calls` will break every future batch migration on those tables

*Where:* plan §3, migration `0010_metric_views`.

*What is wrong:* `backend/src/agentscope_app/infrastructure/db/alembic/env.py:19,40` configures
`render_as_batch=True`, and batch mode is the established pattern here
(`0003_multi_file_imports.py:22,71` use `op.batch_alter_table`). Alembic's SQLite batch recipe
creates `_alembic_tmp_<table>`, copies, **drops** the original and renames the temp table into
place. Since SQLite 3.25 `ALTER TABLE … RENAME` validates every view in the schema, so the rename
aborts with `error in view metric_model_calls_v1: no such table: main.model_calls`. Any later
migration that adds a column to `model_calls`, `tool_calls` or `sessions` — a near certainty, given
#28 — will fail to apply on every existing database.

*Required change:* add to the plan a stated convention and a guard: any migration touching those
three tables must `DROP VIEW IF EXISTS` the three views first and recreate them last, and
`0010_metric_views` should ship a small shared helper (in the migration package or `metric_sql.py`)
that both creates and drops them, so a later migration is one call. Note it in
`docs/api/v0.1.md` or the architecture docs so the next agent finds it. Consider adding a test that
adds a throwaway column to `model_calls` via `batch_alter_table` after `0010` and succeeds.

### 10. (P2) `run_migrations` calls `upgrade(config, "head")`, so the multiple-head situation the plan creates is a hard startup failure, not a merge chore

*Where:* plan §3 ("Use an issue-specific revision identifier to avoid another agent choosing
`0005`; the coordinator resolves any resulting multiple-head integration").

*What is wrong:* `backend/src/agentscope_app/infrastructure/db/engine.py:40-45` runs
`command.upgrade(config, "head")` (singular) on every container build. With two heads, Alembic
raises `Multiple head revisions are present for given argument 'head'` and **every** test that
builds a container fails, not just the metric tests. Deferring to the coordinator is right, but
"the coordinator resolves it" understates what has to happen and where.

*Required change:* state in the plan that integration requires an explicit Alembic **merge
revision** (`alembic merge`) authored by the coordinator, that `revision = "0010"` with
`down_revision = "0004"` is a deliberate placeholder, and that this branch's own test run therefore
proves nothing about the merged head. Do not change `"head"` to `"heads"` in `engine.py` in this
issue — a linear history with an explicit merge point is the safer contract, and `engine.py` is a
shared file.

### 11. (P2) The reference fixtures are not stated to travel through the real import path, so import-scope and contribution semantics would be tested against states that never occur

*Where:* plan §Tests, first paragraph ("Use generated in-memory synthetic records, not new dataset
files"); `tests/metric_reference.py`.

*What is wrong:* three of the plan's scope rules are defined over rows that only ingestion
produces: `entity_contributions` (rule 1, "sessions with contributions or children in that
import"), the `(source, occurrence_key)` uniqueness that makes re-import idempotent
(`models.py:250, 277`), and the cached session counters. If the fixtures are inserted through the
ORM directly, the test author hand-writes those rows and can hand-write them into a shape ingestion
never emits — the join-multiplication test in particular ("multiple contributions cannot multiply
session IDs") is only meaningful against contributions that ingestion actually creates.

There is an existing pattern to reuse: `backend/tests/infrastructure/test_database.py:265-274`
(`_tracelab_line`) builds synthetic JSONL text and drives `StoreUpload` + `CommitImport`, with no
new dataset file.

*Required change:* require at least the import-scope, join-multiplication and re-import cases to be
built through `StoreUpload`/`CommitImport` on synthetic JSONL (the `_tracelab_line` pattern), and
say so in §Tests. Direct-ORM fixtures are fine for the pure arithmetic cases
(`[10, 0, None]`, overflow), where ingestion adds nothing.

### 12. (P2) On the reference dataset the canonical Input tokens KPI is permanently "Unavailable"; the plan should say so out loud

*Where:* plan §1 ("The new canonical result's token value is null for mixed/unknown accounting");
§4 bullet 3.

*What is wrong:* this is the *correct* reading of ADR-003 lines 52-55 and 81, and I am not asking
for it to change. But it has a consequence the plan states only obliquely: the committed TraceLab
fixture carries two distinct semantics tags (`test_database.py:228`, `test_api_e2e.py:102`), so
`comparability = mixed` and `value_text = null` for the entire default scope. The Console
Overview's third KPI card (`3-console/README.md:110`) would therefore read `Unavailable` on the
demo data, forever, unless the scope is narrowed to one tag. The plan's mitigation ("#11 must
render canonical text/partitions") is not a design; it is a deferral.

*Required change:* state the consequence explicitly in the #11 handoff, and specify the intended
presentation so #11 does not invent one: the recommended shape is that a `mixed` token metric
renders as the per-partition values with the reason string, never as an unqualified `Unavailable`
that is indistinguishable from zero coverage. Make the distinction machine-readable — `mixed` with
full coverage and `unknown` with zero coverage must not serialise to the same thing.

---

## P3 findings

### 13. (P3) The UTC-day bucketing SQL is never specified

*Where:* plan §2 ("UTC started day (model/tool-call grain)"); §3.

Datetimes are stored as SQLite text in SQLAlchemy's `YYYY-MM-DD HH:MM:SS.ffffff` form
(`models.py:41-55`), so `date(started_at)` works and returns `NULL` for `NULL` (giving the plan's
null-day bucket for free), but this is dialect-specific and the plan does not name the expression,
the returned key's type (a `str`, not a `date`), or how that key round-trips into the drill's
`[started_from, started_before)` bound. *Required:* name the expression, state that the group key
crosses the port as an ISO date string, and add to
`test_unknown_timestamps_and_utc_boundaries` a row at exactly `00:00:00.000000Z` and one at
`23:59:59.999999Z` on the same day.

### 14. (P3) Merging empty-string semantics into `unknown` contradicts ADR-003 without saying so

*Where:* plan §1 ("Normalize null/empty token tags to `unknown` before SQL grouping").

ADR-003 line 28 lists the empty string as "a present textual value, **not** implicitly null or
zero". Folding `""` into `unknown` is defensible for an accounting tag — an empty tag is by
definition unvalidated — but it is a deviation from the governing ADR and from the plan's own
"without rewriting other tags". *Required:* record it as an explicit decision with that rationale,
and confirm ingestion cannot currently produce `""` here (nothing in `models.py:239` prevents it).

### 15. (P3) Normalising `token_semantics` inside the view makes the KPI partition disagree with the session-detail row

*Where:* plan §3 ("Model view normalizes `token_semantics`").

`SessionDetail.model_calls[].token_semantics` is read straight from the ORM
(`repositories.py:783`) and will still show `null` for a call the partition labels `unknown`. A user
following the drill path the whole product is built around (`3-console/README.md:5`) sees the label
change under them. *Required:* either normalise on the read path too, or state in
`docs/api/v0.1.md` that the row shows the raw tag and the metric shows the normalised one, and why.

### 16. (P3) Child rows carry their own `source`; the plan silently prefers the session's

`model_calls.source` and `tool_calls.source` exist (`models.py:230, 261`) and the views derive
`source` by joining `sessions` instead. They should always agree, but nothing enforces it.
*Required:* state which one is authoritative (the session's, for filter consistency across grains)
and add one assertion that they agree on ingested data, so a future mapping bug surfaces as a test
failure rather than as two KPIs that disagree.

### 17. (P3) `TraceQuery` has two declared homes

Plan §2 defines `TraceQuery.aggregate` inside `application/metric_queries.py`; the Files-touched
table assigns "TraceQuery and UoW property" to `application/ports.py`. Both files would need each
other's types (`ports.UnitOfWork` needs `TraceQuery`; `metric_queries` needs nothing from `ports`,
so this is resolvable, but only if decided). *Required:* put the `TraceQuery` Protocol and the
`UnitOfWork.trace_query` attribute in `ports.py` alongside every other port, and keep
`metric_queries.py` for `TraceScope`/`MetricQuerySpec`/`AggregateRows` only.

### 18. (P3) View `Table` objects must not live on `Base.metadata`

`alembic/env.py:11` sets `target_metadata = Base.metadata`. If the adapter's view `Table` objects
are attached to it, a future `alembic revision --autogenerate` emits `CREATE TABLE` for the three
views and `Base.metadata.create_all` (if ever used in a test) does the same. *Required:* state that
the view tables use a private `MetaData()` owned by `trace_query.py`.

### 19. (P3) `exact_int_sum`'s failure mode when unregistered is unspecified

Plan §3 registers the aggregate in `engine.py`'s connect hook. Any connection not created via
`create_engine_for` (`engine.py:17-29`) — a raw `sqlite3.connect` in a debugging script, an
external tool, a future test helper — will fail with "no such function: exact_int_sum". *Required:*
state that this is a loud failure by design (never a silent fallback to `SUM`), and that the guard
is the existing `engine.dialect.name == "sqlite"` check at `engine.py:21`, so a non-SQLite engine
fails at registration rather than at query time.

---

## What the plan gets right — keep all of this

1. **Its reading of the existing code is accurate.** Every claim in §Current state checks out: the
   four-entry prose `DEFINITIONS` (`queries.py:169-180`), the absence of a `TraceQuery`
   (`ports.py:135-170`), the `(tag or "unknown")` dict comprehension that lets a literal `unknown`
   and a `NULL` overwrite each other (`repositories.py:842-849`), `_token_metric`'s independent
   second definition of the same metric (`repositories.py:704-717`), the N+1 in `list_sessions`
   (`repositories.py:729,745`), `0004` as the latest revision, and the fact that neither existing
   test provides an independent oracle. I found no false statement about the codebase.
2. **Refusing `SUM(DISTINCT value)` as a fan-out repair**, and saying why: two equal-valued calls
   are two observations. That is the single most common wrong fix for join multiplication.
3. **Correlated `EXISTS` for cross-grain predicates instead of joins**, plus the same-witness rule
   (a model filter and a day bound must match the *same* row, not two different children). This is
   the subtle half of "filter correctness after join" and most plans miss it.
4. **Coverage taken from the filtered grain before missing values are grouped away**, stored as
   integer numerator and denominator, with the ratio left undefined at denominator zero — never
   100%, never a fabricated zero. Exactly ADR-003 lines 76-79.
5. **Distinguishing count 0 from an unavailable measure**, and calling out that empty populations
   yield count 0 with coverage 0/0.
6. **Normalising semantics before grouping rather than after**, which is the actual fix for the
   `repositories.py:842` bug rather than a workaround.
7. **Measured zero is a known contributor** (`[10, 0, None]` → 10, coverage 2/3). Stated as a named
   test, not as prose.
8. **Null buckets are explicit and distinct from the literal string `unknown`**, with drill flags
   (`model_is_unknown`, `agent_is_unknown`, `timestamp_missing`) instead of a sentinel label
   pretending to be a value.
9. **Excluded-unknown counts under a time range**, so unknown timestamps stay visible rather than
   vanishing from time-filtered summaries (ADR-003 line 80).
10. **Refusing to invent cross-export deduplication** in the metric layer, and refusing to
    substitute a duplicate import's earlier import.
11. **The oracle discipline**: pure-Python, loops and sets, no shared helpers with the compiler,
    anchored by hand-written literal expected numbers so two implementations cannot agree on the
    same mistake. This is the right answer to "independent of the code under test".
12. **No `eval`, no SQL strings in the domain, no caller-supplied formula**, and no metric-ID switch
    in HTTP or chart code — the registry is declarative data. This keeps the import-linter contracts
    (`backend/pyproject.toml`, "Domain is framework-free", "Application is infrastructure-free")
    satisfied by construction, and I found no place in the design where a SQLAlchemy type would
    cross the port.
13. **Honesty about extensibility limits for #28** — new definitions over the existing count/sum
    vocabulary are free, new primitives are not, and the plan says so instead of promising
    arbitrary formulas.
