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
