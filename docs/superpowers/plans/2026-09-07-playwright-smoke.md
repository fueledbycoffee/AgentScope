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
