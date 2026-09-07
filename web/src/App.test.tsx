import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { mapping, metrics, preview, rawRecord, reject, report, session, upload } from './test/fixtures'

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function defaultResponse(input: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'http://localhost')
  if (url.pathname === '/api/mappings') return Promise.resolve(json([mapping, { ...mapping, id: 'map_2', revision: 2 }]))
  if (url.pathname === '/api/uploads') return Promise.resolve(json(upload))
  if (url.pathname === '/api/imports/preview') return Promise.resolve(json(preview))
  if (url.pathname === '/api/imports' && options?.method === 'POST') return Promise.resolve(json(report))
  if (url.pathname === '/api/imports') return Promise.resolve(json([{ ...report, warnings: undefined }]))
  if (url.pathname === '/api/imports/imp_1') return Promise.resolve(json(report))
  if (url.pathname === '/api/imports/imp_1/rejects') return Promise.resolve(json([{ ...reject, payload: { bad: true } }]))
  if (url.pathname === '/api/metrics/summary') return Promise.resolve(json(metrics))
  if (url.pathname === '/api/sessions') return Promise.resolve(json([session]))
  if (url.pathname === '/api/sessions/ses_1') return Promise.resolve(json(session))
  if (url.pathname === '/api/raw-records') return Promise.resolve(json({ ...rawRecord, locator: url.searchParams.get('locator') }))
  throw new Error(`Unexpected request: ${url}`)
}
function start(route = '/import') {
  render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
}
async function selectFile() {
  await screen.findByLabelText('Trace file')
  fireEvent.change(screen.getByLabelText('Trace file'), { target: { files: [new File(['{}'], 'sample.jsonl.gz')] } })
  await screen.findByRole('heading', { name: 'Uploaded file' })
  await screen.findByRole('option', { name: /revision 1/ })
  fireEvent.change(screen.getByLabelText('Mapping'), { target: { value: 'map_1' } })
}
async function makePreview() {
  await selectFile()
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByRole('heading', { name: 'Import preview' })
}

