# Console — the evidence behind the signal

**Concept:** Start with recorded activity, narrow the scope, and descend from a number to the exact source record without losing the question you came to answer.

Console is direction 3. Monitoring is its organizing principle: a wide analytical canvas, a sticky scope bar, exact KPI values, and direct chart-to-session drill-down. It favors the returning analyst and the reviewer checking an unexpected number. Known-file ingestion remains short; unknown-file onboarding is a focused secondary workspace. An operator gets a durable import ledger, without placing ledger metadata on the overview.

Open [mockup.html](./mockup.html) directly from disk. There are no dependencies, fonts to download, network requests, telemetry, external assets or build steps. Everything, including charts and the assistant simulation, is inline. No backend is contacted and no file is uploaded.

## Information architecture

| Screen | Prototype hash | Production route | What lives here |
| --- | --- | --- | --- |
| 4 · Dashboard | `#dashboard` | `/dashboard?source=&agent=&model=&period=` | Four KPIs; activity, input-by-model and tool charts; quality strip; scoped sessions |
| 1 · Import | `#import` | `/import` | File selection and sniff result, same-byte warning, saved mapping choice, sample preview, commit confirmation |
| 2 · Import report | `#report` | `/imports/:id` | Attempt status, exclusive record outcomes, emitted entity counts, manifest, warnings, rejects browser |
| 3 · History | `#imports` | `/imports` | Attempts, source file, mapping revision, outcomes, entity counts and UTC time |
| 5 · Session | `#session` | `/sessions/:id` | Full external identity, repository/user, observed span, coverage, model/tool observations and source drawers |
| 6 · Mapping assistant | `#assistant` | `/mappings/new?upload_id=` | Local profile, outbound context review, proposed mapping, per-field explanations, ambiguities, conversation, validation, preview, immutable revision |
| 7 · Definitions | `#definitions` | `/definitions` | Metric definitions, units, semantics tags, coverage and comparability rules |

The application header contains three destinations: Overview, Imports, Mappings. Import is the one persistent creation action. There is no sidebar, project switcher, invented organization hierarchy, account avatar or command palette. “Local workspace” describes the deployment without implying a cloud service or live data feed.

Definitions is reached from a metric explanation or the review controls. Reports and sessions are subordinate destinations with breadcrumbs. The prototype’s compact routes hold the currently selected example in memory; production routes must carry actual IDs and retain filters in the query string. An unknown hash has a deliberate recovery view.

## Navigation and disclosure

The scope bar is sticky beneath the 64 px header on analytics and session routes. Source, agent, model and period each have a native select and a reset action. These are global **analytics** filters; they are not displayed on import, history or mapping tasks, where they would imply incorrect filtering of ingestion. The selected scope survives leaving and returning during this prototype session.

There is one primary drill-down motion:

1. Select a day or a tool bar, or a model row. The charts, KPI totals and session results narrow together. A visible day/tool chip identifies the selection.
2. Open a matching session from the result table. The same scope remains in the header; the breadcrumb restores it.
3. Select **Source record** on a model or tool observation. A modal drawer opens the corresponding JSON, full file hash, locator and emission path.

This is three clicks from chart to source. The drawer closes with Escape or its labeled close button, returning to its opener. No second drawer is stacked over it: switching from a metric explanation to contributing sessions replaces the contents of the single disclosure surface.

| On screen | One deliberate action away | Why |
| --- | --- | --- |
| KPI label, exact value, known/total coverage | Definition, accounting breakdown and contributing sessions | Value and coverage answer “what happened, and how much do we know?”; semantics are available at the point of interpretation |
| Three charts with units and restrained axes | Exact data table or a scoped session list | Charts support pattern recognition; the source table supports verification |
| Four quality counts | Meaning, denominator, import warning totals and report | Quality must temper interpretation, without turning the overview into a diagnostics console |
| Session identity and repository/user | Internal ID and full identity explanation | External identity is useful for recognition; storage identity is evidence |
| Observed span; declared interval unavailable | Both exact UTC bounds and derivation | No inferred active time, no wall of repeated timestamps |
| Model or tool observations | Raw JSON and provenance | Normalized values are the main task; source bytes are an explicit review step |
| Sniff result and same-byte warning | Previous import details and complete hash | Duplicate risk matters immediately; cryptographic metadata matters at confirmation |
| Preview outcomes and entity counts | Warning detail, empty rejects view, emission sample | A clean preview should lead directly to confirmation |
| Report status, record outcomes, entity counts and manifest | Warning explanations and reject payload | The report’s task is audit, so its file hash belongs on the main surface |
| Editable proposal and unresolved ambiguities | Each field’s rationale and local profile | Uncertainty must block execution, not hide in assistant prose |
| Short redaction summary | Explicit outbound profile and send decision | A provider request is meaningful only after the user sees its data boundary |

