import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

/**
 * The day-1 gate and the shell, in a real browser against the built backend.
 * Serial: later tests rely on the fixture imported by the first one. Numbers
 * below are the fixture's known totals (fixtures/tracelab/tracelab-sample.manifest.json).
 */
test.describe.configure({ mode: 'serial' })

const FIXTURE = fileURLToPath(new URL('../../fixtures/tracelab/tracelab-sample.jsonl.gz', import.meta.url))
const TOTALS = { sessions: 80, model_calls: 4770, tool_calls: 5723, input_tokens: 553447877, coverage: { known: 4770, total: 4770 }, by_semantics: { 'tracelab-claude': 186454781, 'tracelab-codex': 366993096 } }
const CODEX = { sessions: 40, model_calls: 3187 }

let firstImportId = ''

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error })
})

async function uploadFixtureAndPreview(page: Page) {
  await page.goto('/import')
  await page.getByLabel(/Trace file|Add another trace file/).setInputFiles(FIXTURE)
  await expect(page.getByRole('heading', { name: 'Uploaded file' })).toBeVisible()
  await expect(page.getByText('4,770').first()).toBeVisible()
  const mapping = page.getByLabel('Mapping')
  const label = await mapping.getByRole('option', { name: /tracelab-v1 · revision 1/ }).textContent()
  await mapping.selectOption({ label: label!.trim() })
  await page.getByRole('button', { name: 'Preview' }).click()
  await expect(page.getByRole('heading', { name: 'Import preview' })).toBeVisible()
  await expect(page.getByText('No rejects in this sample.')).toBeVisible()
}

async function summary(page: Page) {
  const response = await page.request.get('/api/metrics/summary')
  expect(response.ok()).toBe(true)
  return response.json()
}

function comparable(body: { sessions: { value: number }; model_calls: { value: number }; tool_calls: { value: number }; input_tokens: { value: number; coverage: object; by_semantics: object } }) {
  return { sessions: body.sessions.value, model_calls: body.model_calls.value, tool_calls: body.tool_calls.value, input_tokens: body.input_tokens.value, coverage: body.input_tokens.coverage, by_semantics: body.input_tokens.by_semantics }
}

