# Plan: assistant field table, lossless numeric codec, report entry point (issue #39)

Revision 3. Revision 1 is commit `b2bc065`; revision 2 (`0bb38d6`) answered the first Codex
review `2026-09-08-assistant-field-table-review-codex.md` (BLOCK, 7 P1 · 7 P2 · 1 P3) in §2;
revision 3 answers the second-pass review `…-review-codex-2.md` (BLOCK; three P1s left open there,
three further findings) in §11 and in the sections those findings name. The owner has decided that
#39 stays in v0.1.0 with a go/no-go after step 1 (§10).

Follow-up to #15. The v0.1.0 slice shipped the assistant with a JSON editor
(`docs/superpowers/plans/2026-09-07-assistant-ui.md`, revision 2, §1); this issue is that plan's
"follow-up issue" paragraph and also answers the #15 review findings [2], [3], [5], [6], [8]
and [11].

## 1. Goal

The issue states no separate "expected verifiable result"; its **Scope** is the goal and is
quoted verbatim:

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

Owner constraints: the conversation keeps `@assistant-ui/react`; the Console design of record
(`research/design/claude/3-console/README.md:116`); icons over labels with an accessible name and
a visible tooltip on every icon-only control; "Unavailable" is a designed value; numbers that must
round-trip travel as text.

## 2. Revision 2: answers to the review, by finding

Every claim below was re-verified in this worktree before it was accepted. **All 15 findings are
accepted**; three carry a correction to the finding's own wording, marked *nuance*.

1. **[P1] Warning-only numeric fallback.** Accepted, verified: `assistRuntime.ts:263-267` applies
   `JSON.stringify(outcome.proposal.mapping, null, 2)` when `extractMappingText` returns null and
   then attaches `outcome.issues`/`executable` to that re-serialised text (`:267`), so Save is
   reachable for a document the server never saw. §3.6 now **removes every parsed-object
   fallback**: on extraction or grammar failure the document, its version, its undo entry and all
   gates are untouched, and the failure is a recoverable error with the raw text on hand.
2. **[P1] Grammar, decoded keys, duplicate keys, offset units.** Accepted, verified: the current
   tokenizer (`jsonText.ts:13-42`) has no number/escape grammar and no structural check, and
   `lineFor` compares raw token spelling with `JSON.stringify(segment)` (`:164`), so
   `{"\u0078": …}` is unreachable and duplicate keys split `JSON.parse` (last) from `lineFor`
   (first). §3.1 adds a real single-value grammar validator, decoded-key comparison with original
   spans, a duplicate-decoded-key repair policy, and states offsets as **UTF-16 code units**
   (`String.prototype.slice` semantics), not bytes.
3. **[P1] Right-to-left sorting is not an atomic multi-edit.** Accepted, verified by construction
   on `{"a":1,"b":2,"c":3}`: the member span of `b` and the member span of `c` both claim the
   comma between them. §3.1 replaces offset sorting with a **container-rendering batch planner**
   (innermost first, one splice per touched container, untouched members copied verbatim), a
   defined "one missing level" rule for creation, conflict detection, and a single commit through
   `editDocument`.
4. **[P1] The table cannot represent the full DSL.** Accepted, verified: `where.value` is `{}` in
   the schema (any JSON), the parser requires the entity's required fields
   (`parser.py:266-274`), and the identity inputs write only `state.identity`
   (`assistRuntime.ts:102-104`) while `buildRequest` refuses a `revise` whose document
   `name`/`source` differ (`:174-176`). §3.2 adds raw-JSON condition values, explicit field
   add/delete, a document-head row (`dsl_version`, `target_schema_version`, `input_format`,
   `name`, `source`) that keeps identity and document in sync in one edit, `default` always
   visible and removable, and a parent select built from the parser's real rule
   (`parser.py:304-333`: only a `tool_call` may declare a parent; it must be a `model_call` rule
   with `select` exactly `$`, declared earlier).
5. **[P1] The catalogue guesses the operation.** Accepted, verified: `Ambiguity` is
   `{target, options: string[], what_settles_it}` (`api/types.ts:168`), `min` is both a `unit`
   and a `bounds` value, `null` is a value of `on_missing`, `on_invalid` and a literal, and
   revision 1's `suggestionsFor(a, index, target)` had no profile argument at all. §3.3 replaces
   the guess with **domain matching plus a user operation choice**: an option is executable only
   when it is a legal value of exactly one applicable option; several candidates render a choice
   menu; anything else stays prose. Freshness is anchored to the document version created by the
   proposal's application (revision 1's `lastOutcome.generation` is stale the moment
   `editDocument` runs, `assistRuntime.ts:258-266`). Profile-path suggestions are cut (§7).
6. **[P1] Report bootstrap loses the import source.** Accepted, verified: `origin` in revision 1
   omitted `report.source`, and the page commits with `saved.record.source`
   (`Assist.tsx:164`), while the backend checks `find_committed(sha256, source)` with the
   *request's* source (`imports.py:375`) and never requires it to equal the mapping's source.
   §3.7 carries the file binding, the report source and the file's status in `origin`, keeps
   mapping identity and execution source distinct with an explicit import-source control, scopes
   the no-insert sentence to the committed bytes+source pair, treats `failed` and `duplicate`
   attempts separately, and replaces the rejects-panel default with a file picker.
7. **[P1] The new e2e spec would never run.** Accepted, verified: `playwright.config.ts:31-33`
   matches only `/smoke\.spec\.ts/` and `/assist\.spec\.ts/`; `assist-table.spec.ts` matches
   neither. §4 adds `web/playwright.config.ts` (a third project that depends on `assistant`, so
   the smoke totals are still measured first) and `web/e2e/assist.spec.ts` to the change list, a
   `playwright test --list` discovery check to §5, and removes the dependency on #45's upload
   selectors by creating the upload through `request.post('/api/uploads')` and navigating
   straight to `/import/assist/:uploadId`.
8. **[P2] The numeric promise overstated the server contract.** Accepted; the review's
   reproduction matches Python's JSON behaviour (`1e3` → `1000.0`, long decimals rounded to a
   double, `-0` → `0`, `"a"` → `"a"`). §3.6 states the guarantee precisely (raw response
   text → editor → outbound request bytes; whitespace changes once at pretty-print) and adds a
   real server-boundary test in `backend/tests/` for the issue's own cases.
9. **[P2] Unknown keys have nowhere to live.** Accepted, verified: `issues.unknown_keys`
   (`parser.py:90-93`) warns and keeps them, and `_parse_transform` accepts ignored parameters
   (`parser.py:664-668`). §3.1 adds `extras` to every indexed container and §3.2 forbids
   render-time cleanup and any form conversion that would drop a member (form conversion is cut
   to follow-up, §7).
10. **[P2] Report loading has no lifecycle and the revision sentence is false.** Accepted,
    verified: state is initialised once from `uploadId` (`Assist.tsx:67`), only the profile effect
    tracks the route (`:85-91`), and a save can return an existing revision
    (`mappings.py:21-32`). §3.7 defines an origin-keyed bootstrap transition with
    loading/error/stale handling, keeps the origin notice out of the `notices` array that
    `startPrepare` clears (`assistRuntime.ts:196`), and reports the actual returned revision and
    `created` flag after Save.
