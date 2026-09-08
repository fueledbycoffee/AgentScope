# Plan: Guided import route, Passage on the Console shell (issue #45)

## Goal

> The Import page (`/import`, and only that page) becomes the Guided candidate's import route, "Passage" (`research/design/claude/4-guided/mockup.html`, deep link `#/import?step=3`; `README.md` beside it is the spec), built with the Console shell's tokens and primitives (ADR-006). Everything else (Imports ledger, report, dashboard, sessions, assistant page) keeps the Console design. The same API calls as today; no backend change.

The result is verifiable by completing File -> Mapping -> Preview -> Confirm on
`/import`, deep-linking to a reachable stop with `?step=n`, completing a
multi-file import with one mapping per file, and landing on the unchanged
Console import report. No route other than `/import` adopts Passage structure,
typography, or colour tokens.

## Current state

- `research/design/claude/4-guided/README.md` specifies the four-stop import
  route, receipt rail, stage bar, disclosure and accessibility rules, and the
  900 px responsive layout. `research/design/claude/4-guided/mockup.html`
  implements the reference import screen in `importPage`, `stepFile`,
  `stepMapping`, `stepPreview`, and `stepConfirm`; its demo deep link preloads
  fake state, which the product must not do.
- `web/src/App.tsx` already maps `/import` to `ImportPage` and leaves
  `/import/assist/:uploadId`, `/imports`, and `/imports/:id` as separate routes.
  `AppShell` wraps every route, and the import route receives the existing
  Console `FileBar`. The route table does not need to change.
- `web/src/pages/Import.tsx` is currently one linear component. It separately
  stores `upload`, `mappingId`, `preview`, and previewed `batch` pairs; saves
  them under the session-storage key `agentscope-import-page`; and uses a string
  `busy`, one page-wide error, and an `inFlight` ref. All file, mapping, preview,
  confirmation, and batch controls can appear on the page at once. There is no
  reducer, progress rail, stage bar, or `?step=` synchronization.
- The current multi-file flow queues already previewed `(upload, mapping,
  preview)` pairs one at a time. It correctly preserves the batch across an
  assistant detour, rejects repeated bytes and mixed sources before commit,
  and sends the single-file or per-file batch form from `requestFor`.
- `web/src/api/index.ts` already exposes every call this issue needs:
  `uploadFile(file)` -> `POST /uploads`, `listMappings({ limit: 500 })` ->
  `GET /mappings`, `previewImport({ upload_id, mapping_id, sample: 200 })` ->
  `POST /imports/preview`, and `commitImport(request)` -> `POST /imports`.
  `web/src/api/types.ts` gives `Upload`, `Mapping`, `ImportPreview`, and both
  `ImportRequest` forms. The mapping summary exposes input format, provenance,
  and revision, but not field-level compatibility or a recommendation flag.
- Upload and commit are request/response operations: neither endpoint exposes
  streamed hashing/counting/import progress. The response is the authority for
  hash, decoded record count, and final import status. The UI must not fabricate
  intermediate server counts.
- The reusable Console surface is in `web/src/components/`: `DataTable`,
  `Notice`, `StateBlock`, `Icon`, `IconButton`, `JsonView`, and `FileBar` are
  usable as-is. `web/src/styles/tokens.css` is the sole colour/type/spacing
  vocabulary. `web/src/styles/base.css` already supplies controls, panels,
  facts, tables, focus rings, tooltips, and a global reduced-motion rule.
  Its `.rail` class belongs to the global top navigation, so the Passage rail
  needs import-scoped class names.
- `web/src/pages/Imports.tsx` already renders a committed notice after success,
  the duplicate explanation, and `Import failed. No observations were
  inserted.` for a failed report. Navigating to that report is sufficient; the
  report page must not be redesigned by this issue.
