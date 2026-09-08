import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

/**
 * The field table end to end: propose → apply an ambiguity as an edit → edit an option in the
 * table → validate → save → preview → import → correct the mapping from the report it produced.
 *
 * The upload is created through the API and the page is opened directly on the assistant route, so
 * this spec does not depend on the import page's selectors (issue #45 is rebuilding that page).
 * It uses its own source, and its own project runs after the smoke and assistant projects, so no
 * unscoped total any other spec measures is disturbed.
 */
test.describe.configure({ mode: 'serial' })

const SOURCE = 'assist-table-e2e'
const ROWS = Array.from({ length: 12 }, (_, i) =>
  JSON.stringify({ session: `s${i % 2}`, id: `c${i}`, ts: 1_757_000_000 + i }),
).join('\n')

async function uploadThroughApi(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/uploads', {
    multipart: { file: { name: 'epoch-table.jsonl', mimeType: 'application/x-ndjson', buffer: Buffer.from(ROWS) } },
  })
  expect(response.status()).toBe(201)
  const upload = (await response.json()) as { upload_id: string }
  return upload.upload_id
}

async function propose(page: Page, uploadId: string) {
  await page.goto(`/import/assist/${uploadId}`)
  await expect(page.getByRole('heading', { name: 'Mapping assistant' })).toBeVisible()
  await page.getByLabel('Mapping name').fill('epoch-table')
  await page.getByLabel('Source').fill(SOURCE)
  const composer = page.getByLabel('Message to the assistant')
  await composer.fill('Propose a mapping for this file')
  await composer.press('Enter')
  await expect(page.getByRole('region', { name: 'Rule model_call' })).toBeVisible({ timeout: 30_000 })
}

