# Plan: mapping assistant UI (issue #15)

Day 3, third issue. Expected result (issue text): from an unknown file a user
can request an analysis, read the proposed mapping with explanations and
ambiguities, ask questions, edit the mapping in a field table, validate,
preview the normalised result, save the mapping and import. The model never
writes to the database. Everything server-side exists (#13, #14): profile,
prepare/run with the digest, the fake and compatible adapters, mapping saves
with validation, preview and import. This issue is the Console-shell UI over
those routes.

## 0. Owner constraints

- Console design of record (ADR-006); icons over labels where possible, every
  icon-only control with an accessible name and a tooltip.
- The conversation is built on a **React chatbot library**, not a hand-rolled
  thread (owner, 2026-09-07). Evaluated on npm the same day:

  | Library | Version, last publish | React 19 | Notes |
  | --- | --- | --- | --- |
  | `@assistant-ui/react` | 0.15.18, 2026-09-03 | yes | MIT, composable primitives (thread, composer, message parts), a runtime abstraction (`useExternalStoreRuntime`) that maps cleanly onto our prepare/run request cycle, CSS-variable theming, keyboard and screen-reader support built in |
  | `@copilotkit/react-ui` | 1.70.1, 2026-09-03 | yes | MIT, but designed around CopilotKit's own runtime and cloud; heavier coupling |
  | `@chatscope/chat-ui-kit-react` | 2.1.1, 2025-05-15 | yes | MIT, presentational only; no release in 16 months |
  | `@nlux/react` | 2.17.1, 2024-08-15 | React 18 only | MPL-2.0 |
  | `deep-chat-react` | 2.5.1, 2026-08-27 | wrapper | a web component; hard to theme with our tokens |

  **Pick: `@assistant-ui/react`** with an external-store runtime: our page
  owns the message list (it is the `history` we already send to the server)
  and the library renders thread, composer and message parts. Fallback if the
  runtime API fights the digest flow during implementation: `@chatscope`
  presentational components with our own state (still a library, still not a
  hand-rolled thread); the plan review should say whether that fallback is
  acceptable.

## 1. Route and page structure

`/import/assist/:uploadId` (reached from the Import page's "Analyse with the
assistant" icon action next to a preview-less upload, and from an Import
report's "Draft a mapping" action for a file whose mapping rejected records).
One page, three regions in the Console shell:

1. **Evidence rail (left, collapsible)**: the field profile as a compact table
   (path, coverage bar, types glyphs, null rate, hints as chips, examples on
   hover), the sample toggle ("Include a redacted sample" off by default) and
   the **outgoing payload notice**: "What the assistant will see" opens the
   prepared text in a drawer with its byte count, digest, redaction counts and
   trimming report, exactly as `POST /api/assistant/prepare` returns it. The
   run button is disabled until the current prepare succeeded and its digest
   is the one that will be sent (any change to sample toggle, message or
   mapping invalidates it and shows "context changed, preparing…").
2. **Mapping workbench (centre)**: the proposal as an editable **field table**
   bound to the DSL schema: one row per (rule, target field) with the source
   path (autocomplete from profile paths and wrapper accessors), transforms,
   `timestamp_format`, `unit`, `on_missing`/`on_invalid`, literal; rule
   header rows with entity, `select`, `where`, `parent`, `native_key`;
   `unmapped` list; `notes`. Inline validation: the document is parsed
   client-side against `mapping-dsl-v1.schema.json` (served at
   `GET /api/mappings/schema`, new, static) for immediate shape errors, and
   server-side (`POST /api/mappings/validate`, new: `parse_mapping` issues
   without saving) on every change, debounced; issues appear on their rows.
   Explanations (confidence chip, why) and ambiguities (options as chips that
   apply an edit when clicked) sit beside their rows; questions appear as the
   assistant's first message in the conversation.
3. **Conversation (right)**: `@assistant-ui/react` thread over an
   external-store runtime. Sending a message = `prepare` (revise, with the
   current mapping, message and history) → show the digest changed →
   `run` → the reply's proposal replaces the editable document (with an
   undo), its questions and ambiguities become the assistant message text.
   Adapter notes and `attempts` show as a small meta line under the message.
   Refusal shows as an assistant message with the failure; `502`/`503` show
   the error envelope's message as a system notice, never as a chat bubble
   from the model.

Bottom bar: **Validate** (server issues), **Preview** (existing preview route
with the current document saved first as a draft? no: preview needs a saved
`mapping_id`; see §3), **Save revision**, **Import**.

## 2. Data flow and invariants

- The page state is one object: `{uploadId, identity, includeSample, document,
  history, prepared?, outcome?}`. Every server call is derived from it; the
  digest binds prepare and run; the UI never sends a run with a stale digest
  (it re-prepares and tells the user why).
- The model never writes: only **Save revision** calls `POST /api/mappings`;
  the response's `id` is what Preview and Import use. Preview of an unsaved
  document is therefore a **draft save**? No: the DSL requires executable
  documents to be saved, and a preview of a non-executable draft is
  meaningless. Preview and Import stay behind Save; Validate is the free
  step. The bottom bar says so ("Save a revision to preview").
- `created_by: "user"` on saves; the proposal's `model` and the digest are
  shown next to the saved revision in the Mappings page (audit-only, from the
  page state; not persisted, per #13).
- Sample inclusion requires the drawer to have been opened at least once in
  this session for that digest (client rule mirroring ADR-005 "show before
  sending"); the server only enforces the digest.

## 3. New backend routes (small)

- `GET /api/mappings/schema` → the DSL v1 JSON Schema (static file).
- `POST /api/mappings/validate` `{document}` → `{issues, executable}` without
  saving (same `parse_mapping`).
- Both in `docs/api/v0.1.md`; no persistence, no assistant involvement.

## 4. Components

- `pages/Assist.tsx` (route, state, calls), `assist/EvidenceRail.tsx`,
  `assist/ProfileTable.tsx`, `assist/PayloadDrawer.tsx`,
  `assist/MappingTable.tsx` (+ `mappingRows.ts`: document ⇄ rows, pure,
  tested), `assist/Conversation.tsx` (the library thread + runtime adapter
  `assistRuntime.ts`, pure state machine, tested), `assist/ActionBar.tsx`.
- Primitives reused: `DataTable`, `Drawer`, `Notice`, `StatusPill`, `Popover`,
  `IconButton`, `QualityStrip` (coverage), `JsonText` (payload).
- Theme: the library's CSS variables mapped from `tokens.css` in
  `assist/chat-theme.css`; light and dark; contrast test extended.
- Icons: analyse (sparkles), payload (eye), sample (table), validate (check),
  save (bookmark), import (download-tray), undo (rotate-left), all with
  tooltips and `aria-label`.

## 5. Tests

- Unit (vitest): `mappingRows` round trip on the bundled TraceLab document
  and on the fake's SWE drafts (document → rows → document is identity);
  `assistRuntime` state machine (prepare → run → apply; stale digest → auto
  re-prepare; refusal; 502; 503) with mocked fetch; ambiguity chip applies
  its edit; inline issue placement by `path`.
- Components (RTL): evidence rail renders profile rows and the payload drawer
  shows digest and byte count; run disabled until prepared; conversation
  sends → history grows → proposal replaces document with undo; icon-only
  controls have names and tooltips; contrast pairs for the chat theme.
- E2E (Playwright, fake provider via `AGENTSCOPE_LLM_PROVIDER=fake` in
  `start-backend.mjs`): upload the TraceLab fixture → Analyse → payload
  drawer → run → proposal with 4 explanations → ask "map the user too" →
  revised → Validate clean → Save → Preview → Import → Overview totals
  unchanged from the day-1 numbers (80 / 4,770 / 5,723). A second e2e on a
  synthetic epoch JSONL: ambiguity chips → pick `epoch_s` → validate clean.
- Backend: the two new routes.

## 6. Cost and order

1. Backend routes + schema serving (0.1 day).
2. `mappingRows`, `assistRuntime`, tests (0.3 day).
3. Page, rail, table, drawer, action bar (0.4 day).
4. Conversation with the library, theme, e2e (0.3 day).

About 1.1 days. Out of scope: persisted conversations, streaming, multiple
uploads per analysis (one file at a time; multi-file mapping reuse is the
existing Import page), the two-model report (#16).
