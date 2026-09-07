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
    throw new Error(`unexpected ${path}`)
  }))
})
afterEach(() => vi.unstubAllGlobals())

function renderPage() {
  return render(
    <ShellProvider>
      <MemoryRouter initialEntries={[{ pathname: '/import/assist/upl_1', state: { upload: { upload_id: 'upl_1', filename: 'epoch.jsonl', sha256: 'a'.repeat(64), size_bytes: 10, format: 'jsonl', record_count: 30, preview: [], already_imported: [] } } }]}>
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
    await waitFor(() => expect((screen.getByLabelText('Mapping document (JSON)') as HTMLTextAreaElement).value).toContain('"external_id"'))
    // the thread's rendering needs a real layout (jsdom shows only the running indicator):
    // the receipt and the ambiguity text are asserted in e2e/assist.spec.ts
    // the outcome's validation counts: saving is possible without a second validate call
    expect(screen.getByRole('button', { name: 'Save a mapping revision' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Preview the import' })).toBeDisabled()
    expect(screen.getAllByText('Save a revision of this exact document first').length).toBeGreaterThan(0)
    // an edit invalidates it again
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
})
