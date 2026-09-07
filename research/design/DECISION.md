# Design decision: Claude Console is the base for AgentScope's UI

Decided by the owner on 2026-09-07 after reviewing the eight candidates of the
design study (issue #27) side by side.

## Winner

**Claude Console** (`research/design/claude/3-console/`): one sticky scope bar
is the spine of the app; every number on every data screen is computed under
it, and drilling down (chart bar, quality counter, KPI) is the same gesture as
filtering because it appends a chip to that bar. KPIs show the exact value
under any abbreviation, coverage sits in the tile, "Unavailable" is a designed
state, and the path from a suspicious number to the source bytes is
scope → sessions → session → source record.

## Why it won

- One mechanism to learn (drill = filter) that serves the reviewer job best and
  keeps the daily import short.
- Cheapest to build on the current API contract with React 19 and Recharts:
  the shell is thin, the components are conventional, nothing needs a
  framework.
- Quiet, consistent visual system; trust surfaces (definition, coverage,
  exactness, provenance) appear at the right moment without prose.
- Weak spots noted for later: default-looking chart colours; the mapping
  assistant screen is competent rather than distinctive.

## Complements recommended by Claude, to confirm when the screens are built

- From **Claude Workbench**: the inspector pattern for the mapping assistant
  (mapping table as the work; the assistant's reasoning and the conversation
  in a side inspector) and for session-detail provenance (locator under every
  call id, diagnostics banner). Issues #13 to #15.
- From **Claude Guided ("Passage")**: the receipt rail for the stepped import,
  filling with verified facts (bytes, hash, mapping revision, dry-run counts)
  so the confirm step shows exactly what will be written. Issues #8 and #9.

## Ranking as reviewed

1. Claude Console. 2. Claude Workbench (purest disclosure discipline, best
assistant and session screens, costs more and is tight at 1280 px). 3. Claude
Guided. 4. Claude Ledger (most distinctive, density and ink-only charts are
risks). 5. Codex Console, then Codex Workbench, Codex Guided (rendering defect
on its dashboard) and Codex Ledger (editorial typography, headings drift into
copy).

## What this changes

- Issue #11 (dashboard), #9 (import accounting UI) and #15 (assistant UI)
  follow the Console design document: routes, disclosure model, tokens, type
  scale, component inventory and states in `claude/3-console/README.md`.
- The thin-slice UI from #7 is refactored into the Console shell rather than
  extended.
- Dark theme follows the token derivation stated in the Console README.

See ADR-006 for the architectural consequences.