This is intentionally less dense in chrome than a workbench. The data is dense: regular rows, aligned numeric columns, abbreviated date labels with exact timestamps in the relevant disclosure, and no decorative illustrations or sparklines pretending to show trends.

## Visual system

### Type

The system stack is `-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`. It fits the laptop/internal-server setting and makes offline typography deterministic for a given machine. Monospace is `SFMono-Regular, Consolas, Liberation Mono, monospace`, reserved for hashes, IDs, JSON and editable paths. Numbers use tabular figures.

| Role | Size / line height | Weight |
| --- | --- | --- |
| Page title | 28 / 35 px, −1 px tracking | 650 |
| Session external identity | 22 / 27.5 px, wrapping allowed | 650 |
| KPI | 30 / 42 px, 26 px at narrower widths, 36 px at 1920 | 600 |
| Section heading | 15 / 21 px | 650 |
| Body | 14 / 21 px | 400 |
| Supporting copy and controls | 12–13 / 18–19.5 px | 400–550 |
| Table heading and metadata | 10–11 / 15–16.5 px | 600 / 400 |
| JSON and identifiers | 11–12 / 20–22 px | 400 |

All four headline values are exact. No “553M”, hover-only number, shortened hash or percentage without a denominator. Compact session references in result rows are recognition labels; the session shows the full external identity, and its identity drawer exposes the complete internal ID.

### Space and density

Base spacing is 4 px: 4, 8, 12, 16, 20, 24, 32, 40, 48. The 36 px desktop page inset and 22 px card inset are deliberate optical adjustments. Cards have 10 px radii, controls 6 px, badges 4 px. Surfaces are separated by fine borders; only modal disclosures have shadows.

At 1280 px the canvas has 36 px insets, four equal KPI cards, a roughly 2:1 activity/model split and a roughly 1:1.6 tools/results split. At 1920 px the canvas caps at 1600 px, increases KPI type and gives chart/table rows more breathing room. At 900 px insets become 24 px, card spacing drops to 12–16 px, the same four KPIs remain visible and assistant/import side columns narrow. Tables can scroll inside their own containers; the page should never scroll horizontally. Long identities and hashes wrap. Below 760 px, paired content stacks; this is a useful fallback rather than a mobile-first redesign.

### Color tokens and dark derivation

Light is fully implemented. Dark is a token specification, not a mockup toggle or an untested claim of completion.

| Semantic token | Light | Dark derivation | Use |
| --- | --- | --- | --- |
| `--bg` | `#F5F7F7` | `#101918` | Canvas |
| `--surface` | `#FFFFFF` | `#172321` | Header, cards, dialogs |
| `--subtle` | `#F0F4F3` | `#21312E` | Quiet surfaces, code blocks, rails |
| `--ink` | `#172B2A` | `#E5EEEB` | Primary text |
| `--muted` | `#526764` | `#A4B8B2` | Supporting text and axis labels |
| `--line` | `#DCE5E2` | `#344B43` | Decorative separators |
| `--strong` | `#81958F` | `#759188` | Input boundaries |
| `--accent` | `#086B58` | `#7ED6B5` | Links, positive text, primary chart |
| `--accent-soft` | `#E6F4EE` | `#173D30` | Positive status surface |
| `--blue` | `#486A9A` | `#96B9EC` | Secondary series |
| `--orange` | `#A86122` | `#E8B071` | Third series |
| `--orange-soft` | `#FFF3E4` | `#3A2D1A` | Ambiguity surface |
| `--danger` | `#AB363E` | `#F4A3AA` | Error text |
| `--danger-soft` | `#FFF0F0` | `#41262A` | Error surface |
| `--focus` | `#146CC4` | `#98C7FF` | 3 px keyboard focus outline |

