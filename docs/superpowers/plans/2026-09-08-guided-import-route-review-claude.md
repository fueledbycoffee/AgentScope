# Cross-review (Claude) of `2026-09-08-guided-import-route.md` — issue #45

**Verdict: APPROVE WITH CHANGES** — 1 × P1, 5 × P2, 8 × P3.

The plan is unusually well grounded: nearly every file, symbol and endpoint it
cites was checked and is correct. One acceptance criterion is silently demoted,
the reducer's declared state cannot enforce the reducer's own declared
invariant, and accessibility between stops (focus, the stage-bar status region)
is unaddressed. None of that needs a re-plan; it needs the amendments below
before code is written.

---

## Findings

### 1 · P1 — the Mapping stop's "Neither fits?" assistant link is demoted to the empty state, which drops an acceptance criterion and regresses today's page

**Where.** Plan, "Stop behavior", item 2 (`docs/superpowers/plans/2026-09-08-guided-import-route.md:201-213`). The only mention of the assistant is: *"If a file has no candidate, its designed empty state names the format and links to unchanged `/import/assist/:uploadId`"*. The phrase "Neither fits?" appears nowhere in the plan.

**What is wrong.** The issue lists, as a Mapping-stop requirement, *"the 'Neither fits?' link to the assistant page (`/import/assist/:uploadId`, unchanged)"* **and**, separately, *"designed empty when no mapping accepts the file"* (`issue-45.md:12`). These are two states, not one. The plan collapses them, so a user whose file *does* have candidate mappings — the common case — loses the route to the assistant entirely.

**Evidence checked.**
- `research/design/claude/4-guided/mockup.html:540` renders the link *below the radio cards*, on the success path: `<p class="small" …>Neither fits? <a …>Set up a new mapping with the assistant</a> — it profiles the file, proposes a mapping and explains each field; nothing is imported until you confirm.</p>` It is followed at `:541` by the stage bar; it is not inside any empty state.
- `research/design/claude/3-console/README.md:103`: *"Step 2 lists mappings that read the sniffed format as radio cards with a one-sentence description, **plus 'Ask the assistant'**; when no mapping reads the format (parquet) the step says so and **the assistant is the primary action**."* The Console design of record makes the same two-state distinction, and additionally specifies that in the no-candidate case the assistant is promoted to the *stage-bar primary action* — the plan's `StageBar` contract (`:86-91`) never covers that case, so today the no-candidate Mapping stop has no defined primary action at all.
- `web/src/pages/Import.tsx:134-138` shows the link is present today whenever an upload exists, unconditionally, with the exact `navigate(\`/import/assist/${…}\`, { state: { upload } })` call. Removing it is a functional regression, not just a spec miss.

**Required change.** In "Stop behavior" item 2, state that (a) every file's mapping card group is followed by a persistent "Neither fits?" link to `/import/assist/:uploadId` carrying `{ state: { upload } }`, on the success path as well as the empty path; (b) when a file has no candidate mapping, the StageBar primary action for that stop becomes the assistant link rather than `Run a dry run`, and the "Files touched"/`StageBar` prop contract admits a link-shaped primary. Add a route test to the `Tests` list asserting the link is present when candidates exist.

---

### 2 · P2 — `ImportEntry` holds only `mappingId`, so the reducer cannot enforce the "compatible mapping" invariant it claims, and a restored session can reach Mapping/Preview/Confirm with an unresolvable mapping

**Where.** Plan `:126-142` (`ImportEntry { upload; mappingId: string | null; preview }`) versus `:157-159` (*"every upload needs a **compatible** selected mapping before Preview is reachable"*) and `:226-228` (Confirm shows *"every exact mapping name/revision/id"*).

