# Plan: mapping assistant UI (issue #15), revision 2

Revision 2 after the Codex review (`…-review-codex.md`, 15 findings, BLOCK).
The review's central point stands: the full issue as written (lossless field
table for the whole DSL, consent-aware chat state machine, save/preview/import
gating, entry points from reports, accessibility across three regions) is 4 to
6 engineer-days, not 1.1, and the v0.1.0 timebox has about one day for it.
This revision therefore **splits the deliverable**: a v0.1.0 slice that meets
the issue's expected result end to end with a JSON editor instead of a field
table, and a follow-up issue for the field table and the report entry point.
The owner decides the split; the plan states it explicitly rather than
claiming the full scope.

Expected result kept for v0.1.0: from an unknown file a user can request an
analysis, read the proposed mapping with explanations and ambiguities, ask
questions, edit the mapping (JSON editor with inline issues), validate,
preview, save the mapping as a revision and import. The model never writes.

## 0. Owner constraints

Console design (ADR-006, icons over labels with accessible names and
tooltips); conversation on a **React chatbot library** (owner, 2026-09-07).
Library evaluated on npm on 2026-09-07 and **installed on this branch**:
`@assistant-ui/react` 0.15.18 (MIT, peer React ^18 || ^19, exports
`useExternalStoreRuntime`, `AssistantRuntimeProvider`, `ThreadPrimitive`,
`ComposerPrimitive`, `MessagePrimitive`). Alternatives:
`@copilotkit/react-ui` (coupled to its runtime), `@chatscope/chat-ui-kit-react`
(presentational, last publish 2025-05), `@nlux/react` (React 18 only, MPL),
`deep-chat-react` (web component). The first implementation step is a bounded
**integration spike** [9]: typecheck a minimal external-store adapter against
the library's real message and callback types under this repository's React
19.2 / Vite 8 / TypeScript 6 strict settings, production-build it, style the
primitives' actual classes with Console tokens in light, explicit dark and
system dark, and prove: pending state, disabled send, one active run, no
retry/edit/branch/attachment actions. Failure criteria: types do not compile
without `any`, or the runtime forces network/streaming semantics we cannot
satisfy from prepare/run. On failure, `@chatscope/chat-ui-kit-react` with the
same tests, decided at the end of the spike, never both installed.

## 1. Scope split

**v0.1.0 slice (this PR):**

- Route `/import/assist/:uploadId`, entered from the Import page only (an
  "Analyse with the assistant" icon action on an uploaded file). The Import
  page's local batch is preserved: the action opens the assist route in the
  same tab with the batch kept in `sessionStorage` under its existing key
  scheme, restored on return [8].
- Identity (`name`, `source`) entered by the user on the assist page before
  the first prepare, validated like the server (no redactable content, ≤100
  characters), kept consistent with the document [8].
- Evidence rail: profile table with exact evidence (records / inspected,
  nulls / values, types named, hints as chips, examples behind a keyboard and
  touch disclosure, truncation limits printed) [11]; sample toggle; payload
  drawer showing `payload_text` **verbatim** with bytes, digest, redaction
  counts and trimming [1].
- Conversation: the library thread over an external-store runtime driven by
  `assistRuntime.ts`, a pure state machine with the consent and freshness
  rules of §2 [1] [7].
- Mapping editor: a **JSON editor** (`JsonText`-based textarea with line
  numbers) holding the canonical document text, with server validation on a
  debounce and issues listed by `path` with a "jump to" that selects the
  matching line; ambiguity options shown as suggestions with
  `what_settles_it`, applied only for the one supported operation
  (`timestamp_format` on an unambiguous timestamp field), otherwise inserted
  into the composer as a pending revision message [5]. The document text is
  the source of truth: no rows model, no lossy re-serialisation; the editor
  sends the text the user sees, parsed once by the browser only to check it
  is JSON, and numeric lexemes travel as the user typed them because the text
  itself is the request body's `document` (the API accepts JSON; we send the
  editor's text inside the envelope through a raw-body helper) [2] [3].