Dark primary buttons use the light-dark accent pair deliberately: mint fill with `#102A21` text. White text on mint would fail. Normalize the mockup’s small number of literal colors into aliases before a theme implementation: table heading `#F8FAF9` → subtle; row hover `#F6FAF8` → subtle; pre background → subtle; graph rail `#EEF3F0` → subtle; chart series literals → series tokens; warning text `#8A4B13` → `#E8B071`; warning border `#E8C79C` → `#896C3C`; positive text `#185E46` → mint. Elevation becomes a darker, less blurred shadow. Never invert charts or raw JSON as an image. Recheck AA contrast and chart-boundary visibility in both themes.

## Components and React implementation

Use React 19, TypeScript, Vite and Recharts as planned. No component framework, CSS-in-JS engine, custom select library, animation library or code editor is justified in the timebox.

| Component | Responsibility | Existing reuse / work |
| --- | --- | --- |
| `ConsoleShell` | Header, route title, breadcrumbs, constrained canvas | Restyle `App.tsx`; retain router |
| `AnalyticsScopeBar` | Native filters, sticky position, reset, query-string scope | Extend existing source/agent filters with agreed API fields |
| `MetricCard` / `MetricDisclosure` | Exact value, coverage, definitions, semantic groups | Split existing KPI presentation; keep formatter and null policy |
| `ActivityChart`, `TokensByModel`, `ToolsChart` | 3 visualizations, keyboard alternatives, exact data views, drill-down | Recharts; server-produced aggregates and scope-consistent queries |
| `QualityStrip` | Four compact indicators linked to explanations | New, with explicit scope/denominator contracts |
| `DataTable` / `Pagination` | Caption, headers, numeric alignment, contained scrolling | Restyle existing `Table` and `Pagination`; no grid dependency |
| `DisclosureDialog` | One modal drawer or central confirmation, focus restoration | Generalize existing `SourceDrawer` using native `<dialog>` |
| `ResourceState` | Skeleton, error with retry, empty state, retained filters | Extend existing component, preserve error DTO details |
| `ImportFile`, `PreviewSummary`, `CommitReview` | Bind immutable upload + mapping revision + preview; explicit commit | Refactor existing long import page, retain its in-flight guard |
| `ImportReport`, `RejectsBrowser` | Honest statuses and separate record/entity counts | Retain existing API calls and code filtering |
| `ObservationTabs` / `SourceRecord` | Separate model/tool rows; exact raw response text | Existing session data and raw-record request; reuse `payload_text` |
| `MappingReview` | Profile, field paths, inline issues, explanations, ambiguities | New day-3 slice; controlled inputs, no visual DSL graph |
| `AssistantConversation` | Reviewed context, proposal revision, recoverable failures | New; application-owned proposal DTO, provider details outside main flow |
| `Definitions` | Metric registry rendered as a compact reference | New page; same definitions as the metric layer |

Keep the current resource hook while restyling; adopt planned TanStack Query only as part of an agreed shared data-layer change. A one-file prototype does not justify a wholesale fetching rewrite. Dialog contents and state logic become React components, not `innerHTML`. Render untrusted strings as text, never executable HTML.

### API and planning alignment

The study was grounded in `web/src/pages`, `components.tsx`, `index.css`, `docs/api/v0.1.md` and the consolidated September 7 plan.

Existing upload, mappings, preview, commit, import listing/report/rejects, sessions and raw-record endpoints support the ingestion/provenance structure. Use `already_imported` for the same-byte warning, not a client-generated hash comparison. Bind confirmation to the immutable upload and exact mapping revision. Any file or mapping change invalidates its preview. Re-importing the same bytes for the same source inserts nothing regardless of a changed mapping.

The current summary response does **not** provide output-token KPIs, time series, model/period filters, full quality aggregates, all count denominators or a scoped import dashboard. Those are day-2 extensions, not fields this design pretends already exist. Define source/agent/model/period semantics, unknown timestamp buckets, output coverage and per-semantics aggregates before implementation. Do not aggregate a single paginated session page into apparently global KPIs. Until import-scoped filtering exists, a report’s button is **Open overview**, with no false promise that it isolates that import.

`running` is a client-side pending-request presentation under the current synchronous commit contract. There is no invented queue, polling job or percentage. The final server statuses remain committed, duplicate and failed. A 409 race must refetch the winning result; do not issue an unbounded blind retry. Empty entity maps on duplicate/failed become zero inserted entities. Missing measurements remain unavailable.

