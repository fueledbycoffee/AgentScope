import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The assistant flow against the built backend with the deterministic fake provider
 * (start-backend.mjs sets AGENTSCOPE_LLM_PROVIDER=fake). It uses its own source so the smoke
 * spec's TraceLab totals are untouched, and a synthetic epoch file so the fake's one supported
 * revision ("treat ts as epoch seconds") changes the document in a way preview can show.
 */
test.describe.configure({ mode: 'serial' })

const ROWS = Array.from({ length: 30 }, (_, i) => JSON.stringify({ session: `s${i % 2}`, id: `c${i}`, ts: 1_757_000_000 + i })).join('\n')

async function uploadEpoch(page: Page) {
  await page.goto('/import')
  await page.getByLabel(/Trace file|Add another trace file/).setInputFiles({ name: 'epoch.jsonl', mimeType: 'application/x-ndjson', buffer: Buffer.from(ROWS) })
  await expect(page.getByRole('heading', { name: 'Uploaded file' })).toBeVisible()
}

test('analyse, review the payload, revise the epoch unit, validate, save, preview, import', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(`${request.method()} ${new URL(request.url()).pathname}`) })
  page.on('pageerror', error => { throw error })
  await uploadEpoch(page)
  await page.getByRole('button', { name: 'Continue to mapping' }).click() // the guided route: the assistant is a link on the Mapping stop
  await page.getByRole('link', { name: 'Set up a new mapping with the assistant' }).click()
  await expect(page).toHaveURL(/\/import\/assist\/upl_/)
  await expect(page.getByRole('heading', { name: 'Mapping assistant' })).toBeVisible()

  // evidence: the profile with exact numbers and the epoch hint
  const rail = page.getByRole('complementary', { name: 'Evidence' })
  await expect(rail).toContainText('30 of 30 records inspected')
  await expect(rail.getByRole('row').filter({ hasText: '$.ts' })).toContainText('epoch_seconds')

  // the composer waits for an identity
  await expect(page.getByLabel('Message to the assistant')).toBeDisabled()
  await page.getByLabel('Mapping name').fill('epoch-assist')
  await page.getByLabel('Source').fill('assist-e2e')
  await expect(page.getByLabel('Message to the assistant')).toBeEnabled()

  // sample on: the payload drawer must be acknowledged before anything is sent
  await rail.getByLabel(/Include a redacted sample/).check()
  await page.getByLabel('Message to the assistant').fill('Propose a mapping for this file')
  await page.getByLabel('Message to the assistant').press('Enter')
  const drawer = page.getByRole('dialog', { name: 'What the assistant will see' })
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText('1 redacted record included')
  await expect(drawer.getByText(/Digest/)).toBeVisible()
  expect(requests.filter(r => r.endsWith('/assistant/run'))).toHaveLength(0)
  await drawer.getByRole('button', { name: 'Send this' }).click()

  // the proposal lands in the editor with the fake's ambiguity, plus a receipt
  const log = page.getByRole('log', { name: 'Conversation' })
  await expect(log).toContainText('model_call.started_at: epoch_s or epoch_ms', { timeout: 30_000 })
  await expect(log).toContainText('proposal applied · fake/deterministic-1 · 1 call · executable')
  // the field table is the default view now; this spec follows the document as text
  await page.getByRole('button', { name: 'JSON document' }).click()
  const editor = page.getByLabel('Mapping document (JSON)')
  await expect(editor).toHaveValue(/"timestamp_format": "epoch_ms"/)
  expect(requests.filter(r => r.endsWith('/assistant/run'))).toHaveLength(1)
  expect(requests.filter(r => r === 'POST /api/mappings' || r === 'POST /api/imports')).toHaveLength(0)

  // revise through the conversation: the document changes
  await page.getByLabel('Message to the assistant').fill('treat ts as epoch seconds')
  await page.getByLabel('Message to the assistant').press('Enter')
  await page.getByRole('dialog', { name: 'What the assistant will see' }).getByRole('button', { name: 'Send this' }).click()
  await expect(editor).toHaveValue(/"timestamp_format": "epoch_s"/, { timeout: 30_000 })
  await expect(log).toContainText('Proposal applied, no open questions.')

  // gates: validate, save, preview, import, each explicit
  await page.getByRole('button', { name: 'Validate the document' }).click()
  await expect(page.getByText('No issues: the document is executable.')).toBeVisible()
  await page.getByRole('button', { name: 'Save a mapping revision' }).click()
  await expect(page.getByText(/Saved as epoch-assist revision 1 \(new\)/)).toBeVisible()
  await page.getByRole('button', { name: 'Preview the import' }).click()
  await expect(page.getByRole('heading', { name: 'Preview of revision 1' })).toBeVisible()
  await expect(page.getByText(/first session:/)).toBeVisible()
  await expect(page.getByText(/2025-09-04T15:33:2\d/)).toBeVisible() // 1,757,000,000 s read as seconds (2025-09-04), not as milliseconds (1970)
  const reportShown = page.waitForURL(/\/imports\/imp_/, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Import with this revision' }).click()
  await reportShown
  await expect(page.getByText(/^Committed in .* 30 of 30 records accepted, 0 rejected\.$/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Imported files' })).toContainText('epoch-assist')
  expect(requests.filter(r => r === 'POST /api/mappings')).toHaveLength(1)
  expect(requests.filter(r => r === 'POST /api/imports')).toHaveLength(1)

  // the new source is visible and isolated from the smoke spec's TraceLab totals
  await page.goto('/sessions?source=assist-e2e')
  const rows = page.getByRole('table', { name: 'Sessions in scope' }).getByRole('row')
  await expect(rows).toHaveCount(3) // header + 2 sessions
})