beforeEach(() => {
  fetchMock.mockImplementation(defaultResponse)
  vi.stubGlobal('fetch', fetchMock)
  // jsdom does not implement the native dialog methods.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); fetchMock.mockReset() })

describe('Import flow', () => {
  it('uploads multipart bytes, previews, confirms, and fetches the persisted report and rejects', async () => {
    start()
    await makePreview()
    expect(screen.getByRole('heading', { name: 'Already imported' })).toBeInTheDocument()
    expect(screen.getByText('1024 bytes')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'First decoded records (up to 20)' })).toHaveTextContent('native_1')
    expect(screen.getByRole('table', { name: 'Rejects sample' })).toHaveTextContent('Expected an integer')
    expect(screen.getByRole('table', { name: 'Emissions sample' })).toHaveTextContent('input_tokens')
    const uploadOptions = fetchMock.mock.calls.find(([url]) => url === '/api/uploads')![1]!
    expect(uploadOptions.method).toBe('POST')
    expect((uploadOptions.body as FormData).get('file')).toBeInstanceOf(File)
    expect(uploadOptions.headers).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/imports/preview', expect.objectContaining({ body: JSON.stringify({ upload_id: 'upl_1', mapping_id: 'map_1', sample: 200 }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findAllByText('committed')
    expect(fetchMock).toHaveBeenCalledWith('/api/imports', expect.objectContaining({ body: JSON.stringify({ upload_id: 'upl_1', mapping_id: 'map_1', source: 'tracelab' }) }))
    expect(fetchMock).toHaveBeenCalledWith('/api/imports/imp_1', undefined)
    expect(screen.getByRole('heading', { name: 'Source records' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Entity observations' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Imported files' })).toHaveTextContent('d044a766')
    expect(await screen.findByRole('table', { name: 'Rejected records' })).toHaveTextContent('invalid_value')
    expect(screen.getByRole('link', { name: 'View rejects (1)' })).toHaveAttribute('href', '#rejects')
    fireEvent.click(screen.getByRole('link', { name: 'Open dashboard' }))
    expect(await screen.findByRole('region', { name: 'Sessions' })).toHaveTextContent('1')
  })

  it.each([{}, { session: 1, model_call: 2 }])('fills missing preview entity kinds with zero for %j and renders null reject fields', async entities => {
    fetchMock.mockImplementation((url, options) => url === '/api/imports/preview'
      ? Promise.resolve(json({ ...preview, entities, rejects: [{ ...reject, field: null }] }))
      : defaultResponse(url, options))
    start()
    await makePreview()
    const counts = screen.getByRole('heading', { name: 'Entity observations' }).parentElement!
    for (const [kind, value] of [['session', 'session' in entities ? 1 : 0], ['model call', 'model_call' in entities ? 2 : 0], ['tool call', 0]] as const) {
      expect(within(within(counts).getByText(kind).parentElement!).getByText(String(value))).toBeInTheDocument()
    }
    expect(counts).not.toHaveTextContent('undefined')
    expect(within(screen.getByRole('table', { name: 'Rejects sample' })).getByRole('cell', { name: '—' })).toBeInTheDocument()
  })

  it('shows the decode error for an undecodable upload preview line', async () => {
    fetchMock.mockImplementation((url, options) => url === '/api/uploads'
      ? Promise.resolve(json({ ...upload, preview: [{ locator: 'line:1', payload: null, error: 'Invalid JSON at line 1' }] }))
      : defaultResponse(url, options))
    start()
    await selectFile()
    expect(screen.getByRole('table', { name: 'First decoded records (up to 20)' })).toHaveTextContent('Invalid JSON at line 1')
  })

  it('invalidates confirmation when the mapping or file changes', async () => {
    start()
    await makePreview()
    fireEvent.change(screen.getByLabelText('Mapping'), { target: { value: 'map_2' } })
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByRole('heading', { name: 'Import preview' })
    fireEvent.change(screen.getByLabelText('Trace file'), { target: { files: [new File(['{}'], 'other.jsonl')] } })
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument()
    await screen.findByRole('heading', { name: 'Uploaded file' })
    expect(screen.getByLabelText('Mapping')).toHaveValue('')
  })

  it('shows contract error details and allows a failed preview to be retried', async () => {
    start()
    await selectFile()
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'invalid_mapping', message: 'Mapping is invalid', details: [{ path: 'rules[0]', message: 'Missing identity' }] } }, 400))
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Mapping is invalid')
    fireEvent.click(screen.getByText('Error details'))
    expect(screen.getByRole('alert')).toHaveTextContent('Missing identity')
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByRole('button', { name: 'Import' })
  })

  it('blocks repeated commits while importing and surfaces conflicts without claiming success', async () => {
    start()
    await makePreview()
    let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const button = screen.getByRole('button', { name: 'Import' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/imports')).toHaveLength(1)
    await act(async () => finish(json({ error: { code: 'import_conflict', message: 'Another import committed these bytes', details: [] } }, 409)))
    expect(await screen.findByRole('alert')).toHaveTextContent('import_conflict')
    expect(screen.queryByRole('heading', { name: 'Import report' })).not.toBeInTheDocument()
  })

  it('imports several files as one batch, each with its own mapping, and refuses the same bytes twice', async () => {
    start()
    await makePreview()
    fireEvent.click(screen.getByRole('button', { name: 'Add to batch and choose another file' }))
    expect(screen.getByRole('table', { name: 'Batch' })).toHaveTextContent('sample.jsonl.gz')
    expect(screen.queryByRole('heading', { name: 'Import preview' })).not.toBeInTheDocument()
    // the same bytes again: allowed in the batch table only once
    await screen.findByLabelText('Add another trace file')
    fireEvent.change(screen.getByLabelText('Add another trace file'), { target: { files: [new File(['{}'], 'copy.jsonl.gz')] } })
    await screen.findByRole('heading', { name: 'Uploaded file' })
    fireEvent.change(screen.getByLabelText('Mapping'), { target: { value: 'map_2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByRole('heading', { name: 'Import preview' })
    expect(screen.getByRole('alert')).toHaveTextContent('same bytes')
    expect(screen.getByRole('button', { name: 'Import 2 files' })).toBeDisabled()
    // a different file: the batch of two posts the files form with per-file mappings
    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ ...upload, upload_id: 'upl_2', sha256: 'b'.repeat(64), filename: 'second.jsonl' })))
    fireEvent.change(screen.getByLabelText('Add another trace file'), { target: { files: [new File(['{}'], 'second.jsonl')] } })
    await screen.findByText('second.jsonl')
    fireEvent.change(screen.getByLabelText('Mapping'), { target: { value: 'map_2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByRole('heading', { name: 'Import preview' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 files' }))
    await screen.findAllByText('committed')
    expect(fetchMock).toHaveBeenCalledWith('/api/imports', expect.objectContaining({
      body: JSON.stringify({ source: 'tracelab', files: [{ upload_id: 'upl_1', mapping_id: 'map_1' }, { upload_id: 'upl_2', mapping_id: 'map_2' }] }),
    }))
    expect(screen.getByRole('table', { name: 'Imported files' })).toHaveTextContent('tracelab-v1 · revision 1')
  })

  it('submits a fully queued batch without a current preview', async () => {
    start()
    await makePreview()
    fireEvent.click(screen.getByRole('button', { name: 'Add to batch and choose another file' }))
    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ ...upload, upload_id: 'upl_2', sha256: 'b'.repeat(64), filename: 'second.jsonl' })))
    fireEvent.change(screen.getByLabelText('Add another trace file'), { target: { files: [new File(['{}'], 'second.jsonl')] } })
    await screen.findByText('second.jsonl')
    fireEvent.change(screen.getByLabelText('Mapping'), { target: { value: 'map_2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByRole('heading', { name: 'Import preview' })
    fireEvent.click(screen.getByRole('button', { name: 'Add to batch and choose another file' }))
    expect(screen.queryByRole('heading', { name: 'Import preview' })).not.toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Import 2 files' })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await screen.findAllByText('committed')
    expect(fetchMock).toHaveBeenCalledWith('/api/imports', expect.objectContaining({
      body: JSON.stringify({ source: 'tracelab', files: [{ upload_id: 'upl_1', mapping_id: 'map_1' }, { upload_id: 'upl_2', mapping_id: 'map_2' }] }),
    }))
  })

  it('does not redirect away from a new page when an earlier import finishes', async () => {
    start()
    await makePreview()
    let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
    await screen.findByRole('region', { name: 'Sessions' })
    await act(async () => finish(json(report)))
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Import report' })).not.toBeInTheDocument()
  })
})