11. **[P2] Re-upload needs the compressed-byte domain and selection generations.** Accepted: the
    store hashes the bytes it receives (`uploads.py:48`, `RawFileStore.put(data)`), so the digest
    is over the file's own bytes, gzip container included. §3.7 names that domain in code and
    copy, adds one active selection with stale-result cancellation, a pre-read size check against
    the existing 25 MiB limit, and drops the "never leaves the machine" promise for the
    no-`crypto.subtle` path by disabling the entry there with an explanation.
12. **[P2] Accessibility specified only for the easy case.** Accepted. §3.2 and §3.5 add table
    semantics, contextual control names, a draft/commit policy for raw-JSON inputs (so `-`, `1e`
    and a lone `"` are typable), stable focus across renames, keyboard reorder with
    `chevronUp`/`chevronDown`, a pressed-state view switch, view-aware issue focus that mounts
    the control before focusing, collision-safe control ids, and a conservative fallback for
    ambiguous parser paths (*nuance*: the parser concatenates unescaped keys at
    `parser.py:92,257`, so a field literally named `a.b` is genuinely ambiguous and the resolver
    must fall back to the JSON view rather than guess). Layout claims move to a real browser at
    1279/1280/900 px; jsdom only covers the disclosure's semantics.
13. **[P2] The receipt fallbacks relax the criterion.** Accepted, and the uncertainty is now
    gone: the pinned install in the main checkout exposes `useAuiState`
    (`@assistant-ui/react@0.15.18/src/index.ts:8`) and `ThreadMessageLike.metadata.custom`
    (`@assistant-ui/core@0.3.17/src/runtime/utils/thread-message-like.ts:80-92`, surfaced as
    `ThreadAssistantMessage.metadata.custom` at `types/message.ts:459`). §3.8 therefore carries
    the receipt as message metadata and renders it from a custom `AssistantMessage` via
    `useAuiState`; the second text part, the text-equality comparison and both fallbacks are
    removed.
14. **[P2] Tests do not prove the claims; the estimate has no margin.** Accepted, including the
    correction that a numeric `bounds` fixture is invalid DSL (`bounds` is `min`/`max`,
    schema line 100) — revision 1 used exactly that fixture. §5 replaces substring assertions
    with path-addressed assertions, adds the batch/rename/move preservation cases, a negative
    catalogue case, and the corrected-same-source re-import case. §7 and §8 re-scope and
    re-estimate, and put the correctness gate plus one thin vertical slice before the specialised
    controls.
15. **[P3] Inventory drift.** Accepted, all four corrections verified: `IssueList.tsx` was missing
    from New; `chevronDown`/`chevronUp` exist (`components/icons.tsx:28-29`); the parser emits
    transform paths as `rules[i].fields.x.transforms[j]` (`parser.py:494`), not at rule level as
    revision 1's Current state claimed; §3.2 lists six columns where §7 said seven. §2 and §4 are
    corrected.

## 3. Design

### 3.1 The document text is the only source of truth

No rows→document rebuild exists anywhere in this issue. Every control produces an **edit plan**
that rewrites only the containers it touches, copying the raw text of every untouched member, and
the result goes through the existing `setDocumentText`/`editDocument`, so a table edit and a typed
edit are indistinguishable to the gates.

**`web/src/assist/jsonText.ts` (changed): a real grammar.**

```ts
export interface Lexeme { kind: 'punct' | 'string' | 'number' | 'literal'; text: string; start: number; end: number }
export function scan(text: string): { lexemes: Lexeme[] } | { problem: string; offset: number }
export function validateJsonText(text: string): { ok: true } | { problem: string; offset: number }
export function decodeJsonString(raw: string): string      // "x" -> x
export function isOneJsonValue(text: string): boolean       // exactly one value, JSON whitespace only around it
```

`scan` enforces JSON proper, not bracket depth: numbers `-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?`
(so `01`, `1.`, `+1`, `.5`, `Infinity`, `NaN` are rejected), literals exactly `true|false|null`,
strings with only the seven legal escapes plus `\uXXXX` and no raw control character below
`U+0020`, delimiters matched **by type**, `:` only between a key and its value, `,` only between
members, no trailing comma, exactly one top-level value, only JSON whitespace
(`space`, `\t`, `\n`, `\r`) elsewhere, and EOF after the value. The review's counter-examples
(`{"x":01}`, `{"x":true false}`, `{"x":1,}`, `{"x":1} trailing`, a comment, `"\q"`, `[1}}`) are
each a named test. **Offsets are UTF-16 code-unit indices** — the units of `String.prototype.slice`
and `String.length` — which is why the fixtures include `{"é😀":0,…}`.

**`web/src/assist/document.ts` (new, pure).**

```ts
export type DocPath = (string | number)[]
export interface Span { start: number; end: number }        // UTF-16 code units

export function scanDocument(text: string): DocTree | { problem: string; offset: number }
export function valueSpanAt(tree: DocTree, path: DocPath): Span | null
export function rawAt(tree: DocTree, path: DocPath): string | null
export function keysAt(tree: DocTree, path: DocPath): { decoded: string; raw: string; span: Span }[] | null

export type DocEdit =
  | { op: 'set';    path: DocPath; raw: string }   // replace, or create the single missing leaf member
  | { op: 'remove'; path: DocPath }
  | { op: 'rename'; path: DocPath; key: string }
  | { op: 'insert'; path: DocPath; index: number; raw: string }
  | { op: 'move';   path: DocPath; index: number } // array reorder; the moved value's raw text is reused
export function planEdits(text: string, edits: DocEdit[]): { text: string } | { problem: string }
export function describeEdits(edits: DocEdit[]): string
```

`scanDocument` builds a tree of **spans** over the lexemes: for each object, its members with
decoded key, key span, value span and member span; for each array, its element spans. Keys are
matched **decoded** (`decodeJsonString`), so `{"\u0078": 1}` is addressable as `x`, and the
original spelling is preserved because only spans are ever spliced.

**Duplicate decoded keys** in any object make that object *unaddressable*: `scanDocument` records
it in `duplicates[]`, every accessor below it returns `null`, and the UI sends that section (or,
for the root, the whole document) to the repair view with the message "two members named `x`; JSON
keeps the last one — remove one to edit this section here". Nothing is auto-selected and nothing
is auto-removed. `rename` refuses a key that collides with an existing decoded key in the same
object.

**`planEdits` is structural, not offset arithmetic** (finding 3):

1. All paths address the **input snapshot**; the plan is computed once against it.
2. Edits are grouped by the container that owns them. Conflicts abort the whole plan with a
   problem: two operations on one path; **any edit strictly beneath a whole-value operation**
   (`set`, `remove`, `insert`, `move`) on an ancestor, because the ancestor's value would silently
   discard it — `set unit = {"from":"us","to":"ms"}` together with `set unit.from = "min"` is a
   conflict, not a merge; an insert or move index out of range; two array operations claiming one
   destination index. A `rename` is a key-level operation on the parent's member list and
   therefore does **not** conflict with edits beneath it: the child renders first and the renamed
   key carries the child-edited text.