Session raw data uses `payload_text` directly. Never `JSON.stringify(payload)` for a real raw-record viewer: the contract specifically protects integers beyond 2^53 and exact decimals. The prototype constructs synthetic sample JSON only; it does not claim those samples were read from the provided file.

The mapping assistant needs the planned profile/propose/revise/validate/preview/save contracts. The production editor must support the complete closed AST, identity/parent requirements and all three validation stages. The mockup’s rooted-path check demonstrates feedback, not DSL validation. No provider request writes observations; saving an immutable mapping revision and committing an import are distinct user actions. Existing committed imports are never silently reprocessed.

## Screens and resource states

The following state specifications apply to production. The prototype implements the main success flows, local upload type/size errors, no-reject views, empty filtered history, inline path errors, ambiguity gates and a review-state switcher for the dashboard/report. It does not implement every provider failure or backend retry behavior.

### 1. Import

**Main surface:** Drop target, native chooser, supported formats and limits. The preloaded TraceLab fixture shows gzip → JSONL, 681,057 bytes and 4,770 records. A same-byte warning links to the earlier import. Select revision 1, preview 200 records, inspect warning/reject/emission disclosures, then open the confirmation with the entire SHA-256 and `map_82934058a2f6af1cbfc6`.

- **Empty:** No file, no mapping controls, no disabled forest of later steps. “Use TraceLab demo fixture” is a prototype shortcut. Production offers only file selection.
- **Loading:** Announce uploading/sniffing or sample preview as the actual stage; disable the relevant action. Preserve successful prior metadata. Cancel/reselect only when the implementation can safely cancel.
- **Error:** Unsupported type and over-limit size have corrective messages. A malformed upload preview shows its locator and decoder error. Mapping failures retain the file. Preview failures retain the draft and expose `{path, code, message}`. Commit failure routes to its report.
- **Success:** The preview counts records separately from entities and explicitly states it is sampled. A duplicate fixture confirmation says **Run duplicate check**, then reaches a duplicate report; it never claims another 80 sessions were inserted.

The local picker accepts a real selection but clearly offers to continue with a demo fixture; it never gives an arbitrary file a fabricated sniff result. The unknown 1.3 GB file is represented by a 2,000-row excerpt, not a fictitiously successful full upload.

### 2. Import report

**Main surface:** Outcome first, then source-record outcomes, inserted entities, manifest and rejects. Full hash belongs here because audit is the task. Accepted/partial/duplicate/rejected/ignored are explicitly record counts; sessions/model calls/tool calls are separate entity counts.

- **Empty:** “No rejected records” means the reject list is empty, not that the report is empty. An unknown import ID shows a not-found recovery link to history; never a zeroed report.
- **Loading / running:** Indeterminate progress and “waiting for transaction result”; no partial committed entity totals. Fetching an existing report uses a skeleton.
- **Error / failed:** Read error and rollback statement, then a concrete choose-file action. Rejects-list fetch errors retry just that section while preserving the committed report.
- **Success / committed:** 4,770 accepted, all other outcomes zero; 80 sessions, 4,770 model calls, 5,723 tools; 11,168 explicit nulls and 14,633 absent field occurrences. Status is committed despite optional-field warnings.
- **Success / duplicate:** 4,770 duplicate records, zero inserted entities and no double-counted warnings. Link to the earlier attempt.
- **Reject example:** Review controls open a separate illustrative import. The browser filters `invalid_type` vs `invalid_json`, and the payload drawer shows `line:1042`, `model_call`, `$.usage.input_tokens` and “expected integer, got string '12,431'”. This never contaminates the clean fixture’s zero-reject report.

### 3. Imports history

**Main surface:** Newest attempts first, textual status badges, full attempt IDs, filename/source, mapping revision, outcome summary, entity counts and UTC time. Selection opens the attempt report. No raw JSON inside ledger cells.

- **Empty:** First use invites import. A status filter with no matches offers to clear the filter; it does not imply all history was deleted.
- **Loading:** Stable column widths and a few skeleton rows, announced once.
- **Error:** Retry the list in place; keep selected status/page. Never render an empty table as the fallback for a failed request.
- **Success:** Clean, duplicate and failed attempts are distinct, with zero inserted entities for duplicate/failed. The prototype shows all three and labels illustrative attempts. Production uses server pagination and actual mapping bindings.