**What is wrong.** Compatibility is defined by the plan itself as `mapping.input_format === upload.format` (`:203-205`), and the receipt needs `mapping.name`/`mapping.revision`. Neither is derivable from an id. The mapping list is fetched separately (`useResource(listMappings)`), is not in reducer state, and is not persisted. So:
- `highestReachableStep(state)` can only test `mappingId !== null`. A stored entry whose `mappingId` no longer resolves in the fetched list — or that has not resolved *yet*, because `GET /mappings` is still in flight — is reported as reaching Preview/Confirm. The plan's own defence against fabricated deep-link data (`:170-173`) therefore has a hole at exactly the point it claims to close.
- The Confirm receipt and the rail fact `tracelab-v1 · rev 1` have no defined rendering while the mapping list is loading or when lookup fails.

Today's page fails closed by accident: `web/src/pages/Import.tsx:52-53` derives `mapping` by `find`, and `:139` disables Preview on `!mapping`. Moving the gate into a reducer that lacks the data removes that safety.

**Required change.** Either (a) persist and carry the resolved `Mapping` object (not just its id) on each entry, as today's `Stored.batch` already does for `Pair.mapping` (`Import.tsx:11,15`), and revalidate it against the fetched list on load; or (b) make reachability a selector that takes `(state, mappings)` and state explicitly that an unresolved `mappingId` clears that entry's mapping and preview and re-clamps `?step=`. Name the chosen option in "Pure reducer and deep links", and add a unit test `a stored mappingId that no longer resolves drops the entry to the Mapping stop`.

---

### 3 · P2 — no focus management between stops, and the stage-bar status is not declared a live region

**Where.** Plan, "Design" (`:76-116`) and "Stop behavior" (`:186-234`). "Focus" appears only as *"focus rings"* in the Current-state inventory (`:48-50`) and as *"focus/tooltip accidents"* in the screenshot check (`:333`).

**What is wrong.** Two gaps:
- **Focus.** Advancing a stop replaces the entire stage, including the button that was activated. Nothing in the plan says where focus goes. In a four-stop wizard this strands keyboard and screen-reader users on a detached node and gives no announcement of the new stop. The same applies to a completed-stop rail button going back, and to the error path where a danger note appears. The review brief asks for focus management between stops; the plan has none.
- **Stage-bar status.** `StageBar` is specified as taking *"status content"* (`:86-90`) with no role. The reference marks it live: `mockup.html:541` renders the dry-run status as `<span class="small muted" role="status">… Applying the mapping to 200 records, nothing written</span>`. The plan declares a live region for the File stop (`:190-193`) and for Confirm (`:229-231`) but leaves the Preview/dry-run running state — the one the issue calls out as *"status text between them while something runs"* (`issue-45.md:10`) — unannounced.

**Required change.** Add to "Design": on every stop transition, focus moves to the stage's `<h1>` (`tabIndex={-1}`, focus removed on blur), and the rail's completed-stop buttons do the same; on an error, focus moves to the `role="alert"` note. Give `StageBar`'s status slot `role="status"` when non-empty. Add assertions to the `App.test.tsx` list (`focus lands on the stop heading after Continue and after a rail backtrack`) and to the smoke list.

---

### 4 · P2 — Back is specified as an icon-only `IconButton`, but no left-pointing glyph exists and `icons.tsx` is excluded from "Files touched"

**Where.** Plan `:88-90` (*"Back is an icon-only Console `IconButton` with accessible name and visible tooltip"*) against `:268-269` (*"shared Console components/styles … remain unchanged"*).

**What is wrong.** `web/src/components/icons.tsx:8-36` contains `arrowRight`, `chevronDown`, `chevronUp`, `x`, `check`, `plus`, `trash`, `eye`, `upload`, `refresh`, `play`, `layers` — and no left arrow or left chevron. `IconName` is `keyof typeof PATHS`, so any Back icon is a type error until a path is added to `icons.tsx`, which the plan's exhaustive file list forbids. The plan is internally inconsistent.

(The plan's accessibility claim for `IconButton` is otherwise correct and worth keeping: `icons.tsx:45-50` already applies `has-tip` and `data-tip={label}` plus `aria-label`, so an icon-only Back satisfies the owner's icon rule without extra work.)

