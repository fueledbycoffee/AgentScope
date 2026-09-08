import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantOutcome, FieldProfile, PreparedContext } from '../api/types'
import { ShellProvider } from '../shellContext'
import AssistPage from './Assist'

const profile: FieldProfile = {
  version: 1,
  inspected: 30,
  total_records: 30,
  nodes_visited: 120,
  truncated: {},
  redactions: {},
  coverage_sample: [0],
  fields: [
    { path: '$', selector: '$', relative: '$', depth: 0, records: 30, missing: 0, values: 30, nulls: 0, types: { object: 30 }, distinct: 0, distinct_capped: false, examples: [], min: null, max: null, min_length: null, max_length: null, hints: [], wrapper: null },
    { path: '$.ts', selector: '$', relative: '$.ts', depth: 1, records: 30, missing: 0, values: 30, nulls: 0, types: { integer: 30 }, distinct: 30, distinct_capped: false, examples: [1757000000], min: 1757000000, max: 1757000029, min_length: null, max_length: null, hints: ['epoch_seconds'], wrapper: null },
  ],
  unaddressable: [],
  withheld: [{ parent: '$', reason: 'email' }],
}

const prepared = (digest: string, sample: boolean): PreparedContext => ({
  kind: 'propose', context_sha256: digest, bytes: 1234, payload_text: '{"profile": "…"}', payload: {}, redactions: { email: 1 }, truncated: {}, sample_included: sample, sample_count: sample ? 1 : 0,
})
const mapping = { dsl_version: 1, target_schema_version: 1, name: 'draft', source: 'assist', input_format: 'jsonl', rules: [{ id: 'session', entity: 'session', select: '$', fields: { external_id: { path: '$.session' } } }] }
const outcome: AssistantOutcome = {
  proposal: { mapping, explanations: [], ambiguities: [{ target: 'model_call.started_at', options: ['epoch_s', 'epoch_ms'], what_settles_it: 'magnitude' }], questions: [], model: 'fake/deterministic-1', executable: true },
  issues: [],
  attempts: 1,
  diagnostics: { finish: 'stop', model: 'fake/deterministic-1', raw_text: '', failure: null, context_sha256: 'd1', sample_included: false },
}

const calls: { path: string; body: unknown }[] = []
function respond(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, '')
    const body = init?.body ? JSON.parse(init.body as string) : null
    calls.push({ path, body })
    if (path.endsWith('/profile')) return respond({ upload_id: 'upl_1', profile, cached: false })
    if (path === '/assistant/prepare') return respond(prepared(body.include_sample ? 'sample-digest' : 'plain-digest', !!body.include_sample))
    if (path === '/assistant/run') return respond(outcome)
    if (path === '/mappings/validate') return respond({ issues: [], executable: true })
    if (path === '/mappings/map_1') {
      // the raw text matters: the saved document carries an integer the browser would round
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{"id": "map_1", "name": "tracelab-v1", "source": "tracelab", "revision": 1, "created_by": "user", "input_format": "jsonl", "issues": [], "document": {"name": "tracelab-v1", "source": "tracelab", "big": 9007199254740993, "rules": []}}' } as unknown as Response
    }
    throw new Error(`unexpected ${path}`)
  }))
})
afterEach(() => vi.unstubAllGlobals())

const ORIGIN = {
  importId: 'imp_1', importSource: 'tracelab', importStatus: 'committed' as const,
  filename: 'epoch.jsonl', sha256: 'a'.repeat(64), fileStatus: 'committed', fileDuplicateOf: null,
  mappingId: 'map_1', mappingName: 'tracelab-v1', mappingRevision: 1,
}

function renderPage(origin?: typeof ORIGIN) {
  return render(
    <ShellProvider>
      <MemoryRouter initialEntries={[{ pathname: '/import/assist/upl_1', state: { origin, upload: { upload_id: 'upl_1', filename: 'epoch.jsonl', sha256: 'a'.repeat(64), size_bytes: 10, format: 'jsonl', record_count: 30, preview: [], already_imported: [] } } }]}>
        <Routes><Route path="/import/assist/:uploadId" element={<AssistPage />} /></Routes>
      </MemoryRouter>
    </ShellProvider>,
  )
}

