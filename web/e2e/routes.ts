import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { scan } from './axe.js'
import type { Finding, Theme } from './axe.js'

/**
 * The route states the accessibility sweep visits, in both themes, once their
 * data has arrived: an empty table would hide exactly the violations a table
 * can have.
 */

export interface RouteState {
  name: string
  /** Resolved against the imported fixture; the report route needs a real id. */
  path: (page: Page) => Promise<string>
  ready?: (page: Page) => Promise<void>
  /** Routes that do not exist on the baseline revision are still swept here. */
  newInThisBranch?: boolean
}

async function firstImportId(page: Page): Promise<string> {
  const response = await page.request.get('/api/imports?limit=1')
  const [first] = await response.json() as { import_id: string }[]
  return first.import_id
}

async function firstSessionId(page: Page): Promise<string> {
  const response = await page.request.get('/api/sessions?limit=1')
  const [first] = await response.json() as { id: string }[]
  return first.id
}

const tableReady = async (page: Page) => {
  await expect(page.getByRole('table').first().getByRole('row').nth(1)).toBeVisible()
}

export const ROUTES: RouteState[] = [
  { name: 'overview', path: async () => '/overview', ready: tableReady },
  { name: 'sessions', path: async () => '/sessions', ready: tableReady },
  // A scoped state, so the chips and the marked active cell are scanned too.
  { name: 'sessions scoped', path: async () => '/sessions?agent=codex', ready: tableReady },
  { name: 'session detail', path: async page => `/sessions/${encodeURIComponent(await firstSessionId(page))}`,
    ready: async p => { await expect(p.getByRole('heading', { name: 'Session detail' })).toBeVisible() } },
  { name: 'imports', path: async () => '/imports', ready: tableReady },
  { name: 'import report', path: async page => `/imports/${encodeURIComponent(await firstImportId(page))}`,
    ready: async p => { await expect(p.getByRole('heading', { name: 'Import report' })).toBeVisible() } },
  { name: 'settings', path: async () => '/settings', newInThisBranch: true,
    ready: async p => { await expect(p.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible() } },
]

const THEMES: Theme[] = ['light', 'dark']

export async function sweep(page: Page, routes: RouteState[]): Promise<Finding[]> {
  const findings: Finding[] = []
  for (const route of routes) {
    const path = await route.path(page)
    for (const theme of THEMES) findings.push(...await scan(page, route.name, path, theme, route.ready))
  }
  return findings
}

/** The baseline revision does not serve routes this branch adds, so it cannot record them. */
export const baselineRoutes = () => ROUTES.filter(route => !route.newInThisBranch)