- Import behavior is covered inside `web/src/App.test.tsx`, including request
  bodies, invalidation, API errors, duplicate/mixed batch guards, and late
  completion after navigation. `web/e2e/smoke.spec.ts` currently drives the old
  upload -> select -> Preview -> Import controls and must be updated to the
  four stops. There is no pure import-state unit test today.
- `docs/adr/ADR-006-ui-design-direction.md` already permits a Guided receipt
  rail as a complement once the owner confirms its issue, but it does not yet
  record that `/import` alone has made that choice.

## Design

### Import-only structure and Console reuse

`ImportPage` remains the only route entry point. It will orchestrate API calls,
URL synchronization, session persistence, and navigation; route-specific view
components will live under `web/src/import/` so the ledger, report, dashboard,
sessions, and assistant cannot acquire Guided styling accidentally.

The component boundary is:

- `ImportRoute`: the two-column Passage layout, containing `RouteRail` and one
  stage. The name avoids collision with React Router's `Route`.
- `RouteRail` and `RouteStop`: `RouteRail` renders
  `<aside aria-label="Progress"><ol>...</ol></aside>`. A `RouteStop` receives
  `{ number, label, state: 'complete' | 'current' | 'future', fact, onSelect }`;
  only complete stops render their label as a button, current uses
  `aria-current="step"`, future stops are non-interactive, and only complete
  stops expose their monospace fact. Its footer is exactly `Nothing is written
  until the last stop.`
- `StageBar`: receives an optional Back handler, primary label/action/disabled
  state, and status content. It reserves the left, middle, and right positions
  on every stop. Back is an icon-only Console `IconButton` with accessible name
  and visible tooltip where a previous stop exists; File has no false back
  destination. The primary button remains visible text with a verb, such as
  `Continue to mapping`, `Run a dry run`, and `Import 4,770 records`.
- `Receipt`: renders typed `{ label, value, mono? }` rows as a Console-styled
  `<dl className="facts">`; `FileReceipt` uses it for one file and a
  `DataTable` receipt for a batch.
- `StatRow`: renders a label, exact formatted value, and optional explanatory
  line. Grouped stat rows present sampled/accepted/rejected, entity
  observations, and warnings without using KPI cards or `Unavailable` for a
  known zero.
- `FileStop`, `MappingStop`, `PreviewStop`, and `ConfirmStop`: semantic stage
  components with one `h1` at a time. They compose the components above and
  the existing `DataTable`, `Notice`, `StateBlock`, `Icon`, `IconButton`, and
  `JsonView`; they do not add a component library or copy Passage tokens.

All new selectors use an `import-route-` prefix. `web/src/styles/import.css`
uses only Console variables (`--bg`, `--surface*`, `--line*`, `--ink*`,
`--accent*`, `--ok*`, `--warn*`, `--bad*`, radii, spacing, and type tokens).
At `max-width: 900px`, the grid becomes one column and the progress list becomes
an internally scrollable horizontal strip above the stage; `min-width: 0`,
wrapping hashes, and contained tables prevent document-level horizontal scroll.
Any progress-width transition is also disabled inside the existing
`prefers-reduced-motion: reduce` contract.

`useFileBar` stays in place. For one upload it shows file, shortened hash, exact
record count, and selected mapping. For a batch it shows the number of files and
exact total records rather than trying to fit every filename in the shell bar.

### Pure reducer and deep links

`web/src/import/importRuntime.ts` will contain framework-free state transitions
and selectors, following the shape and stale-result discipline of
`web/src/assist/assistRuntime.ts`:

```ts
export type ImportStep = 1 | 2 | 3 | 4

export interface ImportEntry {
  upload: Upload
  mappingId: string | null
  preview: ImportPreview | null
}

export interface ImportState {
  step: ImportStep
  entries: ImportEntry[]
  operation: { kind: 'upload' | 'preview' | 'import'; generation: number } | null
  error: { stop: ImportStep; cause: unknown; uploadId?: string } | null
}

export function importReducer(state: ImportState, action: ImportAction): ImportState
export function requestedStep(search: URLSearchParams): ImportStep
export function highestReachableStep(state: ImportState): ImportStep
```

