# Plan: Playwright smoke test in CI (issue #12)

Expected result (issue text): one browser test runs in `ci-required`: upload,
preview, commit, dashboard shows the indicator, re-import leaves totals
unchanged. It also carries the browser checks deferred from #30: native
dialog modality and focus return, the keyboard path over the shell, deep
links, and the theme stamp before first paint.

## Setup

- `web/e2e/` with `@playwright/test` (Chromium only), `playwright.config.ts`
  pointing at `http://127.0.0.1:8765`, `webServer` starting the backend from
  `backend/` with `uv run uvicorn agentscope_app.interfaces.api.main:app
  --port 8765` and a throwaway database and raw-file directory under a temp
  directory (`AGENTSCOPE_DATABASE_URL`, `AGENTSCOPE_RAW_FILE_DIR`), after
  `pnpm build` so the backend serves `web/dist` (the SPA fallback from #30).
- Scripts: `pnpm --dir web e2e` (headless), `pnpm --dir web e2e:ui` locally.
- `tools/ui_clickthrough.py` is retired in favour of the TypeScript test.

## The tests (one spec file, sequential, one database)

1. **Day-1 path**: `/import` → choose the fixture
   `fixtures/tracelab/tracelab-sample.jsonl.gz` → the uploaded-file panel shows
   4,770 records → pick `tracelab-v1` → Preview → Import → the report says
   committed with 4,770 accepted → Overview shows 80 sessions, 4,770 model
   calls, and the exact input tokens under the abbreviated tile → re-upload
   the same bytes → the upload panel names the earlier import → Import →
   the report is `duplicate` and points at the original → Overview totals
   unchanged.
2. **Scope and drill path**: type an agent in the scope bar, Enter → the
   receipt and the URL change → Sessions in the rail keeps the scope → open a
   session → the breadcrumb keeps the scope → Source record → the native
   dialog is modal (Tab cycles inside, Escape closes, focus returns to the
   button) and the JSON text contains the record's session id.
3. **Deep link and theme**: open `/sessions?source=tracelab` directly (served
   by the backend) → the list renders scoped; choose Dark → reload → the
   root carries `data-theme="dark"` before the app script runs (checked with
   `page.evaluate` on `document.documentElement.dataset.theme` immediately
   after `goto` with `waitUntil: "commit"`).
4. **API envelope through the SPA**: `GET /api/metrics/sumary` is a JSON 404,
   not the page.

Assertions use roles and names, never CSS selectors, so the design can
change without rewriting the test.

## CI

- New job `e2e` in `.github/workflows/ci.yml`: checkout, uv + Python, pnpm
  + Node, `uv sync` in `backend/`, `pnpm install --frozen-lockfile` and
  `pnpm build` in `web/`, `pnpm exec playwright install --with-deps chromium`,
  `pnpm e2e`; artifacts: the HTML report and traces on failure.
- `ci-required` waits on `e2e` too. Runtime budget: under 3 minutes.

## Cost

Half a day. Out of scope: the assistant flow (#15), visual regression
snapshots, cross-browser runs.

## Revision 2: what the Codex review changed (2026-09-07)

`2026-09-07-playwright-smoke-review-codex.md` (BLOCK, 14 findings) shaped the
implementation directly, per the round-cap rule:

1. `ci-required` needs `[backend, web, e2e]` and checks each result is
   `success` (a skipped or cancelled e2e fails the gate).
2. Playwright has `testDir: './e2e'`; vitest excludes `e2e/**`; a separate
   `tsconfig.e2e.json` type-checks the config and spec in `tsc -b`.
3. `e2e/start-backend.mjs` creates a unique temp root before the server
   starts, passes absolute `AGENTSCOPE_DATABASE_URL` and
   `AGENTSCOPE_RAW_FILE_DIR`, runs the backend from its own cwd with
   `--host 127.0.0.1`, refuses to start without `web/dist`, and removes the
   root when the server exits; `reuseExistingServer: false`; readiness is
   `/api/health` (answers after the lifespan has run migrations and loaded
   mappings).
4. Serial mode, one worker, retries 0, per-test timeout 120 s, expect 15 s,
   traces retained on failure, page errors fail the test, reduced motion and
   a fixed light colour scheme.
5. The second import repeats mapping selection (by the option's displayed
   text) and Preview; the original import id is captured from the URL and
   asserted on the upload notice and the duplicate report; the duplicate
   attempt has a distinct id.
6. "Totals unchanged" compares `/api/metrics/summary` (sessions, model calls,
   tool calls, input tokens, coverage, by-semantics) against the fixture's
   exact numbers before and after the duplicate, and the overview shows the
   exact value beside the abbreviation.
7. The theme check saves dark through the UI, opens a fresh light-OS context
   with that storage, aborts the app module request, and asserts the stamp
   and the computed dark background while the React root is still empty, so
   removing the head bootstrap fails it.
8. Modality is asserted natively (`HTMLDialogElement`, `open`, `:modal`),
   with Tab and Shift+Tab kept inside the dialog, Escape closing it and focus
   returning to the exact opener.
9. Deterministic identities: the `codex` agent (40 sessions, 3,187 model
   calls), the clicked row's external id in the raw payload, the breadcrumb
   href carrying the scope, a no-results source.
10. Locators are roles with names, labels and named regions; the obsolete
    Python prototype is removed.
11. Chart keyboard checks are transferred to #11, where charts enter the
    production build; the popover Escape/focus return and the skip link are
    covered here.
12. Deep links cover the scoped `/dashboard` redirect, Back, an empty scope,
    and the API envelope (`/api/metrics/sumary`, `/api`, a missing asset,
    an extensionless page route).
13. Timeouts are explicit; the suite runs in about 7 s locally after a 2 s
    import.
14. CI installs `chromium-headless-shell` with system deps, reuses the uv and
    pnpm caches, uploads the report and traces on failure with 7-day
    retention; no browser cache until measured.
