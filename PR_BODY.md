# Guided import route (Passage) on the Console shell

## What changed

`/import` is now a four-stop Passage route — File, Mapping, Preview, Confirm — inside the existing Console shell. Its progress rail turns verified upload, mapping, and dry-run facts into an auditable confirmation receipt while every other route keeps the Console design.

- Upload one to twenty JSONL/gzip or Parquet files and review exact file identity, record counts, prior-import evidence, and decoded sample rows.
- Select one format-compatible saved mapping per file, including deterministic recommendations, superseded-revision labels, and the existing assistant handoff.
- Run bounded per-file previews and review aggregate record, entity, warning, reject, and emission results before anything is written.
- Confirm exact files, hashes, mappings, source, and counts before the existing single-file or atomic batch import request is submitted.

The route supports reachable `?step=n` deep links, browser-history backtracking, focus transfer between stops and to errors, a responsive progress strip at 900 px, duplicate-byte and mixed-source guards, and trimmed versioned session persistence. Restored state is revalidated against the current mapping list; storage failures produce a visible warning.

## Review changes closed

- The “Neither fits?” assistant link remains below every compatible mapping group and becomes the primary action when no saved mapping accepts the file format.
- Missing or incompatible stored mapping ids fail closed to Mapping and invalidate their previews.
- Stop changes focus the new heading, errors focus their alert, and running text is announced through `role="status"`.
- Back uses the new shared `arrowLeft` action glyph with the existing accessible icon-button name and tooltip; primary actions retain written verbs.
- Persisted state omits decoded upload rows and preview reject/emission payloads while retaining the counts required for reachability and confirmation.
- Upload and import status text reports only facts available from the request/response API; no incremental backend telemetry is fabricated.
- Successful, duplicate, and failed reports clear route state before navigation, so browser Back canonicalizes a stale Confirm entry to File.

## Multi-file decision

The full per-file batch design ships: choose up to twenty files at File, select one mapping per file at Mapping, run one bounded preview request per file, review the aggregate at Preview, and submit the existing atomic `files` request at Confirm. The planned single-file fallback was not needed.

## Verification

The implementation green bar passes:

```sh
pnpm --dir web lint
pnpm --dir web typecheck
pnpm --dir web test
pnpm --dir web build
```

The full Vitest run covers 159 tests, including the converted legacy import integration tests and focused guided-route/runtime cases. The coordinator completed the Playwright run and captured the four route screenshots on the host, where browser execution is owned:

- `test-results/guided-import-route/1-file.png`
- `test-results/guided-import-route/2-mapping.png`
- `test-results/guided-import-route/3-preview.png`
- `test-results/guided-import-route/4-confirm.png`

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_014DtPBVHFozpxZEh1F61h56