The reducer owns the issue's `step`, upload, mapping, and preview state as the
`entries` collection required for batches. Actions cover upload start/result/
failure, removal, mapping selection, dry-run start/per-file result/failure,
import start/failure, backtracking, and reset. An operation generation is
checked before applying an asynchronous result so a stale completion cannot
overwrite newer state or navigate after unmount.

Invariants are enforced by the reducer/selectors, not JSX:

- no upload means only File is reachable;
- every upload needs a compatible selected mapping before Preview is reachable;
- every current `(upload, mapping)` pair needs its own successful preview before
  Confirm is reachable;
- adding/removing a file clears the aggregate preview gate, and changing one
  mapping clears only that file's preview;
- duplicate SHA-256 values in the batch and mixed selected mapping sources keep
  the dry-run/commit action disabled with a named danger notice;
- backtracking keeps valid facts, while mutation invalidates only dependent
  facts; and
- the request builder emits the existing single-file body for one entry and the
  existing `files` body for two to twenty entries.

`ImportPage` reads `?step=` with `useSearchParams`. Missing or invalid values
default to 1; values above 4 clamp to 4. A requested stop is further clamped to
`highestReachableStep`, so a fresh `/import?step=3` cannot invent upload,
mapping, or preview data. With matching session state, `/import?step=3` opens
Preview directly. User transitions push `step=N`; initial normalization and
state-invalidating corrections replace the current URL. Browser Back/Forward
is observed and dispatched through the same pure transition. Completed rail
buttons use this path as well; future stops never call it.

Session storage keeps the existing `agentscope-import-page` key with a versioned
payload containing all entries and their previews. `loadStored` accepts the
current `{ batch, upload, mappingId }` shape and converts it to entries so an
in-progress batch survives the deployment and an assistant detour. Busy/error
state and request generations are never persisted. Any returned import report,
including `failed` or `duplicate`, clears storage and navigates to
`/imports/:importId`; a transport/API error with no report id remains on Confirm
with Back and a retryable danger note.

### Stop behavior

1. **File.** The dropzone is a Console bordered surface containing the native
   file input (accepting JSONL, JSONL.gz/gzip, and Parquet, with `multiple` for
   batches); no custom drag event behavior is added. Each selected file is sent
   through the existing `uploadFile` call. While unresolved, a `role="status"`
   panel names the ordered server work (`storing -> hashing -> counting`) and
   the exact selected byte total; it does not claim an intermediate server
   count. A successful single-file receipt shows filename, exact bytes, full
   SHA-256, a format sentence, exact record count, and Seen before Yes/No. A
   batch shows those columns in a table, with icon-only Remove controls. Seen
   before Yes links to each earlier `/imports/:id` and a separate info notice
   states that a same-source re-import inserts no observations. The existing
   first-20-record disclosure remains one step away. A 413 gets specific
   over-limit copy from `ApiError.status`; all other upload errors use a danger
   note directly below the dropzone. Successfully uploaded files remain when a
   later file fails.
2. **Mapping.** Each uploaded file gets a labelled `<fieldset>` and radio-card
   group. Compatibility uses the only current server fact that can establish
   it without another API/backend contract: `mapping.input_format ===
   upload.format`. A revision is `Superseded` when a higher revision with the
   same mapping name exists. Candidates sort current before superseded,
   bundled before user-created, then revision descending and name/id for a
   stable tie-break; the first current candidate is preselected and visibly
   recommended with the honest reason (`bundled mapping for this format` or
   `latest saved revision for this format`). The UI never claims that columns
   were validated because `GET /mappings` does not provide that evidence. If a
   file has no candidate, its designed empty state names the format and links
   to unchanged `/import/assist/:uploadId` with the existing location-state
   upload. A mapping-list failure uses `StateBlock` with Retry. Dry run stays
   disabled until every file has one mapping and all selected sources agree.