**Required change.** Add `web/src/components/icons.tsx` to "Files touched" with the single scoped edit *"add `arrowLeft` to `PATHS`"*, or specify Back as a text button. Given the issue's wording — *"Icons over labels where the Console rules already apply; the primary action keeps its verb"* (`issue-45.md:10`) — adding the glyph is the better answer; note also that `docs/adr/ADR-006-ui-design-direction.md:33-36` still says *"no icons beyond the `i` and the chip close"*, so the ADR amendment (finding 12) should cover this too.

---

### 5 · P2 — the cost estimate under-counts the test work, and the plan records no timebox fallback although the issue offers one

**Where.** Plan, "Cost estimate" (`:396-403`): *"2 hours for unit/integration/Playwright updates and screenshot capture"*.

**What is wrong.** That two hours has to cover: 10 new reducer unit tests (`:278-287`), 6 rewritten integration tests plus 5 new ones (`:290-312`), a rewritten `uploadFixtureAndPreview` helper and four new e2e assertion blocks including a deep-link reload and a 900 px overflow check (`:316-333`), and four inspected screenshots. Rewriting `web/e2e/smoke.spec.ts:22-77` alone — the helper plus the day-1 test plus the duplicate path — is not a 20-minute change against a 120 s-timeout serial suite that must be re-run end to end each iteration. Realistic: 4–5 h for tests, so ~14–16 h total, against a sprint ending 2026-09-11 with the plan review consuming part of 09-08.

Separately, `issue-45.md:15` explicitly offers a release valve: *"If this does not fit the timebox, the batch stays on the current layout behind the same route and the issue says so."* The plan takes the maximal option — full per-file mapping card groups, aggregate previews, partial-failure handling, a persistence migration — and never records the fallback or a decision point.