### 4. Dashboard

**Main surface:** Four exact KPIs: 80 sessions, 4,770 model calls, 553,447,877 input tokens, 1,204,331 output tokens. Known/total coverage remains visible beneath each. Activity by day uses discrete session-count bars; tokens by model uses labeled horizontal bars and exact counts; tools use a horizontal chart with exact end labels. No fabricated growth delta, anomaly badge or live indicator.

- **Empty:** No sessions in scope, explanation, clear filters, import action. No chart frame around an invented flat zero line.
- **Loading:** Same KPI/chart geometry with neutral skeletons and a live status. Review controls intentionally hold this state for inspection; Refresh demonstrates a short loading-to-success transition.
- **Error:** One actionable local-server error with retained filters and Retry. Production can retain old data only if clearly marked stale; the prototype hides it.
- **Success:** All chart selections change the scoped totals and results. Pagination contains five sessions at a time; Expand opens the same scoped data in the drawer.
- **Coverage zero:** Input reads **Unavailable**, coverage `0 / 4,770`, the input chart becomes an unavailable state, and its definition drawer reports unavailable semantics values. Other metrics remain valid. Zero observations and unknown usage are different states.

Input coverage is the brief’s 4,770 / 4,770. The prototype assumes full output coverage and complete timestamps/linking for illustration; those denominators are not supplied by the brief or current metric DTO and must come from backend evidence. The KPI explanation warns that two token accounting semantics cannot establish cross-provider efficiency.

### 5. Session detail

**Main surface:** The supplied full external identity, tracelab / claude-code, repository `project_8f998460`, user `user_b87fa13e`, 48,187 input tokens and 2 / 2 coverage. Model and tool observation tabs separate two different row shapes. The observed interval is June 4, 2026, 02:51:06.901–02:52:00.698 UTC: 53,797 ms. Declared bounds are unavailable, not inferred.

- **Empty:** Missing model or tool observations have local empty views; unavailable declared timestamps stay labeled. A nonexistent session is a not-found page with its overview breadcrumb.
- **Loading:** Identity and observation skeletons; source drawer shows its hash and locator immediately while awaiting payload text.
- **Error:** Failed source reads show a local retry; never substitute another raw row. Conflicting agent values and reversed intervals appear in diagnostics, preserving source claims and excluding invalid duration calculations. A separate example is available in the diagnostics drawer.
- **Success:** Any observation opens its corresponding illustrative parent raw row with full hash and locator. Tool rows identify their model parent. Observation pagination keeps the table compact. Escape restores focus to Source record.

The synthetic observation details sum to the session totals. Timestamp placement within the timeline is explicitly illustrative. The prototype does not include the source file; its locators, per-call distribution and raw JSON are illustrative, not forensic evidence of the supplied hash.

### 6. Mapping assistant

**Main surface:** Initially the local field profile only. The adjacent conversation begins only after outbound-context review. The proposed mapping becomes the shared editable artifact, with explanations per field and two visible unresolved questions: conversation-level usage and missing tool parent relationships.

- **Empty:** No proposal has been requested. The local profile is still useful; the call to action reviews the outbound context first.
- **Loading:** Announce proposal generation; keep the profile readable. Validation/preview show their actual phase. Prevent duplicate requests and keep the last usable draft.
- **Error:** Rooted-path errors appear next to the edited field. Unresolved usage/linking blocks preview; every edit invalidates preview and saved-draft actions. Production provider timeout, refusal, truncation and malformed output leave the last draft intact and allow a bounded retry or manual edit; never silently apply partial output.
- **Success:** Resolve usage to one model-call observation per conversation, explicitly exclude unsupported tool emissions, validate, preview, save revision 1, then open the standard import surface with that revision. The assistant conversation supports those two revisions locally; other questions explain the offline limitation.

Outbound review lists field names, types, presence counts, array structure, current mapping and conversation message. No sample values are sent in this profile-only example. Prompt content, tool arguments, repository values and conversation IDs are excluded. An expandable payload shows the exact profile portion. Production must render the full actual outbound context and resolved provider destination, including the analyst’s message, before a request requiring sensitive context. Redaction cannot protect a secret deliberately pasted into chat; the nearby notice explains that boundary.

