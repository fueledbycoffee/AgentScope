# AgentScope

Import, normalise and explore traces of AI coding agents (Claude Code, Codex and others).

AgentScope takes trace files (JSONL, Parquet), normalises them into a common relational model of sessions, model calls and tool calls, keeps the original records and their provenance, and lets you explore the result in a dashboard. An LLM-assisted import helper proposes a mapping for files it has never seen; the mapping is validated and applied by a deterministic engine, never by the model itself.

> Not related to the `agentscope` Python package (Alibaba's agent framework).

## Status

Pre-release. The plan for v0.1.0 lives in [`docs/planning/`](docs/planning/2026-09-07-consolidated-plan.md). Work is tracked on the GitHub Project linked to this repository.

## Licence

MIT. See [LICENSE](LICENSE).
