import { AxeBuilder } from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Accessibility regression, not an accessibility score.
 *
 * A rule is never disabled: doing that to excuse one old instance would exempt
 * every new control from the same rule. Instead each finding is identified by
 * (rule, target) and the run must be a subset of the recorded baseline, which
 * was captured with this same helper against the pre-change revision on the
 * same engine and the same route states. A route with no baseline entry — the
 * settings page, for instance — must therefore be clean.
 */

export const BASELINE = fileURLToPath(new URL('./axe-baseline.json', import.meta.url))

export interface Finding { route: string; theme: string; rule: string; target: string }
/* `route` is the state's stable name, never its path: session and report paths
   carry generated ids that differ between the baseline run and the check. */

export type Theme = 'light' | 'dark'

async function applyTheme(page: Page, theme: Theme) {
  await page.evaluate(value => {
    document.documentElement.setAttribute('data-theme', value)
    try { localStorage.setItem('agentscope-theme', value) } catch { /* private mode */ }
  }, theme)
}

/** Scan one route state in one theme, once its data has arrived. */
export async function scan(page: Page, route: string, path: string, theme: Theme, ready?: (page: Page) => Promise<void>): Promise<Finding[]> {
  await page.goto(path)
  await applyTheme(page, theme)
  if (ready) await ready(page)
  await page.waitForLoadState('networkidle')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  // Proof the scan actually ran: an injection that silently failed would report
  // no violations and look like success.
  expect(results.passes.length, `axe did not run on ${route} (${theme})`).toBeGreaterThan(0)
  return results.violations.flatMap(violation =>
    violation.nodes.map(node => ({ route, theme, rule: violation.id, target: node.target.join(' ') })))
}

const key = (finding: Finding) => `${finding.route} | ${finding.theme} | ${finding.rule} | ${finding.target}`

export function writeBaseline(findings: Finding[]) {
  const sorted = [...findings].sort((a, b) => key(a).localeCompare(key(b)))
  writeFileSync(BASELINE, `${JSON.stringify(sorted, null, 2)}\n`)
}

export function readBaseline(): Finding[] {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8')) as Finding[]
  } catch { return [] }
}

/** Every finding must already exist in the baseline; a new target fails even under an old rule. */
export function expectNoNewViolations(found: Finding[]) {
  const known = new Set(readBaseline().map(key))
  const added = found.filter(finding => !known.has(key(finding)))
  expect(added.map(key), 'new accessibility violations').toEqual([])
}
