# D3-03b Assistant UI: field table, lossless numeric codec, report entry point

Closes #39. Plan: `docs/superpowers/plans/2026-09-08-assistant-field-table.md` (revision 3), with
the two Codex reviews beside it. No backend change; no change to `docs/api/v0.1.md`.

## What changed

The assistant's mapping document is still one piece of canonical text. What is new is that the
text is now **addressable**: a real JSON grammar, a span index over it, and an edit planner that
rewrites only the containers an edit touches. Everything above that — the field table, the
ambiguity chips, the report entry — is a view over the same text, so an untouched member keeps its
bytes no matter how many edits pass over it.

- **`jsonGrammar.ts`** reads JSON as JSON rather than as balanced brackets. The old tokenizer
  accepted `{"x":01}`, `{"x":1,}`, `{"x":1} trailing` and `"\q"`, so re-tokenizing an edit's output
  could never prove it produced one JSON value. Keys are matched **decoded**, so `{"x": 1}` is
  addressable as `x`, and an object with duplicate decoded keys is refused rather than resolved
  differently from `JSON.parse` (which keeps the last). Offsets are UTF-16 code units.
- **`document.ts`** turns that into spans and `planEdits`. Sorting splices right to left cannot
  express a batch — with three members, removing the middle one and the last one makes both member
  spans claim the comma between them — so containers are *rendered* from their member list,
  innermost first, with the renderer owning every separator. A batch aborts whole on a conflict:
  two edits on one path, an edit inside a value the batch replaces or removes, renames that would
  leave two members of one name, two array operations claiming one index.
- **`documentIndex.ts`** is the read view: rules, fields, sources, transforms, options, conditions,
  `unmapped`, `notes`, plus every key the DSL does not name, kept as `extras` with its path.
  Absent, `null`, `false` and empty stay four different states.
- **The field table** (`FieldTable`, `FieldCells`, `RuleHeader`, `DocumentHead`, `RawJsonInput`)
  edits the whole DSL and is the default view, with the JSON view one icon away.
- **The codec** no longer has a parsed-object fallback anywhere, and `getMappingText` reads a saved
  revision from the response bytes.
- **Ambiguities** become edits only when the operation is named, never inferred.
- **An import report** can hand a file back to the assistant, SHA-checked in the browser.

## How each acceptance criterion is met

**1. Field table bound to the DSL, rows as an indexed view, never a lossy rebuild.**
Every cell shows `rawAt(path)` — the source text — and every control emits an edit batch for the
planner. `path` / ordered `paths` / `literal` switch in one batch that removes the others, so the
parser's ambiguous-source error cannot be produced by a switch; `transforms` are raw-JSON entries
in both forms, added, reordered and deleted, with `enum_map`'s policy as its own select; the six
closed option domains each have an explicit "not set" that *removes* the member; `unit` is written
only once both halves are chosen; `default` stays editable and removable whatever `on_missing`
says, labelled *unused* when it says something else. Rules add, delete and rename, with a rename or
delete that would break a `parent` refused naming the rules that hold it, and `parent` offering
only what the parser accepts (`parser.py:304-333`). `where` conditions take raw-JSON typed values,
so an object or a 2^53+1 integer is first class, and the value member is removed, not disabled, for
`exists`. `unmapped`, `notes` and the document head are editable; `native_key` absent, declared
empty and declared are three visible states. Anything the table cannot represent — a malformed
section, an object with duplicate keys — says so and offers the JSON view, and is never rewritten.

**2. Lossless numeric codec at the API boundary, with tests from raw response text to the server.**
`codec.test.ts` starts from a raw run-response *string* with an escaped envelope key and an escaped
field key, applies it through the state machine, makes a planner edit, and asserts the captured
save and validate request bytes still carry `9007199254740993`, `1.0` and `1` **at their paths**
(a substring check cannot tell a right value at a wrong path). The parsed-object fallback is gone:
on an unreadable reply the document, its version, its undo entry and every gate stay exactly as
they were, and no outcome validation is attached — a warning would have left Save enabled for data
the server never saw. The guarantee is stated exactly in the plan §3.6: response text → editor →
request bytes, whitespace changed once at pretty-print; a server round trip is *not* claimed
(Python returns `1e3` as `1000.0`), which is why reopening a revision reads the response bytes.

**3. Ambiguity options as executable suggestions, with unambiguous targeting.**
A target that names an option matches that option's domain only; a target that names just a field
always asks the user to pick a named operation, even when exactly one domain matches — `reject`,
`null`, `true` and `min` each name more than one thing, and none of them is applied on a guess.
`unit` is only offered from an explicit ordered pair. Applicability stays the parser's: an entry
says what the parser will make of it (`bounds` without a `[*]` path, `timestamp_format` on a field
declared otherwise) rather than deciding, and `on_missing: default` is blocked until a `default`
exists. Chips are anchored to the document version the proposal created, so a stale click is
impossible rather than unlikely.

**4. Entry from an import report, with a SHA check, not replacing committed observations.**
The report's file rows and its rejects panel open a dialog that hashes the chosen file **on this
machine before uploading**, so the wrong file never leaves it; the server's digest is compared
again afterwards, and where the browser cannot hash the entry is disabled rather than uploading
first. Bytes are hashed as they are on disk, compressed included, because that is what the store
hashes. The page then loads that file's own revision by id through `getMappingText`. What it
promises is scoped to what is true: duplicates are decided by bytes + source, the import's source
is not necessarily the mapping's, so the two are kept apart behind an explicit **import source**
control defaulting to the report's; a committed file, a duplicate file and a failed attempt each
get their own sentence, and the failed one does not claim a retry cannot be a duplicate (a lost
race is recorded as failed for every file). The e2e proves it: a corrected revision re-imported
into the same source inserts nothing and leaves the first import's session count unchanged.

