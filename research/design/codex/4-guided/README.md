# Waypoint — Guided

**One-sentence concept:** A short, inspectable path from source file to trusted dashboard, with a shared mapping table and a side conversation when the format needs interpretation.

Direction 4 · Codex · AgentScope design study · 7 September 2026.

Open [mockup.html](./mockup.html) directly from disk. No server, build, package installation, remote fonts, images, scripts or network requests are needed. The initial screen is the recognised-file mapping step, the useful middle of the daily import flow. “Import traces” starts at the file step. The footer’s **Review prototype** drawer links to all seven screens and exposes state scenarios without putting demo controls into the product’s primary navigation.

## Who it favours

The daily analyst gets a bundled mapping, a bounded preview and a single explicit commit gate. The weekly analyst gets a readable artifact to correct, with the assistant beside it rather than above it. The reviewer reaches chart → matching sessions → session → source record in three activations. The operator gets an attempt ledger and a receipt that accounts for every source outcome.

This direction deliberately favours successful ingestion and confident onboarding over continuous monitoring. It assumes one analyst or a small team, one workspace, and occasional rather than constant use of the mapping assistant. There are no invented organisations, billing controls, activity feeds or team avatars.

## Information architecture

Production routes retain the thin slice’s existing shape; hash routes only make this HTML work from disk.

| Screen | Production route | Prototype route | What lives here |
|---|---|---|---|
| 1. Import | `/import`, step in query/state | `#import/file`, `#import/mapping`, `#import/review` | File selection and sniff; immutable upload identity; earlier imports; saved mapping; bounded preview; exact binding confirmation |
| 2. Report | `/imports/:id` | `#report`, `#report/committed`, `#report/duplicate`, `#report/failed`, `#report/running`, `#report/partial` | Transaction result, five record outcomes, added entities, warnings, files, rejects, receipt |
| 3. History | `/imports` | `#imports` | All attempts, newest first; status filter; source and immutable mapping revision; record and entity counts; UTC time |
| 4. Dashboard | `/dashboard` | `#dashboard` | Four metrics, three charts, scoped session list, quality exceptions, metric definitions |
| 5. Session | `/sessions/:id` | `#session/0` through `#session/79` | Identity, declared and observed time, usage coverage, observation tables, diagnostics, source record drawer |
| 6. Mapping assistant | `/import/analysis/:uploadId` | `#assistant` | Local profile, outbound-context review, shared draft, conversation, explanations, validation, preview, revision save, separate import confirmation |
| 7. Definitions | `/definitions` | `#definitions` | Definitions, units, semantics and comparability rules; available independently and from metric disclosures |

`#report/partial` is a **review scenario**: committed with one rejected record, not a new API status. `partial` remains a source-record outcome. Production accepts only the documented committed, duplicate and failed terminal statuses. Running is a client request state until a job contract exists.

## Navigation model

A 68 px top bar contains the product identity, Overview, Imports and the Import traces action. These are the three recurring tasks. Definitions is secondary. Reports are reached through imports; sessions through analysis; assistant setup through an incompatible or uncertain mapping. There is no permanent navigation entry for each intermediate object.

The import rail is local navigation, not global chrome. Completed steps are revisitable; unearned steps are disabled. Its three steps are **File → Mapping → Review**. Commit leaves the stepper for a durable receipt; the receipt leads to the dashboard. A known, preselected fixture starts at Mapping in this study, but actual first-time file selection starts at File. Existing immutable uploads should survive Back navigation in the application; a browser reload restores server-owned uploads and saved revisions, not an uncommitted chat transcript by assumption.

The assistant’s profile/shaping/preview labels describe its progression. The table remains in place while questions and revisions happen beside it. Profile, details and preview evidence open on demand; this does not become a second full-screen wizard inside the import wizard.

A chart’s sessions open in a drawer so the chart remains the context. Choosing a session opens the session route. “Back to sessions” restores the originating chart drawer and its filtered result set. All-chart filtering uses the same source/agent/model/period scope.

## Disclosure model

The rule is not “hide information.” It is “put the information next to the decision that needs it.”

