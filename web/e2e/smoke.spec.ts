import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
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

const SHOTS = 'test-results/guided-import-route'

async function uploadFixtureAndPreview(page: Page, screenshots = false) {
  await page.goto('/import')
  const progress = page.getByRole('complementary', { name: 'Progress' })
  await expect(progress.getByRole('list')).toBeVisible()
  await expect(progress.locator('[aria-current="step"]')).toHaveText('File')
  await expect(progress.getByRole('button')).toHaveCount(0)
  await page.getByLabel(/Trace file|Add another trace file/).setInputFiles(FIXTURE)
  await expect(page.getByRole('heading', { name: 'Uploaded file' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove tracelab-sample.jsonl.gz' })).toBeVisible()
  await expect(page.getByText('4,770').first()).toBeVisible()
  if (screenshots) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: `${SHOTS}/1-file.png`, fullPage: true })
  }
  await page.getByRole('button', { name: 'Continue to mapping' }).click()
  await expect(page).toHaveURL(/\/import\?step=2$/)
  await expect(page.getByRole('heading', { name: 'Choose how to read it' })).toBeFocused()
  await expect(progress.locator('[aria-current="step"]')).toHaveText('Mapping')
  await expect(page.getByRole('radio', { name: /tracelab-v1.*revision 1/ })).toBeChecked()
  await expect(page.getByText(/Neither fits\?/)).toContainText('Set up a new mapping with the assistant')
  if (screenshots) await page.screenshot({ path: `${SHOTS}/2-mapping.png`, fullPage: true })
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('agentscope-import-page') ?? '{}').entries?.[0]?.mappingId)).toBeTruthy()
  await page.goto('/import?step=3') // an interrupted dry run restores here without preview results
  await expect(page.getByRole('heading', { name: 'Dry run on up to 200 records per file' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run the dry run' })).toBeEnabled()
  await page.getByRole('button', { name: 'Run the dry run' }).click()
  await expect(page.getByText('Ignored').locator('..')).toContainText('0')
  await expect(page.getByText('No rejects in this sample.')).toBeVisible()
  if (screenshots) await page.screenshot({ path: `${SHOTS}/3-preview.png`, fullPage: true })
}

async function summary(page: Page) {
  const response = await page.request.get('/api/metrics/summary')
  expect(response.ok()).toBe(true)
  return response.json()
}

function comparable(body: { sessions: { value: number }; model_calls: { value: number }; tool_calls: { value: number }; input_tokens: { value: number; coverage: object; by_semantics: object } }) {
  return { sessions: body.sessions.value, model_calls: body.model_calls.value, tool_calls: body.tool_calls.value, input_tokens: body.input_tokens.value, coverage: body.input_tokens.coverage, by_semantics: body.input_tokens.by_semantics }
}

test('day-1 path: guided import, deep links, report, re-import leaves totals unchanged', async ({ page, browser }) => {
  await page.route('**/api/mappings*', async route => {
    const response = await route.fetch()
    const mappings = await response.json() as object[]
    await route.fulfill({ response, json: [...mappings, {
      id: 'map_history_other', name: 'history-source', source: 'other', revision: 1,
      created_by: 'user', input_format: 'jsonl',
    }] })
  })
  await uploadFixtureAndPreview(page, true)
  const progress = page.getByRole('complementary', { name: 'Progress' })
  await expect(progress.getByRole('button', { name: 'File' })).toBeVisible()
  await expect(progress.getByRole('button', { name: 'Mapping' })).toBeVisible()
  await expect(progress).toContainText('tracelab-v1 · rev 1') // facts sit under completed stops only

  // Responsive Passage rail becomes a strip above the stage without document overflow.
  await page.setViewportSize({ width: 900, height: 1000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => document.documentElement.clientWidth))
  const railBox = await progress.boundingBox()
  const stageBox = await page.locator('.import-route-stage').boundingBox()
  expect(railBox!.y + railBox!.height).toBeLessThanOrEqual(stageBox!.y + 1)
  await page.setViewportSize({ width: 1440, height: 1000 })

  // A completed stop backtracks and transfers focus; rerunning restores Preview.
  await progress.getByRole('button', { name: 'Mapping' }).click()
  await expect(page.getByRole('heading', { name: 'Choose how to read it' })).toBeFocused()
  await page.getByRole('button', { name: 'Run a dry run' }).click()
  await expect(page.getByRole('heading', { name: 'Dry run on up to 200 records per file' })).toBeFocused()

  // Back/Forward clamps a newly mixed-source batch to Mapping with its reason.
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('agentscope-import-page') ?? '{}').entries?.[0]?.preview)).toBeTruthy()
  await page.evaluate(() => {
    const key = 'agentscope-import-page'
    const stored = JSON.parse(sessionStorage.getItem(key)!)
    stored.entries.push({
      ...stored.entries[0],
      upload: { ...stored.entries[0].upload, upload_id: 'upl_history', filename: 'history.jsonl', sha256: 'f'.repeat(64) },
    })
    sessionStorage.setItem(key, JSON.stringify(stored))
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Dry run on up to 200 records per file' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Choose how to read it' })).toBeVisible()
  const historyMapping = page.getByRole('group', { name: 'Mapping for history.jsonl' })
  await historyMapping.getByRole('radio', { name: /history-source.*source other/ }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('agentscope-import-page')!).entries[1].mappingId)).toBe('map_history_other')
  await page.goForward()
  await expect(page).toHaveURL(/\/import\?step=2$/)
  await expect(page.getByRole('heading', { name: 'Choose how to read it' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('selected mappings declare different sources')

  // Restore the valid single-file batch for the remaining import assertions.
  await page.evaluate(() => {
    const key = 'agentscope-import-page'
    const stored = JSON.parse(sessionStorage.getItem(key)!)
    stored.entries = stored.entries.slice(0, 1)
    sessionStorage.setItem(key, JSON.stringify(stored))
  })

  // Stored summaries make step=3 reachable; a fresh context safely clamps it to File.
  await page.goto('/import?step=3')
  await expect(page.getByRole('heading', { name: 'Dry run on up to 200 records per file' })).toBeVisible()
  const origin = new URL(page.url()).origin
  const cleanContext = await (browser as Browser).newContext({ baseURL: origin, colorScheme: 'light', reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } })
  const cleanPage = await cleanContext.newPage()
  await cleanPage.goto('/import?step=3')
  await expect(cleanPage).toHaveURL(/\/import\?step=1$/)
  await expect(cleanPage.getByRole('heading', { name: 'Import a trace file' })).toBeVisible()
  await cleanContext.close()

  await page.getByRole('button', { name: 'Looks right, continue' }).click()
  await expect(page.getByRole('heading', { name: 'Confirm and run' })).toBeFocused()
  await expect(progress).toContainText('200 sampled · 0 rejected · 0 ignored') // the Preview stop is complete now; the dry run samples 200 per file
  await page.screenshot({ path: `${SHOTS}/4-confirm.png`, fullPage: true })
  const reportShown = page.waitForURL(/\/imports\/imp_/, { timeout: 120_000 })
  await page.getByRole('button', { name: 'Import 4,770 records' }).click()
  await reportShown
  firstImportId = new URL(page.url()).pathname.split('/').pop()!
  await expect(page.getByText(/^Committed in .* 4,770 of 4,770 records accepted, 0 rejected\.$/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Imported files' })).toContainText('tracelab-sample.jsonl.gz')

  // Import state was cleared: Back canonicalizes the stale Confirm history entry.
  await page.goBack()
  await expect(page).toHaveURL(/\/import\?step=1$/)
  await expect(page.getByRole('heading', { name: 'Import a trace file' })).toBeVisible()
  await page.goForward()

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

  // the same bytes again: the File stop names the earlier import, the report is a duplicate
  await page.goto('/import')
  await page.getByLabel(/Trace file|Add another trace file/).setInputFiles(FIXTURE)
  await expect(page.getByRole('heading', { name: 'Uploaded file' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Already imported' })).toBeVisible()
  await expect(page.getByRole('link', { name: firstImportId })).toBeVisible()
  await page.getByRole('button', { name: 'Continue to mapping' }).click()
  await page.getByRole('button', { name: 'Run a dry run' }).click()
  await expect(page.getByRole('heading', { name: 'Dry run on up to 200 records per file' })).toBeVisible()
  await page.getByRole('button', { name: 'Looks right, continue' }).click()
  const duplicateShown = page.waitForURL(/\/imports\/imp_/, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Import 4,770 records' }).click()
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
  const bare = await request.get('/api')
  expect(bare.status()).toBe(404)
  expect(bare.headers()['content-type']).toContain('application/json')
  expect(await bare.json()).toEqual({ error: { code: 'not_found', message: expect.any(String), details: [] } })
  expect((await request.get('/assets/missing.js')).status()).toBe(404)
  const page = await request.get('/sessions/anything')
  expect(page.status()).toBe(200)
  expect(page.headers()['content-type']).toContain('text/html')
})
