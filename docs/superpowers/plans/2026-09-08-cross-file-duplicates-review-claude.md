# Review (Claude) — plan `2026-09-08-cross-file-duplicates.md` (issue #33)

**Verdict: APPROVE WITH CHANGES.**

The plan's architecture is sound and its reading of ADR-002 is the right one. Findings 1–4 are
design-level, not implementation detail: they must be resolved *in the plan* and re-checked before
the implementation run. Findings 5–8 must be answered explicitly (a written decision plus a named
test is enough for several of them). Findings 9–13 are corrections and omissions.

Everything below was checked by reading the code in this worktree at `20a550f`. Every path, symbol
and behaviour the plan cites in "Current state" exists and is described accurately; I found no
fabricated citation (see "What the plan gets right").

---

## 1. P1 — A legal mapping without a session harness turns every accepted observation into a diagnostic row

**Plan:** Design 1, lines 108–114 ("Missing harness or ambiguous declarations mean comparison is
unavailable for that claimed emission: emit `claim_scope_unavailable` once with its occurrence") and
Design 5, lines 302–307 (`file.warnings[C] = sum(record.warning_counts[C] for that file)`).

**What is wrong.** `agent` is an *optional* field of the session entity —
`backend/src/agentscope_app/domain/schema.py:53` declares it with no `required=True`, unlike
`external_id` (`:52`), `session_external_id` (`:62`, `:91`) and `tool_name` (`:94`). A mapping is
also free to have no `session` rule at all: `reduce_sessions` builds an aggregate for any
`session_external_id` seen on a child and only raises an `implicit_session` diagnostic
(`backend/src/agentscope_app/domain/reducer.py`, the `if not acc.declared and acc.first_child is not
None` block). The only mapping bundled today maps `agent`
(`backend/mappings/tracelab-v1.json`, session rule, `$.provider` through an `enum_map`), but the
product's whole premise is user-authored and assistant-authored mappings for new sources (#15/#16;
`backend/tests/verification/documents/swe-chat-*.json` are hand-written examples).

For any such mapping the plan emits one `claim_scope_unavailable` per *emission*. On a
100,000-record file that is >100,000 rows in `import_diagnostics` — a table with a six-column
UNIQUE index and a seven-column secondary index (plan lines 190) — plus >100,000 counted into
`record.warning_counts`, `file.warnings` and `report.warnings`. The Console report's Warnings panel
(`web/src/pages/Imports.tsx:221`) would read `claim_scope_unavailable: 400,000` on a perfectly
healthy import, and the diagnostics table would be larger than `model_calls` and `tool_calls`
combined. The plan's own risk section (lines 450–455) frames this only as reduced coverage; the
accounting and storage consequence is not considered.

**Required change.** An unresolvable claim scope is a property of a *file and rule*, not of each
emission. Record it once per `(file_sha256, rule_id)` with the number of affected emissions, and
keep it out of the per-emission `import_diagnostics` table and out of per-record
`warning_counts` — or, if it must stay a warning code, state a hard cap and how the report explains
truncation. Also state explicitly what happens when the mapping has no `session` rule at all
(reducer creates implicit sessions), because that is the all-unavailable case.

## 2. P1 — The 0005 backfill hard-fails `alembic upgrade`, and `upgrade` runs on every application start