| Task | Visible immediately | One deliberate step away | Why |
|---|---|---|---|
| Choose a file | File, size, sniff, readable record count, upload limits; duplicate notice if found | Full hash, decoded records, earlier receipt | The hash is essential identity but not necessary to pick a mapping |
| Check a mapping | Revision, source, three source-to-observation rules | Mapping fields, null policies, semantics; mapping choice | A known source should not require a DSL reading session |
| Approve an import | Preview population, entities, rejects count, warning totals, file, complete hash, revision ID, confirmation | Warning meanings, emission sample, rejected rows | Exact binding is necessary **here** and is therefore not hidden |
| Read a receipt | Status, five outcome counts, three entity counts, immutable file hash, revision and UTC run times | Warning codes and meanings, rejects browser/raw payload | The success task is to continue; exceptions remain labelled and accessible |
| Explore | Scope, four exact values and coverage, three charts, compact quality strip | Definition/semantics popover, chart data table, matching sessions | Trust metadata is local to each metric, not repeated as paragraphs |
| Inspect a session | Full external identity, repo, user, agent, observed times, coverage, selected observation table | Other observation type; exact observation identity/times; diagnostics; original JSON | Raw trace text is evidence, not the primary reading surface |
| Shape an unknown mapping | Source paths, targets, transforms, unresolved decision, conversation, concise egress notice | Field profile, per-field rationale, full outgoing context, DSL representation | The draft is the shared artifact; chat never displaces it |

Drawers are native modal `<dialog>` elements. Small definitions and confirmation decisions use the same element with a centred 490 px presentation. Large source and session-result drawers use 590/760 px widths. Nested disclosures replace the drawer content without stacking modals; closing restores the original page control. There is no hidden keyboard-only feature.

Exception counts earn their place. Zero quality counts are retained as a small explicit assurance for a trust-oriented product; detailed explanations stay behind a click. A mapping ambiguity appears immediately because it blocks validation. The normal path never expands empty reject tables automatically.

## Visual system

### Typography

A local system sans stack (`Inter` if installed, then Apple/system/Segoe UI) makes the artifact independent of Google Fonts. It has no font request. A native monospace stack is limited to identity, field paths and source text. Numbers use tabular figures, ordinary grouping separators and no compact notation.

| Role | Size / line height | Weight | Use |
|---|---|---|---|
| Main flow heading | 32 / 38 px; 29 px near 900 | 650 | The current decision |
| Other page heading | 29 / 35 px | 650 | Destination or object |
| Metric | 29 / 41 px; 25 px near 900 | 600 | Exact totals |
| Section heading | 17 / 24 px | 650 | Meaningful grouping |
| Main body | 14 / 21 px | 400 | Short explanation |
| Controls and supporting body | 13 / 20 px | 400–600 | Task actions |
| Table and detailed data | 12 / 18 px | 400 | Dense observations |
| Metadata | 11 / 16 px | 400–600 | Units, dates, sublabels |
| Eyebrow / auxiliary header | 10 / 15 px | 600–700 | Rare orientation labels; never the sole instruction |
| Raw JSON / identifiers | 11–12 / 20 px | 400 | Exact textual evidence |

### Space, shape and density

Spacing scale: **4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px**. Layout-specific 22/26/28 px values compensate for borders and optical alignment; these are not a second spacing scale. Page gutters are 44 px at 1280 and 26 px near 900. The import uses a 210 px rail, 50 px gap and at most 790 px content column. At 900, the rail becomes 170 px and the gap 28 px. At 1920, content caps at 1376 px so data does not become a scanning marathon.

Cards have 10 px radii, controls 6–7 px, tags 5 px. Borders carry structure; elevation is reserved for dialogs. Cards do not each need an icon. One restrained green gradient marks a successful receipt. The main action uses a deep forest green; the rest of the interface is warm grey and white.

Tables have semantic captions, small uppercase headers, horizontal separators, approximately 48–62 px rows, right-aligned measures where practical, and muted secondary identifiers. IDs can wrap or have a short display label if their full value is available in detail. Full hashes wrap, never ellipsise. There is no horizontal **page** scroll; narrow tables may scroll inside a labelled region. The selected observation type gets one table, not two dense tables stacked by default.