3. **Preview.** `Run a dry run` invokes the existing preview endpoint with
   `sample: 200` once for each file and advances only after the batch settles.
   The stage aggregates exact sampled/accepted/partial/rejected, entity, and
   warning counts, while a batch caption makes the per-file sampling explicit.
   It shows the existing reject columns or the designed no-reject sentence and
   exactly the first five emissions across the ordered responses. The lede
   states that nothing was written. If any preview request fails, Preview
   replaces all stats with a danger note naming the affected file; StageBar
   retains Back and offers `Retry the dry run`. No partial aggregate is shown as
   if it covered the whole batch.
4. **Confirm.** A receipt repeats every filename and full hash, every exact
   mapping name/revision/id, exact total record count, and aggregate dry-run
   counts. Duplicate expectations are stated without promising insertion. The
   one primary action is `Import N records`. While the atomic request is
   unresolved, the button and Back are disabled and a polite live region shows
   the exact total (`Importing N records in one transaction`); it does not show
   simulated increments. On any returned report the route navigates to the
   existing Console report, whose status lead is the success banner or the
   `nothing was inserted` failure. Request failure without a report remains on
   Confirm and cannot claim success.

### ADR amendment

Append a dated Issue #45 decision to ADR-006: `/import` alone adopts Passage's
four-stop structure because import is a gated provenance-building task and the
rail turns already-verified facts into the final confirmation receipt. Console
remains the design of record for the shell, tokens, primitive behavior, and all
other routes. Record that the choice changes no API or persistence semantics
and does not adopt Passage typography/colours or its dashboard/assistant
layouts.

## Files touched

Implementation is limited to this exhaustive tracked-file set:

- `web/src/pages/Import.tsx` — API orchestration, URL/session synchronization,
  shell receipt, four-stop composition, and report navigation.
- `web/src/import/importRuntime.ts` (new) — pure reducer, selectors, compatible
  mapping ordering, persistence migration, aggregate counts, and unchanged
  single/batch request construction.
- `web/src/import/importRuntime.test.ts` (new) — focused unit tests for reducer,
  deep links, invalidation, stale operations, mapping ordering, and batches.
- `web/src/import/components.tsx` (new) — `ImportRoute`, `RouteRail`/
  `RouteStop`, `StageBar`, `Receipt`, `StatRow`, and the four stop views.
- `web/src/styles/import.css` (new) — import-scoped Passage layout expressed in
  Console tokens, including the 900 px and reduced-motion rules.
- `web/src/App.test.tsx` — update the existing route integration tests and add
  loading/empty/error/duplicate/deep-link assertions.
- `web/e2e/smoke.spec.ts` — drive and assert the stepped happy path, duplicate
  path, deep link, accessibility structure, and 900 px overflow check.
- `docs/adr/ADR-006-ui-design-direction.md` — record the import-only Passage
  complement and rationale.

`web/src/App.tsx`, `web/src/api/index.ts`, `web/src/api/types.ts`, shared Console
components/styles, backend files, and every non-import page remain unchanged.
The four review screenshots are generated locally under ignored
`web/test-results/guided-import-route/` and attached by the coordinator; PNGs,
Playwright traces, fixture data, and raw uploads are not committed.

## Tests

### Pure runtime (`web/src/import/importRuntime.test.ts`)

- `clamps missing, invalid, and future deep links to the highest reachable stop`
- `advances File -> Mapping -> Preview -> Confirm only when prerequisites exist`
- `lets completed stops go back and leaves future stops inert`
- `changing a mapping invalidates only that file preview and Confirm`
- `adding or removing a file invalidates aggregate preview state`
- `ignores upload and preview completions from stale operation generations`
- `marks older same-name revisions superseded and recommends deterministically`
- `blocks duplicate bytes and mixed sources in a batch`
- `builds the existing single-file and per-file batch request bodies`
- `migrates the current sessionStorage batch shape without losing previews`

### Route integration (`web/src/App.test.tsx`)