**Required change.** Re-slice the estimate with tests at 4–5 h, and add a "Timebox fallback" paragraph naming the trigger (e.g. *if the four stops and the reducer are not green by end of 09-09, the multi-file batch keeps today's queue layout inside the four-stop route and the PR body says so*) and what ships in that case. State whether the single-file route alone still satisfies every other criterion (it does).

---

### 6 · P2 — the `?step=` deep-link acceptance depends on `sessionStorage` succeeding, which the code silently swallows and a 20-file batch can exceed

**Where.** Plan `:175-182` (*"Session storage keeps the existing `agentscope-import-page` key with a versioned payload containing **all entries and their previews**"*) and the smoke step at `:322-324` (*"Reload `/import?step=3` after preview state has reached session storage and assert the Preview stage opens"*).

**What is wrong.** The persisted payload per entry is `Upload` — which carries `preview`, the first 20 decoded records with **full payloads** (`web/src/api/types.ts:24-27`) — plus an `ImportPreview` carrying up to 50 rejects and 50 emissions each (`backend/src/agentscope_app/application/use_cases/imports.py:53` `SAMPLE_LIMIT = 50`, applied at `:136` and `:147`). At the API's documented batch ceiling of 20 files (`docs/api/v0.1.md:182-183`) this is plausibly several MB against a ~5 MB `sessionStorage` quota. `web/src/pages/Import.tsx:23-28` swallows the write failure (`catch { /* storage is a convenience */ }`), so the failure mode is a silent loss of the batch and a `?step=3` deep link that clamps back to File with no explanation.

**Required change.** State in "Pure reducer and deep links" what is *not* persisted — drop `upload.preview` (the 20-record disclosure can be re-fetched or simply absent after reload) and the `emissions`/`rejects` arrays, keeping the counts needed for the rail facts and the Confirm receipt — and specify the behaviour when the write throws: a visible notice that the batch will not survive a reload, not silence. Add a unit test for the trimmed persistence shape.

---

### 7 · P3 — the upload phase text is static where the issue asks for progressing phases; flag it as a deviation, not only as a risk

`issue-45.md:11` asks for *"uploading (`role="status"`, phase text storing → hashing → counting)"*; `mockup.html:502` animates it. The plan (`:190-193`, and the first Risk at `:370-374`) deliberately renders the ordered work statically because `POST /uploads` is request/response — which is the honest call, and correct: `web/src/api/index.ts:48-52` confirms there is no progress channel. But the deviation is buried in Risks and absent from the acceptance table (`:356-365`), so a reviewer mapping tasks to criteria will read the criterion as met. Add a row to the acceptance table naming the deviation and the reason.

### 8 · P3 — same for the Confirm "exact record counter"

`issue-45.md:14` asks for *"an exact record counter in a live region"*; the plan (`:229-231`) shows a static `Importing N records in one transaction`. Same justification, same fix: surface it in the acceptance table rather than only in Risks.

### 9 · P3 — two existing import tests are missing from the test plan

The plan enumerates five `App.test.tsx` tests to update or keep (`:290-303`) and their names match the file exactly. It omits two that the rewrite touches: `web/src/App.test.tsx:95` `shows the decode error for an undecodable upload preview line` (asserts on the first-20-record table, which moves behind a disclosure on the File stop) and `:197` `does not redirect away from a new page when an earlier import finishes` (the stale-navigation guard the plan re-implements as operation generations). Name both and say what happens to them.

### 10 · P3 — three e2e mechanics the plan asserts but does not specify

- *"open the same URL in clean storage"* (`:324`) — `page.goto` preserves `sessionStorage` within a tab. The step needs `browser.newContext()` or an explicit `sessionStorage.clear()` + reload; say which.
- *"screenshots … at 1440 px"* (`:329-331`) — the effective e2e viewport is 1280 × 720, because the `chromium` project's `use: { ...devices['Desktop Chrome'] }` overrides the top-level `viewport: { width: 1280, height: 900 }` (`web/playwright.config.ts:20,32`). The step needs an explicit `page.setViewportSize`, and its ordering relative to the 900 px check must be stated.
- The reduced-motion contract cannot be proven in e2e: `web/playwright.config.ts:23` sets `reducedMotion: 'reduce'` for every run. Note that `web/src/styles/base.css:17` already kills all transitions and animations globally under `prefers-reduced-motion: reduce`, so the plan's extra rule (`:110-111`) is a no-op — either drop it or verify it in a unit/CSS test instead.

### 11 · P3 — put `import.css` beside its components, not in the shared `web/src/styles/`

Plan `:104-107,259-260` places the new stylesheet at `web/src/styles/import.css`. That directory holds the shared Console vocabulary (`tokens.css`, `base.css`) that other agents may be editing this wave, and both are imported from `web/src/main.tsx:6-7`. The established precedent for route-scoped CSS is `web/src/assist/assist.css`, imported from the page itself (`web/src/pages/Assist.tsx:44`). Move it to `web/src/import/import.css` and import it from `Import.tsx`; this also keeps the plan's own "route-specific views live under `web/src/import/`" rule (`:71-73`) intact. (Note the plan's claim that `.rail` is taken by the global navigation is correct — `web/src/styles/base.css:56-65` — and the `import-route-` prefix is the right answer.)

### 12 · P3 — the ADR amendment should reconcile the icon rule it will sit next to

Plan `:238-244` describes the amendment well. Add one sentence reconciling ADR-006 rule 4 (`docs/adr/ADR-006-ui-design-direction.md:33-36`: *"no cards with shadows, no icons beyond the `i` and the chip close"*) with the owner's standing icons-over-labels rule and the icon set already in use on this very page (`Import.tsx:89,98,135,142,170`). Otherwise the amendment records a Passage adoption immediately below a rule the route breaks.

### 13 · P3 — say what browser Back does after a commit

