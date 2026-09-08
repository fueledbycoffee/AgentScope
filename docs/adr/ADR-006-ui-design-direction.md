# ADR-006: UI design direction is the Console variant

## Status

Accepted — 2026-09-07.

## Context

Before day 2 of the v0.1.0 sprint the owner commissioned a design study
(issue #27): eight enterprise-grade candidates from one brief
(`research/design/00-brief.md`), four by Claude and four by Codex, across four
directions (Workbench, Ledger, Console, Guided). The brief's governing
principle is progressive disclosure: a thing is shown only if strictly
necessary for the task at hand; everything else is one deliberate step away.
The candidates were reviewed side by side on the same seven screens.

## Decision

The **Console** variant by Claude (`research/design/claude/3-console/`) is the
design of record for the web application. Its rules bind UI work from #8 on:

1. **One global scope.** A sticky scope bar (source, agent, model, period)
   governs every data screen; import, report and assistant screens swap in a
   file-identity bar in the same slot. Drilling down appends a chip to the
   scope and navigates to sessions; there is no second drill mechanism.
2. **Exactness without hover.** Numbers abbreviate only above 99,999 and print
   the exact value beside them; coverage is shown in the same element as the
   value; "Unavailable" is a rendered state, never 0.
3. **Trust surfaces one step away, same place every time.** Definition,
   unit, semantics and coverage open from an `i` control; provenance opens
   from a "Source record" control into a `<dialog>` showing file hash,
   locator and the server's exact `payload_text`.
4. **Visual system.** The token set, type scale, spacing scale, density and
   dark derivation in the Console README; no cards with shadows, no icons
   beyond the `i` and the chip close, charts drawn with Recharts to the same
   scale rules as the mockup's SVG.
5. **Complements** may be adopted per screen when they respect rules 1 to 4:
   the Workbench inspector for the mapping assistant and session provenance,
   the Guided receipt rail for the stepped import. Each is confirmed with the
   owner when its issue starts.

### Amendment: Passage structure for `/import` (2026-09-08, issue #45)

The owner confirms the Guided candidate's **Passage** structure for `/import`
and that route only: File → Mapping → Preview → Confirm, with a progress rail
that turns verified file, mapping, and dry-run facts into the final receipt.
Import is a gated provenance-building task, so the complement makes the point
of commitment clearer than the otherwise preferred Console page structure.

Console remains the design of record for the application shell, tokens, type,
spacing, primitive behaviour, and every other route. This amendment adopts no
Passage colour or typography tokens and no Guided dashboard, ledger, report,
session, or assistant layout. It changes neither API calls nor server-side
persistence and does not imply backend progress telemetry where the
request/response API exposes none.

Rule 4's original “no icons beyond” language rejects decorative icon
proliferation. It does not prohibit the action-icon set established in the
implemented Console shell: secondary icon-only actions use an accessible name
and visible tooltip, while each stage's primary action keeps its written verb.

### Amendment: dashboard hierarchy and URL drill scope (2026-09-08, issue #11)

The Overview keeps exactly four visually dominant cards: Sessions,
Model-call observations, Tool-call observations, and Input usage by accounting
group. Scheduled cost and observed span in imported data sit in a quieter
two-value headline strip. Output usage remains visible in the token panel and
as the second Tokens-by-model series. This preserves the Console scan order
without presenting six values as equal decisions.

The global URL scope gains one versioned `drill` envelope as the sole carrier
of an allowlisted server-returned chart or quality scope. It is part of the
same scope as Source, Agent, Model, and Period—not component state and not a
second drill mechanism—and explicitly excludes internal session IDs. Current
base values take precedence over matching envelope fields. Removing a base
value also removes that field and its mutually exclusive unknown predicate
from the envelope; changing Period invalidates the envelope because its
witness bounds describe the earlier period. The complete envelope remains in
links and browser history so reload, Back, and chart-to-session navigation
select the same population.

## Consequences

- Integration is a dedicated issue (#30): tokens, shell and reusable
  components land first, and the #7 thin slice is re-hosted in that shell (routes
  `/overview`, `/sessions`, `/sessions/:id`, `/imports`, `/imports/:id`,
  `/import`, `/mappings`, `/assistant`, `/definitions`).
- The metric layer (#10) must expose per-metric definition, unit, semantics
  and coverage in the response so rule 2 and 3 need no client-side knowledge.
- The query API gains the scope parameters the bar needs (source, agent,
  model, period) on sessions and metrics endpoints (#11).
- A Playwright smoke test (#12) covers the scope → sessions → session →
  source record path.
- Rejected alternatives and their trade-offs are recorded in
  `research/design/DECISION.md`; the other seven candidates remain in
  `research/design/` as reference.