**Plan:** Design 4, lines 260–265 ("If provenance is missing, a stored mapping is not executable, or
replay disagrees with a persisted call, fail upgrade … Do not fabricate projections").

**What is wrong.** `build_container` calls `run_migrations(engine)` unconditionally at start-up
(`backend/src/agentscope_app/interfaces/api/container.py:117`), and `run_migrations` wraps
`command.upgrade(config, "head")` in a single `engine.begin()`
(`backend/src/agentscope_app/infrastructure/db/engine.py:40–44`). A migration that raises therefore
does not degrade a feature — it **prevents the application from starting**, permanently, for any
database that trips one of the three conditions. All three are reachable without corruption: a
mapping revision stored when the parser was looser is no longer `is_executable`
(`application/use_cases/imports.py:56–66` shows executability is re-derived, not stored); replay
"disagreement" has to compare recovered Python values against SQLite-returned values across
`Boolean`/int, `UtcDateTime` naive-vs-aware (`infrastructure/db/models.py:41–55`) and Decimal-vs-int
token values, which is a large surface for spurious mismatch. The offered remedy — "an actionable
provenance-repair message" — describes a repair procedure that does not exist anywhere in the repo.

The plan already carries the correct signal for "we could not check this": `duplicate_detection_version
= null` (lines 192, 271–273).

**Required change.** The migration must never abort the upgrade on data conditions. On an
unrecoverable import/file, skip its claims, leave that import's `duplicate_detection_version`
null, and record the reason in a row the diagnostics API can show. Keep the hard-failure behaviour,
if wanted at all, behind an explicit opt-in maintenance command that is not on the start-up path.
Replace `test_0005_missing_provenance_or_replay_mismatch_rolls_back` with a test that asserts the
upgrade *succeeds* and marks the affected imports unchecked.

## 3. P1 — Claim/scope writes inherit `store()`'s blanket `IntegrityError → ConflictError`, which reports a race that did not happen and rolls back a healthy import

**Plan:** Design 3 step 2, lines 205–209 ("Insert all eligible claims in bounded executemany
batches; intern scopes with UNIQUE-backed upserts") and Design 5, lines 293–294 (`Change
TraceRepository.store(..., claims: Sequence[ClaimCandidate])`).

**What is wrong.** `SqlAlchemyTraces.store` wraps the *entire* `_store` body and translates **any**
`IntegrityError` into `ConflictError("Another import of the same bytes for this source is already
committed")` (`backend/src/agentscope_app/infrastructure/db/repositories.py:505–512`). `CommitImport`
then catches `ConflictError` specifically, writes every file of the attempt as `failed` with the
message "lost a race with a concurrent import of the same bytes", and re-raises so the API answers
409 (`application/use_cases/imports.py:328–344`). Putting claim, scope and extrema inserts inside
`store` means any integrity violation in the new tables — most plausibly a duplicate
`claim_scopes(version, scope_text)` from a second connection that committed between this
transaction's read and write, or an FK failure on `entity_claims.file_sha256` — **rolls back an
otherwise successful import and blames a byte-level race that never occurred.** The plan guards the
opposite direction only ("Do not broaden occurrence uniqueness errors into native-ID conflicts",
line 321).

**Required change.** State that scopes and extrema are written with
`sqlalchemy.dialects.sqlite.insert(...).on_conflict_do_nothing()` / `on_conflict_do_update()` so no
`IntegrityError` is raised on the normal path (the codebase already uses this pattern —
`repositories.py:282–284`), and narrow the `except IntegrityError` in `store` to the occurrence-key
constraints (`uq_model_calls_occurrence`, `uq_tool_calls_occurrence`) so that any other integrity
failure surfaces as itself and is reported as a `failed` import with its real cause, not as a 409.
Add this case to the extended `test_race_loser_is_recorded_as_failed_then_conflicts`
(`backend/tests/infrastructure/test_multifile_import.py:272`).

## 4. P2 — The detection predicate flags identical re-exports whenever the source repeats a native key inside one file

**Plan:** Design 2, lines 149–156 (the predicate), Design 3, lines 189 and 226–230 (extrema and the
"why extrema suffice" argument).

**What is wrong.** The predicate is "*some* peer file has a different projection for this scope". Take
a source that legitimately repeats a native id inside a file with two different projections — the
exact case ADR-002 exists for and that ADR-002:15–19 documents upstream (about 8,900 duplicated
`round_id`, 514 `trace_key` duplicates). File A holds claim K with projections {P1, P2}. Export the
same data again as file B, byte-different but content-identical: B also holds {P1, P2}. B's P1
emission finds A's P2 (different) and warns; B's P2 finds A's P1 and warns. **Two identical exports
warn on every repeated claim**, and the Console notice the plan specifies (lines 353–355) tells the
user "N emitted observations have matching native claims with different values in another file",
which is false for this data. That is precisely the false-positive class the issue asks to decide.

**Required change.** Use the stronger, cheaper predicate: warn when **no peer file holds an *equal*
projection** for this scope. It still catches the target case (a re-export with a changed timestamp:
the changed projection has no equal peer) and it stops flagging equal multisets. It also simplifies
the storage: replace `claim_file_extrema` with a distinct-projection table
`claim_file_projections(scope_id, projection_text, file_sha256)` as PK plus a witness `claim_id`.
Then

- the equality probe is one index seek: `WHERE scope_id=? AND projection_text=? AND file_sha256<>?
  LIMIT 1`, and at most one scanned row can belong to the incoming file because the PK makes
  `(scope, projection, file)` unique — the same bounding argument the plan already makes;
- the *witness* for the diagnostic still needs the two range probes (`< P` ordered descending and
  `> P` ordered ascending, `LIMIT 1`), with the identical one-skipped-row bound;
- four correlated probes per candidate become three, and one table and one text column disappear.

If the plan wants to keep the current predicate, it must say so explicitly, justify it against the
notice wording, and add a named test for the equal-multiset case (`file A {P1,P2}` vs `file B
{P1,P2}`) that pins the chosen answer. `test_repeated_keys_within_file_need_another_file` (line 407)
does not cover it.

## 5. P2 — Scoping claims by harness contradicts the session identity the application actually stores, and makes `agent` an unflaggable projection field

**Plan:** Design 1, lines 88–107 (harness in the scope) and line 131 (the session projection field
list includes `agent`).

**What is wrong.** Two independent problems from the same choice.

(a) The stored session key has no harness: `UniqueConstraint("source", "external_id",
name="uq_sessions_source_external_id")` (`infrastructure/db/models.py:220`), and
`existing_sessions`/`_upsert_sessions` look up by `(source, external_id)` only
(`repositories.py:470–494`, `640–702`). Two files that disagree about the harness are therefore
**merged into one session row** with a `conflicting_value` reducer diagnostic
(`domain/reducer.py`, `_merge_session_fields`) — while the plan's claim comparison treats them as
different entities and stays silent. The diagnostics channel's notion of identity is stricter than
the storage's, in the direction of false negatives, on exactly the observations that *did* collide.

(b) Because children resolve harness file-locally from session declarations, and `tracelab-v1.json`
derives session `agent` from `$.provider` through an `enum_map`, a re-export in which the provider
label changed (or became unmapped) changes the scope of **every session, model and tool claim in the
whole file**. The file then compares against nothing and produces zero suspected duplicates —
silently. Meanwhile `agent` sits in the session projection (line 131) where, being part of the
scope, it can never be the field that differs.

**Required change.** Either drop harness from the scope of *child* claims (session external id
already scopes them, and it matches the identity the reducer and the `sessions` table use), or state
in the plan why the diagnostics channel deliberately uses a stricter identity than the store, and
add named tests for both: (i) same session id, different declared `agent` across files → what
happens to the session claim, and (ii) a file whose provider label changed → assert the resulting
coverage loss is the intended outcome.

## 6. P2 — The "native-key definition" in the scope is vacuous as a collision guard, and unguarded as a compatibility claim

**Plan:** Design 1, lines 88–96 ("Thus different key definitions do not accidentally collide") and
Tests line 407 (`test_compatible_mapping_revisions_compare`).

**What is wrong.** The key "definition" available to `prepare_claims` is `Rule.native_key`, a tuple
of *canonical target field names* (`domain/mapping/contract.py:56`,
`domain/mapping/parser.py:277–301`). Those names come from a tiny fixed set, and
`parser.py:285` *defaults* `native_key` to `("external_id",)` whenever the rule maps `external_id` —
so nearly every rule in every mapping has the identical key definition. Two mappings of the same
source that claim `external_id` from different source paths (mapping revision 1 from `$.trace_key`,
revision 2 from `$.round_id` — both are present in the TraceLab records, see the `unmapped` entry in
`backend/mappings/tracelab-v1.json`) produce **the same scope text for unrelated values**. The
stated protection ("different key definitions do not accidentally collide") does not hold, and
"Compatible mapping revisions can compare" (line 95) has no definition of compatible.

**Required change.** Either include a fingerprint of what actually feeds the key fields (the source
paths and transforms of the `native_key` fields, taken from `MappingSpec`, which `prepare_claims`
already receives) and accept that this narrows "compatible revisions", or state plainly that
comparison is only meaningful inside one source namespace where the operator asserts a stable claim
contract, and make `test_compatible_mapping_revisions_compare` a test of *that* stated contract —
including a negative case where two revisions claim `external_id` from different paths.

## 7. P2 — Equal cross-file projections produce no diagnostic at all, so the commonest real duplicate doubles the counts silently

**Plan:** Design 1, lines 142–145 ("Equal scoped projections receive no `suspected_duplicate`
warning and remain accepted observations. This issue does not classify equal cross-file observations
as the record outcome `duplicate`").

**What is wrong.** The decision not to change the five record outcomes is correct and matches the
issue. But the plan then makes the equal case *entirely invisible*: no code, no count, no report
sentence. A user who imports two byte-different exports of the same sessions gets `model_call`
doubled (4,770 → 9,540 for the committed fixture; `docs/api/v0.1.md:206`), sessions merged, token
totals doubled, and a report that says nothing at all. ADR-002:48–50 explicitly allows the equal
case to be *classified* ("matching scoped native claims with equal canonical entity projections can
also be classified as duplicates, with provenance retained"), and the issue's first task is to
decide "equal projections vs different ones" — deciding "nothing happens, and nothing is said" is
the one outcome that leaves the report misleading.

**Required change.** Add a second counted code (for example `matching_claim_equal_projection`) on
the same diagnostics channel, or — at minimum — a report sentence stating how many emissions matched
a claim in another file with identical values, plus a named test. Either way this must not touch the
five record outcomes or `entities`. The predicate in finding 4 already computes the equality answer,
so the extra code is nearly free.

## 8. P2 — Exact projection text is stored and indexed in three places, and the projected fields are unbounded

**Plan:** Design 3, lines 188–198 (`entity_claims.projection_text`, `claim_file_extrema.min/max_projection`
plus two indexes over them) and Risks, lines 461–464.

**What is wrong.** The plan measures the cost but does not bound it. Two concrete problems:

- `model_call.error_message` is `Text` with no length limit (`infrastructure/db/models.py:248`), and
  `tool_call.status`/`session.repo` are 100–300 chars. A single trace with a 1 MB error string
  becomes a 1 MB index key in *both* extrema indexes plus a 1 MB `projection_text` in
  `entity_claims`. SQLite handles that, badly.
- For the committed fixture, `entity_claims` gains 15,263 rows (4,770 session + 4,770 model_call +
  5,723 tool_call emissions) against 10,573 entity rows, each carrying the whole canonical row again
  as JSON text. `session` emissions are per-record, so a source with 100k records in 5 sessions
  writes 100k session claims, each with a full session projection.

`entity_claims.projection_text` is arguably redundant: the only projections ever *read* are the
witness's, which the extrema (or, per finding 4, the distinct-projection table) already carries.

**Required change.** Either (a) keep exact text only in the distinct-projection/extrema table and
store a `projection_sha256` in `entity_claims` (so rebuild is still possible from raw provenance),
or (b) index a `projection_sha256` and keep exact text out of the index entirely — a 256-bit digest
mismatch is a sound equality test, and the witness's exact text is fetched by the join the plan
already does. State a documented maximum projection length and what happens above it. Give the
verification document a numeric budget ("index + table growth must stay under N× the entity tables
at 100k emissions"), not just "measure".

## 9. P3 — The plan never says where claim values come from, and `Emission.native_key` cannot supply what it asks for

**Plan:** Design 1, lines 88–91 ("encoded as typed canonical values, not delimiter-joined strings")
and lines 112–114 ("A present empty string is a literal value, distinct from null").

**What is wrong.** `Emission.native_key` is `tuple(str(p) for p in parts)`
(`domain/mapping/interpreter.py:315–320`): the values are already stringified and the key *names* are
not carried on the emission at all. Reading it would make integer `5` and string `"5"` collide in a
composite key, which is what the plan says it must avoid. The typed values are only available from
`emission.fields[name]` combined with `Rule.native_key` from the `MappingSpec` — which
`prepare_claims(source, emissions, specs_by_file)` does receive, but the plan never says this is the
source. Note also that if values are re-read from `emission.fields`, the "any null component ⇒ no
claim" rule (`interpreter.py:317–319`) must be re-applied in `domain/claims.py`, not inherited.

**Required change.** Say explicitly that scope values come from `emission.fields` keyed by
`Rule.native_key` (resolved through `specs_by_file` by `rule_id`), that the null-component rule is
re-applied there, and add a test that composite key `(5, "x")` and `("5", "x")` produce different
scopes.

## 10. P3 — The `{items, total, comparison_version}` envelope diverges from every other list endpoint

**Plan:** Design 6, lines 330–336.

Every existing collection route returns a bare array: `GET /api/imports/{id}/rejects` →
`list[RejectRow]` and `GET /api/imports/{id}/records` → `list[RecordRow]`
(`interfaces/api/routers.py:166–194`; `docs/api/v0.1.md:230,236`), and the Console `Pagination`
component takes `count` = rows on the current page, not a total
(`web/src/components/primitives.tsx:43`). The new shape is defensible but it is a new convention.
State why, say where `comparison_version` lives when the report already carries it, and say what
`Pagination` does with `total` (nothing today).

## 11. P3 — `duplicate_detection_version` and `FileInfo.warnings` are specified for the table and for TypeScript but not for the application DTOs

**Plan:** Design 3, lines 191–192 (columns) and Design 6, line 344 (TypeScript), against Design 5,
line 299 (`FileInfo.warnings` only).

`ImportReport` (`application/dto.py:176–188`) and `FileInfo` (`:163–172`) are frozen dataclasses whose
last fields already have defaults, so appending `warnings: dict[str, int] = field(default_factory=dict)`
and `duplicate_detection_version: int | None = None` is safe — but the plan must list them, because
`SqlAlchemyImports._to_dto` (`repositories.py:326–354`) and `add_report`/`update_report`
(`:201–277`) all have to round-trip them, and `test_multifile_import.py:118` asserts
`uow.imports.get(report.import_id) == report` on the whole dataclass.

## 12. P3 — "Child entities independent of parent changes" is only partly true, because `session_external_id` is inherited from the parent

**Plan:** Design 1, lines 116–120 and 138–140; test `test_parent_changes_leave_child_projection_equal`
(line 406) and `test_parent_change_does_not_flag_unchanged_tool` (line 407).

`_emit` fills a child's `session_external_id` from its parent emission when the child does not map
one, and rejects the child when they disagree (`domain/mapping/interpreter.py:284–300`). In
`tracelab-v1.json` the `tool_call` rule maps no `session_external_id`, so it is *always* inherited.
A parent whose `session_id` changed between exports therefore changes both the child's projection
(`session_external_id` is field 1 of the tool projection, plan line 132) *and* the child's scope —
moving it to a different scope, i.e. a false negative rather than a flag. Name this in the plan and
make the two tests use a parent field that is genuinely not projected (`model`, `input_tokens`), not
the session id.

## 13. P3 — Test-surface omissions

- **e2e fixtures are unspecified.** Tests line 416 says "synthetic custom-source A/B/C uploads" in
  `web/e2e/smoke.spec.ts`, but no synthetic multi-file fixture is committed and a custom source also
  needs a mapping revision (`assist.spec.ts` creates one through the assistant). Say how the three
  files and the mapping are created (in-memory `setInputFiles` buffers plus `POST /api/mappings`).
  The plan's reasoning about appending after the existing unscoped assertions is correct and
  verified (`smoke.spec.ts:51–64` measures unscoped dashboard totals; `assist.spec.ts:85–88` is
  scoped to `assist-e2e` and runs after the `chromium` project per `playwright.config.ts`).
- **`web/src/App.test.tsx:15`** mocks `/api/imports` as `[{ ...report, warnings: undefined }]`;
  moving `warnings` onto `ImportSummary` makes that mock contradict the new type. The file is in the
  touched list but this specific line should be named.
- **`backend/tests/verification/test_replay_without_assistant.py`** and
  `backend/tests/verification/documents/*.expected.json` are not in the touched list. They import
  multi-file SWE-chat fixtures and pin expected documents; confirm they are unaffected, or list them.
  (Good news: no backend test asserts `report.warnings ==` exact equality, so a new code will not
  break existing assertions.)
- **`docs/api/v0.1.md:226`** already misdescribes history as "`[{import report without warnings
  detail}]`" while the backend returns full reports; the plan depends on history carrying warnings,
  so fix that line explicitly.
- **The session page shows nothing.** `SessionDetail.diagnostics` exists and is rendered, but it is
  fed only from `session_diagnostics` (reducer conflicts) — `repositories.py:761–763,806`. The issue
  only asks for report and history surfaces, so this is in scope to *state*, not to build: say
  explicitly that a session whose observations are suspected duplicates shows no marker.

---

## What the plan gets right

- **Every citation checks out.** All 30-odd file paths, symbols and behaviours in "Current state"
  are accurate, including the non-obvious ones: call tables have no `external_id` column
  (`models.py:225–280`), claims are JSON `native_key`, `store` returns only `dict[str, int]`
  (`ports.py:144–158`), session storage is keyed `(source, external_id)` without harness
  (`models.py:220`), `INSERT_CHUNK = 500` (`repositories.py:861`), `uq_import_files_committed_source`
  is a partial unique index (`models.py:161–167`), alembic head is `0004` with `down_revision =
  "0003"`, `ImportSummary`/`ImportReport` split in `web/src/api/types.ts`, and the Playwright
  `chromium` project matching only `smoke.spec.ts`. Findings 1–4 and 11 of the #9 Codex review say
  what the plan says they say. I found nothing cited that does not exist.
- **The three projection field lists are exactly the target schema** (`domain/schema.py:48–105`) —
  all 6 session, 15 model_call and 11 tool_call fields, none added, none dropped. Freezing them per
  comparison version instead of reading `TARGET_SCHEMA` at runtime is the right call.
- **The reading of ADR-002 is correct** where the #9 plan's was not: projections, not native ids;
  no parent-record hashing for children; no session identity change; no reclassification of the five
  record outcomes; "unavailable" as a designed value rather than a zero.
- **The bounded-lookup argument is genuinely sound.** "A file has any projection different from P iff
  its min or max differs from P", and "at most one row in each projection range belongs to the
  incoming file because `(scope, file)` is unique", are both correct, and the four strict ranges do
  implement the predicate without scanning a hot bucket. Finding 4 changes the predicate, not this
  reasoning — the same bounding argument carries over.
- **Determinism is handled properly**: staging all claims before detection so both files of a mixed
  batch qualify, one warning per qualifying emission regardless of peer count, witness chosen by
  file/locator-position/locator/emission-path/entity rather than insertion id, and no rewriting of
  earlier report snapshots. This directly answers findings 4 and 11 of the #9 review.
- **Accounting integration is right**: `stored.entity_counts` remains the only source of entity
  counters, `RECORD_OUTCOMES` is untouched, warnings roll up record → file → attempt, and the
  additive `FileInfo.warnings` / `imports.duplicate_detection_version` respect existing databases.
- **Operational care**: reading back claim ids via `index(import_id, id)` rather than relying on
  `executemany` returning keys, keyset batches of 128 in the backfill, migration-local table
  definitions instead of live ORM models, refusing to advertise "one query" when scope interning is
  extra round trips, and noticing that the Playwright smoke project only selects `smoke.spec.ts`.
- **Scope isolation is correct for the two named false positives**: the same external id under two
  sources cannot compare (source namespace is in the scope), and a re-export with changed timestamps
  is flagged because timestamps are in the projection and not in the scope.