Charts use inline SVG in the study and Recharts in production. No animation is needed. One colour indicates the primary series; slate and ochre distinguish models. Every plotted bar has an exact accessible label/title and a matching session action. Each chart also offers an exact tabular “View data” path. Token counts have no “k” or “M” abbreviation. Missing timestamps require an Unknown bucket in production; this illustrative distribution has none. Units, scope and UTC day boundaries appear near the chart. Colour never substitutes for a series label.

### Light tokens and dark derivation

The HTML fully designs light mode. Dark is an eventual token substitution, not an automatic inversion or a delivered theme toggle.

| Token | Light | Dark target | Role |
|---|---|---|---|
| `canvas` | `#F6F7F5` | `#141B17` | Page |
| `surface` | `#FFFFFF` | `#1C251F` | Cards, dialogs, controls |
| `subtle` | `#F0F3EF` | `#253129` | Quiet inset surfaces |
| `ink` | `#202E29` | `#E8EFE9` | Primary text |
| `muted` | `#5E6C65` | `#ABB9AF` | Secondary text |
| `faint` | `#737F78` | `#8F9F94` | Noncritical metadata |
| `line` | `#DFE5DF` | `#36473B` | Grouping separators |
| `control` | `#839388` | `#7C9383` | Input/button boundary |
| `accent` | `#21644B` | `#A5D9B9` | Links, active state |
| `accent-hover` | `#174C38` | `#BCE5CB` | Active hover |
| `tint` | `#EAF3EC` | `#253D2E` | Selected mapping |
| `good` / `good-bg` | `#226548` / `#EAF4ED` | `#A1D9B1` / `#23382A` | Accepted/validated |
| `warn` / `warn-bg` | `#85510C` / `#FFF4DF` | `#F0CD86` / `#3B3020` | Decision needed |
| `bad` / `bad-bg` | `#B13735` / `#FFF0ED` | `#FFB5AA` / `#402925` | Error |
| `focus` | `#386DDD` | `#93B7FF` | 3 px keyboard outline |
| `chart2` | `#7789A1` | `#A5B8D1` | Second model |
| `chart3` | `#B78651` | `#D8AD7C` | Third model |

In dark mode, the primary-button foreground becomes `#142B1D` against the lighter accent. Tag boundaries derive from their semantic foreground/background pair. The receipt gradient becomes `#23382A → surface`. Raw JSON uses `subtle`; the overlay becomes black at 55%; the shadow becomes black at 35%. SVG grid, tick and muted-bar colours also become tokens. Light-only SVG literals and semantic border colours in this standalone artifact must be extracted during component implementation. Validate AA pairings and non-text control contrast separately for both themes; do not claim the dark palette is certified from this light mockup.

## Component inventory and React plan

| Component | Responsibility | Implementation |
|---|---|---|
| `AppShell`, `PageHeader`, `Breadcrumbs` | Three-task navigation, scope, route focus | Extend existing React Router shell; no kit |
| `ImportFlow`, `StepRail`, `FileDropzone` | File → mapping → review transitions | Discriminated-union state/reducer; native file input and drag/drop |
| `FileIdentity`, `MappingChoice`, `BindingConfirmation` | Stable uploaded bytes and immutable revision | Existing upload/mapping DTOs; compare binding fingerprint before commit |
| `PreviewSummary`, `OutcomeCounts`, `RunReceipt` | Separate record and entity populations | Extend existing `Counts`; terminal status union |
| `DisclosureRow`, `EvidenceDialog` | Drawer/popover presentations, focus lifecycle | Reuse current native-dialog source drawer; one tested wrapper |
| `DataTable`, `Pagination`, `StatusTag` | Reusable dense, captioned data | Extend current `Table`/`Pagination`; ordinary HTML table |
| `MetricCard`, `MetricDefinition`, `QualityStrip` | Definitions, units, known/total, quality | Metric-domain DTOs; missing-value formatter reused |
| `DashboardFilters`, `ChartCard`, `SessionResults` | Shared scope and chart drill | Recharts + TanStack Query as planned; scope in URL |
| `SessionIdentity`, `ObservationSwitcher`, `RawRecord` | Session context and exact provenance | Existing session/raw endpoints; render `payload_text` as text |
| `ProfileDrawer`, `EgressReview` | Inspect local profile and actual provider context | Day-3 application DTOs; approval bound to context fingerprint |
| `MappingTable`, `FieldExplanation`, `Conversation` | Editable shared draft and bounded proposal | Controlled inputs; assistant response is data; server validates AST |
| `ResourceState`, `ErrorNotice`, `ProgressNotice` | Deliberate empty/loading/error handling | Extend current components; structured API errors, retry context |

