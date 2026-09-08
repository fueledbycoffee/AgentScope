# Contributing to AgentScope

AgentScope is pre-release. Keep changes small, tied to one issue, and explicit
about whether a behavior is implemented, verified, or planned. Open a branch
for the issue; do not combine unrelated fixes or rewrite accepted history.

## Toolchain and locked setup

CI uses uv 0.11.15, Node.js 24 and pnpm 10.28.1. From the repository root:

```sh
uv --directory backend sync --locked --all-groups
pnpm --dir web install --frozen-lockfile
```

Do not regenerate a lockfile as a side effect of setup. See the
[clean-clone quickstart](README.md#quickstart-from-a-clean-clone) for the
single-process application path.

## Architecture and code placement

The backend follows Clean Architecture. Domain code is framework-free;
application code depends on domain and application-owned ports; infrastructure
implements those ports; interfaces compose the application and expose HTTP.
Import-linter enforces the dependency direction. Read
[ADR-001](docs/adr/ADR-001-stack.md) and the
[component diagram](docs/architecture/import-pipeline.md) before moving code
between layers.

Put backend tests under the matching `backend/tests/` layer. Put React unit and
contract tests beside the exercised surface, and browser flows under `web/e2e/`.
Changes to behavior need tests at the narrowest layer that proves the contract;
changes crossing storage, API and UI need an integration or browser assertion.

## Required checks

These commands mirror [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
Update this section whenever that workflow changes.

From `backend/`:

```sh
uv run ruff check . ../scripts
uv run ruff format --check . ../scripts
uv run mypy
uv run lint-imports
uv run pytest
uv run python -m unittest discover -s ../scripts -p 'test_*.py'
```

From `web/`:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

For the browser suite, complete the backend locked install first: its launcher
starts `uv run uvicorn` from `backend/`. Then, from `web/`, install the same
Chromium binary as CI and run the suite:

```sh
pnpm exec playwright install --with-deps chromium-headless-shell
pnpm e2e
```

`pnpm e2e` rebuilds `web/dist` before Playwright. The suite creates and removes
its own database/raw-file directory and starts a fake-assistant backend on port
8765; it does not exercise the server or persistent state from the README.

## Mappings, decisions and documentation

- Mapping changes must remain declarative, validate against the v1 schema, and
  include preview/replay evidence. Preserve unmapped fields with reasons and
  the source's token semantics. Start with the
  [mapping reference](docs/mapping/README.md).
- Durable architectural choices require an ADR; add the next sequential record
  and update the [ADR index](docs/adr/README.md). Never edit an accepted ADR to
  disguise a replacement decision.
- Commands and numerical claims in documentation need fresh evidence. Link the
  authoritative contract rather than copying it; metric wording comes from the
  application definition map and is rendered by `/definitions` at runtime.

## Data, secrets and UI trust rules

Never commit `.env`, keys, tokens, raw uploads, gated datasets, `data/`, browser
reports, or package/build caches. A redistributable fixture needs pinned
provenance, licence and attribution, a deterministic manifest, and a recorded
sensitive-content review; see the [dataset policy](docs/datasets/README.md).
Treat trace content as untrusted data in the assistant and as inert text in the
browser.

Preserve missingness: `Unavailable` is not zero or a dash. Values that cannot
round-trip safely as JavaScript numbers need a lossless text representation;
raw records already expose `payload_text` for this purpose. Follow
[ADR-003](docs/adr/ADR-003-nulls-and-units.md) and
[ADR-006](docs/adr/ADR-006-ui-design-direction.md). Prefer icons where the
design calls for them, but every icon-only control must retain an accessible
name and a visible tooltip.

## Before coordinator review

- The issue's acceptance checks are mapped to tests or verification evidence.
- The required backend, web and e2e commands pass, or the exact failure and
  ownership are recorded.
- `git diff --check` is clean; generated files and secrets are absent.
- New local links resolve and Mermaid uses GitHub-supported syntax.
- User-visible limits, missing values and data provenance are documented.
- Commits are small and include the required authorship trailer.

The coordinator opens and merges pull requests and publishes releases.
