# Plan: assistant field table, lossless numeric codec, report entry point (issue #39)

Follow-up to #15. The v0.1.0 slice shipped the assistant with a JSON editor
(`docs/superpowers/plans/2026-09-07-assistant-ui.md`, revision 2, §1); this issue is the
"follow-up issue" paragraph of that plan and answers the Codex review findings
`2026-09-07-assistant-ui-review-codex.md` [2] (field-table model), [3] (numeric loss at the
JSON boundary), [5] (ambiguity options are prose), [6] (issue paths), [8] (report entry has no
bootstrap contract) and [11] (breakpoints, exact evidence, labelled controls).

## 1. Goal

The issue states no separate "expected verifiable result" section; its **Scope** is the goal and
is quoted verbatim:

> - Field table bound to the DSL: rows as an indexed view over the canonical document (never a
>   lossy rows→document rebuild), all field options (`path`/`paths`/`literal`, `transforms` in
>   both forms, `enum_map`, `timestamp_format`, `unit`, `bounds`, `type`, `empty_as_missing`,
>   `on_missing`/`default`, `on_invalid`), rules add/delete/rename with parent references,
>   `where` conditions with typed values, `unmapped` and `notes`; malformed sections kept in a
>   JSON repair view.
> - Lossless numeric codec at the API boundary (large integers, `1.0` vs `1`), with tests from
>   raw response text through the editor to the server.
> - Ambiguity options as executable suggestions beyond the single supported edit
>   (`timestamp_format`), with unambiguous rule/field targeting.
> - Entry from an Import report (needs an upload-resolution API or a re-upload flow with SHA
>   check; a corrected mapping does not replace observations of an already committed file).
> - Responsive collapse of the evidence rail below 1280 px; per-message receipt styling via the
>   chat library's message hooks.
> - Issue-path resolver mapping the parser's `rules[0].fields.x` paths to editor controls.
>
> **Not in scope**: persisted conversations, streaming, provenance columns.

Owner constraints that bind this issue: the conversation keeps `@assistant-ui/react`; Console
design of record (`research/design/claude/3-console/README.md` §"6. Mapping assistant": rule,
target, editable source path, transforms, why + ambiguity, caption counting ambiguities and
invalid rows); icons over labels, every icon-only control with an accessible name and a visible
tooltip; "Unavailable" is a designed value; numbers that must round-trip travel as text.

## 2. Current state (verified on this branch)

- `web/src/pages/Assist.tsx` (258 lines): route `/import/assist/:uploadId`, identity form,
  profile fetch, prepare/run effects, gates validate → save → preview → import, payload drawer.
  It holds no rows model; the document is text.
- `web/src/assist/assistRuntime.ts` (328 lines): the pure state machine. `editDocument()` bumps
  `documentVersion` and clears `validation`/`saved`/`preview`; `outcomeArrived()` applies the
  proposal from the **raw response text** via `extractMappingText` + `prettyJson`, and falls back
  to `JSON.stringify(outcome.proposal.mapping, null, 2)` **silently** when extraction fails.
  Ambiguities are rendered as prose inside `assistantText()`; nothing is executable.
- `web/src/assist/jsonText.ts` (187 lines): a tokenizer that never parses numbers, plus
  `prettyJson`, `extractMappingText`, `envelopeWithRawJson`, `pathSegments`, `lineFor`. It can
  *locate* a value (`valueSpan` is private) but cannot *edit* one.
- `web/src/assist/DocumentEditor.tsx`: textarea + issue list with "jump to line" via `lineFor`.
- `web/src/assist/EvidenceRail.tsx`: `<aside aria-label="Evidence">`, always expanded.
- `web/src/assist/Conversation.tsx`: `@assistant-ui/react` 0.15.18 external-store runtime; the
  receipt is a second text part styled by the CSS hack
  `.chat-msg-assistant > :nth-child(2)` (`web/src/assist/assist.css:82`).
- `web/src/assist/assist.css:8`: `@media (max-width: 1280px)` only reflows the grid to two
  columns and makes the rail span both; the rail's long profile table stays fully expanded.
- `web/src/api/index.ts`: `assistantBody()` embeds `current_mapping_text` verbatim,
  `rawDocumentBody()` sends `{"document":<text>}` verbatim, `runAssistant()` returns
  `{outcome, rawText}`. **Lossy on the read side**: `getMapping()` uses `response.json()`, so a
  saved document's numbers are rounded by the browser before they can reach the editor.