React 19 + TypeScript + Vite are sufficient. There is no heavy component framework, virtual spreadsheet, syntax editor, graph canvas or motion dependency. Use native inputs, selects, tables and dialogs. Vitest covers transitions and exactness; the planned Playwright smoke covers the full user path. Add Recharts and TanStack Query only as already planned dependencies. Do not rewrite data fetching while only restyling a component.

### Contract fit and explicit dependencies

* Upload, mapping choice, preview, commit, report, history, sessions and raw source evidence map directly onto `docs/api/v0.1.md`. Preview is the first 200 records, not a representative-sampling claim. A changed file or mapping invalidates preview and confirmation.
* `GET /api/raw-records` returns `payload_text`; render it directly as a text node. Never pretty-print the parsed `payload` again. This retains integers above JavaScript’s safe range and exact decimals. The mock uses a prewritten illustrative JSON string, not real backend bytes.
* The current metric contract lacks **output tokens**, day/model/tool series, quality counters, metric identity coverage, and model/period/import filtering. These need day-2 DTO/query additions. Source and agent filters already exist. Never filter only one 50-row page to manufacture whole-dataset metrics in production.
* The report action currently opens the **tracelab source**, and says so. It does not pretend the current API supports import-specific scoping. Chart drill-down needs server-side matching session queries with consistent filters and pagination.
* Current metric values are JSON numbers. Tokens beyond the safe integer range need an agreed exact-string/decimal transport or a safe-range assertion in generated DTOs. Do not solve this by formatting already-rounded JavaScript numbers. The supplied fixture totals fit the safe range.
* Report warnings are a code-count map. The design shows meanings and exact code counts; it does not invent a per-field breakdown unsupported by the API. Rejects do have payloads and a `code` filter.
* Commit is currently a synchronous transaction request. Running gets an indeterminate state, no invented percentage, job polling, cancellation or stream. A 409 race should refresh the known attempt and expose the duplicate receipt instead of blindly retrying. A failed transaction inserts no observations. Failed reports do not invent outcome counts for unprocessed records.
* The assistant’s profile, sanitised context, proposal, explanations, ambiguity resolution, validation, immutable save and parent links need day-3 APIs. The inline “DSL” is explicitly a design representation, **not** a claim to implement the actual closed AST schema.
* The unknown file’s 1.3 GB is upstream size. The upload is a locally created 2,000-row excerpt within 25 MiB, with its own immutable hash. There is no remote Hugging Face fetch, file streaming or 1.3 GB upload promise.
* Saving a mapping is separate from importing observations. Production egress approval is bound to the exact sanitised context, provider/model and sample. Changing that context requires a fresh review; routine follow-up messages in an already reviewed conversation remain user-directed. The assistant has no commit tool.

## Screen-by-screen design and states

### 1. Import

The file step shows sniffed format, record count and a collision notice when the same bytes were previously committed. The first-record payloads stay in the file drawer. The Mapping step shows three source-to-entity relationships and the selected bundled revision. Review exposes 200-record preview outcomes, entity counts, optional warnings, emissions and rejects in deliberate disclosures. The full hash and immutable mapping ID become prominent beside the one confirmation checkbox and commit button.

* **Empty:** Dropzone, accepted formats, 25 MiB / 100,000-record bounds and one browse action; a sample action exists only in this design study.
* **Loading:** Named upload/sniff/preview state; retain selected file; disable conflicting actions. Preview is simulated with a short indeterminate dialog. No fabricated percentage.
* **Error:** A >25 MiB selection opens a specific limit error and recovery. Malformed/unreadable records expose locator and decoder message; incompatible mappings lead to assistant setup. A generic fetch error has Retry plus structured details. No commit is enabled after failed preview.
* **Success:** Bundled mapping selected, sample preview passed; explicit file+revision confirmation enables commit. Duplicate discovery is an explained branch, not a clean-import success claim.

Changing the file or mapping clears the preview and approval. Back navigation may retain a valid preview for the same binding. The standalone file picker honestly states that arbitrary files are not parsed, then offers the supplied fixture.