describe('Dashboard', () => {
  it('keeps the sessions list usable when metrics fail and retries the metrics request', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'query_failed', message: 'Metrics temporarily unavailable', details: [] } }, 500))
    start('/dashboard')
    expect(await screen.findByRole('alert')).toHaveTextContent('Metrics temporarily unavailable')
    expect(await screen.findByRole('link', { name: 'claude:native_1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('region', { name: 'Sessions' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders all KPIs, a real zero, Unavailable with coverage, and expandable definitions', async () => {
    start('/dashboard')
    const tokens = await screen.findByRole('region', { name: 'Input tokens' })
    expect(within(tokens).getByText('Unavailable')).toBeInTheDocument()
    expect(tokens).toHaveTextContent('Coverage: 0 / 2 calls')
    expect(within(tokens).queryByText('0', { exact: true })).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Tool calls' })).getByText('0')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Sessions' })).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Model calls' })).getByText('2')).toBeInTheDocument()
    fireEvent.click(within(tokens).getByText('Definition'))
    expect(within(tokens).getByText(metrics.input_tokens.definition)).toBeVisible()
  })

  it('renders known input tokens and the semantics breakdown', async () => {
    fetchMock.mockImplementation((url, options) => String(url).startsWith('/api/metrics/summary')
      ? Promise.resolve(json({ ...metrics, input_tokens: { ...metrics.input_tokens, value: 123, coverage: { known: 1, total: 2 }, by_semantics: { 'tracelab-claude': 123 } } }))
      : defaultResponse(url, options))
    start('/dashboard')
    const tokens = await screen.findByRole('region', { name: 'Input tokens' })
    expect(tokens).toHaveTextContent('123')
    expect(tokens).toHaveTextContent('Coverage: 1 / 2 calls')
    expect(within(tokens).queryByText('Unavailable')).not.toBeInTheDocument()
    fireEvent.click(within(tokens).getByText('Token semantics'))
    expect(within(tokens).getByText('tracelab-claude')).toBeVisible()
  })

  it('filters KPIs and sessions together and ignores late responses for an old scope', async () => {
    let finishOld!: (response: Response) => void
    fetchMock.mockImplementation((url, options) => String(url) === '/api/metrics/summary'
      ? new Promise(resolve => { finishOld = resolve }) : defaultResponse(url, options))
    start('/dashboard')
    await screen.findByRole('table', { name: 'Sessions in scope' })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'trace & lab' } })
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'claude-code' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await screen.findByRole('region', { name: 'Sessions' })
    expect(fetchMock).toHaveBeenCalledWith('/api/metrics/summary?source=trace+%26+lab&agent=claude-code', undefined)
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions?source=trace+%26+lab&agent=claude-code&limit=50&offset=0', undefined)
    await act(async () => finishOld(json({ ...metrics, sessions: { ...metrics.sessions, value: 999 } })))
    expect(screen.getByRole('region', { name: 'Sessions' })).not.toHaveTextContent('999')
  })
})

