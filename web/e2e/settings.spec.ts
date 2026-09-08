import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectNoNewViolations } from './axe.js'
import { ROUTES, sweep } from './routes.js'

/**
 * The issue's acceptance path in a real browser, against the fixture the smoke
 * project imported: tables that filter, dates that read, and a settings page
 * whose choices reach every page without a reload and survive one.
 */
test.describe.configure({ mode: 'serial' })

const SHOTS = 'test-results/tables-dates-settings'
// The fixture is 40 claude-code and 40 codex sessions; unscoped pages show PAGE_SIZE.
const CODEX_SESSIONS = 40
const PAGE_SIZE = 50

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error })
})

const dataRows = (page: Page) => page.getByRole('table', { name: 'Sessions in scope' }).getByRole('row')

/** Choose a display setting through the real controls, as a person would. */
async function chooseOnSettings(page: Page, options: { format?: RegExp; relative?: boolean; zone?: string; locale?: string }) {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  if (options.relative !== undefined) await page.getByLabel('Relative times').setChecked(options.relative)
  if (options.format) await page.getByRole('radio', { name: options.format }).check()
  if (options.zone) await page.getByLabel('Time zone').selectOption(options.zone)
  if (options.locale) await page.getByLabel('Number locale').selectOption(options.locale)
}

test('a table cell filters the app, and the chip takes it back', async ({ page }) => {
  await page.goto('/sessions')
  await expect(dataRows(page)).toHaveCount(PAGE_SIZE + 1) // + the header row
  await page.setViewportSize({ width: 1440, height: 1000 })

  // The agent cell is a link, not a button, so it can also open in a new tab.
  const cell = page.getByRole('link', { name: 'Filter by agent codex' }).first()
  await expect(cell).toHaveAttribute('href', /agent=codex/)
  await cell.click()

  await expect(page).toHaveURL(/\/sessions\?agent=codex/)
  await expect(dataRows(page)).toHaveCount(CODEX_SESSIONS + 1)
  const chips = page.getByRole('group', { name: 'Active filters' })
  await expect(chips).toContainText('Agent codex')
  await page.screenshot({ path: `${SHOTS}/1-sessions-scoped.png`, fullPage: true })

  // The active value is marked, and announces that clicking it clears the key.
  await expect(page.getByRole('link', { name: 'Clear the agent filter codex' }).first())
    .toHaveAttribute('aria-current', 'true')

  await chips.getByRole('button', { name: 'Remove Agent codex' }).click()
  await expect(page).toHaveURL(/\/sessions$/)
  await expect(dataRows(page)).toHaveCount(PAGE_SIZE + 1)
  await expect(page.getByRole('group', { name: 'Active filters' })).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/2-chip-removed.png`, fullPage: true })
})

test('a scope cell opens a scoped view in a new tab without moving this one', async ({ page, context }) => {
  await page.goto('/sessions')
  const opened = context.waitForEvent('page')
  await page.getByRole('link', { name: 'Filter by agent codex' }).first().click({ modifiers: ['ControlOrMeta'] })
  const tab = await opened
  await tab.waitForLoadState()
  expect(new URL(tab.url()).search).toContain('agent=codex')
  await expect(page).toHaveURL(/\/sessions$/) // the original tab is untouched
  await tab.close()
})

test('a display choice reaches another page and survives a reload', async ({ page }) => {
  await chooseOnSettings(page, { relative: false, format: /Day month year/, zone: 'UTC' })
  await page.screenshot({ path: `${SHOTS}/3-settings.png`, fullPage: true })

  const started = page.getByRole('table', { name: 'Import attempts, newest first' })
    .getByRole('row').nth(1).getByRole('button').first()
  await page.getByRole('link', { name: 'Imports', exact: true }).click()
  await expect(page).toHaveURL(/\/imports$/)
  await expect(started).toHaveText(/^\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/)
  await page.screenshot({ path: `${SHOTS}/4-imports-reformatted.png`, fullPage: true })

  await page.reload()
  await expect(started).toHaveText(/^\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/)

  // Relative times are a separate choice; the imports this run created are recent.
  await chooseOnSettings(page, { relative: true })
  await page.goto('/imports')
  await expect(started).toHaveText(/just now|\d+ min ago|\d+ h ago/)
})

test('every timestamp keeps the exact API value, and session pages carry the offset', async ({ page }) => {
  await chooseOnSettings(page, { relative: false, format: /ISO 8601/, zone: 'UTC' })

  const response = await page.request.get('/api/sessions?agent=codex&limit=1')
  const [session] = await response.json() as { id: string; external_id: string; observed_start_at: string }[]
  await page.goto('/sessions?agent=codex')
  const row = page.getByRole('row').filter({ hasText: session.external_id }).first()
  // The tooltip and title carry the API's own string, byte for byte.
  await expect(row.getByRole('button').first()).toHaveAttribute('title', session.observed_start_at)

  await page.goto(`/sessions/${encodeURIComponent(session.id)}`)
  await expect(page.getByRole('heading', { name: 'Session detail' })).toBeVisible()
  // The offset is on every session timestamp, not only on the interval facts,
  // so two instants that read alike across a DST change stay distinguishable.
  await expect(page.getByText(/\(UTC\+00:00\)/).first()).toBeVisible()
  expect(await page.getByText(/\(UTC\+00:00\)/).count()).toBeGreaterThan(1)
  await page.screenshot({ path: `${SHOTS}/5-session-dates.png`, fullPage: true })
})

test('a timestamp and a chip are reachable and operable from the keyboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await chooseOnSettings(page, { relative: false, format: /ISO 8601/, zone: 'UTC' })
  await page.goto('/sessions?agent=codex')

  const time = page.getByRole('table', { name: 'Sessions in scope' }).getByRole('row').nth(1).getByRole('button').first()
  const exact = (await time.getAttribute('title'))!
  await time.focus()
  await expect(time).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(time).toHaveAttribute('data-tip', 'Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(exact)

  const remove = page.getByRole('group', { name: 'Active filters' }).getByRole('button', { name: 'Remove Agent codex' })
  await remove.focus()
  await page.keyboard.press('Enter')
  // Focus is never dropped on the body when the last chip goes.
  await expect(page.getByRole('status').filter({ hasText: 'Filters cleared' })).toBeFocused()
})

test('no new accessibility violations on any route this branch touches', async ({ page }) => {
  test.setTimeout(300_000)
  expectNoNewViolations(await sweep(page, ROUTES))
})
