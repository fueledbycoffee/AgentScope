# Architecture decision records

ADRs record durable choices, the evidence behind them and the tradeoffs a
maintainer must preserve. Accepted records describe decisions, not proof that
every component or release verification has already been delivered.

| Record | Decision |
| --- | --- |
| [ADR-001: Stack](ADR-001-stack.md) | Python/FastAPI, React/TypeScript and SQLite; JSONL and Parquet. |
| [ADR-002: Identities](ADR-002-identities.md) | Separate source occurrences, native claims and entity comparisons; derive sessions. |
| [ADR-003: Nulls and units](ADR-003-nulls-and-units.md) | Preserve missingness and measurement semantics; report coverage. |
| [ADR-004: Mapping DSL v1](ADR-004-mapping-dsl-v1.md) | Replay a bounded declarative contract through four validation stages. |
| [ADR-005: LLM access](ADR-005-llm-access.md) | One application port, compatible adapter first, fake in CI. |
| [ADR-006: UI design direction](ADR-006-ui-design-direction.md) | Use the Console variant as the design of record, with accessible trust surfaces and explicit unavailable values. |

Use sequential, zero-padded numbers and descriptive filenames:
`ADR-NNN-short-topic.md`. Never reuse or renumber an accepted record.

To add a decision, choose the next unused number, explain one architectural
choice in roughly 60–150 lines, and add it to this index in the same PR. Include
`Status` (state and date), `Context`, `Decision`, `Consequences`, and
`Alternatives considered` (one line per alternative). Link evidence and related
records; distinguish a planned implementation from verified behavior.

Review proposed decisions through a PR. A replacement decision gets a new
number and links its predecessor; mark the old record superseded and link back.
Clarifications and implementation links can be added without rewriting history.

The [consolidated plan](../planning/2026-09-07-consolidated-plan.md) supplies the
agreed scope. Where earlier plans disagree with
[verified dataset findings](../datasets/README.md), the verified findings win;
record that correction explicitly.