describe('Reports, history, and session detail', () => {
  it.each(['duplicate', 'failed'] as const)('explains a %s report without implying observations were inserted', async status => {
    fetchMock.mockImplementation((url, options) => url === '/api/imports/imp_1'
      ? Promise.resolve(json({ ...report, status, entities: {}, error: status === 'failed' ? 'IntegrityError: Transaction rolled back' : null }))
      : defaultResponse(url, options))
    start('/imports/imp_1')
    await screen.findByText(status, { selector: 'dd' })
    expect(screen.getByText(/No observations were inserted/)).toBeInTheDocument()
    const counts = screen.getByRole('heading', { name: 'Entity observations' }).parentElement!
    expect(within(counts).getAllByText('0', { exact: true })).toHaveLength(3)
    for (const kind of ['session', 'model call', 'tool call']) expect(within(counts).getByText(kind)).toBeInTheDocument()
    expect(counts).not.toHaveTextContent('undefined')
    if (status === 'failed') expect(screen.getByRole('alert')).toHaveTextContent('IntegrityError: Transaction rolled back')
  })

  it('shows string errors and empty entity counts in history', async () => {
    fetchMock.mockImplementation((url, options) => String(url).startsWith('/api/imports?')
      ? Promise.resolve(json([
        { ...report, status: 'failed', entities: {}, error: 'IntegrityError: Transaction rolled back' },
        { ...report, import_id: 'imp_duplicate', status: 'duplicate', entities: {} },
      ])) : defaultResponse(url, options))
    start('/imports')
    const table = await screen.findByRole('table', { name: 'Import attempts, newest first' })
    expect(table).toHaveTextContent('IntegrityError: Transaction rolled back')
    expect(within(table).getAllByText('session: 0, model_call: 0, tool_call: 0')).toHaveLength(2)
    expect(table).not.toHaveTextContent('undefined')
  })

  it('renders a dash for a reject without a field', async () => {
    fetchMock.mockImplementation((url, options) => String(url).startsWith('/api/imports/imp_1/rejects')
      ? Promise.resolve(json([{ ...reject, code: 'invalid_json', field: null, payload: null }]))
      : defaultResponse(url, options))
    start('/imports/imp_1')
    const table = await screen.findByRole('table', { name: 'Rejected records' })
    expect(within(table).getByRole('cell', { name: '—' })).toBeInTheDocument()
  })

  it('renders a dash for a session diagnostic without a field', async () => {
    fetchMock.mockImplementation((url, options) => url === '/api/sessions/ses_1'
      ? Promise.resolve(json({ ...session, diagnostics: [{ code: 'internal_error', field: null, message: 'Processing failed' }] }))
      : defaultResponse(url, options))
    start('/sessions/ses_1')
    const table = await screen.findByRole('table', { name: 'Session diagnostics' })
    expect(within(table).getByRole('cell', { name: '—' })).toBeInTheDocument()
  })

  it('opens an import report from history', async () => {
    start('/imports')
    fireEvent.click(await screen.findByRole('link', { name: 'imp_1' }))
    await screen.findAllByText('committed')
    expect(screen.getByRole('heading', { name: 'Import report' })).toBeInTheDocument()
  })

  it('paginates rejects and resets the page when the code filter changes', async () => {
    fetchMock.mockImplementation((url, options) => String(url).startsWith('/api/imports/imp_1/rejects')
      ? Promise.resolve(json(String(url).includes('offset=50') ? [] : Array.from({ length: 50 }, (_, i) => ({ ...reject, locator: `line:${i}`, payload: {} }))))
      : defaultResponse(url, options))
    start('/imports/imp_1')
    await screen.findByRole('table', { name: 'Rejected records' })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('No rejects on this page.')
    expect(fetchMock).toHaveBeenCalledWith('/api/imports/imp_1/rejects?limit=50&offset=50', undefined)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Reject code filter'), { target: { value: 'invalid_value' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/imports/imp_1/rejects?code=invalid_value&limit=50&offset=0', undefined))
    await screen.findByRole('table', { name: 'Rejected records' })
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  })

  it('opens session detail, displays diagnostics, and lazily fetches source payloads as inert JSON', async () => {
    start('/dashboard')
    fireEvent.click(await screen.findByRole('link', { name: 'claude:native_1' }))
    await screen.findByText('Conflicting agent values')
    expect(screen.getByRole('table', { name: 'Recorded tool-call observations' })).toHaveTextContent('No')
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/raw-records'))).toBe(false)
    const opener = screen.getByRole('button', { name: 'Source record for model call mc_1' })
    opener.focus()
    fireEvent.click(opener)
    const drawer = await screen.findByRole('dialog', { name: 'Source record' })
    await within(drawer).findByText(/untrusted trace/)
    expect(drawer.querySelector('script')).toBeNull()
    expect(drawer.querySelector('pre')?.textContent).toBe(rawRecord.payload_text)
    expect(drawer.querySelector('pre')?.textContent).toContain('9007199254740993')
    expect(drawer.querySelector('pre')?.textContent).not.toContain('9007199254740992')
    expect(fetchMock).toHaveBeenCalledWith('/api/raw-records?file_sha256=d044a766&locator=line%3A1', undefined)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close source record' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Source record for tool call tc_1' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/raw-records?file_sha256=d044a766&locator=line%3A2', undefined))
    await screen.findByText(/untrusted trace/)
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
