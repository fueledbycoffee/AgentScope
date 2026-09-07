# AgentScope web

React UI for the day-1 trace import and inspection slice. The hand-written DTOs
and API client in `src/api/` follow `../docs/api/v0.1.md`. That reference contract
is carried by the backend PR for issues #5 and #6.

From the repository root:

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir web dev
```

Vite proxies `/api` to `http://127.0.0.1:8000`. All API calls are same-origin;
no API keys or provider configuration are used by the browser. The production
backend must serve `web/dist` and fall back to its `index.html` for SPA routes
such as `/imports/imp_1` and `/sessions/ses_1` (while preserving `/api` routes).

Pages:

- `/import`: upload JSONL, gzip, or Parquet; inspect original records; choose a
  mapping revision; preview records, entities, warnings, rejects, and emissions;
  confirm the file hash and revision; import and open the persisted report.
- `/imports`: paginated history; `/imports/:id`: full report and paginated,
  code-filtered rejects. Duplicate and failed imports explain that nothing was
  inserted.
- `/dashboard`: four KPI tiles with expandable definitions, input-token coverage
  and semantics, source/agent filters shared by metrics and the sessions table,
  and session pagination. Missing values render as `Unavailable`; real zeroes
  remain zeroes.
- `/sessions/:id`: session fields, model calls, tool calls, diagnostics, and a
  source-record drawer with formatted, inert JSON fetched on demand. The native
  dialog supports Escape, focus containment, and returning focus to its opener.

Changing the file or mapping invalidates the preview. Controls lock during
mutations to prevent repeated submissions. Read errors offer a retry; obsolete
filter/page responses are ignored. List pages use 50 rows (the API does not
provide a total; a full final page can lead to an empty next page).

Validation, without a live backend:

```sh
pnpm --dir web test
pnpm --dir web typecheck
pnpm --dir web lint
pnpm --dir web build
```

Vitest and Testing Library use contract-shaped fetch mocks. Tests exercise the
upload → preview → confirm → report → dashboard flow, preview invalidation,
duplicate/failed reports, errors and commit conflicts, KPI null/zero/known-value
rendering, shared filters and stale responses, history, rejects pagination,
session source records, and every API endpoint's method/body/query/error shape.
The actual server restart, persistence, and exact-file re-import gate require
the backend PR and a live TraceLab excerpt; these frontend tests do not claim
that integration evidence.