2b. **Final-key check.** For every touched object the planner computes the decoded keys of its
   final member list (after removes, renames and created members) and aborts on any duplicate, so
   a batch can never introduce the duplicate-key state §3.1 sends to repair — this covers renaming
   both `a` and `b` to an absent `c`, which no input-key check would catch.
2c. **Array semantics.** `insert` and `move` indices address the **input snapshot's** order. The
   final order is: remove removed elements, then place each moved element at its destination index
   in the post-removal order (in the order the moves appear in the batch), then apply insertions at
   their indices in the post-move order. Two operations claiming one destination index abort. A
   moved element carries its own raw text, including any child edit applied to it.
3. Containers are rendered **innermost first**. Rendering a container emits one replacement string
   for its span from its member list after removes → renames → sets → inserts/moves, reusing the
   original raw text of every untouched member and of every moved value (never a re-serialisation
   of a parsed structure). Separators are produced by the renderer, so the "who owns the comma"
   problem of adjacent removals cannot arise, and two insertions into `{}` are simply two members
   of the rendered list. Indentation is taken from the container's existing members, or from its
   depth when it is empty.
4. `set` creates **at most one missing level**: `set …unit.from` on an absent `unit` is a problem;
   the caller expresses it as one composite `set …unit = {"from":"s","to":"ms"}`. This rule is why
   the UI never needs multi-level creation planning.
5. The rendered document is re-validated with `validateJsonText`; a failure returns a problem and
   **nothing is applied**.
6. The page applies a plan through one `applyDocumentEdits(state, edits)` action: one version
   bump, one undo entry, gates invalidated once; on a problem, text, version, undo and gates are
   untouched and the reason is shown.

`raw` is always raw JSON *text* (`"epoch_s"`, `1.0`, `9007199254740993`, `{"from":"s","to":"ms"}`)
and must satisfy `isOneJsonValue`.

**`web/src/assist/documentIndex.ts` (new): the indexed read view.**

```ts
export interface Member { path: DocPath; raw: string | null }            // raw === null: absent
export interface FieldView {
  name: string; path: DocPath
  source: { present: ('path' | 'paths' | 'literal')[]; raw: Record<string, string | null> } // several present = conflict, shown as such
  transforms: { index: number; form: 'short' | 'object'; name: string | null; raw: string }[]
  options: Record<FieldOption, Member>                                    // type, timestamp_format, unit, bounds,
                                                                          // empty_as_missing, on_missing, default, on_invalid
  extras: Member[]                                                        // unknown keys, kept and shown
  malformed: string | null
}
export interface RuleView { index: number; path: DocPath; id: Member; entity: Member; select: Member
  where: ConditionView[]; parent: Member; nativeKey: { present: boolean; items: Member[] }
  fields: FieldView[]; extras: Member[]; malformed: string | null }
export interface DocIndex { ok: boolean; problem: string | null; duplicates: DocPath[]
  head: Record<'dsl_version' | 'target_schema_version' | 'name' | 'source' | 'input_format', Member>
  rules: RuleView[]; unmapped: UnmappedView[]; notes: Member; extras: Member[]
  malformed: { path: DocPath; reason: string }[] }
export function indexDocument(text: string): DocIndex
```

Structure comes from the span tree (not `JSON.parse`), so nothing is normalised on the way in;
every displayed value is `rawAt(...)`, so `9007199254740993` and `1.0` are shown as written.
`extras` holds every member the DSL does not name, at document, rule, field, condition, unit and
transform-parameter level, each with a JSON-view jump. **Absent, `null`, `false` and empty are four
different states** and each renders differently (`native_key` absent vs `[]` is the canonical
case). Nothing is ever rewritten at render time.

### 3.2 The field table