- Update `uploads multipart bytes, previews, confirms, and fetches the persisted
  report and rejects` to assert all four named stages, progress semantics,
  rail facts, full receipt data, and the unchanged request bodies.
- Update `invalidates confirmation when the mapping or file changes` for rail
  backtracking and reducer invalidation.
- Keep `shows contract error details and allows a failed preview to be retried`,
  asserting the Preview error replaces stats and retains Back.
- Keep `blocks repeated commits while importing and surfaces conflicts without
  claiming success`, asserting the exact-total live region and no report
  navigation when the response has no report id.
- Replace the old queue interactions in the two batch tests with one File stop,
  one per-file Mapping stop, aggregate Preview, and one Confirm; assert the same
  `files` request body, duplicate SHA and mixed-source guards, and persisted
  restoration.
- Add `renders upload 413 below the dropzone and preserves prior batch files`.
- Add `renders Seen before links and explains that re-import inserts nothing`.
- Add `renders one mapping fieldset per file, recommended and superseded cards,
  and the assistant empty state`.
- Add `honors a reachable ?step=3 session deep link and canonicalizes an
  unreachable one to File`.
- Add `returned failed and duplicate reports navigate to their unchanged report
  notices`.

### Browser smoke (`web/e2e/smoke.spec.ts`)

- Update `uploadFixtureAndPreview` and the day-1 test to select the fixture on
  File, continue to Mapping, accept the recommended radio card, run the dry
  run, inspect Preview, continue to Confirm, click `Import 4,770 records`, and
  verify the existing committed report. Repeat the stepped route for duplicate
  behavior and unchanged totals.
- During that flow assert `<aside aria-label="Progress">`, the ordered list,
  `aria-current="step"`, completed-stop backtracking, inert future stops, and
  the three completed facts.
- Reload `/import?step=3` after preview state has reached session storage and
  assert the Preview stage opens; open the same URL in clean storage and assert
  it safely canonicalizes to File.