Saving records an immutable mapping revision. The subsequent “Import with this revision” action opens preview/confirmation, not an autonomous import. SWE-chat results and its excerpt hash are explicitly illustrative and are not mixed into the fixed TraceLab dashboard fixture.

### 7. Definitions

**Main surface:** One compact reference listing sessions, model calls, input/output/cache tokens, activity, tokens by model, tools, observed span, quality and import outcomes. Each has unit, semantics and comparison rules. No separate settings taxonomy.

- **Empty:** If a mapping has no metric definition, show “Definition unavailable for this revision” and disable misleading comparisons; do not invent one.
- **Loading:** Preserve metric headings and load descriptions from the shared registry.
- **Error:** Registry retrieval failure has Retry and a return-to-overview action; cached definitions must identify their revision.
- **Success:** The same text and semantics labels power metric disclosures. Reference explains observed time, record/entity counts, known-only sums and source-occurrence identity.

## Accessibility

Use semantic landmarks, one page h1, actual headings, captioned tables, scoped column headers and visible row links. Native selects remain keyboard accessible. Every interactive chart bar is focusable with Enter/Space activation and a complete accessible label; activity and token charts also offer exact tabular data. Tool chart counts are included in each accessible bar label. Color reinforces text; it never exclusively encodes outcome, series or uncertainty.

All disclosures use native modal `<dialog>`, a named heading and close button. Production must preserve the original invoker through content changes and restore it on close; when the original control disappears, restore to the route heading. The prototype restores a connected opener and uses native focus trapping/Escape. Session tabs support arrow keys, Home and End. Route changes focus main; a skip link reaches it. Inputs have labels, invalid paths have live inline messages, and async actions announce status without reading entire tables. Focus uses a 3 px blue outline with a 3 px offset. Reduced-motion preferences stop skeleton/progress animation.

Text colors target AA; thin separator lines are decorative, while required input boundaries use the stronger token. Info controls have a 24 × 24 px minimum. Production should enlarge thin chart-bar hit areas without enlarging the visible marks and audit screen-reader behavior around nested SVG graphics in the actual Recharts implementation. The browser layout and full assistive-technology pass remain release checks, not something a static DOM test can certify.

## Implementation cost and release boundary

Budget: approximately **12 front-end hours / 1.5 working days**, spread over the four-day release plan. This assumes metric and assistant contracts are implemented alongside the UI and that existing API behavior remains stable.

| Work | Estimate | v0.1.0 scope |
| --- | --- | --- |
| Shared shell, tokens, controls, dialog, resource states | 1.5 h | Ship |
| Refactor import/report/history; preserve existing behaviors | 2 h | Ship |
| Four KPIs, three Recharts charts, scope and drill-down | 3 h | Ship when day-2 aggregate contracts land |
| Session tabs, metric explanation, source precision | 1 h | Ship |
| Minimal profile/proposal/editor/conversation/preview/save | 2.5 h | Ship against day-3 assistant DTOs |
| Definitions, responsive/keyboard checks, existing smoke path | 2 h | Ship |

This is an aggressive estimate, with little contingency. Protect known import → report → dashboard → session → source first. If backend extensions slip, show an explicitly unavailable chart/metric; never simulate it in the real product. Assistant polish can reduce to native form fields and one explanation disclosure, but human review, validation and preview invalidation cannot be cut.

Deferred: dark-theme implementation and its separate QA (tokens are specified here); a polished timeline (use the exact interval disclosure first); saved views; resizable panels; query builder; command palette; arbitrary chart brushing; assistant history management; transcript search; alerting, anomaly detection and live monitoring; bulk reprocessing; mobile optimization beyond sensible stacking. These are not required to deliver the six core tasks. No new heavy runtime framework is introduced.

Validation should build on the existing tests and planned smoke: known upload → preview → confirm → committed report → chart scope → session → payload_text → duplicate re-import. Add meaningful checks for zero coverage, failed transaction totals, query consistency, mapping edit invalidation and refusal to commit an unresolved draft. Keep exact large-number fixtures in the raw-record rendering tests.

## Risks and trade-offs