test('the table edits the proposal, saves it, imports it, and reopens it from the report', async ({ page, request }) => {
  const requests: string[] = []
  page.on('request', r => { if (r.url().includes('/api/')) requests.push(`${r.method()} ${new URL(r.url()).pathname}`) })
  page.on('pageerror', error => { throw error })

  const uploadId = await uploadThroughApi(request)
  await propose(page, uploadId)

  // the proposal is shown as rows over the same text the JSON view holds
  await expect(page.getByLabel('path of started_at in model_call')).toHaveValue('$.ts')
  expect(requests.filter(r => r === 'POST /api/mappings' || r === 'POST /api/imports')).toHaveLength(0)

  // the ambiguity is executable, and it names the operation it will perform
  const ambiguities = page.getByRole('region', { name: 'Ambiguities' })
  await expect(ambiguities).toContainText('model_call.started_at')
  await ambiguities.getByRole('button', { name: /^set timestamp_format of model_call · started_at to "epoch_s"$/ }).click()
  await expect(page.getByLabel('timestamp_format of started_at in model_call')).toHaveValue('epoch_s')

  // an option the table owns, edited straight into the document
  await page.getByLabel('on_missing of started_at in model_call').selectOption('reject')
  await page.getByRole('button', { name: 'JSON document' }).click()
  const editor = page.getByLabel('Mapping document (JSON)')
  await expect(editor).toHaveValue(/"timestamp_format": "epoch_s"/)
  await expect(editor).toHaveValue(/"on_missing": "reject"/)
  await page.getByRole('button', { name: 'Field table' }).click()

  // the gates, each explicit
  await page.getByRole('button', { name: 'Validate the document' }).click()
  await expect(page.getByText('No issues: the document is executable.')).toBeVisible()
  await page.getByRole('button', { name: 'Save a mapping revision' }).click()
  await expect(page.getByText(/Saved as epoch-table revision 1 \(new\)/)).toBeVisible()
  await page.getByRole('button', { name: 'Preview the import' }).click()
  await expect(page.getByRole('heading', { name: 'Preview of revision 1' })).toBeVisible()
  // epoch seconds, not milliseconds: 1,757,000,000 s is 2025-09-04
  await expect(page.getByText(/2025-09-04T15:33:2\d/)).toBeVisible()

  const reportShown = page.waitForURL(/\/imports\/imp_/, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Import with this revision' }).click()
  await reportShown
  await expect(page.getByText(/^Committed in .* 12 of 12 records accepted, 0 rejected\.$/)).toBeVisible({ timeout: 30_000 })

  // nothing was written before the explicit clicks
  const firstSave = requests.indexOf('POST /api/mappings')
  const firstImport = requests.indexOf('POST /api/imports')
  expect(firstSave).toBeGreaterThan(-1)
  expect(firstImport).toBeGreaterThan(firstSave)
})

test('the report reopens the file’s own revision, refusing any other bytes', async ({ page }) => {
  page.on('pageerror', error => { throw error })
  await page.goto('/imports')
  await page.getByRole('link', { name: /^imp_/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Import report' })).toBeVisible()

  await page.getByRole('button', { name: /^Correct the mapping of epoch-table\.jsonl/ }).click()
  const dialog = page.getByRole('dialog', { name: "Correct this file's mapping" })
  await expect(dialog).toContainText('epoch-table')

  // the wrong bytes are refused here, before any upload
  await dialog.getByLabel('Trace file').setInputFiles({ name: 'other.jsonl', mimeType: 'application/x-ndjson', buffer: Buffer.from('{"session": "x"}\n') })
  await expect(dialog).toContainText('Those are different bytes')

  // the right bytes open the assistant on that file's own revision
  await dialog.getByLabel('Trace file').setInputFiles({ name: 'epoch-table.jsonl', mimeType: 'application/x-ndjson', buffer: Buffer.from(ROWS) })
  await expect(page).toHaveURL(/\/import\/assist\/upl_/, { timeout: 30_000 })
  await expect(page.getByLabel('Mapping name in the document')).toHaveValue('epoch-table')
  await expect(page.getByLabel('Import source')).toHaveValue(SOURCE)
  await expect(page.getByText(/inserts nothing/)).toBeVisible()
  await expect(page.getByLabel('timestamp_format of started_at in model_call')).toHaveValue('epoch_s')
})

test('re-importing the corrected revision into the same source inserts nothing', async ({ page }) => {
  page.on('pageerror', error => { throw error })
  const before = await page.request.get(`/api/sessions?source=${SOURCE}&limit=100`)
  const sessionsBefore = ((await before.json()) as unknown[]).length

  await page.goto('/imports')
  await page.getByRole('link', { name: /^imp_/ }).first().click()
  await page.getByRole('button', { name: /^Correct the mapping of epoch-table\.jsonl/ }).click()
  const dialog = page.getByRole('dialog', { name: "Correct this file's mapping" })
  await dialog.getByLabel('Trace file').setInputFiles({ name: 'epoch-table.jsonl', mimeType: 'application/x-ndjson', buffer: Buffer.from(ROWS) })
  await expect(page).toHaveURL(/\/import\/assist\/upl_/, { timeout: 30_000 })

  // correct one option, save the new revision, and import it into the very same source
  await page.getByLabel('on_invalid of started_at in model_call').selectOption('null')
  await page.getByRole('button', { name: 'Validate the document' }).click()
  await expect(page.getByText('No issues: the document is executable.')).toBeVisible()
  await page.getByRole('button', { name: 'Save a mapping revision' }).click()
  await expect(page.getByText(/Saved as epoch-table revision 2/)).toBeVisible()
  await page.getByRole('button', { name: 'Preview the import' }).click()
  await expect(page.getByRole('heading', { name: 'Preview of revision 2' })).toBeVisible()
  const reportShown = page.waitForURL(/\/imports\/imp_/, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Import with this revision' }).click()
  await reportShown

  // the same bytes in the same source: a duplicate, whatever the mapping now says
  await expect(page.getByText(/No observations were inserted\./)).toBeVisible({ timeout: 30_000 })
  const after = await page.request.get(`/api/sessions?source=${SOURCE}&limit=100`)
  expect(((await after.json()) as unknown[]).length).toBe(sessionsBefore)
})

test('the layout holds at 1280, 1279 and 900 px, in both themes', async ({ page }) => {
  page.on('pageerror', error => { throw error })
  await page.goto('/imports')
  await page.getByRole('link', { name: /^imp_/ }).first().click()
  await page.getByRole('button', { name: /^Correct the mapping of epoch-table\.jsonl/ }).click()
  const dialog = page.getByRole('dialog', { name: "Correct this file's mapping" })
  await dialog.getByLabel('Trace file').setInputFiles({ name: 'epoch-table.jsonl', mimeType: 'application/x-ndjson', buffer: Buffer.from(ROWS) })
  await expect(page).toHaveURL(/\/import\/assist\/upl_/, { timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Rule model_call' })).toBeVisible()

  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme })
    for (const width of [1280, 1279, 900]) {
      await page.setViewportSize({ width, height: 900 })
      // the rail is a real disclosure below 1280, so wait for the layout before measuring it
      const collapsed = page.getByRole('button', { name: /^Evidence: / })
      if (width < 1280) await expect(collapsed).toBeVisible()
      else await expect(collapsed).toHaveCount(0)
      const measured = await page.evaluate(() => {
        const root = document.scrollingElement!
        const wrap = document.querySelector('.field-table .table-wrap')!
        const table = wrap.querySelector('table')!
        const row = document.querySelector('.field-table tbody tr')!
        return {
          pageOverflow: root.scrollWidth - root.clientWidth,
          tableOverflow: table.scrollWidth - wrap.clientWidth,
          rowHeight: Math.round(row.getBoundingClientRect().height),
        }
      })
      // eslint-disable-next-line no-console
      console.log(`[layout] ${theme} ${width}px page=${measured.pageOverflow} table=${measured.tableOverflow} row=${measured.rowHeight}`)
      expect(measured.pageOverflow, `${theme} ${width}px: the page itself must never scroll sideways`).toBeLessThanOrEqual(0)
      expect(measured.tableOverflow, `${theme} ${width}px: a field row must fit without scrolling the table`).toBeLessThanOrEqual(0)
    }
  }
})
