// Local verification harness for issue #16 (never a CI test: it needs the live provider and the
// SWE-chat excerpt). Drives the assistant UI exactly as a person would, per configuration, on an
// isolated backend, snapshots the database before importing, imports, and writes an artifact
// directory. `--replay <snapshot-dir>` restores a pre-import snapshot, starts the backend with
// the assistant unavailable (AGENTSCOPE_LLM_PROVIDER=none) and imports with the saved revisions.
//
//   node e2e/verify-second-source.mjs --run A-sessions --file ../data/samples/swe-chat-1/sessions.parquet \
//     --name swe-chat-sessions-v1 --source swe-chat --model dots-studio/dots-3-note-preview:free \
//     --message "Propose a mapping for this file" [--sample] [--revise "…"] [--replace 'old=>new']
//     [--force-import] [--out ../data/verification/runs]
//   --replace applies a human correction to the editor text as a plain string replacement (no
//   parsing; recorded with base and target hashes). --delete-field rule_id.field removes one field
//   mapping and --set-where 'rule_id=<json array>' replaces a rule's conditions (these two parse and
//   re-indent the document; recorded as such with hashes). Import runs only when the preview accepted at
//   least one record, unless --force-import.
//   node e2e/verify-second-source.mjs --replay ../data/verification/runs/A-sessions/snapshot --file … --out …
//
// Artifacts (local root, gitignored): outcome.json (sanitised: mapping, issues, explanations,
// ambiguities, questions, model, attempts, adapter notes; no payload text), prepared.json (digest,
// bytes, redactions, truncated, sample flags), requests.json (method/path/status counters), the
// saved document, preview and import reports, and the pre-import snapshot (database + raw store).
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = resolve(here, '..', '..')
// repeated flags accumulate into arrays (--replace, --set-where, --delete-field, --revise)
const args = {}
for (const [key, value] of process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]])
  return acc
}, [])) {
  if (key in args) args[key] = [].concat(args[key], value)
  else args[key] = value
}
const out = resolve(args.out ?? join(repo, 'data', 'verification', 'runs'))
const runId = args.run ?? (args.replay ? `replay-${Date.now()}` : `run-${Date.now()}`)
const runDir = join(out, runId)
mkdirSync(runDir, { recursive: true })
const port = Number(args.port ?? 8767)
const base = `http://127.0.0.1:${port}`

function log(...parts) { console.log(new Date().toISOString(), ...parts) }

async function startBackend(root, env) {
  mkdirSync(root, { recursive: true })
  const child = spawn('uv', ['run', 'uvicorn', 'agentscope_app.interfaces.api.main:app', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: join(repo, 'backend'),
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, AGENTSCOPE_DATABASE_URL: `sqlite:///${join(root, 'agentscope.sqlite3')}`, AGENTSCOPE_RAW_FILE_DIR: join(root, 'raw'), ...env },
  })
  for (let i = 0; i < 120; i += 1) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return child } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 500))
  }
  child.kill('SIGTERM')
  throw new Error('backend did not start')
}

const counters = {}
function count(request, status) {
  const key = `${request.method()} ${new URL(request.url()).pathname} ${status}`
  counters[key] = (counters[key] ?? 0) + 1
}

async function uploadAndOpenAssistant(page, file) {
  await page.goto(`${base}/import`)
  await page.getByLabel(/Trace file|Add another trace file/).setInputFiles(file)
  await page.getByRole('heading', { name: 'Uploaded file' }).waitFor()
  await page.getByRole('button', { name: 'Draft a mapping with the assistant' }).click()
  await page.getByRole('heading', { name: 'Mapping assistant' }).waitFor()
  return new URL(page.url()).pathname.split('/').pop()
}

async function sendAndWait(page, message, sample) {
  const input = page.getByLabel('Message to the assistant')
  await input.fill(message)
  await input.press('Enter')
  if (sample) {
    const drawer = page.getByRole('dialog', { name: 'What the assistant will see' })
    await drawer.waitFor({ timeout: 60_000 })
    const text = await drawer.innerText()
    await drawer.getByRole('button', { name: 'Send this' }).click()
    return text
  }
  return null
}