test('day-1 path: upload, preview, import, overview, re-import leaves totals unchanged', async ({ page }) => {
  await uploadFixtureAndPreview(page)
  const reportShown = page.waitForURL(/\/imports\/imp_/, { timeout: 120_000 })
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await reportShown
  firstImportId = new URL(page.url()).pathname.split('/').pop()!
  await expect(page.getByText(/^Committed in .* 4,770 of 4,770 records accepted, 0 rejected\.$/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Imported files' })).toContainText('tracelab-sample.jsonl.gz')

  expect(comparable(await summary(page))).toEqual(TOTALS)
  await page.getByRole('link', { name: 'Open dashboard' }).click()
  await expect(page).toHaveURL(/\/overview/)
  await expect(page.getByRole('region', { name: 'Sessions' }).first()).toContainText('80')
  await expect(page.getByRole('region', { name: 'Model calls' })).toContainText('4,770')
  await expect(page.getByRole('region', { name: 'Tool calls' })).toContainText('5,723')
  const tokens = page.getByRole('region', { name: 'Input tokens' })
  await expect(tokens).toContainText('553.4M')
  await expect(tokens).toContainText('exact 553,447,877')
  await expect(tokens).toContainText('coverage 4,770 / 4,770 calls')

  // the same bytes again: the upload names the earlier import, the report is a duplicate
  await uploadFixtureAndPreview(page)
  await expect(page.getByRole('heading', { name: 'Already imported' })).toBeVisible()
  await expect(page.getByRole('link', { name: firstImportId })).toBeVisible()
  const duplicateShown = page.waitForURL(/\/imports\/imp_/, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await duplicateShown
  const secondImportId = new URL(page.url()).pathname.split('/').pop()!
  expect(secondImportId).not.toBe(firstImportId)
  await expect(page.getByText('These bytes were already imported for this source. No observations were inserted.')).toBeVisible()
  await expect(page.getByRole('link', { name: firstImportId }).first()).toBeVisible() // the report points at the original
  expect(comparable(await summary(page))).toEqual(TOTALS)
})

test('scope, rail, session and the modal source-record dialog', async ({ page }) => {
  await page.goto('/overview')
  const agent = page.getByRole('group', { name: 'Scope' }).getByLabel('Agent')
  await agent.fill('codex')
  await agent.press('Enter')
  await expect(page).toHaveURL(/agent=codex/)
  await expect(page.getByRole('group', { name: 'Scope' })).toContainText(`${CODEX.sessions} sessions · ${CODEX.model_calls.toLocaleString('en-US')} model calls`)
  await expect(page.getByRole('region', { name: 'Sessions' }).first()).toContainText(String(CODEX.sessions))

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Sessions' }).click()
  await expect(page).toHaveURL(/\/sessions\?agent=codex/)
  const rows = page.getByRole('table', { name: 'Sessions in scope' }).getByRole('row')
  await expect(rows.nth(1)).toContainText('codex')
  const externalId = (await rows.nth(1).getByRole('link').first().textContent())!.trim()
  await rows.nth(1).getByRole('link').first().click()
  await expect(page.getByRole('heading', { name: 'Session detail' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Sessions' })).toHaveAttribute('href', /agent=codex/)

  // keyboard to the first source-record button, open the native modal dialog
  const button = page.getByRole('button', { name: /^Source record for model call / }).first()
  await button.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Source record' })
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate(element => element instanceof HTMLDialogElement && element.open && element.matches(':modal'))).toBe(true)
  await expect(dialog).toContainText(externalId)
  await expect(dialog.getByText('File SHA-256')).toBeVisible()
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('dialog[open]') !== null)).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(button).toBeFocused()

  // popover: Escape closes and returns focus; skip link is the first tab stop
  await page.goto('/overview')
  const info = page.getByRole('button', { name: 'Definition of Input tokens' })
  await info.click()
  await expect(page.getByRole('dialog', { name: 'Input tokens' })).toContainText('Definition')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Input tokens' })).toHaveCount(0)
  await expect(info).toBeFocused()
  // from the top of the document, the first Tab stop is the skip link
  await page.goto('/overview')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
})

test('deep links, redirects and the theme stamped before the app runs', async ({ page, browser }) => {
  await page.goto('/sessions?agent=codex')
  await expect(page.getByRole('group', { name: 'Scope' }).getByLabel('Agent')).toHaveValue('codex')
  await expect(page.getByRole('table', { name: 'Sessions in scope' }).getByRole('row').nth(1)).toContainText('codex')
  await page.goto('/sessions?source=nope')
  await expect(page.getByText('No sessions match this scope. Clear the scope or import traces.')).toBeVisible()
  await page.goto('/dashboard?agent=codex')
  await expect(page).toHaveURL(/\/overview\?agent=codex$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/sessions\?source=nope/)

  // choose dark, then prove the head bootstrap alone stamps it: block the app module
  await page.goto('/overview')
  await page.getByRole('button', { name: 'Dark theme' }).click()
  expect(await page.evaluate(() => localStorage.getItem('agentscope-theme'))).toBe('dark')
  const storage = await page.context().storageState()
  const context = await browser.newContext({ colorScheme: 'light', storageState: storage })
  const fresh = await context.newPage()
  await fresh.route('**/assets/*.js', route => route.abort())
  await fresh.goto('/overview', { waitUntil: 'domcontentloaded' })
  expect(await fresh.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark')
  expect(await fresh.evaluate(() => document.getElementById('root')?.childElementCount ?? 0)).toBe(0)
  expect(await fresh.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(14, 16, 19)')
  await context.close()
})

test('the API keeps its envelope behind the SPA fallback', async ({ request }) => {
  const typo = await request.get('/api/metrics/sumary')
  expect(typo.status()).toBe(404)
  expect(typo.headers()['content-type']).toContain('application/json')
  expect(await typo.json()).toEqual({ error: { code: 'not_found', message: expect.any(String), details: [] } })
  expect((await request.get('/api')).status()).toBe(404)
  expect((await request.get('/assets/missing.js')).status()).toBe(404)
  const page = await request.get('/sessions/anything')
  expect(page.status()).toBe(200)
  expect(page.headers()['content-type']).toContain('text/html')
})