- Gates [4]: Validate (free) → Save (needs a current `executable: true`
  validation of exactly the displayed text and an explicit click) → Preview
  (needs the displayed text to equal the saved snapshot; shows the existing
  preview report: emissions, sampled count, partial/rejected/ignored,
  warnings) → Import (needs a current preview for that upload, saved id and
  source; confirmation names file, hash, source, revision; reuses the Import
  page's confirmation content). Every edit, undo, proposal application or
  identity change invalidates downstream gates synchronously; late responses
  for an older document version are ignored; no double submit.
- A session-only "assistance used" receipt beside the saved result (model,
  digest, attempts, whether the saved text differs from the proposal); nothing
  persisted, nothing implied about server audit [14].

**Follow-up issue (filed as part of this PR, milestone v0.1.0 stretch):**
field table bound to the DSL (rows as an indexed view over the canonical
document, all field options, rules add/delete/rename, transforms, conditions,
unmapped) with the lossless numeric codec at the API boundary; entry from
an Import report (needs an upload-resolution API or a re-upload flow with SHA
check); ambiguity chips beyond the one supported edit; responsive inspector
collapse below 1280 px.

## 2. State machine (`assistRuntime.ts`) [1] [4] [7]

State: `{generation, uploadId, identity, includeSample, documentText,
documentVersion, thread (UI messages), history (bounded projection),
prepared?: {generation, requestSnapshot, response}, acknowledged?: digest,
run?: {generation, outcome}, validation?: {documentVersion, issues,
executable}, saved?: {documentText, record}, preview?: {savedId, report},
busy: none | preparing | running | validating | saving | previewing |
importing}`.

Rules:

- Any mutation of `identity`, `includeSample`, `documentText`, the composer
  draft being sent, `history` or `uploadId` increments `generation` and drops
  `prepared`, `acknowledged` and `run`. Late prepare/run/validate/save/preview
  results whose generation or document version do not match are discarded.
- A run always uses `prepared.requestSnapshot` and `prepared.response.
  context_sha256`, never a rebuilt request. Only one run at a time; the
  composer and editor are locked while `busy != none`.
- Sample consent: when `includeSample` is true, a prepare pauses in
  `awaiting_ack` until the payload drawer has rendered **this digest's**
  `payload_text` and the user pressed "Send this"; a drawer closed before the
  prepare resolved acknowledges nothing; a new digest (including after `409
  stale_context`) needs a new acknowledgement. Without a sample, the digest is
  shown in the composer footer and the run follows the prepare directly.
- Kinds: the first send is `propose` with `message` (the user's text) and no
  mapping; every later send is `revise` with the current document text (must
  be a JSON object with matching `name`/`source`, else the send is refused
  locally with the reason), the new text as `message`, and the last ≤20
  completed turns (≤4,000 chars each, older dropped and the omission shown as
  a small notice) as `history`. Transport/system notices are never part of
  `history`.
- Reply handling: `proposal` present → the document text becomes the
  proposal's `mapping` (pretty-printed once; undo restores the previous text
  and invalidates gates), the assistant bubble shows a receipt line
  ("proposal applied · model · attempts · executable or N issues") plus
  questions and ambiguities; no questions and no ambiguities → "Proposal
  applied, no open questions" so the bubble is never empty. `proposal: null`
  with refusal → assistant bubble with the failure, document unchanged.
  `400` field details, `404`, `409` (auto re-prepare, then re-ack if a sample
  is on), `413`, `502`, `503` → system notices from the envelope's message,
  draft retained, no duplicate turns, no silent re-run.
- The chat runtime can never invoke save, preview or import.

## 3. Backend (already on this branch)

`GET /api/mappings/schema` (registered before `GET /mappings/{id}`; a test
asserts the literal `schema` path resolves) and `POST /api/mappings/validate`
(`200 {issues, executable}` for any JSON-object document, drafts included;
non-object bodies fail the envelope with `400 invalid_input`; no persistence,
no assistant) [10]. The client uses the validate route as the authority; the
JSON Schema is fetched only to power the editor's "reference" popover, not for
client-side validation (a 2020-12 validator with `if/then/oneOf` is not worth
its bundle for this slice) [10].

## 4. Components

`pages/Assist.tsx` (route, identity form, state, calls), `assist/assistRuntime.ts`
(pure), `assist/EvidenceRail.tsx`, `assist/ProfileTable.tsx`,
`assist/PayloadDrawer.tsx`, `assist/Conversation.tsx` (+ `chat-theme.css`),
`assist/DocumentEditor.tsx` (textarea, line numbers, issue list with jump,
reference popover), `assist/ActionBar.tsx`, `assist/Receipt.tsx`. API helpers
and DTOs for profile, prepare, run, validate, save in `api/index.ts` and
`api/types.ts`, including a raw-body save/validate helper that embeds the
editor text without re-serialising it [3].

Accessibility [11]: labelled thread (`role="log"`, `aria-live="polite"` for new
replies only), composer with Enter to send and Shift+Enter for a newline,
focus kept on the composer after a reply, visible focus everywhere, disabled
actions explained in an adjacent text line (not only a tooltip), exact numbers
in the evidence rail, every icon-only control with a name and a tooltip.

## 5. Tests [12] [13]

- `assistRuntime` unit matrix with mocked fetch: every invalidator; inverted
  completion order for prepare/validate/run/save; double submit; sample on/off
  and changed-digest re-acknowledgement; drawer closed before prepare
  resolves; `400/404/409/413/502/503`; refusal; non-executable repaired
  draft; edit during save; undo invalidating gates; history projection limits;
  exact request bodies; and **no `/assistant/run` request** until eligible.
- Component tests: profile table exact numbers and disclosure; payload drawer
  verbatim text; editor issue jump; action bar gate texts; icon names and
  tooltips; chat theme contrast pairs in `tokens.test.ts`.
- Playwright, on its own database (`E2E` profile already isolates a temp root;
  this spec uses a **distinct source** `assist-e2e` so the smoke spec's totals
  are unaffected) with `AGENTSCOPE_LLM_PROVIDER=fake` set explicitly in
  `start-backend.mjs`: upload a synthetic epoch JSONL → identity → analyse →
  payload drawer → run (`fake/deterministic-1`) → ambiguity → send "treat ts
  as epoch seconds" → the document's `timestamp_format` changes to `epoch_s`
  → validate clean → save (`created: true`) → preview shows an ISO timestamp
  from the seconds reading → import → report `committed` with the saved
  mapping id → sessions filtered by `source=assist-e2e` count 2. Negative
  assertions along the way: no `/api/mappings` POST and no `/api/imports`
  request until the explicit clicks (request log), Import disabled until the
  preview exists. TraceLab remains the smoke spec's business.

## 6. Cost and order

1. Integration spike with the library (0.15 day; decision point).
2. `assistRuntime` + API helpers + unit matrix (0.35 day).
3. Page, rail, drawer, editor, action bar, receipt (0.35 day).
4. Conversation, theme, Playwright, docs (0.25 day).

About 1.1 days for the **slice**; the follow-up issue carries the remaining
3 to 4 days of the review's estimate and is filed, not claimed.