/** A reply bubble, or an error/warning notice (502, 503, 409 twice, refusal): whichever comes first. */
async function waitForReplyOrNotice(page, nth, notices) {
  const bubble = page.getByRole('log', { name: 'Conversation' }).getByText(/proposal applied|did not return a proposal/).nth(nth)
  const notice = page.locator('.notice.bad, .notice.warn').last()
  const deadline = Date.now() + 600_000
  while (Date.now() < deadline) {
    if (await bubble.count() > 0) return 'reply'
    if (await notice.count() > 0) {
      const text = await notice.innerText()
      if (!/Not sent/.test(text)) { notices.push(text); return 'notice' }
    }
    await page.waitForTimeout(1000)
  }
  throw new Error('no reply and no notice within 600 s')
}

async function live() {
  const root = join(runDir, 'backend')
  rmSync(root, { recursive: true, force: true })
  const env = { AGENTSCOPE_LLM_PROVIDER: 'openai_compatible', AGENTSCOPE_LLM_MODEL: args.model, AGENTSCOPE_LLM_TIMEOUT_S: args.timeout ?? '240', AGENTSCOPE_LLM_JSON_MODE: 'auto' }
  const backend = await startBackend(root, env)
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const outcomes = []
  const prepared = []
  page.on('response', r => { if (r.url().includes('/api/')) count(r.request(), r.status()) })
  page.on('response', async r => {
    const path = new URL(r.url()).pathname
    if (path === '/api/assistant/prepare' && r.ok()) { const b = await r.json(); prepared.push({ digest: b.context_sha256, bytes: b.bytes, redactions: b.redactions, truncated: b.truncated, sample_included: b.sample_included, sample_count: b.sample_count }) }
    if (path === '/api/assistant/run' && r.ok()) { const b = await r.json(); outcomes.push({ proposal: b.proposal, issues: b.issues, attempts: b.attempts, diagnostics: { ...b.diagnostics, raw_text: undefined } }) }
  })
  try {
    log('upload', args.file)
    const uploadId = await uploadAndOpenAssistant(page, resolve(args.file))
    await page.getByLabel('Mapping name').fill(args.name)
    await page.getByLabel('Source').fill(args.source)
    if (args.sample) await page.getByLabel(/Include a redacted sample/).check()
    log('send', args.message)
    await sendAndWait(page, args.message ?? 'Propose a mapping for this file', !!args.sample)
    const notices = []
    let ended = await waitForReplyOrNotice(page, 0, notices)
    log('first reply:', ended, notices.at(-1) ?? '')
    const revisions = [].concat(args.revise ?? [])
    for (const message of revisions) {
      if (ended !== 'reply') break
      log('revise', message)
      await sendAndWait(page, message, !!args.sample)
      await page.waitForTimeout(500)
      ended = await waitForReplyOrNotice(page, revisions.indexOf(message) + 1, notices)
      log('revision reply:', ended, notices.at(-1) ?? '')
    }
    let documentText = await page.getByLabel('Mapping document (JSON)').inputValue()
    writeFileSync(join(runDir, 'document.model.json'), documentText)
    const corrections = []
    for (const rule of [].concat(args.replace ?? [])) {
      const [from, to] = rule.split('=>')
      if (!documentText.includes(from)) { log('correction not applicable', from); corrections.push({ from, to, applied: false }); continue }
      const base = createHash('sha256').update(documentText).digest('hex')
      documentText = documentText.split(from).join(to)
      const target = createHash('sha256').update(documentText).digest('hex')
      corrections.push({ from, to, applied: true, base_sha256: base, target_sha256: target })
      log('correction applied', from, '=>', to)
    }
    for (const spec of [].concat(args['delete-field'] ?? [])) {
      const [ruleId, field] = spec.split('.')
      const parsed = JSON.parse(documentText)
      const rule = (parsed.rules ?? []).find(r => r.id === ruleId)
      const base = createHash('sha256').update(documentText).digest('hex')
      if (!rule || !(field in (rule.fields ?? {}))) { log('field not present', spec); corrections.push({ delete: spec, applied: false }); continue }
      delete rule.fields[field]
      documentText = JSON.stringify(parsed, null, 2)
      corrections.push({ delete: spec, applied: true, reserialised: true, base_sha256: base, target_sha256: createHash('sha256').update(documentText).digest('hex') })
      log('field removed', spec)
    }
    for (const spec of [].concat(args['set-where'] ?? [])) {
      const eq = spec.indexOf('=')
      const ruleId = spec.slice(0, eq)
      const where = JSON.parse(spec.slice(eq + 1))
      const parsed = JSON.parse(documentText)
      const rule = (parsed.rules ?? []).find(r => r.id === ruleId || r.entity === ruleId)
      const base = createHash('sha256').update(documentText).digest('hex')
      if (!rule) { log('rule not present', ruleId); corrections.push({ set_where: spec, applied: false }); continue }
      rule.where = where
      documentText = JSON.stringify(parsed, null, 2)
      corrections.push({ set_where: spec, applied: true, reserialised: true, base_sha256: base, target_sha256: createHash('sha256').update(documentText).digest('hex') })
      log('where replaced on', rule.id)
    }
    if (args['set-notes'] !== undefined) {
      const parsed = JSON.parse(documentText)
      const base = createHash('sha256').update(documentText).digest('hex')
      parsed.notes = String(args['set-notes'])
      documentText = JSON.stringify(parsed, null, 2)
      corrections.push({ set_notes: true, applied: true, reserialised: true, base_sha256: base, target_sha256: createHash('sha256').update(documentText).digest('hex') })
      log('notes replaced')
    }
    if (corrections.some(c => c.applied)) {
      await page.getByLabel('Mapping document (JSON)').fill(documentText)
      writeFileSync(join(runDir, 'document.corrected.json'), documentText)
    }
    log('validate')
    await page.getByRole('button', { name: 'Validate the document' }).click()
    // either the "no issues" line or the issue list (a labelled <ul>, no visible heading)
    await page.getByText('No issues: the document is executable.').or(page.locator('ul[aria-label="Validation issues"]')).first().waitFor({ timeout: 60_000 })
    const executable = await page.getByText('No issues: the document is executable.').count() > 0
    const issuesText = executable ? '' : await page.locator('ul[aria-label="Validation issues"]').innerText()
    writeFileSync(join(runDir, 'validation.txt'), executable ? 'executable' : issuesText)
    if (!executable) log('validation issues:', issuesText.slice(0, 400).replace(/\n/g, ' | '))
    let saved = null
    let preview = null
    let report = null
    if (executable) {
      log('save')
      await page.getByRole('button', { name: 'Save a mapping revision' }).click()
      await page.getByText(/Saved as .* revision \d+/).waitFor({ timeout: 60_000 })
      saved = await page.getByText(/Saved as .* revision \d+/).innerText()
      log('snapshot before import')
      cpSync(root, join(runDir, 'snapshot'), { recursive: true })
      log('preview')
      await page.getByRole('button', { name: 'Preview the import' }).click()
      await page.getByRole('heading', { name: /Preview of revision/ }).waitFor({ timeout: 120_000 })
      preview = await page.locator('.preview-summary').innerText()
      const acceptedMatch = preview.match(/accepted\s+(\d+)/)
      const accepted = acceptedMatch ? Number(acceptedMatch[1]) : 0
      if (accepted === 0 && !args['force-import']) {
        log('preview accepted 0 records: not importing (use --force-import to override)')
      } else {
        log('import')
        await page.getByRole('button', { name: 'Import with this revision' }).click()
        await page.waitForURL(/\/imports\/imp_/, { timeout: 120_000 })
        await page.getByText(/^Committed in .*|^Failed/).first().waitFor({ timeout: 120_000 })
        report = await page.locator('main').first().innerText()
      }
    }
    writeFileSync(join(runDir, 'outcome.json'), JSON.stringify({ runId, model: args.model, file: args.file, uploadId, name: args.name, source: args.source, sample: !!args.sample, message: args.message, revisions, notices, corrections, executable, saved, imported: report !== null, prepared, outcomes }, null, 2))
    writeFileSync(join(runDir, 'preview.txt'), preview ?? '')
    writeFileSync(join(runDir, 'import-report.txt'), report ?? '')
    writeFileSync(join(runDir, 'requests.json'), JSON.stringify(counters, null, 2))
    log('done', runId, executable ? 'executable, imported' : 'not executable')
  } catch (error) {
    writeFileSync(join(runDir, 'failure.json'), JSON.stringify({ runId, error: String(error), prepared, outcomes, requests: counters }, null, 2))
    throw error
  } finally {
    await browser.close()
    backend.kill('SIGTERM')
  }
}