### 2. Import report

A calm receipt replaces the wizard. Result first, source outcomes second, entities third. File identity and mapping revision remain visible for auditing. The current fixture shows accepted 4,770; partial/duplicate/rejected/ignored zero; sessions 80; model calls 4,770; tools 5,723. Null warnings 11,168 and absent warnings 14,633 open into code meanings. Empty rejects stay one click away.

* **Empty:** An unresolved receipt ID should say “Import not found” with return to history; no fabricated successful receipt. The review menu’s generic empty state is a layout specimen, not this 404 implementation.
* **Loading / running:** Indeterminate transaction status and “counts appear after commit”; no partial successful totals. A terminal report fetch can use the standard skeleton/retry pattern.
* **Error:** “Import failed. No changes made.” with actual backend message and recovery action; ledger entry retained. A connectivity error while awaiting commit requires checking the attempt before another submission.
* **Success:** Committed → explore. Duplicate → 4,770 duplicate records, zero entities added, earlier receipt available. A committed-with-rejects scenario opens the code-filtered rejects browser and raw JSON for `line:1042` / `invalid_type`.

### 3. Imports history

One table, one local status filter. File and import ID occupy the first column; source/revision and record/entity populations are kept distinct. UTC is stated once. The fixture receipt is real brief data; the duplicate and failed attempts are labelled illustrative in the caption.

* **Empty:** No attempts, one Import traces action.
* **Loading:** Header remains; row skeletons and polite status occupy the table area.
* **Error:** Inline failure with Retry; in production stale rows remain marked stale rather than silently shown as current.
* **Success:** Any status opens a complete receipt. Failed and duplicate attempts are retained. Production uses API limit/offset pagination; the three-row study needs none.

### 4. Dashboard

This is the destination. Exact Sessions, Model calls, Input tokens and Output tokens sit above activity/day, input/model and tool-count charts. Each metric keeps coverage beneath the number and a definition button beside the label. Session/model-call “coverage” means identity/record population, not a completeness claim about unimported activity. Token coverage means known usage calls / all calls. The quality strip separates missing usage, unknown timestamps and unlinked tools from source rejects.

* **Empty:** A first-use overview invites import. A filtered empty result retains the filters, shows zero observed entities, and **Unavailable** token totals with 0/0 coverage; clear filters is the recovery.
* **Loading:** Reserved KPI/chart geometry and polite status; no initial zeros or simulated growth. Production retains previous data only with a visible updating state and its prior scope.
* **Error:** Explicit metric/query failure, Retry and error details; failed chart requests do not erase independently loaded session evidence.
* **Success:** All filters recompute the local illustrative dataset. Charts open matching sessions; exact data tables provide an equivalent keyboard path. The reviewer can reach the fixture’s source record in three activations.

Comparability is a definition-level rule: totals are arithmetic inventory across accounting tags, not “work”, price or normalised efficiency. The model chart names each model; the definition popover separates `tracelab-claude` and `tracelab-codex`. Cache read values do not become a universal KPI.

### 5. Session detail

Identity is readable at the top: source, full external ID, internal ID, agent, repository and user. The declared and observed intervals are separate. The example uses 2026-06-04T02:51:06.901Z–2026-06-04T02:52:00.698Z, two model calls, three tools and 48,187 input tokens at 2/2 coverage. Model and tool observations share a switcher. Source record is a direct row action.

* **Empty:** Identity can exist without observations. Show that fact, leave usage unavailable, and omit empty table chrome. Unknown session ID is a 404 with Back to overview.
* **Loading:** Identity/observation skeletons. Source drawer can load independently without replacing the session behind it.
* **Error:** Failed session request offers Retry. Failed raw-record fetch retains the requested hash/locator and a drawer-local Retry; do not substitute a similar record.
* **Success:** Each observation carries provenance. Diagnostics default to a compact no-conflicts summary; conflict/reversed-interval examples show code, field and retained claims. No active-time assertion is derived from the observed span.

The prototype’s primary session is the brief example. Other sessions are explicitly synthetic. Full production observation pagination is deferred in this HTML; the large synthetic sessions show only their first eight example observations and say so. Dashboard session pagination itself works.

### 6. Mapping assistant