Plan `:172-174` pushes a history entry per stop; `:179-182` clears storage on any returned report and navigates to `/imports/:id`. Browser Back from the report therefore lands on `/import?step=4` with empty storage, which the clamp (`:167-170`) rewrites to step 1. That is defensible, but it is a user-visible behaviour the plan should state, and the smoke's existing `page.goBack()` habit (`web/e2e/smoke.spec.ts:136`) makes it cheap to assert.

### 14 · P3 — say explicitly that "Unavailable" has no occurrence on this route

Plan `:95-98` says stat rows render *"without … `Unavailable` for a known zero"*, which is right (0 is a measured value). But the brief and ADR-006 rule 2 make "Unavailable" a designed value, and a reviewer will look for it. Add one line: every measure on the import route is known — `Upload.record_count` is non-nullable (`web/src/api/types.ts:8-13`) and `ImportPreview.records` counts are always present (`:52-58`) — so "Unavailable" correctly never appears, and a zero renders as `0`.

---

## What the plan gets right

- **Its factual base holds up.** Every symbol, endpoint and constraint it cites was checked and is accurate: the Console primitives it reuses all exist and are exported (`DataTable`, `Notice`, `StateBlock`, `Icon`, `IconButton`, `JsonView`, `FileBar` — `web/src/components/index.ts`); every token family it names exists in `web/src/styles/tokens.css:7-57`; the `.rail`/`.bar` collisions are real; the global reduced-motion rule is real; `web/test-results/` is gitignored (`web/.gitignore:28`); and the five `App.test.tsx` test titles it quotes match verbatim.
- **"Seen before" has a real source of truth, and the plan found it.** `Upload.already_imported` (`web/src/api/types.ts:24-27`, `docs/api/v0.1.md:23,29`) is exactly the evidence the criterion needs, already rendered today (`Import.tsx:116-120`) and already asserted in the smoke (`web/e2e/smoke.spec.ts:66-75`). No new endpoint is invented anywhere.
- **API fit is exact and no backend change is smuggled in.** Every stop uses only `POST /uploads`, `GET /mappings`, `POST /imports/preview`, `POST /imports`. The single-vs-`files` request bodies match `requestFor` (`Import.tsx:30-33`) and `docs/api/v0.1.md:182-183`. The 413 copy is grounded in the documented 25 MiB upload limit (`docs/api/v0.1.md:293`).
- **It refuses to fabricate.** Twice — the upload phase counter and the import record counter — it declines to animate numbers the server does not send, and it refuses to claim column-level mapping compatibility that `GET /mappings` cannot support. `created_by: "bundled" | "user"` (`docs/api/v0.1.md:33,46`) really is the only provenance signal available, and the "superseded" rule is sound because mapping identity is `UniqueConstraint("name", "revision")` (`backend/src/agentscope_app/infrastructure/db/models.py:120`), so grouping by name is exactly right.
- **The assistant hand-off is preserved.** `/import/assist/:uploadId` stays a separate route (`web/src/App.tsx:48`) and the plan keeps the `{ state: { upload } }` payload that `web/src/pages/Assist.tsx:65-66` reads — subject to finding 1, which is about *where* the link appears, not what it carries.
- **Scope discipline.** Route-specific views under `web/src/import/`, an `import-route-` selector prefix, an exhaustive file list that leaves `App.tsx`, `api/`, shared components and the whole backend alone, and an explicit "no PNGs, traces, fixtures or uploads committed" clause. This is precisely the containment the issue's "import page only" demands.
- **The reducer shape is a genuine improvement on the issue's sketch.** Generalising `upload`/`mapping`/`preview` into an `entries` collection is what makes multi-file batches expressible at all, and the operation-generation guard correctly mirrors `web/src/assist/assistRuntime.ts:1-14`, whose documented invariants are the same stale-result discipline.
- **Nothing in the issue's checklist is widened.** Multi-file batches, `?step=` deep links, the duplicate "Seen before" line, the recommended-mapping reason, the 900 px strip and reduced motion are all present; the report, ledger, dashboard, sessions and assistant pages are explicitly untouched.