async function replay() {
  const root = join(runDir, 'backend')
  rmSync(root, { recursive: true, force: true })
  cpSync(resolve(args.replay), root, { recursive: true })
  const backend = await startBackend(root, { AGENTSCOPE_LLM_PROVIDER: 'none', AGENTSCOPE_LLM_API_KEY: '' })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('response', r => { if (r.url().includes('/api/')) count(r.request(), r.status()) })
  try {
    await page.goto(`${base}/import`)
    await page.getByLabel(/Trace file|Add another trace file/).setInputFiles(resolve(args.file))
    await page.getByRole('heading', { name: 'Uploaded file' }).waitFor()
    // control: the assistant really is unavailable on this backend (prepare works, run answers 503)
    const uploads = await (await fetch(`${base}/api/imports?limit=1`)).json().catch(() => [])
    const uploadId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('agentscope-import-page') ?? '{}').upload?.upload_id)
    const request = { kind: 'propose', upload_id: uploadId, identity: { name: 'control', source: 'control' }, message: 'control' }
    const prep = await fetch(`${base}/api/assistant/prepare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
    const prepared = prep.ok ? await prep.json() : null
    const probe = prepared ? await fetch(`${base}/api/assistant/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, context_sha256: prepared.context_sha256 }) }) : prep
    const control = { prepare_status: prep.status, run_status: probe.status, code: (await probe.json()).error?.code, uploads_seen: Array.isArray(uploads) ? uploads.length : null }
    const mapping = page.getByLabel('Mapping', { exact: true })
    const label = await mapping.getByRole('option', { name: new RegExp(args.name) }).textContent()
    await mapping.selectOption({ label: label.trim() })
    await page.getByRole('button', { name: 'Preview' }).click()
    await page.getByRole('heading', { name: 'Import preview' }).waitFor({ timeout: 120_000 })
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await page.waitForURL(/\/imports\/imp_/, { timeout: 120_000 })
    await page.getByText(/^Committed in .*|^Failed|already imported/).first().waitFor({ timeout: 120_000 })
    const report = await page.locator('main').innerText()
    const sessions = await (await fetch(`${base}/api/sessions?source=${encodeURIComponent(args.source ?? 'swe-chat')}&limit=500`)).json()
    writeFileSync(join(runDir, 'replay.json'), JSON.stringify({ runId, snapshot: args.replay, control, sessions: sessions.length, requests: counters }, null, 2))
    writeFileSync(join(runDir, 'import-report.txt'), report)
    log('replay done', runId, `control ${control.status} ${control.code}`, `${sessions.length} sessions`)
  } finally {
    await browser.close()
    backend.kill('SIGTERM')
  }
}

if (!existsSync(join(repo, 'web', 'dist', 'index.html'))) { console.error('build the web app first (pnpm build)'); process.exit(2) }
await (args.replay ? replay() : live())