- **Monitoring can imply live telemetry.** This is imported, recorded activity. The UI uses a date range and explicit Refresh, without a live pulse or “now” chart.
- **An impressive total can imply comparability.** Coverage is always visible; semantics is one click away. The model chart explicitly links its two accounting semantics. A future default split by semantics is safer if analysts routinely misread the combined number.
- **Chart filters can hide evidence.** Selections get a named chip, reset and retained breadcrumbs. Production must use exactly the same scope for aggregates and session drill-down, not approximate local filtering.
- **Rejected records may have no session or model.** Their dashboard scope cannot be guessed. Define source/import-level reject coverage and explain it in the quality disclosure before exposing agent/model-filtered rejection totals.
- **Chart aggregation costs backend work.** Three charts are cheap to draw and expensive to make truthful. The shared contract, not React, is the critical path.
- **Assistant minimalism can bury uncertainty.** The two ambiguity decisions remain on the main mapping surface, with explicit execution gates. Explanations are secondary; unresolved semantics are not.
- **Profile-only proposals may be incomplete.** Keep manual correction available; add a separately reviewed bounded sample only when required. Never quietly broaden provider context.
- **Dark is not achieved by inversion.** Token derivation, SVG aliases and positive-button foregrounds require a second visual pass.
- **Small text favors desktop density.** The 900 px layout prioritizes numerical scanning; zoom and screen-reader checks are necessary before shipping. Small decorative labels must not become the only place critical meaning appears.
- **Source trust must survive implementation.** The prototype’s synthetic JSON is not a pattern for reserializing real payloads. Production must keep the existing `payload_text` boundary.

## Relative to the other directions

| Direction | Where Console wins for AgentScope | Where Console loses |
| --- | --- | --- |
| Workbench | Faster first read of aggregate activity; no permanent inspector or command-learning burden; fewer custom interaction primitives | Slower expert multi-artifact comparison and less efficient repeated keyboard inspection |
| Ledger | Finds temporal/model/tool patterns before the analyst knows which import to audit | Less document-like auditability; provenance needs a deliberate drill-down instead of leading every row |
| Guided | Returning analysts arrive at the result; repeat imports avoid a ceremonial wizard; analytics stays the primary destination | First-time mapping authors receive less step-by-step coaching; a complex proposal can still feel technical |

Console is the strongest choice if the daily question is “what did these agents do, and can I trust that number?” It loses if initial onboarding or written audit review dominates usage. The core wager is that imports and mappings are preparation, while scoped observation and verification are the recurring product.

## Prototype data, review path and verification

The supplied fixture filename, byte size, SHA-256, record count, mapping ID/revision, clean report outcomes, warning totals, dashboard totals and example session identity/interval/input coverage are preserved. Eighty deterministic synthetic sessions allocate the exact supplied aggregate counts and tokens so filtering is internally consistent. Daily/model/tool distributions, non-example identities, output coverage, quality denominators, preview sample counts, observation timing, raw rows/locators, extra import attempts and SWE-chat results are illustrative and labeled. They are not discoveries about the actual file.

Suggested review:

1. Start at Overview; select Jun 4; open `781a3b4c`; select Source record. Close with Escape, return to Overview and reset the scope.
2. Inspect Input tokens to see definition, coverage and semantics; use Contributing sessions.
3. Open Import traces → Preview → warning/reject/emission disclosures → Review & commit → Run duplicate check.
4. Open Imports, then the committed report to check clean counts and complete hash.
5. Use **Review states** at the bottom to inspect loading, empty, unavailable, error, running, duplicate, failed and the separate reject example. Filter reject codes and open raw payload.
6. Open Mappings → Review & propose → inspect outbound payload → generate proposal. Resolve both ambiguities, edit a path, validate, preview, save and import. Editing again invalidates preview/save actions. Conversation examples: “usage is per conversation” and “exclude tools”.
7. Reach Definitions from any metric disclosure or Review states.

Verification performed: inline JavaScript parse; DOM execution of all seven routes; deterministic aggregate reconciliation; report/reject filter interactions; metric and raw-record disclosures; model/tool tabs; scope filtering; mapping ambiguity resolution, validation, preview and save. A network-resource scan confirms no external scripts, styles, images or runtime fetches.

Visual verification limitation: Chrome and the available headless Chromium could not render under this environment’s sandbox (browser process exited / sandbox initialization failed). Consequently, 900/1280/1920 px behavior is specified and implemented in CSS but not screenshot-verified; native focus trapping and assistive-technology behavior still require browser review. No browser screenshot is represented as having passed.