`FieldTable.tsx` renders `DocIndex` as one `<section>` per rule containing a `<table class="data">`
with a `<caption>` in the Console voice ("12 fields · 1 ambiguity · 2 invalid rows") and
`<th scope="col">` headers. Columns: **Target**, **Source**, **Transforms**, **Options**, **Why**,
**Issues** (six; §7's earlier "seven" was wrong).

- **Target** — a text input (`aria-label="Target field of rule model_call"`); free text, the server
  is the authority. Renaming commits on blur or Enter, never per keystroke, so the focused input is
  not remounted; a collision with an existing field name is refused with the reason.
- **Source** — `path` / `paths` / `literal`. Switching kind is one plan that sets the new member and
  removes the others, so the parser's ambiguous-source error cannot be produced by the switch; when
  several are already present the cell shows a **conflict marker** listing them and offers "keep
  only X" as an explicit choice. `path` and each `paths[j]` are text inputs; `literal` is a
  raw-JSON input. `paths` supports add / remove / reorder (`chevronUp`/`chevronDown`, each with a
  name and tooltip).
- **Transforms** — a list of entries, each edited as **raw JSON** (`"trim"` and `{"trim":{}}` are
  both shown as written and neither is converted), with add / remove / reorder. `enum_map` gets a
  dedicated editor (mapping entries with raw-JSON values, `unmapped: keep|null|reject`) that edits
  the smallest path (`…transforms[j].enum_map.mapping.<key>`), so unknown parameters elsewhere in
  the entry are untouched. No form conversion exists in this slice (§7).
- **Options** — one control per DSL option, each with an explicit "not set" that **removes** the
  member: `type`, `timestamp_format`, `unit.from`/`unit.to` (created together as one composite
  `set`), `bounds` (`min`/`max`), `empty_as_missing`, `on_missing`, `default`, `on_invalid`.
  `default` is always visible and removable; when `on_missing` is not `default` a chip says it is
  ignored — the editor is never disabled, so a repair is always possible.
- **Why** — the matching `FieldExplanation`, shown only while the proposal anchor of §3.3 is
  current and only when its target resolves to exactly one field; otherwise it stays in the
  conversation as today.
- **Issues** — the resolved validation issues for this row (§3.5), each a button that focuses the
  offending control.

Rule header (`RuleHeader.tsx`): `id` (rename; a rename that would break a `parent` reference is
**refused** with the list of referring rules and a link to each — no silent cascade, §7), `entity`,
`select`, `parent` (a select over the parser's valid choices — earlier root `model_call` rules,
`parser.py:304-333` — plus "none"; an existing invalid value stays selected and is labelled
"invalid, kept"), `native_key` as a token list where "not declared" and "declared empty" are
separate states, **add field** (name + source kind, so a new rule reaches a legal shape), **delete
field**, add rule, delete rule (refused while referenced, with the reason).

Document head row: `dsl_version`, `target_schema_version`, `input_format` (a select; a value that
differs from the upload's sniffed format is flagged, because the import refuses that combination),
`name` and `source`. **These are the identity inputs**: editing them writes `state.identity` and,
in the same plan, the document's `name`/`source` when a document exists and is addressable. When
the document is malformed the fields still edit the identity and a notice says the two are out of
sync and why `revise` is blocked (`assistRuntime.ts:174-176`).

**Identity and undo move together** (second-pass finding 9). The runtime's undo today stores text
only (`assistRuntime.ts:53,89-117`), so an identity rename followed by Undo would restore the old
document beside the new identity and break the next `revise`. `undo` therefore becomes
`{ documentText: string; identity: { name: string; source: string } } | null` and `undoDocument`
restores both. The same rule governs every accepted document replacement: applying a proposal, a
report bootstrap load, and a JSON-view edit of `name`/`source` all set `state.identity` from the
document's head when it is addressable, in the same state transition. While the document is
malformed the user's identity is kept as they typed it and nothing is inferred; when the JSON is
repaired the head's values win and the notice clears. No second, hidden identity repair is ever
required of the user.

`WhereEditor.tsx`: `path`, `op` (`eq/ne/in/not_in/exists/not_exists`) and a value editor that is
**raw JSON by default** — objects, nested lists and large integers are all first-class — with a
convenience type picker (string / number / boolean / null) that only writes the corresponding
lexeme. For `exists`/`not_exists` the `value` member is removed, not disabled.
`UnmappedEditor.tsx` (`path`, `reason`) and a `notes` textarea complete the surface.

Raw-JSON inputs use a **draft/commit** policy: keystrokes edit local draft state, so `-`, `1e` and
a lone `"` are typable; the document is written on blur or Enter when `isOneJsonValue` holds; an
invalid draft shows `aria-invalid` with `aria-describedby` and Escape cancels back to the document
value.

`ViewSwitch.tsx` is a grouped pair of icon buttons with `aria-pressed` (`layers` = Table,
`braces` = JSON). Table is the default when the document is addressable; the JSON view is the
default (and Table is disabled with the reason) when it is not. Issues render under both views.

### 3.3 Ambiguity options as executable suggestions

```ts
export interface Suggestion { id: string; label: string; description: string; edits: DocEdit[] }
export function resolveTarget(index: DocIndex, target: string):
  { path: DocPath } | { choices: { label: string; path: DocPath }[] } | null
export function suggestionsFor(a: Ambiguity, index: DocIndex, field: DocPath):
  { ready: Suggestion[] } | { operationChoice: Suggestion[][] } | { prose: string }
```

**Targeting.** A target is normalised into an optional **option** and a **field**: a path ending in
a DSL option name (`rules[0].fields.x.on_invalid`) keeps that option and resolves the field from
the prefix; otherwise it is a field target — an exact field path, then an `entity.field` pair
resolved against the rules that declare that entity *and* that field, then a bare field name
unique across rules. Several matching rules render a rule picker; no match stays prose.

**Operation is never inferred from an option string** (second-pass finding 5):

- **Target names the option** → the value is matched against *that* option's domain only. One
  match is an executable chip; no match is prose.
- **Target names only a field** → the user must pick a **named operation**, always, even when only
  one option's domain contains the value. The menu lists each candidate operation with its
  `describeEdits()` text; nothing is applied until the user picks. This is why `true`,
  `reject`, `null` and `min` cannot be auto-applied: the plan no longer has a rule that would.

Domains in this slice: `timestamp_format` `{iso8601, epoch_s, epoch_ms}`, `type`
`{string, integer, number, boolean, timestamp}`, `on_missing` `{null, default, reject}`,
`on_invalid` `{null, reject}`, `empty_as_missing` `{true, false}`, `bounds` `{min, max}`. `unit`
needs an ordered pair and is offered **only** from an explicit pair (`s→ms`, `s to ms`), so a bare
`min` never produces a unit edit; free-text unit parsing and profile-path suggestions are cut (§7).

**Semantic applicability is the parser's, not ours.** The browser has no target schema, and the
parser's rules are real: `type` must equal the target field's type (`parser.py:498-505`), `bounds`
requires a timestamp target *and* a `path` containing `[*]` (`:439-473`), `unit.to` must be the
target's canonical unit and the target must have a convertible one (`:527-556`),
`timestamp_format` on a non-timestamp is a warning, not an error (`:507-522`). A suggestion
therefore never claims applicability: the menu shows what the document can already contradict (a
`bounds` entry on a `path` without `[*]` is labelled "the parser will reject this: bounds needs a
path containing `[*]`") and the server's validation remains the authority after the edit.
An `on_missing: default` operation additionally requires a `default`; the menu entry writes both
members or is not offered.

**Freshness**: applying a proposal records `proposalAnchor = { documentVersion }` — the version
`editDocument` creates, not the pre-application generation. Chips and Why render only while
`documentVersion === proposalAnchor.documentVersion`; after any edit they are shown as "from an
earlier draft" prose and cannot be applied. A stale click is impossible, not merely unlikely.

### 3.4 Malformed and unaddressable sections

`indexDocument` never throws. A rule that is not an object, a `fields` value that is not an object,
a `transforms` that is not a list, an object with duplicate decoded keys: each becomes a marker
with its reason and a `braces` button that switches to the JSON view and jumps to the line. A
document that does not pass `validateJsonText` renders the repair view only, with the message and
the offset. Nothing in a malformed or unaddressable section is ever rewritten.

### 3.5 Issue-path resolver

`issuePaths.ts` maps the parser's real paths — `$`, `dsl_version`, `rules[0].id`,
`rules[0].fields`, `rules[0].fields.started_at.bounds`, `rules[0].fields.x.transforms[2]`
(field-level, `parser.py:494`), `rules[0].where[1].value`, `rules[0].native_key[2]`,
`unmapped[0].reason` — to a `Control` union and a collision-safe `controlId` (each segment
percent-encoded, so a field named `a.b` cannot collide with a nested path). Because the parser
concatenates unescaped keys (`parser.py:92,257`), a path that could denote either a dotted field
name or a nested path is **ambiguous by construction**: the resolver returns `{kind:'document'}`
and the issue opens the JSON view instead of focusing a possibly wrong control.

Focusing is view-aware: switch to the view that owns the control, open its rule section and any
row disclosure, wait for the control to mount (a layout effect keyed on a pending focus request),
then focus and scroll it into view. An issue with no control (`rules[0].fields` for
`required_field_unmapped`, a missing member) focuses the nearest existing parent — the rule's Add
field control — and, in the JSON view, falls back to the nearest existing parent's line or the
document start. Row markers only show while `validation.documentVersion === documentVersion`.

### 3.6 The lossless numeric codec at the API boundary

**The guarantee, stated exactly.** Every number and string lexeme in a raw HTTP *response* that
the user does not edit is preserved character-for-character from that response through the editor
into the outbound *request* bytes; the only transformation is the single pretty-print, which
changes whitespace only. It is **not** claimed that a document survives a server round trip
unchanged: the server parses with Python, so `1e3` comes back as `1000.0`, `-0` as `0`,
`"a"` as `"a"`, and a decimal beyond double precision is rounded. The issue's two cases —
large integers and `1.0` vs `1` — do survive, and a backend contract change to promise more is out
of scope for #39 and would need its own issue and estimate.

Changes:

- `rawValueOf(rawJson, path)` generalises `extractMappingText` over the span tree;
  `extractMappingText(raw)` becomes `rawValueOf(raw, ['proposal','mapping'])` and now also matches
  **escaped envelope keys** (`{"\u0070roposal": …}`), which today's raw comparison misses.
- `api/index.ts`: `getMappingText(id)` reads `response.text()` and takes `['document']` from it.
- **No parsed-object fallback anywhere** (finding 1). If extraction returns null, or the extracted
  text fails `validateJsonText`, or it is not an object: the document, `documentVersion`, `undo`,
  `validation`, `saved` and `preview` are untouched, no outcome validation is attached, and the
  assistant turn carries a recoverable error ("the response could not be read as text; the
  document was left unchanged") with a disclosure showing `diagnostics.raw_text` so the user can
  copy it. The same rule governs `getMappingText` failures at bootstrap (§3.7).
- Every table control writes raw lexemes through `planEdits`, which refuses anything that is not
  one JSON value.

### 3.7 Entry from an Import report

No new backend route (the alternative is rejected in §9). The browser re-uploads the bytes with a
SHA check.

**Origin.** `origin = { importId, importSource, importStatus, fileSha256, filename, fileStatus,
fileDuplicateOf: string | null, mappingId | null, mappingName | null, mappingRevision | null }` —
the *file's* binding and the *file's* status, never the report-level mapping echo, which is only
the first file's display value (`docs/api/v0.1.md:181-218`, `ImportedFile.mapping` is nullable).
`fileDuplicateOf` comes from `ImportedFile.duplicate_of` (`api/types.ts:20`, already used at
`Imports.tsx:76-79`) and carries the link to the original import. In a mixed batch every sentence
below is chosen by the **selected file's** status, not the attempt's.

**Entry points.** One `IconButton` per row of the report's files table ("Correct this file's
mapping with the assistant") and one in the rejects panel head; when the rejects panel's file
filter is "All files" and the report has several files, the action opens a **file picker** listing
them — it never assumes the first file.

**Re-upload dialog** (`ReuploadDialog.tsx`): names the file, its full SHA-256 and the file's
mapping revision, and asks for the same file. The digest is taken over **the file's own bytes as
they are on disk** — for a `.jsonl.gz` that is the compressed bytes, because the store hashes what
it receives (`uploads.py:48`); the dialog's copy says so, and nothing is decompressed, decoded or
re-encoded before hashing. A size over the 25 MiB limit is refused before reading. One selection is
active at a time: a new pick or a close cancels the previous hash/upload and its result is
discarded (a generation counter, like the runtime's). On a hash match the file is uploaded and the
server's `sha256` is compared again; a mismatch at either step shows both digests in full and
refuses. Where `crypto.subtle` is unavailable (an insecure context) the entry is **disabled** with
the reason, rather than uploading first — the promise "the wrong file never leaves the machine"
must hold unconditionally. The dialog also lists the new upload's `already_imported` entries.

**Bootstrap.** Navigating carries `origin` in router state. `AssistPage` runs an origin-keyed
transition: `bootstrap: 'idle' | 'loading' | 'ready' | 'failed'`; while loading, the document
editor, the table and every gate are disabled and a live region says what is loading; the result is
applied atomically (identity + document text + gates invalidated) and only when the origin and
upload id still match — a late or superseded response is discarded, and a manual edit made
meanwhile wins (the load is then offered as "load the saved mapping anyway", never silently
applied). A failed or missing mapping binding is honest ("that file's mapping binding is
unavailable; start from a proposal instead") with retry. The document text comes from
`getMappingText(origin.mappingId)` — the exact per-file revision, never the newest by name.

**Source, said honestly.** Mapping identity (`document.name` / `document.source`) and the import's
execution source are different things; the backend takes them independently
(`imports.py:375` uses the request's source). With an `origin`, the page shows an explicit **import
source** control defaulting to `origin.importSource`, and the commit uses it (today the page
silently uses `saved.record.source`, `Assist.tsx:164`); changing it away from the report's source
requires an explicit choice and the confirmation names it. The notice is scoped to what is true:

- `committed`: "These bytes are committed in import `imp_…` under source `A`. Re-importing them
  into `A` inserts nothing (duplicates are decided by file bytes and source), and that import's
  observations do not change. A corrected revision applies to the next import of this file — under
  a different source, or of a different file."
- `duplicate`: names the original import and says the same about it.
- `failed`: "That attempt inserted nothing. Importing these bytes into `A` now is checked against
  what is committed in `A` today, so it may still be recorded as a duplicate — a failed attempt
  says what it wrote, not whether the bytes are absent." (The attempt that lost a concurrent race
  is recorded as `failed` for every file even though another import committed some of those bytes,
  `imports.py:328-344`; a later successful import of the same bytes has the same effect on an
  older failed report reopened afterwards.)

Re-importing under a different source to "fix" history is never suggested. After Save, the receipt
states the actual outcome from the response (`created: true` → "saved as revision N", `false` →
"identical to the existing revision N, nothing new was written"), because a save is idempotent by
content hash (`mappings.py:21-32`).

### 3.8 Responsive collapse and the receipt

- `useMediaQuery(query)` guarded by `typeof window.matchMedia === 'function'`, defaulting to the
  wide layout; `web/src/test-setup.ts` gains a stub. Below 1280 px the evidence rail is a real
  disclosure (`aria-expanded` / `aria-controls`, collapsed by default) whose button label carries
  the exact summary ("Evidence: 30 of 30 records inspected, 12 paths"), so the numbers are legible
  while collapsed; at 1280 px and above it is a plain `<aside>` with no button. The table scrolls
  inside its own `overflow-x: auto` container; the page never scrolls horizontally. The layout
  claim is verified in a real browser at 1279, 1280 and 900 px, in both themes; jsdom only asserts
  the disclosure's semantics.
- The receipt travels as **message metadata**, not a second text part:
  `convertMessage` sets `metadata: { custom: { receipt } }`
  (`ThreadMessageLike.metadata.custom`, verified in the pinned
  `@assistant-ui/core@0.3.17/src/runtime/utils/thread-message-like.ts:80-92`), and a custom
  `AssistantMessage` reads it with
  `useAuiState(s => s.message.metadata.custom.receipt as string | undefined)` (`useAuiState` is
  exported from `@assistant-ui/react@0.15.18/src/index.ts:8`) and renders one
  `<p className="chat-receipt">` after `MessagePrimitive.Parts`. The text-equality fallback, the
  duplicate text part and the `nth-child` CSS rule are all removed. The exact selector is
  typechecked against the pinned install in step 1 of §10.

## 4. Files touched (exhaustive)

New, in `web/src/assist/` unless stated: `document.ts`, `documentIndex.ts`, `issuePaths.ts`,
`suggestions.ts`, `FieldTable.tsx`, `RuleHeader.tsx`, `FieldRow.tsx`, `SourceCell.tsx`,
`TransformsCell.tsx`, `OptionsCell.tsx`, `WhereEditor.tsx`, `UnmappedEditor.tsx`, `RawJsonInput.tsx`
(the draft/commit input), `Suggestions.tsx`, `ViewSwitch.tsx`, `IssueList.tsx`,
`ReuploadDialog.tsx`; `web/src/useMediaQuery.ts`.

New tests: `jsonText.grammar.test.ts`, `document.test.ts`, `documentIndex.test.ts`,
`issuePaths.test.ts`, `suggestions.test.ts`, `FieldTable.test.tsx`, `RawJsonInput.test.tsx`,
`codec.test.ts`, `Conversation.test.tsx`, `ReuploadDialog.test.tsx`,
`web/e2e/assist-table.spec.ts`, `backend/tests/interfaces/test_api_mapping_numerics.py`.

Changed: `web/src/assist/jsonText.ts` (grammar, decode, `rawValueOf`; `extractMappingText` becomes
a wrapper and keeps its tests), `assistRuntime.ts` (no parsed fallback, `applyDocumentEdits`,
`proposalAnchor`, `origin`, `bootstrap`, an `importSource`), `Conversation.tsx` (metadata receipt),
`EvidenceRail.tsx` (disclosure), `DocumentEditor.tsx` (issue rendering moves to `IssueList.tsx`,
plus a "focus in table" action — §3.2's "the JSON view is today's editor" is therefore *this*
change, not "unchanged"), `assist.css`, `web/src/pages/Assist.tsx`, `web/src/pages/Imports.tsx`
(report page only), `web/src/api/index.ts`, `web/src/test-setup.ts`, `web/playwright.config.ts`
(third project, `dependencies: ['assistant']`), `web/e2e/assist.spec.ts` and
`web/src/pages/Assist.test.tsx` (select the JSON view explicitly where they assert on the
textarea), `web/src/assist/assistRuntime.test.ts`, and this plan.

Not touched: `web/src/pages/Import.tsx` and the `/import` route (issue #45),
`web/src/components/icons.tsx` (`chevronUp`/`chevronDown` already exist),
`backend/src/**`, `docs/api/v0.1.md` (no contract change). Shared-file coordination: `Imports.tsx`
report surfaces are also touched by #33's diagnostics notice and #10's report/history work —
the two entry actions are additive and are the last commit in the branch so a rebase is cheap.

## 5. Tests (named)

**Grammar** (`jsonText.grammar.test.ts`): rejects `{"x":01}`, `{"x":1.}`, `{"x":+1}`, `{"x":.5}`,
`{"x":true false}`, `{"x":1,}`, `{"x":1} trailing`, `{"x":/*c*/1}`, `"\q"`, a raw newline inside a
string, `[1}}`; accepts CRLF, tabs, compact text, `{}`/`[]`, trailing whitespace, `1e3`, `-0`,
`\uXXXX` escapes; `decodeJsonString` round-trips escaped keys; offsets are code units
(`{"é😀":0,"b":1}` fixture).

**Spans and batches** (`document.test.ts`): byte-identical preservation of an untouched document
around every edit kind; adjacent removals (`{"a":1,"b":2,"c":3}` removing `b` and `c` in one plan);
removing every member; two insertions into `{}`; `set` on a one-level-missing member; `set` two
levels missing → problem; composite `unit` creation; rename + child edit in one plan; rename
collision refused; repeated edits of one path refused; array `move` reusing the moved value's raw
text; a plan whose result would be invalid leaves the input untouched; duplicate decoded keys make
the container unaddressable; non-ASCII before an edited span; escaped-key edits (editing `"\u0078"`
itself, not only a neighbour).

**Index** (`documentIndex.test.ts`): all four states (absent / `null` / `false` / empty) for
`native_key`, `default`, `empty_as_missing`; both transform forms preserved verbatim; unknown keys
surfaced as `extras` at document, rule, field, condition, unit and transform-parameter level; a
malformed rule marked without touching its siblings; raw lexemes (`9007199254740993`,
`1.0`) shown as written — the numeric fixture uses a **valid** location (a `literal`, a `where`
value), never `bounds`, which is `min`/`max`.

**Issue paths** (`issuePaths.test.ts`): every parser path listed in §3.5 maps to a control and a
stable id; a field named `a.b` resolves to `{kind:'document'}`; ids are collision-safe.

**Suggestions** (`suggestions.test.ts`): a target naming the option
(`rules[0].fields.started_at.timestamp_format`) with `epoch_s` → one executable chip; the same
value with a **field-only** target → an operation menu, and nothing is applied until a pick;
`reject` → a menu of `on_missing` and `on_invalid`, never auto-applied to either (both are legal,
schema lines 97-99); `true` → a menu with `empty_as_missing`, still an explicit pick; `min` → a
menu with `bounds` only, labelled with the parser's wildcard requirement when the field's `path`
has no `[*]`, and never a `unit` edit; an explicit `s→ms` pair → a `unit` chip;
`"a validated swe-chat tag"` → prose; two rules emitting the entity → a rule picker; a click after
an edit is refused because the anchor moved; `on_missing: default` without a `default` is not
offered.

**Codec** (`codec.test.ts`). Positive cases, each asserted through to the captured request body:
a run response whose envelope key is escaped (`{"\u0070roposal":{"mapping":{…}}}`) extracts and
applies normally; a mapping containing `{"fields":{"\u0078":{"literal":9007199254740993}}}` is
indexed under the decoded name `x`, and **editing that escaped field itself** preserves both its
original key spelling and the integer; `1.0`, `9007199254740993` and `1` survive `outcomeArrived`
→ a table edit elsewhere → `saveMappingText`, asserted by locating each value's span **at its
path** (never by substring, which cannot tell a right value at a wrong path from a duplicated
member). Negative cases — a missing `mapping` member, a `mapping` that is not an object, a
`mapping` that fails the grammar, and duplicate envelope keys — each leave the document, its
version, its undo entry and every gate exactly as they were, attach no outcome validation, keep an
earlier validated or saved state intact, and surface a recoverable error.
Transport coverage is named per helper, not left to one mocked fetch: `getMappingText` (GET
`/api/mappings/{id}`, `api/index.ts:54`), `prepareContext` and `runAssistant` (`:77-100`) and
`validateMappingText`/`saveMappingText` (`:114-121`).

**Server boundary** (`backend/tests/interfaces/test_api_mapping_numerics.py`): `POST /api/mappings`
then `GET /api/mappings/{id}` with `9007199254740993` in a `where` value and `1.0` vs `1` literals
at valid DSL locations; asserts the values at their paths, and documents `1e3 → 1000.0` as the
known, stated limit rather than a bug.

**Table** (`FieldTable.test.tsx`): each control writes the expected text; the source switch removes
the other members in one plan; a conflicting source shows the marker; "not set" removes; a new rule
reaches a legal shape through Add field; a rename that would break a `parent` is refused with the
referring rules; `default` stays editable when `on_missing` is not `default`; the parent select
offers only earlier root `model_call` rules and keeps an invalid value labelled; a raw-JSON input
accepts `-`, `1e` and a lone `"` as drafts and commits on blur; renaming does not remount the
focused input; every icon-only control has a name and a tooltip; table semantics
(`caption`, `th scope`) are present.

**Conversation** (`Conversation.tsx`): the receipt comes from message metadata — several turns, two
turns with identical receipts, a reply whose text equals its receipt, a refusal and a pending state
each render exactly one receipt, with no positional CSS.

**Page** (`Assist.test.tsx`, extended): bootstrap loading disables the gates; a late load after a
manual edit does not overwrite it; a failed load offers retry; the origin notice survives a send
(it is not in `notices`); the import source defaults to the report's source and the confirmation
names it; issue focus switches views and focuses the control; the rail disclosure's semantics
under a stubbed 1279 px.

**Re-upload** (`ReuploadDialog.test.tsx`): a mismatching file is refused with both digests and no
`POST /api/uploads`; two gzip files with the same payload but different gzip headers are correctly
refused as different bytes; a replaced selection while hashing discards the first result; a server
digest disagreeing with the local one aborts; no `crypto.subtle` disables the entry with the
reason; an oversize file is refused before reading.

**End to end** (`web/e2e/assist-table.spec.ts`, its own source `assist-table-e2e`, its own project
depending on `assistant`): the upload is created with `request.post('/api/uploads')` and the test
navigates straight to `/import/assist/:uploadId`, so it does not depend on the import page's
selectors (#45). Propose → an ambiguity chip sets `timestamp_format` → a table edit sets
`on_missing` → validate → save → preview → import → open the report → "Correct this file's
mapping" → a wrong file is refused → the right file passes → the assistant reopens with the exact
saved document (a large integer intact) → correct it → save → import into the **same** source →
the second report is `duplicate`, nothing inserted, and the first import's counts are unchanged.
Negative assertions: no `POST /api/mappings`, `/api/imports` or `/api/uploads` before the explicit
clicks. Verification includes `pnpm --dir web exec playwright test --list` showing the new spec and
the run output showing it executed.

Gates before the PR: `pnpm --dir web lint`, `typecheck`, `test`, `build`, `e2e` (with the discovery
listing), plus `uv --directory backend run pytest -q`, `ruff check`, `mypy src`,
`lint-imports` for the one new backend test.

## 6. Acceptance checks mapped to the issue's scope

1. **Field table over the canonical document** — `document.test.ts` (preservation through every
   edit kind and batch), `documentIndex.test.ts` (all options, both transform forms, `enum_map`,
   four absent/null/false/empty states, unknown keys), `FieldTable.test.tsx` (rules add/delete/
   rename with parent references, field add/delete, `where` with object and large-integer values,
   `unmapped`, `notes`), §3.4 + its tests (malformed and duplicate-key sections in the repair
   view).
2. **Lossless numeric codec, raw response text → editor → server** — `codec.test.ts` with
   path-addressed assertions, the grammar suite, and the server-boundary test; the guarantee is
   stated exactly in §3.6.
3. **Executable suggestions beyond `timestamp_format`** — `suggestions.test.ts`: five further
   operations from closed enums, an operation choice instead of a guess, prose for the rest, a
   rule picker for ambiguous targets, and a stale-anchor refusal.
4. **Report entry with a SHA check and honest duplicate semantics** — `ReuploadDialog.test.tsx`,
   the bootstrap cases in `Assist.test.tsx`, and the e2e round trip that ends in a `duplicate`
   report with the first import's counts unchanged.
5. **Rail collapse below 1280 px and receipts through the message hook** — the browser pass at
   1279/1280/900 px in both themes, plus `Conversation.tsx`'s metadata cases.
6. **Issue-path resolver** — `issuePaths.test.ts` over the parser's real paths and the view-aware
   focus case in `Assist.test.tsx`.

## 7. Scope for v0.1.0 and what moves to follow-up

The review is right that none of the six bullets can be dropped without leaving #39 open, so the
cuts are depth, not coverage. Each cut names the acceptance criterion it does **not** touch.

Cut to a follow-up issue ("#39b assistant table depth"):

1. **Target-name and profile-path autocomplete, and the Python drift guard.** Free-text inputs
   remain and the server stays the authority, so bullet 1 is unaffected; only typing convenience
   is lost.
2. **Natural-language and free-text unit parsing in the suggestion catalogue.** Bullet 3 asks for
   executable options beyond `timestamp_format`; the closed-enum catalogue delivers five, tested.
   Prose options already have a defined behaviour (insert into the message).
3. **Transform form conversion and chip polish.** Both forms stay readable and editable as raw
   JSON with add/remove/reorder, and `enum_map` keeps its editor, so bullet 1's "transforms in
   both forms" is met; only conversion between them is deferred — which also removes the member-
   discarding risk of finding 9.
4. **Automatic `parent` reference cascades on rename/delete.** Renames and deletes that would
   break a reference are refused with the list of referring rules, and each `parent` is editable,
   so bullet 1's "rules add/delete/rename with parent references" is met by explicit editing.
5. **Profile-path suggestions.** They need a profile the suggestion API does not receive and a
   root-relative vs current-item path translation; bullet 3 is met without them.
6. **Per-row Why/Issues disclosure below 1280 px.** The rail disclosure (bullet 5's actual text)
   plus a horizontally scrolling table container keeps the page free of horizontal scroll.

Kept, because they are the acceptance criteria: the grammar and span contract, the batch planner,
the full option/rule/condition/`unmapped`/`notes` surface with repair, the codec with no parsed
fallback, the closed-enum suggestions with operation choice, the SHA-checked report entry with
honest source semantics, the rail collapse and metadata receipts, the issue-to-control navigation,
and the accessibility and browser passes.

## 8. Risks

- **Schedule (the largest one).** See §10: 4.0 days of work against three calendar days to the
  2026-09-11 freeze, with #10, #33, #18 and #45 also in flight. This plan does not assert that it
  fits; it names the owner's two options.
- **Rejected alternative: an upload-resolution route.** `GET /api/uploads?file_sha256=…` would be
  a shorter path but touches `routers.py`, `schemas.py`, the ports and `docs/api/v0.1.md` — files
  other wave-1 agents hold — and would hand out an upload id for bytes the user has not presented.
  The re-upload flow is explicitly allowed by the issue. Recorded so the reviewer can overrule it.
- **Span correctness is the whole issue.** Mitigated by building `jsonText`/`document` first under
  TDD, by re-validating every planned result with the grammar, and by refusing rather than
  guessing whenever a container is unaddressable.
- **`Imports.tsx` and `playwright.config.ts` are shared** with #10/#33 and (indirectly) #45. The
  report actions and the Playwright project are additive and land last in the branch.
- **Table density at 1280 px** with six columns: the rail collapses first and the table scrolls in
  its own container; verified in a real browser, not in jsdom.
- **E2E ordering**: the new project depends on `assistant`, which depends on `chromium`, so the
  smoke spec's unscoped totals are still measured before any assistant import.

## 9. Verification of the review's own claims

Everything in §2 was re-checked here before acceptance; three points are recorded with a nuance
rather than as plain restatements: the dotted-field-name ambiguity in finding 12 is a property of
the parser's path concatenation and is therefore handled by refusing to resolve rather than by a
better parser (§3.5); finding 8's decimal and `1e3` cases are Python JSON semantics, so the plan
states the guarantee's boundary instead of promising a fix (§3.6); finding 13's uncertainty is
removed rather than mitigated, because the pinned package does expose both the metadata field and
the hook (§3.8). No claim in the review was contested.

## 10. Order and estimate

Correctness gate first, then one thin vertical slice, then breadth (the review's ordering
requirement):

1. Grammar, spans, `planEdits`, their tests; typecheck the `useAuiState` receipt selector against
   the pinned install (0.9 day).
2. Thin vertical slice: `indexDocument` + one field row with two options + `ViewSwitch` + issue
   focus → edit → validate → save, in the browser (0.6 day).
3. The rest of the table: rules, fields add/delete, source kinds, transforms, `where`, `unmapped`,
   `notes`, document head and identity sync (0.9 day).
4. Suggestions with the operation choice and the anchor (0.35 day).
5. Report entry: `getMappingText`, dialog, origin bootstrap, import source, notices (0.6 day).
6. Codec tests, server-boundary test, Playwright project + discovery + the two adapted specs, the
   1279/1280/900 px and both-theme browser pass, receipt tests (0.65 day).

**Total ≈ 4.0 engineer-days** (revision 3 adds no new steps; the second-pass fixes are contract
changes inside steps 1, 3, 4 and 5), up from revision 1's 3.0 because the contracts are now
specified rather than assumed and because the review's test, discovery and browser work is
delivery, not optional QA.

**This is a task estimate, not a capacity claim, and revision 2's "roughly half a day of margin"
is withdrawn** (second-pass finding 10): four engineer-days against 2026-09-08 to 2026-09-11 has
no demonstrated reserve, review-fix and shared-file integration time was never costed into it, and
the sprint keeps feature freeze separate from clean-clone, rehearsal and release work
(`docs/planning/2026-09-07-consolidated-plan.md:118-122`).

**Owner decision, 2026-09-08: #39 stays in v0.1.0**, this agent is the only remaining assistant
feature-work agent, with a **go/no-go after step 1**. The plan's obligation is therefore to make
that gate decidable rather than to assert a fit: the step-1 report states the elapsed time, what
the tests prove, any case the grammar or planner could not handle, and a **fresh estimate of the
remaining steps measured against step 1's actual pace**. A no-go at that gate means the release
falls back to the shipped #15 JSON slice with #39 open, and it must be taken on the date of the
gate so that clean-clone and release verification keep their time. No second undeclared split of
#39's acceptance criteria is proposed in either direction.

## 11. Revision 3: answers to the second-pass review, by finding

`2026-09-08-assistant-field-table-review-codex-2.md` (BLOCK). Findings 1, 2, 4 and 7 are recorded
there as closed and need no change. Nothing is contested: every open point was re-verified in the
code first, and each is closed by a named change above.

| # | Verdict | Change |
| --- | --- | --- |
| 1 | closed by the review | No change (parsed-object fallback already removed, §3.6). |
| 2 | closed by the review | No change (grammar, decoded keys, duplicates, code-unit offsets, §3.1). |
| 3 | **open → closed** | §3.1 rules 2, 2b, 2c: any edit strictly beneath a whole-value `set`/`remove`/`insert`/`move` is now a conflict (`set unit` + `set unit.from` aborts); `rename` explicitly does not conflict with edits beneath it and carries the child-edited text; a **final decoded-key check** per touched object catches renaming both `a` and `b` to an absent `c`, which no input-key check sees; array `insert`/`move` indices address the input order with a defined remove → move → insert sequence and a conflict on a contested destination. §5 adds each case, asserting that a refused plan leaves text, version, undo and gates unchanged. Verified that the grammar check alone cannot see a discarded child edit — hence the structural rule. |
| 4 | closed by the review | No change to the surface; the undo/JSON identity transition it deferred to finding 9 is now specified (§3.2). |
| 5 | **open → closed** | §3.3 stops deriving the operation from the option string. A target that names an option (`…fields.x.on_invalid`) keeps it and matches only that option's domain; a **field-only target always requires the user to pick a named operation**, even when exactly one domain matches — so `true`, `reject`, `null` and `min` have no auto-apply path left. `unit` is offered only from an explicit ordered pair, so bare `min` never yields a unit edit (the revision-2 contradiction is gone). Applicability is stated as the parser's, not ours, with its real rules cited (`parser.py:439-473` bounds needs a timestamp target and a `[*]` path; `:498-505` `type` must equal the target type; `:527-556` `unit.to` must be the canonical unit; `:507-522` `timestamp_format` on a non-timestamp is a warning), and a menu entry the document already contradicts is labelled rather than hidden. §5's `reject → on_missing` test — which did encode the guess — is replaced by a menu assertion. |
| 6 | **open → closed** | §3.7's `failed` sentence no longer claims a retry cannot be a duplicate: a lost concurrent race is recorded as `failed` for every file even though another import committed those bytes (`imports.py:328-344`), so the copy now says the attempt inserted nothing and the retry is checked against what is committed in that source today. `origin` gains `fileDuplicateOf` (`api/types.ts:20`) for the original-import link, and every status sentence is chosen by the **selected file's** status in a mixed batch. §5's e2e adds the mixed and A-versus-B cases. |
| 7 | closed by the review | No change (third Playwright project, discovery listing, JSON-view selection in the two existing specs). |
| 8 | closed | §5's codec section is rewritten: escaped envelope keys (`{"proposal":…}`) and an escaped **field** key (`{"fields":{"x":{"literal":9007199254740993}}}`, edited through its decoded name) are **positive** cases — revision 2 wrongly listed the first as negative — while missing/wrong-type `mapping`, invalid grammar and duplicate envelope keys are the negatives, each asserting unchanged prior validated/saved state. Assertions locate values by span **at their path**; the four transport helpers are named individually (`api/index.ts:54`, `:77-100`, `:114-121`); the server test asserts Python types and integer values. The escape spellings lost in revision 2's prose are restored (lines 53, 202, 442). |
| 9 | closed | §3.2 "Identity and undo move together": `undo` becomes `{documentText, identity}` and `undoDocument` restores both, so rename → Undo → revise no longer breaks at `assistRuntime.ts:174-176`; every accepted document replacement (proposal, bootstrap, JSON edit of `name`/`source`) sets the identity from the document head when it is addressable, and a malformed document keeps the user's identity untouched until repair. §5 tests rename → undo → revise and malformed → repaired → revise. |
| 10 | closed | §10 withdraws the half-day margin claim outright and records the owner's decision that #39 stays in v0.1.0 with a go/no-go after step 1, whose report must carry a fresh remaining estimate measured against step 1's actual pace and a dated no-go that preserves release-verification time. |