The mapping occupies the larger column; the conversation is a 302 px side column (260 px at 900). This reverses a chat-first hierarchy: the edited mapping is the outcome, chat is assistance. The local profile is one step away. A compact notice explains egress, and an explicit context dialog shows included/removed fields, a bounded redacted sample and destination before a simulated message is sent.

The proposal’s unresolved timestamp unit is a visible blocker. Per-field “Why?” explains the source-accounting assumption. `created_at` can be set to epoch seconds from the table, ambiguity dialog or a suggested correction. Unknown source paths produce inline invalid state. Schema/semantic validation precedes preview; preview precedes immutable revision save; saved revision precedes separate import approval.

The design assumes one model-call observation per root conversation for this **illustrative** mapping. Conversation-level usage is never repeated across `turns[]`. Tool arrays expand under the enclosing root observation; missing usage stays null. This assumption must be checked against a real source contract and may be rejected in a real proposal.

* **Empty:** Choose/profile a local excerpt; no assistant proposal is invented before analysis. The study starts with a clearly labelled example proposal to make the shared-table design reviewable.
* **Loading:** Profile progress, proposal-in-progress and preview progress are separate; retain the draft. The provider does not stream executable mapping edits into the table.
* **Error:** Malformed/truncated/refused/timed-out proposal yields diagnostics after at most one repair attempt. Preserve the last valid draft; offer Retry or manual editing. Invalid field paths have associated text and focus. Ambiguous units block validation. A bad preview cannot be saved as approved.
* **Success:** Validate → preview 200 rows → inspect entities/warnings/emissions/coverage → save revision 1 → review excerpt hash/revision → confirm → simulated committed result. Saved mappings replay without a provider.

Editing invalidates validation, preview and the affordance to import the old draft. The local conversation understands epoch-second corrections and explains usage; other free text gets an explicit simulation response rather than a false “applied” claim. No message is sent off this page. The unknown-file commit is an illustrative result dialog; it does not alter the separate TraceLab dashboard fixture.

### 7. Definitions

A compact reference document, not an onboarding hurdle. Entries cover sessions, model observations, input/output tokens, tools, observed interval and cache reads; each has units and semantics. Metric popovers link here. Definitions should ultimately render from the same domain-owned source as API metric DTOs.

* **Empty:** If a source exposes no additional semantics, state that no source-specific definitions were supplied; retain the built-in definitions.
* **Loading:** Built-in content remains readable; loading source-specific metadata is local to that section.
* **Error:** Missing server definitions are “Definition unavailable” with Retry, not a guessed meaning. Never silently replace the definition of a displayed metric.
* **Success:** Units, known/total coverage rules and comparability guidance are explicit. Unknown values never become zero; a measured zero is still known.

Quality definitions in production: rejects count rejected source-record outcomes; missing usage counts calls with null usage per selected token metric; unknown timestamps count observations excluded from dated buckets; unlinked tools count tools without a model-call parent. Include denominators and current scope in each disclosure. These planned API-dependent definitions are described in the prototype’s quality dialogs.

## Accessibility

* Native headings, landmarks, forms, labels, buttons, links and captioned tables. The skip link and hash-route focus move to the main region; route changes update the document title.
* Modal `<dialog>` provides browser focus containment, Escape dismissal and inert background. Preserve the original opener across content replacement. Close is a named button. A drawer must not trap focus after it disappears.
* Focus uses a 3 px blue outline with 3 px offset. The native visually hidden file input gives the entire dropzone a visible focus-within outline. File browse works without drag/drop.
* No action depends on hover. SVG bars are links with exact labels; “View data” tables provide the same filter/drill action. Production chart accessibility should include a keyboard-tested data table even if Recharts’ accessibility layer is enabled.
* Status is text plus optional symbol/colour. Errors use text, associated field messages, `aria-invalid` and focus on the first offending input. Routine progress uses polite live regions, not an interrupting alert on every update. Production unexpected failures use `role="alert"` once.
* Reduced-motion media rules remove spinner/shimmer animation. No chart entrance animation. Hit areas are generally 30–38 px desktop controls; compact text actions retain spacing. At touch widths increase them to 44 px in implementation.
* Dark palette, actual browser/screen-reader behaviour, 200% zoom and final contrast need rendered verification. Small metadata is supplementary; exact values and task instructions do not depend on tiny text or colour alone.
* The responsive design keeps 900 px usable and adds a stacked layout below 760 px. Tables scroll locally when needed. Production scroll regions must have a name, keyboard access and visible overflow affordance where clipped.
* Every raw payload is inserted as escaped text, including untrusted trace content and assistant/user strings. No trace is interpreted as HTML or an instruction.