**5. Responsive collapse below 1280 px; per-message receipts through the chat library's hooks.**
Below 1280 the evidence rail is a real disclosure whose button still states the numbers; above it
there is no button. The receipt travels as message metadata and is read back with
`useAuiState(s => s.message.metadata.custom?.receipt)` inside a custom assistant message — the
second text part and the `nth-child` CSS rule are gone. Both are verified in a real browser at
1280, 1279 and 900 px in both themes.

**6. Issue-path resolver mapping the parser's paths to editor controls.**
`issuePaths.ts` maps `rules[0].id`, `rules[0].fields.x.bounds`, `rules[0].fields.x.transforms[2]`,
`rules[0].where[1].value`, `unmapped[0].reason`, `dsl_version` and `$` to controls with
collision-safe ids, and clicking an issue focuses the control that owns it or opens the JSON view
at its line. Where the parser's path is genuinely ambiguous — it concatenates unescaped keys, so a
field named `a.b` reads exactly like a nested path — it resolves to the document rather than
focusing a possibly wrong control.

**Accessibility.** Every control is a native input, select or button named after its *rule* as well
as its field (two rules may share a field name); an issue makes its control `aria-invalid` and
points `aria-describedby` at the message; raw JSON can be typed one keystroke at a time, because a
draft only reaches the document on blur or Enter and only when it is one JSON value; an incomplete
draft is put back rather than written; an edit that re-renders a row leaves focus where it was; and
every icon-only control keeps an accessible name and a visible tooltip.

## What moved to #39b, and why it costs no criterion

- **Target-name and profile-path autocomplete, and a drift guard against the Python target schema.**
  Free text remains and the server stays the authority, so only typing convenience is deferred.
- **Natural-language and free-text unit parsing in the suggestion catalogue.** Six closed-enum
  operations ship, tested; prose options already have a defined behaviour.
- **Transform form conversion** (`"trim"` ↔ `{"trim": {}}`). Both forms stay readable and editable
  as raw JSON, which is what the criterion asks and also removes the risk of a conversion dropping
  an unknown parameter.
- **Automatic `parent` reference cascades.** Renames and deletes that would break a reference are
  refused with the rules that hold them, and each `parent` is editable, so references are covered
  by explicit editing.
- **Profile-path suggestions.** They need a profile the suggestion API does not receive, and the
  profile's paths are root-relative while a field path is current-item relative.
- **A per-row disclosure for Transforms/Options below 1280 px.** The two-line row plus the rail
  disclosure already keep the page free of horizontal scroll at every width measured.

## Notes for the reviewer

- **Two-line rows, not a scroll container.** A field's eleven controls overflowed the table by
  77 px at 1280 px, so a field is two table lines: source and issues, then transforms and options,
  with the continuation row named after its field. Measured after the change: no page overflow and
  no table overflow at 1280, 1279 and 900 px in both themes.
- **A tooltip caused a real 78 px horizontal scroll at 1279 px** with no element out of place:
  `::after` tooltips are absolutely positioned, contribute to overflow, and are invisible to an
  element scan. At the right edge of the full-width rail they now open inwards.
- **`web/src/pages/Imports.tsx`** is the only file outside `web/src/assist/`, `web/src/api/` and the
  e2e surface that this PR changes, and only the report page. `web/src/pages/Import.tsx` and
  `web/src/import/` (issue #45, PR #53) are untouched: the new spec creates its upload through the
  API and opens the assistant route directly, so it does not depend on that page's selectors.
- **`e2e/assist.spec.ts` now clicks "JSON document"** before asserting on the textarea, because the
  table leads. It is otherwise unchanged.

## Review round (adversarial review of this PR)

One P1, five P2 and one P3, each closed as a class with the failing test written first:
the P1 crash on an ambiguity target naming `unit` or `default` (now every option in the DSL
resolves without throwing, narrowed by type rather than cast); a `unit` pair that could not be
created and, when edited, dropped members no control owns (a draft until both halves are known;
existing pairs edited at their member paths); malformed sections mistaken for missing ones (every
indexed container now distinguishes the two, and the cells offer repair instead of a control that
would overwrite); a re-upload dialog whose close and unmount did not cancel a pending completion;
issue paths for dotted field names resolved against the document rather than by guess; and control
ids made injective so `getElementById` cannot return another field's control.

## How to verify

```
pnpm --dir web lint          # 3 warnings, all pre-existing
pnpm --dir web typecheck
pnpm --dir web test          # 259 tests, 15 files
pnpm --dir web build
E2E_PORT=8795 pnpm --dir web exec playwright test --list   # 9 tests in 3 projects
E2E_PORT=8795 pnpm --dir web exec playwright test          # 9 passed
uv --directory backend run pytest -q                       # unchanged, green
```

The Playwright run prints its layout measurements as `[layout] <theme> <width>px page=0 table=0`,
which is the responsive claim in evidence rather than in prose.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_014DtPBVHFozpxZEh1F61h56