- At a 900 px viewport assert the progress strip is above the stage and
  `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
- For PR evidence, capture deterministic light-theme screenshots after File,
  Mapping, Preview, and Confirm at 1440 px into
  `web/test-results/guided-import-route/{1-file,2-mapping,3-preview,4-confirm}.png`;
  inspect them for clipping, exposed raw/private data, dark-token leakage, and
  focus/tooltip accidents before handing them to the coordinator.

### Full acceptance commands

Run from the repository root after focused tests:

```sh
pnpm --dir web lint
pnpm --dir web typecheck
pnpm --dir web test
pnpm --dir web build
pnpm --dir web e2e
uv --directory backend run ruff check src tests
uv --directory backend run mypy src
uv --directory backend run lint-imports
uv --directory backend run pytest -q
```

The backend commands prove the frontend-only change did not disturb the shared
CI baseline; no backend test or source file changes are expected.

## Acceptance checks mapped to the issue's tasks

| Issue task | Verifiable acceptance check |
|---|---|
| Plan reviewed | This document names component signatures, reducer invariants, reused Console primitives, exhaustive files, tests, limitations, and cost; the other-vendor review is folded in before implementation. |
| Reducer and `?step=` deep links | Pure runtime tests cover reachability, invalidation, stale results, persistence migration, and query clamping; React and Playwright prove reachable and clean-session `?step=3` behavior. |
| Four stops and all states | Route tests cover File upload/413/duplicate, Mapping loading/empty/recommended/superseded, Preview success/no-reject/error, Confirm running/request-error, and returned committed/duplicate/failed reports. Role assertions prove the rail and live regions. |
| Multi-file batch | Integration tests upload multiple files before leaving File, choose a mapping per file, aggregate previews, preserve the batch through session storage, reject duplicate bytes/mixed sources, and assert the unchanged batch request body. |
| Playwright smoke | The real-browser day-1 and duplicate paths use all four stages and land on the report; deep-link, rail semantics, and 900 px no-overflow checks run in the same spec. |
| ADR-006 amendment | The ADR names Passage for `/import` only, retains Console tokens/shell/primitives everywhere, and records the provenance/gating rationale and no-backend consequence. |
| Four PR screenshots | Four inspected, deterministic screenshots are produced in ignored test results and handed to the coordinator for the PR; no dataset, upload, trace, or screenshot is committed. |
| Everything else remains Console | The tracked diff contains no non-import page, shell, shared-token, API, or backend source changes; existing report/dashboard/session/assistant assertions and the full CI command set pass. |

## Risks

- **Atomic operations cannot report real incremental server progress.** The UI
  will announce the ordered upload work and exact byte total, and the exact
  import record total, but will not animate fabricated processed counts. True
  phase/counter telemetry would require a backend contract and is explicitly
  outside this issue.
- **Mapping acceptance is format-level with today's API.** Candidate cards and
  recommendation copy are limited to `input_format`, revision, and
  `created_by`. Claiming that fields/columns were checked would be unsupported;
  deeper compatibility needs a future API change.
- **URL and session state can disagree.** All query requests go through one
  clamping selector and invalidating transitions replace the URL immediately,
  preventing a stale Confirm screen or a deep link with fabricated data.
- **Batch previews can partially fail.** The reducer records which file failed,
  exposes no partial aggregate as complete, keeps prior successful upload and
  mapping facts, and retries the full dry run for a coherent receipt.
- **Session-storage schema changes can strand an existing batch.** A versioned
  decoder migrates the exact current shape, validates enough structure to fail
  closed, and retains the established key and assistant-detour behavior.
- **Long hashes and multi-file tables can cause horizontal page overflow.** Hash
  cells wrap, grids use `min-width: 0`, tables own any necessary internal
  scrolling, and Playwright checks document width at 900 px.
- **The shell already owns `.rail` and `.bar`.** Import-prefixed selectors avoid
  changing the global Console navigation and scope/file bars.
- **Screenshots may expose imported content.** Evidence uses only the committed
  synthetic/public fixture, is inspected before handoff, stays under ignored
  Playwright output, and is attached rather than committed.

## Cost estimate

About 1.5 days after plan review: 3 hours for the reducer, persistence migration,
and URL synchronization; 4 hours for the four stages and batch orchestration;
2 hours for import-scoped responsive styling and accessibility; 2 hours for
unit/integration/Playwright updates and screenshot capture; and 1 hour for the
ADR amendment, full CI verification, and review fixes. No backend or API-contract
work is included.

## Revision after review

This section supersedes conflicting details above and answers every numbered
finding in `2026-09-08-guided-import-route-review-claude.md`.

1. **P1 — accepted.** Every file with compatible candidates keeps a persistent
   “Neither fits? Set up a new mapping with the assistant” link immediately below
   its radio cards. It navigates to `/import/assist/:uploadId` with
   `{ state: { upload } }`. When no mapping reads a file's format, the designed
   empty state remains and the Mapping stop's stage primary action becomes the
   assistant handoff; `StageBar` therefore accepts either a button action or a
   link-shaped action. The reachable-candidate path is covered in the browser
   smoke as well as the no-candidate rendering in focused import tests.
2. **P2 — accepted, option (b).** `ImportEntry` continues to persist only
   `mappingId`, while mapping-dependent selectors take the current `mappings`
   resource. After mappings resolve, any id that is absent or incompatible with
   its upload format is cleared together with that entry's preview and the URL is
   re-clamped to Mapping. Mapping-dependent facts and Confirm never render while
   the resource is unresolved or failed. A focused runtime test covers a stored
   id that no longer resolves.
3. **P2 — accepted.** Each stop owns an `<h1 tabIndex={-1}>`; advancing,
   backtracking, browser history, and completed rail buttons move focus to that
   heading. A new failure moves focus to its `role="alert"` notice. `StageBar`
   wraps non-empty running text in `role="status"`. Focus after Continue and a
   rail backtrack is asserted in a focused import route test and in Playwright.
4. **P2 — accepted without changing the shared icon registry.** To stay inside
   Phase 2's import-only edit surface, Back uses the existing `arrowRight` glyph
   inside `IconButton`, rotated 180 degrees by the import-scoped stylesheet. It
   retains the accessible name and visible tooltip without adding a shared icon
   or falling back to a text-labelled secondary control.
5. **P2 — accepted.** The estimate is revised to 14–16 hours: 3 hours for state,
   persistence, and URL synchronization; 4 hours for stages and orchestration;
   2 hours for styling/accessibility; 4–5 hours for focused tests, Playwright,
   and screenshots; and 1–2 hours for the ADR, full verification, and fixes.
   **Multi-file timebox decision:** proceed with the full per-file Mapping,
   aggregate Preview, and atomic Confirm design. If the four stops plus reducer
   are not green by the end of 2026-09-09, keep the current multi-file queue
   interaction inside the same `/import` route, ship the complete guided
   single-file path, and disclose the fallback in `PR_BODY.md`. The single-file
   route still meets every criterion other than the optional richer batch
   presentation.
6. **P2 — accepted.** Versioned session data omits `upload.preview` and the
   preview `rejects` and `emissions` arrays. It retains upload identity and
   receipt metadata, mapping ids, counts, warnings, and entity totals required
   for reachability and confirmation. After a restored Preview, detailed sample
   rows are explicitly unavailable until the dry run is run again. A failed
   `sessionStorage.setItem` shows a visible warning that the current import will
   not survive reload. Focused tests cover the trimmed payload and write-failure
   notice.
7. **P3 — accepted.** The acceptance record now names the deliberate upload
   telemetry deviation: the request/response API exposes no phase events, so the
   live status names the ordered `storing -> hashing -> counting` work and exact
   bytes without pretending the phases are advancing.
8. **P3 — accepted.** The acceptance record also names the Confirm telemetry
   deviation: the live region announces the exact total in one transaction,
   while a progressing record counter would require backend telemetry that this
   issue forbids.
9. **P3 — declined as an edit request.** Phase 2 explicitly excludes
   `web/src/App.test.tsx`; its decode-error and late-completion tests must remain
   green unchanged, while equivalent moved-disclosure and stale-result coverage
   is added under `web/src/import/` and in the smoke.
10. **P3 — accepted.** Clean-storage deep links use a fresh browser context;
    screenshot capture explicitly calls `page.setViewportSize({ width: 1440,
    height: 1000 })` after the 900 px overflow check; and no redundant
    route-specific reduced-motion override/test is added because the global
    Console rule already disables all transitions under the configured reduced
    motion preference.
11. **P3 — accepted.** The scoped stylesheet moves to
    `web/src/import/import.css` and is imported by `Import.tsx`.
12. **P3 — accepted.** The ADR amendment records that icon-only secondary
    actions with accessible names/tooltips are the current Console convention;
    the older “no icons beyond” sentence meant decorative icon proliferation,
    not a prohibition on the already-established action-icon set.
13. **P3 — accepted.** A successful report clears persisted import state.
    Browser Back therefore returns to `/import`, where stale `?step=4` is replaced
    with canonical `?step=1`; Playwright asserts this reset.
14. **P3 — accepted.** `Unavailable` never appears on this route: upload record
    counts and preview measures are always known by contract, so measured zeroes
    render as `0`.

The Phase 2 tracked-file boundary also supersedes the earlier file and screenshot
lists: implementation may touch `web/src/pages/Import.tsx`, new files under
`web/src/import/` or `web/src/components/`, `web/src/App.tsx` only if the route
needs wiring, `web/e2e/smoke.spec.ts`,
`docs/adr/ADR-006-ui-design-direction.md`, and committed PNG evidence under
`web/e2e/screenshots/45/`. It does not touch `web/src/App.test.tsx`, shared icon
sources, any assistant file, any backend file, or any other route.