## Implementation cost within the timebox

Budget approximately **12 front-end hours (1.5 days)** across the four-day plan, assuming the scheduled backend contracts arrive. This is a refinement of the existing thin slice, not a parallel design-system project.

| Work | Estimate | Gate |
|---|---:|---|
| Tokenised shell, type, native controls, tables, common dialog and state surfaces | 2 h | Existing React layout |
| Three import states, exact confirmation, receipt and history treatment | 2.5 h | Existing upload/import APIs |
| Four KPI cards, 3 simple Recharts charts, filters and session drill | 2.5 h | Day-2 metric and query additions |
| Session switcher, interval/coverage presentation, raw and diagnostic drawers | 1 h | Existing session/raw endpoints |
| Shared mapping table, profile/context drawers, bounded conversation and validation flow | 2.5 h | Day-3 assistant APIs; one mapping workflow |
| Integration, keyboard/contrast review, targeted Vitest and smoke checks | 1.5 h | Stable response shapes |
| **Total** | **12 h** | Backend time excluded |

**Ships in v0.1.0:** three-step known-file import, exact receipt, rejects browser, history, four metrics, three charts, basic filters/drill, source drawer, definitions, one bounded assistant/table flow and explicit save/commit gates. Dark token support should enter the shared stylesheet; ship the toggle only after both themes pass visual/contrast checks within the available verification time. Light is the fully specified study deliverable.

**Deferred:** command palette, resizable split view, virtualised editable grid, undo history, side-by-side revision diff, chat transcript persistence, rich JSON syntax highlighting, custom date-range calendar, streaming progress, background jobs, broad provider settings, bulk reprocessing and overlapping-export reconciliation. Multi-file imports can reuse one file-binding row per upload when the scheduled day-2 backend supports them; this study intentionally exercises one file.

If APIs arrive late, cut embellishments and ancillary editors first. Do not substitute fabricated output totals, pretend local pagination is whole-dataset filtering, or remove confirmation/provenance to hit the timebox. The 12-hour estimate has little contingency; the assistant is the largest risk. Profile and mapping editing must remain useful if the provider is unavailable.

## Risks and trade-offs

1. **Steps add navigation.** Keep known mappings preselected and the rail to three decisions. Do not add a welcome page, project naming or “success celebration.” The receipt is the completion state.
2. **Disclosure can conceal quality.** Warnings/reject counts and blocking ambiguities stay visible. Only details collapse. A nonzero quality counter must visibly signal attention without requiring a hover.
3. **Assistant output can look authoritative.** Label it Draft/Proposal, show assumptions and per-field explanations, block unresolved units, invalidate previews after edits, and separate save from commit.
4. **Cross-source totals can mislead.** Show coverage and semantics; identify an arithmetic inventory rather than claim normalised efficiency. Cache-read comparability remains limited.
5. **Profile shape does not establish semantics.** A 10-digit timestamp or a root usage object is evidence, not proof. The mapping table and ambiguity decision preserve analyst control. Real SWE-chat may require a different representable contract.
6. **Some current endpoints are thin.** Chart drill, output metrics, quality and assistant state need additive API work. The README’s component plan is conditional on those contracts, not a frontend-only promise.
7. **Exact-file idempotency is narrower than deduplication.** Native IDs are retained claims, not universal keys. Avoid implying that overlapping exports are safe to merge automatically.
8. **Dense desktop details can become small.** Bound page width at 1920, keep the mapping artifact larger than chat at 900, and use full-width drawers. Verify chart labels and table overflow in a permitted browser before adopting this design.

## Why Guided wins here, and where it loses