- `web/src/pages/Imports.tsx`: `ImportsPage` (ledger) and `ReportPage` (`/imports/:id`). The
  report has a files table (`ImportedFile`: filename, sha256, size, format, record_count,
  mapping id/name/revision, status) and a rejects panel. `ImportedFile` has **no `upload_id`**
  and there is no upload-lookup route (`backend/.../interfaces/api/routers.py` has
  `POST /uploads`, `POST /uploads/{id}/profile`, no `GET /uploads`).
- `backend/.../domain/mapping/mapping-dsl-v1.schema.json`: the DSL v1 shape used below.
  Parser issue paths are `rules[0].id`, `rules[0].fields.started_at.bounds`,
  `rules[0].where[1].value`, `rules[0].transforms[2]`, `unmapped[0].reason`, `dsl_version`, `$`
  (`backend/.../domain/mapping/parser.py:139,257,342,418`).
- Duplicate detection is **bytes + source**: `uow.imports.find_committed(sha256, source)`
  (`backend/.../application/use_cases/imports.py:375`). A corrected mapping re-imported over the
  same bytes into the same source inserts nothing.
- `SaveMappingRevision` is idempotent by content hash and refuses non-executable documents
  (`backend/.../application/use_cases/mappings.py`).
- The fake provider emits exactly two ambiguity shapes:
  `{target: "model_call.started_at", options: ["epoch_s","epoch_ms"]}` (executable) and
  `{target: "model_call.token_semantics", options: ["unknown","a validated swe-chat tag"]}`
  (prose) — `backend/.../infrastructure/llm/fake.py:241,287`.
- Icons available (`web/src/components/icons.tsx`): overview sessions imports mappings
  definitions upload sun moon monitor x check alert info clock copy file braces refresh plus
  trash filter eye play layers arrowRight. **No new icon is added by this issue.**
- Tests today: `web/src/assist/assistRuntime.test.ts`, `web/src/assist/jsonText.test.ts`,
  `web/src/pages/Assist.test.tsx`, `web/e2e/assist.spec.ts` (fake provider, source `assist-e2e`).
- `window.matchMedia` is not used anywhere in `web/src` and jsdom does not provide it.

## 3. Design

### 3.1 The document is still the only source of truth

No rows→document rebuild exists anywhere in this issue. Every table control performs a
**text splice**: it replaces the byte span of exactly one value (or inserts/removes exactly one
member) inside `state.documentText`, and the result goes through the existing
`setDocumentText()`, so a table edit and a typed edit are indistinguishable to the gates. Key
order, spacing, unknown keys and every numeric lexeme outside the spliced span are byte-identical
before and after. This is what answers review findings [2] and [3].

**New module `web/src/assist/document.ts`** (pure, framework-free, built on `jsonText.ts`):

```ts
export type DocPath = (string | number)[]            // ['rules', 0, 'fields', 'started_at', 'unit', 'from']
export interface Span { start: number; end: number } // byte offsets into the document text

export function valueSpanAt(text: string, path: DocPath): Span | null   // the value only
export function memberSpanAt(text: string, path: DocPath): Span | null  // key + value + one separator comma
export function rawAt(text: string, path: DocPath): string | null       // the exact source text of that value
export function existsAt(text: string, path: DocPath): boolean

export type DocEdit =
  | { op: 'set';    path: DocPath; raw: string }        // replace a value, or add the member if absent
  | { op: 'remove'; path: DocPath }                     // delete an object member or an array element
  | { op: 'rename'; path: DocPath; key: string }        // rename an object key, value untouched
  | { op: 'insert'; path: DocPath; index: number; raw: string } // into an array at index

export function applyEdits(text: string, edits: DocEdit[]): { text: string } | { problem: string }
export function describeEdits(edits: DocEdit[]): string   // "set rules[1].fields.started_at.timestamp_format to \"epoch_s\""
```

Mechanics: `valueSpanAt` walks the token stream with the same descent as the existing `lineFor`
(that descent is extracted into a shared `descend()` so there is one implementation);
`applyEdits` sorts edits by descending `start` and splices right-to-left so offsets stay valid;
`set` on an absent member inserts `"key": <raw>` after the last member of the parent object using
the indentation of its previous sibling (or reformats a `{}` empty object to two lines);
`remove` takes the member span including the comma that separates it from a sibling (the
preceding one when it is the last member). A malformed document makes every function return
`null`/`{problem}` and the table falls back to the repair view (§3.4).