describe('Assist page', () => {
  it('shows the profile with exact numbers and gates the composer on the identity', async () => {
    renderPage()
    const rail = await screen.findByRole('complementary', { name: 'Evidence' })
    await waitFor(() => expect(rail).toHaveTextContent('30 of 30 records inspected'))
    expect(rail).toHaveTextContent('1 key withheld')
    expect(screen.getByRole('row', { name: /\$\.ts/ })).toHaveTextContent('epoch_seconds')
    expect(screen.getByLabelText('Message to the assistant')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Mapping name'), { target: { value: 'draft' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'assist' } })
    expect(screen.getByLabelText('Message to the assistant')).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Mapping name'), { target: { value: 'sean@example.com' } })
    expect(screen.getByLabelText('Message to the assistant')).toBeDisabled()
  })

  it('prepares, runs and applies the proposal without a sample; save stays gated until validated', async () => {
    renderPage()
    await screen.findByRole('complementary', { name: 'Evidence' })
    fireEvent.change(screen.getByLabelText('Mapping name'), { target: { value: 'draft' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'assist' } })
    const input = screen.getByLabelText('Message to the assistant')
    fireEvent.change(input, { target: { value: 'Propose a mapping' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(calls.some(c => c.path === '/assistant/run')).toBe(true))
    const run = calls.find(c => c.path === '/assistant/run')!.body as { context_sha256: string; kind: string; message: string }
    expect(run.context_sha256).toBe('plain-digest')
    expect(run.kind).toBe('propose')
    expect(run.message).toBe('Propose a mapping')
    // the proposal lands in the table, which is the default view now
    await screen.findByRole('region', { name: 'Rule session' })
    expect(screen.getByLabelText('path of external_id in session')).toHaveValue('$.session')
    // the thread's rendering needs a real layout (jsdom shows only the running indicator):
    // the receipt and the ambiguity text are asserted in e2e/assist.spec.ts
    // the outcome's validation counts: saving is possible without a second validate call
    expect(screen.getByRole('button', { name: 'Save a mapping revision' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Preview the import' })).toBeDisabled()
    expect(screen.getAllByText('Save a revision of this exact document first').length).toBeGreaterThan(0)
    // an edit invalidates it again; the JSON view is one icon away
    fireEvent.click(screen.getByRole('button', { name: 'JSON document' }))
    fireEvent.change(screen.getByLabelText('Mapping document (JSON)'), { target: { value: '{"dsl_version": 1}' } })
    expect(screen.getByRole('button', { name: 'Save a mapping revision' })).toBeDisabled()
    expect(screen.getAllByText('Validate the document first').length).toBeGreaterThan(0)
    expect(calls.filter(c => c.path === '/mappings')).toHaveLength(0)
  })

  it('with a sample on, nothing runs until the payload drawer is acknowledged', async () => {
    renderPage()
    await screen.findByRole('complementary', { name: 'Evidence' })
    fireEvent.change(screen.getByLabelText('Mapping name'), { target: { value: 'draft' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'assist' } })
    fireEvent.click(screen.getByLabelText(/Include a redacted sample/))
    const input = screen.getByLabelText('Message to the assistant')
    fireEvent.change(input, { target: { value: 'go' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    const drawer = await screen.findByRole('dialog', { name: 'What the assistant will see' })
    expect(drawer).toHaveTextContent('sample-digest')
    expect(drawer).toHaveTextContent('1 redacted record included')
    expect(drawer).toHaveTextContent('email 1')
    expect(calls.filter(c => c.path === '/assistant/run')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Send this' }))
    await waitFor(() => expect(calls.filter(c => c.path === '/assistant/run')).toHaveLength(1))
    expect((calls.find(c => c.path === '/assistant/run')!.body as { context_sha256: string }).context_sha256).toBe('sample-digest')
  })

  it('switches to the field table, edits one option through the planner and keeps the rest of the text', async () => {
    renderPage()
    await screen.findByRole('complementary', { name: 'Evidence' })
    // the table leads now that it covers the DSL; the JSON view is one icon away
    expect(screen.getByRole('button', { name: 'Field table' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'JSON document' })).toHaveAttribute('aria-pressed', 'false')

    const document = '{"name": "draft", "source": "assist", "big": 9007199254740993, "rules": [{"id": "r", "entity": "session", "fields": {"started_at": {"path": "$.ts", "timestamp_format": "epoch_ms"}}}]}'
    fireEvent.click(screen.getByRole('button', { name: 'JSON document' }))
    fireEvent.change(screen.getByLabelText('Mapping document (JSON)'), { target: { value: document } })
    fireEvent.click(screen.getByRole('button', { name: 'Field table' }))
    expect(screen.getByRole('region', { name: 'Rule r' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Mapping document (JSON)')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('timestamp_format of started_at in r'), { target: { value: 'epoch_s' } })
    fireEvent.click(screen.getByRole('button', { name: 'JSON document' }))
    const text = (screen.getByLabelText('Mapping document (JSON)') as HTMLTextAreaElement).value
    expect(text).toBe(document.replace('epoch_ms', 'epoch_s'))
    expect(text).toContain('9007199254740993')
    expect(calls.filter(c => c.path === '/mappings')).toHaveLength(0)
  })

  it('applies an ambiguity as an edit, once, and only while it describes this document', async () => {
    renderPage()
    await screen.findByRole('complementary', { name: 'Evidence' })
    fireEvent.change(screen.getByLabelText('Mapping name'), { target: { value: 'draft' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'assist' } })
    const input = screen.getByLabelText('Message to the assistant')
    fireEvent.change(input, { target: { value: 'Propose a mapping' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    // the fake's ambiguity is model_call.started_at with epoch_s or epoch_ms; the proposal has no
    // model_call rule, so it stays prose rather than being applied to the wrong field
    await screen.findByRole('region', { name: 'Ambiguities' })
    expect(screen.getByRole('region', { name: 'Ambiguities' })).toHaveTextContent('model_call.started_at')
    expect(screen.getByRole('button', { name: 'ask the assistant about it' })).toBeInTheDocument()
  })

  it('reopens a report’s own revision, with its numbers and its import source intact', async () => {
    renderPage(ORIGIN)
    await screen.findByRole('complementary', { name: 'Evidence' })
    await waitFor(() => expect(screen.getByLabelText('Mapping name in the document')).toHaveValue('tracelab-v1'))
    // the document came from the response text, so the large integer survived
    fireEvent.click(screen.getByRole('button', { name: 'JSON document' }))
    expect((screen.getByLabelText('Mapping document (JSON)') as HTMLTextAreaElement).value).toContain('9007199254740993')
    // the import's source, which is not necessarily the mapping's, is what an import would use
    expect(screen.getByLabelText('Import source')).toHaveValue('tracelab')
    expect(screen.getByText(/Re-importing them into “tracelab” inserts nothing/)).toBeInTheDocument()
    // and it survives sending a message, unlike a notice
    fireEvent.change(screen.getByLabelText('Message to the assistant'), { target: { value: 'help' } })
    fireEvent.keyDown(screen.getByLabelText('Message to the assistant'), { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(calls.some(c => c.path === '/assistant/run')).toBe(true))
    expect(screen.getByText(/Re-importing them into “tracelab” inserts nothing/)).toBeInTheDocument()
  })

  it('warns when the import source is changed away from the report’s', async () => {
    renderPage(ORIGIN)
    await screen.findByRole('complementary', { name: 'Evidence' })
    fireEvent.change(screen.getByLabelText('Import source'), { target: { value: 'elsewhere' } })
    expect(screen.getByText(/not the “tracelab” this report used/)).toBeInTheDocument()
  })

  it('keeps the JSON view when the document cannot be shown as rows, and says why', async () => {
    renderPage()
    await screen.findByRole('complementary', { name: 'Evidence' })
    fireEvent.click(screen.getByRole('button', { name: 'JSON document' }))
    fireEvent.change(screen.getByLabelText('Mapping document (JSON)'), { target: { value: '{"rules": [1,' } })
    const table = screen.getByRole('button', { name: 'Field table' })
    expect(table).toBeDisabled()
    expect(table.getAttribute('data-tip')).toContain('The field table needs a JSON object')
  })
})