| Against | Guided’s advantage for AgentScope | Where this direction loses |
|---|---|---|
| Workbench | A clear next action for importing and onboarding; fewer permanent inspectors and commands to learn; native primitives fit the short release window | Slower for experts comparing many records or repeatedly editing many mappings; no command-driven workspace |
| Ledger | Trust details appear at the decision point without turning every import into an audit document; the assistant has a natural shared workspace | A dedicated ledger is stronger for extended audit reading and comparing immutable receipts |
| Console | Explains whether the imported data can be trusted before making charts the centre of attention; better handling of unfamiliar inputs | Monitoring-heavy users need an extra context switch to the overview and get fewer persistent monitoring controls |

Guided fits AgentScope’s current bottleneck: getting heterogeneous data into a trustworthy, inspectable form. The dashboard is an earned destination, while provenance remains a short path rather than a permanent wall of detail.

## Prototype data, interactions and validation

### Data fidelity

The filename, 681,057-byte size, supplied SHA-256, mapping ID/revision, 4,770 source records, exact aggregate counts and token totals, warning totals and first session identity/times/input coverage follow the brief. The supplied hash is reproduced verbatim throughout. These are design fixtures, not live API results.

Additional attempts, per-day and per-model distributions, tool distribution, individual call splits, raw JSON payloads, source locators, 79 additional sessions, unknown-file profile presence counts, excerpt hash and preview/full-run results are **illustrative**. The generated 80-row TraceLab example reconciles exactly to the headline totals. The first session uses 16,147 + 32,040 = 48,187 input tokens, and its three tool observations are Bash, Read and Edit. The normal fixture has zero rejects; `line:1042` appears only in the separately labelled rejected-record scenario.

The unknown mapping preview uses 200 accepted rows, 200 sessions, 200 root model calls, 628 tools and 187/200 known input calls. It never copies root usage to every turn. Its full-run result dialog is a separate simulation and does not rewrite the TraceLab metric fixture. The study does not claim the brief supplied these unknown-file counts or a validated mapping AST.

### What actually works

* Seven screen routes, three import steps, native file selection and drag/drop, specific oversized-file recovery, supplied-file selection, earlier-import branch.
* Mapping selection disclosure, 200-record preview, warning and emission details, rejects sample, full hash/revision confirmation, indeterminate run, committed receipt.
* Duplicate/failed/running/committed-with-reject scenarios, reject-code filter and raw rejection payload.
* History status filtering; all four dashboard scope filters; exact recomputation and session pagination; three SVG chart drill paths; exact chart tables.
* Metric definition and semantics disclosures; session identity/observations; raw-record drawer; copy/select fallback; diagnostic example; remembered chart drill context.
* Unknown-file profile/context inspection; explicit context review before simulated chat; epoch-unit correction; editable paths with inline validation; preview invalidation; immutable-save simulation; separate excerpt import approval and result.
* Empty/loading/error/success layout examples for every route through the review drawer. More specific API states are documented above; the menu is not a complete backend fault injector.

### Verification and limits

Inline JavaScript is syntax-checked. Calculated light contrast ratios include primary text 14.15:1, secondary text 5.51:1, primary action 7.03:1, success text 6.17:1, warning text 6.06:1 and error text 5.46:1 against their respective surfaces. Control borders and muted chart bars were darkened to exceed 3:1 against white. These are token-pair calculations, not a rendered accessibility audit. DOM interaction checks exercise import preview/confirmation/commit, chart-to-session-to-raw navigation, assistant validation/preview/save/import, invalid-field handling, rejection payload, zero-coverage display, all route state examples, and fixture aggregate reconciliation. A separate sweep opened 43 disclosure actions and checked table captions and form labels across all screens. These checks do not certify CSS layout or native focus containment.

A headless Chromium launch was attempted for 900/1280/1920 screenshots, but the managed macOS sandbox rejected its Mach-port registration (`bootstrap_check_in … Permission denied`). No escalation or external browser/network service was used. **Rendered visual QA, native keyboard focus and actual viewport-overflow checks remain unverified.** The responsive CSS has been reviewed structurally for these sizes; this is not represented as a screenshot pass.

Before adopting the design: open the file at 900, 1280 and 1920 px; run the known-file flow; inspect a June 4 bar → session → source record; tab through a drawer and return focus; test missing usage; revise/validate the mapping; review the outgoing context; inspect the rejected-record and failed-import scenarios; verify light contrast and a dark-token implementation. Keep the prototype’s explicit illustrative-data boundary when presenting it for selection.