`raw` strings are always **raw JSON text**, never JS values: `"epoch_s"`, `1.0`,
`9007199254740993`, `{"from":"s","to":"ms"}`. `applyEdits` rejects a `raw` that is not exactly one
balanced JSON value (new `isOneJsonValue(text)` in `jsonText.ts`, tokenizer-based, no
`JSON.parse` of numbers).

**New module `web/src/assist/documentIndex.ts`** — the indexed *read* view:

```ts
export interface FieldView {
  name: string; path: DocPath                       // ['rules', i, 'fields', name]
  source: { kind: 'path' | 'paths' | 'literal' | 'none'; raw: string | null }
  transforms: TransformView[]                       // { index, kind, raw, form: 'short' | 'object' }
  options: Partial<Record<FieldOption, string>>     // raw lexemes, keyed by option name
  malformed: string | null                          // "fields.x is not an object"
}
export interface RuleView {
  index: number; path: DocPath; id: string | null; entity: string | null
  select: string | null; where: ConditionView[]; parent: string | null
  nativeKey: string[] | null; fields: FieldView[]; malformed: string | null
}
export interface DocIndex {
  ok: boolean; problem: string | null
  head: { dsl_version: string | null; target_schema_version: string | null; name: string | null;
          source: string | null; input_format: string | null }
  rules: RuleView[]; unmapped: UnmappedView[]; notes: string | null
  malformed: { path: DocPath; reason: string }[]
}
export function indexDocument(text: string): DocIndex
```

`indexDocument` uses `JSON.parse` **for structure only** (which keys exist, array lengths, string
values); every value shown in a cell or written back comes from `rawAt(text, path)`, so a
`9007199254740993` bound or a `1.0` literal is displayed and re-sent as typed. Structure carries
no numeric loss. `FieldOption` is the closed list from the DSL schema: `type`,
`timestamp_format`, `unit`, `bounds`, `empty_as_missing`, `on_missing`, `default`, `on_invalid`.

### 3.2 The field table

`web/src/assist/FieldTable.tsx` renders `DocIndex` as one `<table class="data">` per rule inside a
`<section>` per rule, with a caption in the Console voice counting rows, ambiguities and invalid
rows ("12 fields · 1 ambiguity · 2 invalid rows"). Columns:

| Column | Control | Document path written |
| --- | --- | --- |
| Target | text input with a `<datalist>` of the known target names for the rule's entity; free text allowed (the server is the authority) | rename of `rules[i].fields.<name>` |
| Source | segmented `path` / `paths` / `literal` (`SourceCell.tsx`); `path` and each `paths[j]` are text inputs with a `<datalist>` of the profile's paths; `literal` is a raw-JSON input | `…fields.x.path` / `.paths` / `.literal` |
| Transforms | `TransformsCell.tsx`: chips per transform with add (`plus`) / remove (`trash`) / reorder; a `<select>` over `trim/lower/upper/json_decode/enum_map`; short form `"trim"` and object form `{"trim":{}}` both readable and switchable; `enum_map` opens a key/value editor whose values are raw JSON, plus `unmapped: keep/null/reject` | `…fields.x.transforms[j]` |
| Options | `OptionsCell.tsx`: `type`, `timestamp_format`, `unit.from`/`unit.to`, `bounds`, `empty_as_missing`, `on_missing`, `default` (raw JSON, enabled only when `on_missing = "default"`), `on_invalid`. Every option has a "not set" choice that **removes** the member rather than writing a default | `…fields.x.<option>` |
| Why | the matching `FieldExplanation` (target, source path, confidence, why) from the last outcome, plus the ambiguity chips of §3.3 | — |
| Issues | the validation issues resolved to this row (§3.5), severity-coloured, each a button that focuses the offending control | — |

Rule-level controls in the rule header (`RuleHeader.tsx`): `id` (rename; when the id changes,
every `rules[k].parent` equal to the old id is offered to be updated in the **same edit batch**,
shown in the confirmation text — never silently), `entity` select, `select` path,
`parent` select over the other rules' ids plus "none", `native_key` as a token list where the
empty list is a distinct, explicit state ("declared empty" vs "not declared", per review [2]),
add rule (`plus`, appends a minimal `{"id":…, "entity":…, "fields":{}}`), delete rule (`trash`,
refuses with an explanation while another rule references it as `parent`).

`WhereEditor.tsx`: one row per condition — `path` input, `op` select
(`eq/ne/in/not_in/exists/not_exists`), and a **typed value**: a type select
(string / number / boolean / null / list) that decides how the raw lexeme is produced, so
`9007199254740993` is written as a number lexeme verbatim and `"9007199254740993"` as a string;
the value control is removed (not disabled) for `exists`/`not_exists`, and the existing member is
deleted from the document. `UnmappedEditor.tsx` (`path` + `reason` rows) and a `notes` textarea
complete the document surface.

A `ViewSwitch` (icon-only, `layers` = table, `braces` = JSON, both with names and tooltips) picks
Table or JSON; the JSON view is today's `DocumentEditor` unchanged. The issue list renders under
both views. The table is the default when the document parses, the JSON view is the default and
the table is disabled when it does not.

### 3.3 Ambiguities as executable suggestions

`web/src/assist/suggestions.ts` (pure):

```ts
export interface Suggestion { id: string; label: string; description: string; edits: DocEdit[] }
export interface TargetChoice { label: string; path: DocPath }   // when several rules match
export function resolveTarget(index: DocIndex, target: string): { path: DocPath } | { choices: TargetChoice[] } | null
export function suggestionsFor(a: Ambiguity, index: DocIndex, target: DocPath): Suggestion[]
```

Target resolution, in order, never guessing: an exact document path (`rules[0].fields.x`) → an
`entity.field` pair (`model_call.started_at`) resolved against the rules that declare that entity
**and** that field → a bare field name unique across all rules. One match is executable; several
matches render a rule picker and become executable once the user picks (review finding [5]);
zero matches renders the ambiguity as today's prose with a "insert into the message" action.

Option → edit is a **closed catalogue** with strict parsing; an option that does not match
exactly stays prose:

| Option text | Edit |
| --- | --- |
| `iso8601` \| `epoch_s` \| `epoch_ms` | `set …timestamp_format` |
| `string` \| `integer` \| `number` \| `boolean` \| `timestamp` | `set …type` |
| `ns` \| `us` \| `ms` \| `s` \| `min` (and `X→Y` / `X to Y` pairs) | `set …unit` to `{"from":…,"to":…}` (single unit sets `to` when `from` exists, else asks) |
| `min` \| `max` when the field's `path` contains `[*]` | `set …bounds` |
| `null` \| `default` \| `reject` | `set …on_missing` (`reject`/`null` also for `on_invalid` when the ambiguity's target names it) |
| `true` \| `false` | `set …empty_as_missing` |
| a path that exists in the profile (`$.a`) | `set …path` |

Every suggestion chip shows `describeEdits()` as its tooltip and its accessible name ("Set
timestamp_format to epoch_s on rules[1].fields.started_at"), applies only on click, goes through
`setDocumentText`, and therefore invalidates validation, save and preview. Suggestions are
derived from `state.lastOutcome` and are dropped as soon as the document version they were
computed against changes.

### 3.4 Malformed sections stay editable as text

`indexDocument` never throws. A rule that is not an object, a `fields` value that is not an
object, a `transforms` that is not a list: each becomes a `malformed` marker with the reason, the
row renders "Not editable here" plus a `braces` button that switches to the JSON view and jumps
to that line (existing `lineFor`). A document that does not parse renders the repair view only,
with the parser message and the offset. Nothing about a malformed section is ever rewritten.

### 3.5 Issue-path resolver

`web/src/assist/issuePaths.ts`:

```ts
export type Control =
  | { kind: 'field-option'; ruleIndex: number; field: string; option: string }
  | { kind: 'field-source'; ruleIndex: number; field: string }
  | { kind: 'transform'; ruleIndex: number; field: string; index: number }
  | { kind: 'condition'; ruleIndex: number; index: number; part: 'path' | 'op' | 'value' }
  | { kind: 'rule'; ruleIndex: number; part: 'id' | 'entity' | 'select' | 'parent' | 'native_key' | 'fields' }
  | { kind: 'unmapped'; index: number; part: 'path' | 'reason' }
  | { kind: 'head'; key: string }
  | { kind: 'document' }
export function resolveIssue(path: string): Control            // built on pathSegments()
export function controlId(control: Control): string            // 'ctl-r1-f-started_at-timestamp_format'
```

`controlId` is the DOM id of the rendered control; clicking an issue focuses it
(`document.getElementById(...)?.focus()`), scrolls it into view and marks the row. A control that
does not exist (a missing required field, a reordered rule, a stale validation — review [6])
falls back to the JSON view and `lineFor`, and the issue list says why. Issues are only shown as
row markers while `validation.documentVersion === documentVersion`, exactly as today.

### 3.6 Lossless numeric codec at the API boundary

Write side is already text-verbatim (`assistantBody`, `rawDocumentBody`); this issue closes the
read side and the silent fallback:

- `jsonText.ts`: generalise `extractMappingText` into
  `rawValueOf(rawJson: string, path: DocPath): string | null` (reuses `descend()`);
  `extractMappingText(raw)` becomes `rawValueOf(raw, ['proposal','mapping'])`.
- `api/index.ts`: `getMappingText(id): Promise<{ record: MappingDetail; documentText: string }>`
  — `fetch` + `response.text()` + `rawValueOf(raw, ['document'])` + `prettyJson`, used by the
  report entry point so a saved mapping is corrected from its exact bytes.
- `assistRuntime.ts`: when `extractMappingText` fails, the `JSON.stringify` fallback stays but
  now pushes a warning notice ("the response could not be read as text, so the browser re-encoded
  its numbers; check large integers and decimals before saving") instead of applying silently.
- Every table control that writes a value writes a raw lexeme; `applyEdits` refuses anything that
  is not one balanced JSON value.

The end-to-end proof required by the issue is a single test that starts from a **raw response
string** containing `9007199254740993`, `1.0` and `1`, walks it through
`outcomeArrived` → `indexDocument` → a table edit on a neighbouring cell → `saveMappingText`, and
asserts the captured request body still contains those three lexemes byte-for-byte (§5).

### 3.7 Entry from an Import report

No backend change (the alternative, a `GET /api/uploads?file_sha256=…` resolution route, is
rejected in §7). The report gets a re-upload flow with a SHA check, entirely in the browser:

- `ReportPage` (`web/src/pages/Imports.tsx`) gains one icon action per file row and one in the
  rejects panel head: `IconButton name="mappings"`, accessible name and tooltip "Correct this
  file's mapping with the assistant". It opens `ReuploadDialog`.
- `web/src/assist/ReuploadDialog.tsx`: a `<dialog>` naming the file, its full SHA-256 and its
  mapping revision, with a file input. On pick, it hashes the chosen file locally
  (`crypto.subtle.digest('SHA-256', …)`) **before uploading**, so a wrong file never leaves the
  machine; a mismatch shows both hashes in full and refuses. On match it calls `uploadFile()` and
  asserts the server's `sha256` equals the expected one as defence in depth (this also covers
  browsers without `crypto.subtle`, where the local hash is skipped and the check happens after
  the upload, stated in the dialog's text). It then navigates to
  `/import/assist/${upload.upload_id}` with router state
  `{ upload, origin: { importId, mappingId, sha256, filename } }`. No new route is added.
- `AssistPage` reads `origin` from the router state: it prefills the identity from the mapping
  record and the document text from `getMappingText(origin.mappingId)`, and shows a persistent
  notice: "This corrects the mapping used by import `imp_…`. That import's observations are
  unchanged; re-importing these bytes into source `x` inserts nothing (duplicates are decided by
  file bytes and source), so a correction applies to the next import of this file, under another
  source or from another file." Saving produces a new revision of the same name (the save route
  is idempotent by content hash), which the notice states.
- The upload dialog also reports the new upload's `already_imported[]` list, so the user sees the
  earlier attempts before doing anything.

### 3.8 Responsive collapse and the receipt part

- `web/src/useMediaQuery.ts`: `useMediaQuery(query: string): boolean`, guarded by
  `typeof window.matchMedia === 'function'` and defaulting to `false` (wide) so tests and older
  environments keep today's layout; a `matchMedia` stub is added to `web/src/test-setup.ts`.
- Below 1280 px the evidence rail renders as a real disclosure: a header button with
  `aria-expanded`/`aria-controls`, collapsed by default, whose label carries the exact summary
  ("Evidence: 30 of 30 records inspected, 12 paths"), so the collapsed state still states the
  numbers. Above 1280 px it is a plain always-open `<aside>` with no button. The field table's own
  wrapper keeps `overflow-x: auto`; the page never scrolls horizontally.
- The receipt stops being `.chat-msg-assistant > :nth-child(2)`. `Conversation.tsx` passes a
  custom text-part component to `MessagePrimitive.Parts components={{ Text }}`; the component
  reads the current message id from the library's message hook and looks the turn up in a
  `ReceiptContext` the `Conversation` provides, rendering `<p className="chat-receipt">` for the
  turn's `meta` and a normal paragraph otherwise. The exact hook name is confirmed against the
  installed `@assistant-ui/react` 0.15.18 types in step 1; the fallback, if the hook is not
  exported, is to compare the part text with the turn's `meta` string from the same context (no
  new dependency, no `any`, no positional CSS).

## 4. Files touched (exhaustive)

New (`web/src/assist/` unless stated):

- `document.ts` — spans, `DocEdit`, `applyEdits`, `describeEdits`.
- `documentIndex.ts` — `indexDocument` and the view types.
- `issuePaths.ts` — `resolveIssue`, `controlId`.
- `suggestions.ts` — `resolveTarget`, `suggestionsFor`.
- `targetFields.ts` — the target-name suggestion lists per entity (a datalist only; the server
  stays the authority) with a comment naming `backend/.../domain/schema.py` as the origin.
- `FieldTable.tsx`, `RuleHeader.tsx`, `FieldRow.tsx`, `SourceCell.tsx`, `TransformsCell.tsx`,
  `OptionsCell.tsx`, `WhereEditor.tsx`, `UnmappedEditor.tsx`, `Suggestions.tsx`, `ViewSwitch.tsx`,
  `ReuploadDialog.tsx`.
- `web/src/useMediaQuery.ts`.
- Tests: `document.test.ts`, `documentIndex.test.ts`, `issuePaths.test.ts`, `suggestions.test.ts`,
  `FieldTable.test.tsx`, `codec.test.ts`, `ReuploadDialog.test.tsx`,
  `web/e2e/assist-table.spec.ts`.

Changed:

- `web/src/assist/jsonText.ts` — extract `descend()`, add `rawValueOf`, `isOneJsonValue`; keep
  `extractMappingText` as a thin wrapper (its tests stay green).
- `web/src/assist/assistRuntime.ts` — a `documentIndex` is *not* stored in state (it is derived);
  add the fallback warning notice, an `applyEdits`-based `applyDocumentEdits(state, edits)`
  action that routes through `editDocument`, and `origin` on the state for the report entry.
- `web/src/assist/Conversation.tsx` — receipt part component and `ReceiptContext`.
- `web/src/assist/EvidenceRail.tsx` — disclosure below 1280 px.
- `web/src/assist/DocumentEditor.tsx` — issue list shared with the table view (issue rendering
  moves into a small `IssueList.tsx` used by both) and a "focus in table" action.
- `web/src/assist/assist.css` — table, chips, disclosure, `.chat-receipt`; drop the `nth-child`
  rule.
- `web/src/pages/Assist.tsx` — view switch, field table wiring, `origin` bootstrap, suggestions.
- `web/src/pages/Imports.tsx` — the two entry actions and the dialog mount (report page only;
  `/import` belongs to issue #45 and is untouched).
- `web/src/api/index.ts` — `getMappingText`.
- `web/src/test-setup.ts` — `matchMedia` stub.
- `web/src/assist/assistRuntime.test.ts`, `web/src/pages/Assist.test.tsx` — extended, not
  rewritten.
- `docs/superpowers/plans/2026-09-08-assistant-field-table.md` (this file).

Not touched: any `backend/**` file, `web/src/pages/Import.tsx`, `web/src/components/icons.tsx`,
`docs/api/v0.1.md` (no contract change).

## 5. Tests (named)

`web/src/assist/document.test.ts`

- `keeps every byte outside the spliced span` — a document with `9007199254740993`, `1.0`, `1e3`,
  a unicode-escaped key and trailing spaces; set one unrelated option; assert the rest is
  byte-identical and the three lexemes survive.
- `sets an absent member with the siblings' indentation`, `removes the last member and its comma`,
  `removes a middle member and its comma`, `renames a key without touching its value`,
  `inserts and removes array elements`, `applies a batch right to left`,
  `refuses a raw value that is not one balanced JSON value`,
  `returns a problem for a malformed document instead of throwing`.

`web/src/assist/documentIndex.test.ts`

- `indexes rules, fields, transforms in both forms, conditions, unmapped and notes`.
- `shows raw lexemes, not parsed numbers` (bounds `9007199254740993`, literal `1.0`).
- `marks a rule whose fields are not an object as malformed and indexes the others`.
- `distinguishes native_key absent from native_key: []`.
- `keeps unknown keys visible and untouched`.

`web/src/assist/issuePaths.test.ts` — the parser's real paths: `$`, `dsl_version`, `rules[0].id`,
`rules[0].fields`, `rules[0].fields.started_at.bounds`, `rules[0].fields.x.transforms[2]`,
`rules[0].where[1].value`, `rules[0].native_key[2]`, `unmapped[0].reason`; each maps to a control
and a stable `controlId`; an unknown path falls back to `{kind:'document'}`.

`web/src/assist/suggestions.test.ts`

- `resolves model_call.started_at to the only rule that emits it` (the fake's epoch document).
- `asks which rule when two rules emit the entity and the field`.
- `turns epoch_s into a timestamp_format edit and leaves "a validated swe-chat tag" as prose`.
- `never returns an edit for an option outside the catalogue`.
- `drops suggestions computed against an older document version`.

`web/src/assist/codec.test.ts` (the end-to-end numeric proof required by the issue) — a raw
`/assistant/run` response string containing `"literal": 1.0`, `"value": 9007199254740993` and
`"sequence": 1`; `outcomeArrived` applies it; a table edit sets `on_missing` on another field;
`saveMappingText` is called with a mocked `fetch`; the captured `body` string is asserted to
contain `1.0`, `9007199254740993` and `"sequence": 1` and to parse to one object; a second case
with a mapping that cannot be extracted asserts the warning notice appears.

`web/src/assist/FieldTable.test.tsx` — every control writes the expected document text
(`path`↔`paths`↔`literal` switch removes the other member; "not set" removes the option; a
transform added in object form; an `enum_map` value typed as raw JSON); renaming a rule id offers
the `parent` update in the same batch and says so; deleting a referenced rule is refused with a
reason; every icon-only control has an accessible name and a `data-tip`; the caption counts rows,
ambiguities and invalid rows; a malformed rule renders "Not editable here" with a jump.

`web/src/assist/ReuploadDialog.test.tsx` — a mismatching file is refused with both hashes and no
`POST /api/uploads` is issued (request log); a matching file uploads and navigates; a server hash
that disagrees with the local hash aborts.

`web/src/pages/Assist.test.tsx` (extended) — entering with `origin` prefills identity and the
document from `getMappingText` (raw text, large integer preserved) and shows the
"observations are unchanged" notice; the view switch keeps the text; an issue click focuses the
resolved control; the rail collapses under a stubbed 1279 px `matchMedia` and its button carries
the summary numbers.

`web/e2e/assist-table.spec.ts` (its own source `assist-table-e2e`, fake provider, epoch fixture,
serial like the existing spec) — upload → identity → propose → the ambiguity chip "Set
timestamp_format to epoch_s on rules[1].fields.started_at" → the table cell shows `epoch_s` and
the JSON view shows it on the expected line → validate → save → preview shows an ISO timestamp
→ import → the report shows the committed attempt → from the report, "Correct this file's
mapping" → a wrong file is refused → the right file passes and the assistant opens with the saved
document and the "unchanged observations" notice. Negative assertions: no `POST /api/mappings`
and no `POST /api/imports` before the explicit clicks; no `POST /api/uploads` on the refused file.

CI gates, all green before the PR: `pnpm --dir web lint`, `typecheck`, `test`, `build`,
`pnpm --dir web e2e`. No backend command is affected, but `uv --directory backend run pytest -q`
is run once to prove nothing moved.

## 6. Acceptance checks mapped to the issue's scope

1. **Field table bound to the DSL, rows as an indexed view, never a rebuild** — `document.test.ts`
   byte-identity test + `FieldTable.test.tsx` per-control writes; every option in the issue's list
   (`path`/`paths`/`literal`, `transforms` in both forms, `enum_map`, `timestamp_format`, `unit`,
   `bounds`, `type`, `empty_as_missing`, `on_missing`/`default`, `on_invalid`) has a named control
   in §3.2 and a case in the test; rules add/delete/rename with parent references and `where` with
   typed values are covered by the rule-header and `WhereEditor` cases; `unmapped` and `notes`
   have their own editors; malformed sections keep the JSON repair view
   (`documentIndex.test.ts`, `FieldTable.test.tsx`).
2. **Lossless numeric codec at the API boundary with tests from raw response text through the
   editor to the server** — `codec.test.ts` (raw string → editor → captured request body),
   `document.test.ts`, and the `getMappingText` case in `Assist.test.tsx`.
3. **Ambiguity options as executable suggestions with unambiguous targeting** —
   `suggestions.test.ts` (catalogue, prose fallback, rule picker) and the e2e chip step.
4. **Entry from an Import report with a SHA check, without replacing committed observations** —
   `ReuploadDialog.test.tsx`, the `origin` cases in `Assist.test.tsx`, the e2e round trip, and the
   notice quoting the bytes+source duplicate rule.
5. **Responsive collapse below 1280 px; per-message receipt styling via the library's hooks** —
   the `matchMedia` case in `Assist.test.tsx` and a `Conversation` case asserting the receipt is
   rendered by the part component with `class="chat-receipt"` (no positional CSS in
   `assist.css`).
6. **Issue-path resolver** — `issuePaths.test.ts` over the parser's real paths, plus the focus
   case in `Assist.test.tsx`.

## 7. Risks

- **Rejected alternative: an upload-resolution route.** A `GET /api/uploads?file_sha256=…` would
  be a smaller click path, but it touches `backend/.../interfaces/api/routers.py`,
  `schemas.py`, the ports and `docs/api/v0.1.md` — all owned by other wave-1 agents (#10, #33,
  #18) — and it would hand out an upload id for bytes the user has not presented in this session.
  The re-upload flow with a local hash check is browser-only, keeps the wrong file on the machine,
  and is explicitly allowed by the issue. Recorded here so the reviewer can overrule it.
- **`@assistant-ui/react` part hooks.** The receipt component depends on an API of 0.15.18 that
  this plan has not run (`node_modules` is not installed in this worktree). Step 1 of §8 confirms
  it against the installed types; the stated fallback needs no library API beyond
  `components={{ Text }}`. If neither works, the receipt becomes a sibling element outside
  `MessagePrimitive.Parts` and the CSS hack is still removed.
- **Splice correctness is the whole issue.** A wrong span silently corrupts a document. Mitigation:
  `document.ts` is pure and tested first (TDD), every edit path in the UI goes through
  `applyEdits`, and `applyEdits` re-tokenizes the result and refuses to return text that does not
  tokenize.
- **Table width at 1280 px.** Seven columns plus inputs is tight (review [11]). Mitigation: the
  rail collapses first, the Why and Issues columns collapse into a per-row disclosure below
  1280 px, and the table scrolls inside its own container.
- **Target-name drift** between `targetFields.ts` and `backend/.../domain/schema.py`. It is a
  suggestion list only; drift shows up as a server validation issue, never as a silent change. A
  cheap guard (a vitest reading the Python file and comparing names, skipped when the file is
  absent) is included if it does not slow the suite.
- **Conflict surface.** `web/src/pages/Imports.tsx` (report only) and `web/src/test-setup.ts` are
  the only files outside `web/src/assist/` and `web/src/api/index.ts` that this issue changes;
  #45 owns `web/src/pages/Import.tsx` and the `/import` route. No `App.tsx` change is needed.
- **E2E database sharing.** `web/playwright.config.ts` shares one database across specs; the new
  spec uses its own source (`assist-table-e2e`) and its own synthetic file so the smoke and
  existing assist specs keep their totals.

## 8. Cost estimate and order

1. Confirm the `@assistant-ui/react` part-hook API and stub `matchMedia`; receipt component and
   rail disclosure (0.3 day).
2. `document.ts` + `jsonText.ts` extraction, TDD (0.5 day).
3. `documentIndex.ts`, `issuePaths.ts`, `targetFields.ts`, tests (0.4 day).
4. `FieldTable` and its cells, `WhereEditor`, `RuleHeader`, `UnmappedEditor`, `ViewSwitch`,
   CSS (0.7 day).
5. `suggestions.ts` and the chips (0.3 day).
6. `getMappingText`, `ReuploadDialog`, report actions, `origin` bootstrap and the notice
   (0.4 day).
7. `codec.test.ts`, the extended page tests, the e2e spec, docs touch-ups (0.4 day).

About **3.0 engineer-days**, inside the 3-to-4-day remainder the Codex review left for this
follow-up. Steps 2 and 3 are the ones that must not be rushed: every later step writes through
them.
