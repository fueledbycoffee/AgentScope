import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { serializeImportState } from './import/importRuntime'
import { mapping, metricDefinitions, metricQueries, metrics, preview, rawRecord, reject, report, session, upload } from './test/fixtures'

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
  if (url.pathname === '/api/imports/imp_1/rejects/summary') return Promise.resolve(json({ codes: { invalid_value: 1 }, rules: { tool_call: 1 }, files: { [upload.sha256]: 1 }, outcomes: { accepted: 2, rejected: 1 } }))
  if (url.pathname === '/api/imports/imp_1/records') return Promise.resolve(json([
    { file_sha256: upload.sha256, locator: 'line:1', outcome: 'accepted', entity_counts: { session: 1, model_call: 1 }, warning_counts: {} },
    { file_sha256: upload.sha256, locator: 'line:3', outcome: 'rejected', entity_counts: {}, warning_counts: { absent: 2 } },
  ]))
  if (url.pathname === '/api/imports/imp_1/rejects') return Promise.resolve(json([{ ...reject, payload: { bad: true } }]))
  if (url.pathname === '/api/metrics/summary') return Promise.resolve(json(metrics))
  if (url.pathname === '/api/metrics/definitions') return Promise.resolve(json(metricDefinitions))
  if (url.pathname === '/api/metrics/facets') return Promise.resolve(json({ sources: ['tracelab'], agents: ['claude-code', 'codex'], models: ['claude'] }))
  if (url.pathname === '/api/metrics/query') return Promise.resolve(json(metricQueries[url.searchParams.get('metric_id') ?? '']))
  if (url.pathname === '/api/sessions') return Promise.resolve(json([session]))
  if (url.pathname === '/api/sessions/ses_1') return Promise.resolve(json(session))
  if (url.pathname === '/api/raw-records') return Promise.resolve(json({ ...rawRecord, locator: url.searchParams.get('locator') }))
  throw new Error(`Unexpected request: ${url}`)
}
function start(route = '/import') {
  render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
}
function NavigationProbe() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate('/import?step=1')}>Simulate history landing on File</button>
}
function startWithNavigation(route = '/import') {
  render(<MemoryRouter initialEntries={[route]}><NavigationProbe /><App /></MemoryRouter>)
}
async function uploadOne() {
  await screen.findByLabelText('Trace file')
  fireEvent.change(screen.getByLabelText('Trace file'), { target: { files: [new File(['{}'], 'sample.jsonl.gz')] } })
  await screen.findByRole('heading', { name: 'Uploaded file' })
}
async function chooseMapping() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue to mapping' }))
  await screen.findByRole('heading', { name: 'Choose how to read it' })
  fireEvent.click(await screen.findByRole('radio', { name: /tracelab-v1.*revision 1/ }))
}
async function makePreview() {
  await uploadOne()
  await chooseMapping()
  fireEvent.click(screen.getByRole('button', { name: 'Run a dry run' }))
  await screen.findByRole('heading', { name: 'Dry run on up to 200 records per file' })
  await screen.findByText('Expected an integer')
}
async function makeConfirmation() {
  await makePreview()
  fireEvent.click(screen.getByRole('button', { name: 'Looks right, continue' }))
  await screen.findByRole('heading', { name: 'Confirm and run' })
}

beforeEach(() => {
  sessionStorage.clear()
  fetchMock.mockImplementation(defaultResponse)
  vi.stubGlobal('fetch', fetchMock)
  // jsdom does not implement the native dialog methods.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
})
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); fetchMock.mockReset() })

describe('Import flow', () => {
  it('uploads multipart bytes, previews, confirms, and fetches the persisted report and rejects', async () => {
    start()
    await uploadOne()
    expect(screen.getByRole('heading', { name: 'Already imported' })).toBeInTheDocument()
    expect(screen.getByText('1,024 bytes')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'First decoded records (up to 20)' })).toHaveTextContent('native_1')
    const uploadOptions = fetchMock.mock.calls.find(([url]) => url === '/api/uploads')![1]!
    expect(uploadOptions.method).toBe('POST')
    expect((uploadOptions.body as FormData).get('file')).toBeInstanceOf(File)
    expect(uploadOptions.headers).toBeUndefined()
    await chooseMapping()
    fireEvent.click(screen.getByRole('button', { name: 'Run a dry run' }))
    await screen.findByRole('heading', { name: 'Dry run on up to 200 records per file' })
    expect(await screen.findByRole('table', { name: 'Rejects sample' })).toHaveTextContent('Expected an integer')
    expect(screen.getByRole('table', { name: 'Emissions sample' })).toHaveTextContent('input_tokens')
    expect(fetchMock).toHaveBeenCalledWith('/api/imports/preview', expect.objectContaining({ body: JSON.stringify({ upload_id: 'upl_1', mapping_id: 'map_1', sample: 200 }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Looks right, continue' }))
    expect(await screen.findByRole('heading', { name: 'Confirm and run' })).toBeInTheDocument()
    expect(screen.getByText(/tracelab-v1 revision 1/)).toBeInTheDocument()
    expect(screen.getAllByText('d044a766')).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Import 3 records' }))
    await screen.findAllByText('committed')
    expect(fetchMock).toHaveBeenCalledWith('/api/imports', expect.objectContaining({ body: JSON.stringify({ upload_id: 'upl_1', mapping_id: 'map_1', source: 'tracelab' }) }))
    expect(fetchMock).toHaveBeenCalledWith('/api/imports/imp_1', undefined)
    expect(screen.getByRole('heading', { name: 'Source records' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Entity observations' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Imported files' })).toHaveTextContent('d044a766')
    expect(await screen.findByRole('table', { name: 'Rejected records' })).toHaveTextContent('invalid_value')
    expect(screen.getByRole('link', { name: 'View rejects (1)' })).toHaveAttribute('href', '#rejects')
    fireEvent.click(screen.getByRole('link', { name: 'Open dashboard' }))
    expect((await screen.findAllByRole('region', { name: 'Sessions' }))[0]).toHaveTextContent('1')
  })

  it.each([{}, { session: 1, model_call: 2 }])('fills missing preview entity kinds with zero for %j and renders null reject fields', async entities => {
    fetchMock.mockImplementation((url, options) => url === '/api/imports/preview'
      ? Promise.resolve(json({ ...preview, entities, rejects: [{ ...reject, field: null }] }))
      : defaultResponse(url, options))
    start()
    await makePreview()
    const counts = screen.getByRole('heading', { name: 'Entity observations' }).closest('section')!
    for (const [kind, value] of [['session', 'session' in entities ? 1 : 0], ['model call', 'model_call' in entities ? 2 : 0], ['tool call', 0]] as const) {
      expect(within(within(counts).getByText(kind).parentElement!).getByText(String(value))).toBeInTheDocument()
    }
    expect(counts).not.toHaveTextContent('undefined')
    expect(within(screen.getByRole('table', { name: 'Rejects sample' })).getByRole('cell', { name: '—' })).toBeInTheDocument()
  })

  it('shows ignored records in preview stats, the completed rail fact, and the confirm receipt', async () => {
    fetchMock.mockImplementation((url, options) => url === '/api/imports/preview'
      ? Promise.resolve(json({ ...preview, records: { ...preview.records, ignored: 1, sampled: 4 } }))
      : defaultResponse(url, options))
    start()
    await makePreview()

    const previewStats = screen.getByText('Records sampled').closest('section')!
    expect(within(within(previewStats).getByText('Ignored').parentElement!).getByText('1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Looks right, continue' }))
    await screen.findByRole('heading', { name: 'Confirm and run' })
    expect(screen.getByRole('complementary', { name: 'Progress' })).toHaveTextContent('4 sampled · 1 rejected · 1 ignored')
    expect(screen.getByText('4 sampled: 2 accepted, 0 partial, 1 rejected, 1 ignored')).toBeInTheDocument()
  })

  it('shows the decode error for an undecodable upload preview line', async () => {
    fetchMock.mockImplementation((url, options) => url === '/api/uploads'
      ? Promise.resolve(json({ ...upload, preview: [{ locator: 'line:1', payload: null, error: 'Invalid JSON at line 1' }] }))
      : defaultResponse(url, options))
    start()
    await uploadOne()
    expect(screen.getByRole('table', { name: 'First decoded records (up to 20)' })).toHaveTextContent('Invalid JSON at line 1')
  })

  it('removes the only selected file and resets the File stop', async () => {
    start()
    await uploadOne()

    fireEvent.click(screen.getByRole('button', { name: 'Remove sample.jsonl.gz' }))

    expect(screen.queryByRole('heading', { name: 'Uploaded file' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Trace file')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to mapping' })).toBeDisabled()
    await waitFor(() => expect(sessionStorage.getItem('agentscope-import-page')).toBeNull())
  })

  it('invalidates confirmation when the mapping or file changes', async () => {
    start()
    await makeConfirmation()
    fireEvent.click(screen.getByRole('button', { name: 'Mapping' }))
    fireEvent.click(screen.getByRole('radio', { name: /tracelab-v1.*revision 2/ }))
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run a dry run' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fetchMock.mockResolvedValueOnce(json({ ...upload, upload_id: 'upl_2', sha256: 'b'.repeat(64), filename: 'other.jsonl' }))
    fireEvent.change(screen.getByLabelText('Add another trace file'), { target: { files: [new File(['{}'], 'other.jsonl')] } })
    expect(await screen.findByRole('table', { name: 'Files ready for this import' })).toHaveTextContent('other.jsonl')
    expect(screen.queryByRole('button', { name: /Import 6 records/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to mapping' }))
    expect(await screen.findAllByRole('radio', { name: /tracelab-v1.*revision 2/ })).toHaveLength(2)
  })

  it('shows contract error details and allows a failed preview to be retried', async () => {
    start()
    await uploadOne()
    await chooseMapping()
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'invalid_mapping', message: 'Mapping is invalid', details: [{ path: 'rules[0]', message: 'Missing identity' }] } }, 400))
    fireEvent.click(screen.getByRole('button', { name: 'Run a dry run' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Mapping is invalid')
    fireEvent.click(screen.getByText('Error details'))
    expect(screen.getByRole('alert')).toHaveTextContent('Missing identity')
    expect(screen.queryByRole('button', { name: /Import \d+ records/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry the dry run' }))
    await screen.findByRole('button', { name: 'Looks right, continue' })
  })

  it.each([400, 409, 413, 500])('preserves the server error message for HTTP %i', async status => {
    fetchMock.mockImplementation((url, options) => url === '/api/uploads'
      ? Promise.resolve(json({ error: { code: 'limit_exceeded', message: `Server guidance for ${status}`, details: [] } }, status))
      : defaultResponse(url, options))
    start()

    fireEvent.change(await screen.findByLabelText('Trace file'), { target: { files: [new File(['{}'], 'too-many-records.jsonl')] } })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(`Server guidance for ${status}`)
    expect(alert).not.toHaveTextContent('25 MiB')
  })

  it('adds upload-size guidance without replacing the message for an explicit upload-byte error code', async () => {
    fetchMock.mockImplementation((url, options) => url === '/api/uploads'
      ? Promise.resolve(json({ error: { code: 'payload_too_large', message: 'The server refused these upload bytes', details: [] } }, 413))
      : defaultResponse(url, options))
    start()

    fireEvent.change(await screen.findByLabelText('Trace file'), { target: { files: [new File(['{}'], 'large.jsonl')] } })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The server refused these upload bytes')
    expect(alert).toHaveTextContent('25 MiB')
  })

  it('blocks repeated commits while importing and surfaces conflicts without claiming success', async () => {
    start()
    await makeConfirmation()
    let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const button = screen.getByRole('button', { name: 'Import 3 records' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button).toBeDisabled()
    const progress = screen.getByRole('complementary', { name: 'Progress' })
    for (const stop of ['File', 'Mapping', 'Preview']) {
      expect(within(progress).getByRole('button', { name: stop })).toBeDisabled()
    }
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByText('Importing 3 records in one transaction')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/imports')).toHaveLength(1)
    await act(async () => finish(json({ error: { code: 'import_conflict', message: 'Another import committed these bytes', details: [] } }, 409)))
    expect(await screen.findByRole('alert')).toHaveTextContent('import_conflict')
    expect(screen.queryByRole('heading', { name: 'Import report' })).not.toBeInTheDocument()
  })

  it('shows a pending commit failure after history lands on another import stop', async () => {
    startWithNavigation()
    await makeConfirmation()
    let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Import 3 records' }))

    fireEvent.click(screen.getByRole('button', { name: 'Simulate history landing on File' }))
    expect(await screen.findByRole('heading', { name: 'Import a trace file' })).toBeInTheDocument()
    await act(async () => finish(json({ error: { code: 'import_conflict', message: 'Another import committed these bytes', details: [] } }, 409)))

    expect(await screen.findByRole('alert')).toHaveTextContent('Another import committed these bytes')
    expect(screen.getByRole('alert')).toHaveTextContent('import_conflict')
  })

  it('keeps aggregate-limit guidance from a 413 commit response', async () => {
    start()
    await makeConfirmation()
    fetchMock.mockResolvedValueOnce(json({
      error: { code: 'limit_exceeded', message: 'The batch has 120000 records to read; the limit is 100000', details: [] },
    }, 413))

    fireEvent.click(screen.getByRole('button', { name: 'Import 3 records' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The batch has 120000 records to read; the limit is 100000')
    expect(alert).not.toHaveTextContent('25 MiB')
  })

  it('imports several files as one batch, each with its own mapping, and refuses the same bytes twice', async () => {
    start()
    await uploadOne()
    fetchMock.mockResolvedValueOnce(json({ ...upload, upload_id: 'upl_copy', filename: 'copy.jsonl.gz' }))
    fireEvent.change(screen.getByLabelText('Add another trace file'), { target: { files: [new File(['{}'], 'copy.jsonl.gz')] } })
    expect(await screen.findByRole('table', { name: 'Files ready for this import' })).toHaveTextContent('copy.jsonl.gz')
    expect(screen.getByRole('alert')).toHaveTextContent('same bytes')
    expect(screen.getByRole('button', { name: 'Continue to mapping' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove copy.jsonl.gz' }))

    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ ...upload, upload_id: 'upl_2', sha256: 'b'.repeat(64), filename: 'second.jsonl' })))
    fireEvent.change(screen.getByLabelText('Add another trace file'), { target: { files: [new File(['{}'], 'second.jsonl')] } })
    await screen.findByText('second.jsonl')
    fireEvent.click(screen.getByRole('button', { name: 'Continue to mapping' }))
    await screen.findByRole('heading', { name: 'Choose how to read it' })
    fireEvent.click(screen.getAllByRole('radio', { name: /tracelab-v1.*revision 1/ })[0])
    expect(screen.getAllByRole('radio', { name: /tracelab-v1.*revision 2/ })[1]).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Run a dry run' }))
    await screen.findByRole('heading', { name: 'Dry run on up to 200 records per file' })
    await waitFor(() => expect(screen.getByText('6', { selector: 'dd' })).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Looks right, continue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Import 6 records' }))
    await screen.findAllByText('committed')
    expect(fetchMock).toHaveBeenCalledWith('/api/imports', expect.objectContaining({
      body: JSON.stringify({ source: 'tracelab', files: [{ upload_id: 'upl_1', mapping_id: 'map_1' }, { upload_id: 'upl_2', mapping_id: 'map_2' }] }),
    }))
    expect(screen.getByRole('table', { name: 'Imported files' })).toHaveTextContent('tracelab-v1 · rev 1')
  })

  it('attributes every aggregated reject and emission row to its batch file', async () => {
    const firstUpload = { ...upload, filename: 'first.jsonl', sha256: 'a'.repeat(64) }
    const secondUpload = { ...upload, upload_id: 'upl_2', filename: 'second.jsonl', sha256: 'b'.repeat(64) }
    sessionStorage.setItem('agentscope-import-page', serializeImportState({ entries: [
      { upload: firstUpload, mappingId: 'map_1', preview: null },
      { upload: secondUpload, mappingId: 'map_2', preview: null },
    ] }))
    fetchMock.mockImplementation((url, options) => {
      if (url !== '/api/imports/preview') return defaultResponse(url, options)
      const request = JSON.parse(String(options?.body)) as { upload_id: string }
      const isFirst = request.upload_id === firstUpload.upload_id
      const source = isFirst ? firstUpload : secondUpload
      return Promise.resolve(json({
        ...preview,
        rejects: [{ ...reject, locator: isFirst ? 'line:11' : 'line:22', file_sha256: source.sha256 }],
        emissions: [{ ...preview.emissions[0], locator: isFirst ? 'line:10' : 'line:20' }],
      }))
    })

    start('/import?step=2')
    fireEvent.click(await screen.findByRole('button', { name: 'Run a dry run' }))
    await screen.findByRole('heading', { name: 'Dry run on up to 200 records per file' })
    await screen.findByText('line:22')

    for (const [caption, locators] of [
      ['Rejects sample', ['line:11', 'line:22']],
      ['Emissions sample', ['line:10', 'line:20']],
    ] as const) {
      const table = screen.getByRole('table', { name: caption })
      for (const [index, row] of within(table).getAllByRole('row').slice(1).entries()) {
        expect(row).toHaveTextContent(index === 0 ? 'first.jsonl' : 'second.jsonl')
        expect(row).toHaveTextContent(index === 0 ? 'aaaaaaaaaaaa…' : 'bbbbbbbbbbbb…')
      }
      expect(within(table).getAllByRole('row')).toHaveLength(locators.length + 1)
    }
  })

  it('shows a decoded-sample disclosure and decode errors for every file in a batch', async () => {
    start()
    await uploadOne()
    fetchMock.mockResolvedValueOnce(json({
      ...upload,
      upload_id: 'upl_2',
      sha256: 'b'.repeat(64),
      filename: 'broken.jsonl',
      preview: [{ locator: 'line:2', payload: null, error: 'Invalid JSON at line 2' }],
    }))
    fireEvent.change(screen.getByLabelText('Add another trace file'), { target: { files: [new File(['{'], 'broken.jsonl')] } })
    await screen.findByRole('heading', { name: 'Uploaded files' })

    fireEvent.click(screen.getByText('Show the first 20 decoded records for sample.jsonl.gz'))
    fireEvent.click(screen.getByText('Show the first 20 decoded records for broken.jsonl'))
    expect(screen.getByRole('table', { name: 'First decoded records for sample.jsonl.gz (up to 20)' })).toHaveTextContent('native_1')
    expect(screen.getByRole('table', { name: 'First decoded records for broken.jsonl (up to 20)' })).toHaveTextContent('Invalid JSON at line 2')
  })

  it('restores and submits a fully previewed batch', async () => {
    const secondUpload = { ...upload, upload_id: 'upl_2', sha256: 'b'.repeat(64), filename: 'second.jsonl' }
    sessionStorage.setItem('agentscope-import-page', serializeImportState({ entries: [
      { upload, mappingId: 'map_1', preview: { value: preview, detailsAvailable: true } },
      { upload: secondUpload, mappingId: 'map_2', preview: { value: preview, detailsAvailable: true } },
    ] }))
    start('/import?step=4')
    const submit = await screen.findByRole('button', { name: 'Import 6 records' })
    expect(screen.getByText(/sample.jsonl.gz · 3 records/)).toBeInTheDocument()
    expect(screen.getByText(/second.jsonl · 3 records/)).toBeInTheDocument()
    fireEvent.click(submit)
    await screen.findAllByText('committed')
    expect(fetchMock).toHaveBeenCalledWith('/api/imports', expect.objectContaining({
      body: JSON.stringify({ source: 'tracelab', files: [{ upload_id: 'upl_1', mapping_id: 'map_1' }, { upload_id: 'upl_2', mapping_id: 'map_2' }] }),
    }))
  })

  it('does not claim a restored preview had no rejects when reject details were not retained', async () => {
    sessionStorage.setItem('agentscope-import-page', serializeImportState({ entries: [{
      upload,
      mappingId: 'map_1',
      preview: { value: preview, detailsAvailable: true },
    }] }))

    start('/import?step=3')

    await screen.findByRole('heading', { name: 'Dry run on up to 200 records per file' })
    expect(screen.getByText('Reject details are unavailable after this reload.')).toBeInTheDocument()
    expect(screen.queryByText('No rejects in this sample.')).not.toBeInTheDocument()
  })

  it('lets a reloaded reachable Preview stop run its missing dry run', async () => {
    sessionStorage.setItem('agentscope-import-page', serializeImportState({ entries: [{
      upload,
      mappingId: 'map_1',
      preview: null,
    }] }))

    start('/import?step=3')

    await screen.findByRole('heading', { name: 'Dry run on up to 200 records per file' })
    const run = screen.getByRole('button', { name: 'Run the dry run' })
    expect(run).toBeEnabled()
    fireEvent.click(run)
    expect(await screen.findByRole('button', { name: 'Looks right, continue' })).toBeEnabled()
  })

  it('shows one persistence warning at every import stop when session storage fills up', async () => {
    sessionStorage.setItem('agentscope-import-page', serializeImportState({ entries: [{
      upload,
      mappingId: 'map_1',
      preview: { value: preview, detailsAvailable: true },
    }] }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })

    start('/import?step=4')

    const warning = 'This import will not survive a reload.'
    await waitFor(() => expect(screen.getAllByText(warning)).toHaveLength(1))
    for (const [stop, heading] of [
      ['Preview', 'Dry run on up to 200 records per file'],
      ['Mapping', 'Choose how to read it'],
      ['File', 'Import a trace file'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: stop }))
      await screen.findByRole('heading', { name: heading })
      expect(screen.getAllByText(warning)).toHaveLength(1)
    }
  })

  it('does not redirect away from a new page when an earlier import finishes', async () => {
    start()
    await makeConfirmation()
    let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Import 3 records' }))
    fireEvent.click(screen.getByRole('link', { name: 'Overview' }))
    await screen.findAllByRole('region', { name: 'Sessions' })
    await act(async () => finish(json(report)))
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument()
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
    await screen.findAllByRole('region', { name: 'Sessions' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders four owner KPIs, two subordinate headlines, three charts, and refuses the mixed total', async () => {
    start('/dashboard')
    const tokens = await screen.findByRole('region', { name: 'Input usage by accounting group' })
    for (const label of ['Sessions', 'Model-call observations', 'Tool-call observations']) {
      expect(screen.getAllByRole('region', { name: label })[0]).toBeInTheDocument()
    }
    expect(tokens).toHaveTextContent('Not comparable')
    expect(tokens).toHaveTextContent('not comparable: 2 token semantics in selection')
    expect(tokens).toHaveTextContent('tracelab-claude: 186454781')
    expect(tokens).toHaveTextContent('tracelab-codex: 366993096')
    expect(tokens).not.toHaveTextContent('553447877')
    expect(within(screen.getByRole('region', { name: 'Tool-call observations' })).getByText('0')).toBeInTheDocument()
    expect(within(screen.getAllByRole('region', { name: 'Sessions' })[0]).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Model-call observations' })).getByText('2')).toBeInTheDocument()
    const cost = screen.getByRole('region', { name: 'Scheduled cost' })
    expect(cost).toHaveTextContent('No recorded tokens have both a rate and validated billing semantics.')
    expect(cost).toHaveTextContent('priced token coverage 0 / 15')
    expect(screen.getByRole('region', { name: 'Observed span' })).toHaveTextContent('1.0 min')
    for (const chart of ['Activity by day', 'Tokens by model', 'Tool calls']) {
      expect(screen.getByRole('region', { name: chart })).toBeInTheDocument()
    }
    expect(screen.getByLabelText('Token usage totals')).toHaveTextContent('Output 5 · coverage 1 / 2')
    fireEvent.click(within(tokens).getByRole('button', { name: 'Definition of Input usage by accounting group' }))
    const dialog = screen.getByRole('dialog', { name: 'Input usage by accounting group' })
    expect(dialog).toHaveTextContent(metrics.input_tokens.definition)
    expect(dialog).toHaveTextContent('Cache-read tokensUnavailable · coverage 0 / 2')
  })

  it('applies Source, Agent, Model, and Period to every canonical request and one receipt', async () => {
    start('/overview?source=tracelab&agent=codex&model=claude&period=7d')
    await screen.findByRole('region', { name: 'Input usage by accounting group' })
    await screen.findByText(/UTC/, { selector: '.receipt *' })

    await waitFor(() => {
      const scoped = fetchMock.mock.calls.map(([value]) => new URL(String(value), 'http://localhost')).filter(url => (
        ['/api/metrics/summary', '/api/metrics/facets', '/api/metrics/query', '/api/sessions'].includes(url.pathname)
        && url.searchParams.get('source') === 'tracelab'
        && url.searchParams.get('agent') === 'codex'
        && url.searchParams.get('model') === 'claude'
      ))
      expect(scoped.some(url => url.pathname === '/api/metrics/summary' && url.searchParams.has('started_from') && url.searchParams.has('started_before'))).toBe(true)
      expect(scoped.some(url => url.pathname === '/api/metrics/facets' && url.searchParams.has('started_from'))).toBe(true)
      expect(scoped.some(url => url.pathname === '/api/sessions' && url.searchParams.get('limit') === '8')).toBe(true)
      const queries = scoped.filter(url => url.pathname === '/api/metrics/query')
      expect(new Set(queries.map(url => url.searchParams.get('metric_id')))).toEqual(new Set(Object.keys(metricQueries)))
      const unknown = queries.find(url => url.searchParams.get('metric_id') === 'unknown_timestamps')!
      expect(unknown.searchParams.has('started_from')).toBe(false)
      expect(unknown.searchParams.has('started_before')).toBe(false)
    })
    expect(screen.getByRole('group', { name: 'Scope' })).toHaveTextContent('1 sessions · 2 model calls · from 1 imports')
  })

  it('opens only attributable quality populations with the full returned drill scope', async () => {
    start('/dashboard')
    await screen.findByRole('region', { name: 'Input usage by accounting group' })
    fireEvent.click(screen.getByRole('button', { name: /1 missing usage/ }))
    fireEvent.click(screen.getByRole('button', { name: 'List these sessions' }))
    await screen.findByRole('heading', { name: 'Sessions' })
    expect(screen.getByText('quality missing usage')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock.mock.calls.some(([value]) => {
      const url = new URL(String(value), 'http://localhost')
      return url.pathname === '/api/sessions' && url.searchParams.get('usage_missing') === 'true'
    })).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(screen.queryByText('quality missing usage')).not.toBeInTheDocument()
    await waitFor(() => expect(fetchMock.mock.calls.some(([value]) => String(value) === '/api/sessions?limit=50&offset=0')).toBe(true))
  })

  it('removes a base model from the envelope and invalidates the drill on Period change', async () => {
    const drill = encodeURIComponent(JSON.stringify({ version: 1, label: 'accounting', value: 'claude · tracelab-claude', scope: { model_is_unknown: true, token_semantics: 'tracelab-claude', activity_grain: 'model_call' } }))
    start(`/dashboard?model=claude&drill=${drill}`)
    await screen.findByText('accounting claude · tracelab-claude')
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: '' } })
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(([value]) => new URL(String(value), 'http://localhost'))
      expect(calls.some(url => url.pathname === '/api/metrics/summary' && url.searchParams.get('token_semantics') === 'tracelab-claude' && !url.searchParams.has('model') && !url.searchParams.has('model_is_unknown'))).toBe(true)
    })
    expect(screen.getByText('accounting claude · tracelab-claude')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Period (UTC)'), { target: { value: '30d' } })
    await waitFor(() => expect(screen.queryByText('accounting claude · tracelab-claude')).not.toBeInTheDocument())
    await waitFor(() => expect(fetchMock.mock.calls.some(([value]) => {
      const url = new URL(String(value), 'http://localhost')
      return url.pathname === '/api/metrics/summary' && url.searchParams.has('started_from') && !url.searchParams.has('token_semantics')
    })).toBe(true))
  })

  it('ignores late responses for an older scope', async () => {
    start('/overview')
    await screen.findByRole('region', { name: 'Input usage by accounting group' })
    await screen.findByRole('option', { name: 'tracelab' })
    let finishOld!: (response: Response) => void
    fetchMock.mockImplementation((url, options) => String(url) === '/api/metrics/summary?source=tracelab'
      ? new Promise(resolve => { finishOld = resolve }) : defaultResponse(url, options))
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'tracelab' } })
    await waitFor(() => expect(finishOld).toBeTypeOf('function'))
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: '' } })
    await screen.findByRole('region', { name: 'Input usage by accounting group' })
    await act(async () => finishOld(json({ ...metrics, sessions: { ...metrics.sessions, value: 999 } })))
    for (const region of screen.getAllByRole('region', { name: 'Sessions' })) expect(region).not.toHaveTextContent('999')
  })

  it('hides stale dashboard numbers when a new scope has a core metric failure', async () => {
    start('/overview')
    await screen.findByRole('region', { name: 'Input usage by accounting group' })
    await screen.findByRole('option', { name: 'tracelab' })
    fetchMock.mockImplementation((url, options) => String(url) === '/api/metrics/summary?source=tracelab'
      ? Promise.resolve(json({ error: { code: 'query_failed', message: 'Scoped metrics failed', details: [] } }, 500))
      : defaultResponse(url, options))
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'tracelab' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Scoped metrics failed')
    expect(screen.queryByRole('region', { name: 'Input usage by accounting group' })).not.toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'claude:native_1' })).toBeInTheDocument()
  })
})

describe('Scope in the shell', () => {
  it('rail links keep the scope on data routes and the session receipt follows the current scope', async () => {
    start('/overview?source=tracelab&agent=claude-code')
    await screen.findAllByRole('region', { name: 'Sessions' })
    expect(screen.getByRole('link', { name: 'Sessions' })).toHaveAttribute('href', '/sessions?source=tracelab&agent=claude-code')
    expect(screen.getByRole('link', { name: 'Imports' })).toHaveAttribute('href', '/imports')
    fireEvent.click(await screen.findByRole('link', { name: 'claude:native_1' })) // the table renders after the regions
    await screen.findByRole('heading', { name: 'Session detail' })
    expect(fetchMock).toHaveBeenCalledWith('/api/metrics/summary?source=tracelab&agent=claude-code', undefined)
  })
})

describe('Metric definitions', () => {
  it('renders every server definition with an anchor and complete trust metadata', async () => {
    start('/definitions#input_tokens')
    const table = await screen.findByRole('table', { name: 'Metric definitions' })
    expect(within(table).getAllByRole('row')).toHaveLength(metricDefinitions.length + 1)
    const definition = metricDefinitions.find(item => item.id === 'input_tokens')!
    const anchor = document.getElementById('input_tokens')!
    expect(anchor).toHaveTextContent(`${definition.label}input_tokens · v1`)
    const row = anchor.closest('tr')!
    expect(row).toHaveTextContent(definition.formula)
    expect(row).toHaveTextContent(definition.null_handling)
    expect(row).toHaveTextContent(definition.comparability_rule)
  })
})

describe('Reports, history, and session detail', () => {
  it.each(['duplicate', 'failed'] as const)('explains a %s report without implying observations were inserted', async status => {
    fetchMock.mockImplementation((url, options) => url === '/api/imports/imp_1'
      ? Promise.resolve(json({ ...report, status, entities: {}, error: status === 'failed' ? 'IntegrityError: Transaction rolled back' : null }))
      : defaultResponse(url, options))
    start('/imports/imp_1')
    await screen.findByText(status, { selector: '.page-head .pill' })
    expect(screen.getByText(/No observations were inserted/)).toBeInTheDocument()
    const counts = screen.getByRole('region', { name: 'Entity observations' })
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
    expect(table.querySelectorAll('td .muted').length).toBeGreaterThanOrEqual(4)  // sessions and model calls show a dash on both rows, never zeros
    expect(table).not.toHaveTextContent('session: 0')
    expect(table).not.toHaveTextContent('undefined')
  })

  it('renders a dash for a reject without a field', async () => {
    fetchMock.mockImplementation((url, options) => String(url).startsWith('/api/imports/imp_1/rejects?')
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

  it('history counts rejected records, not reject rows, and names every mapping of a batch', async () => {
    fetchMock.mockImplementation((url, options) => String(url).startsWith('/api/imports?')
      ? Promise.resolve(json([{ ...report, reject_count: 2, records: { ...report.records, rejected: 1 },
        files: [report.files[0], { ...report.files[0], sha256: 'b'.repeat(64), filename: 'b.parquet', mapping: { id: 'map_p', name: 'parquet-test-v1', revision: 1 } }] }]))
      : defaultResponse(url, options))
    start('/imports')
    const table = await screen.findByRole('table', { name: 'Import attempts, newest first' })
    expect(within(table).getByRole('columnheader', { name: 'Rejected records' })).toBeInTheDocument()
    const row = within(table).getAllByRole('row')[1]
    const cells = within(row).getAllByRole('cell').map(cell => cell.textContent)
    expect(cells[cells.indexOf('2 mappings: tracelab-v1 · rev 1, parquet-test-v1 · rev 1') + 4]).toBe('1') // rejected records, not the 2 reject rows
    expect(table).toHaveTextContent('2 mappings: tracelab-v1 · rev 1, parquet-test-v1 · rev 1')
  })

  it('shows a retry when the rejects summary fails, without hiding the rows', async () => {
    fetchMock.mockImplementation((url, options) => String(url).endsWith('/rejects/summary')
      ? Promise.resolve(json({ error: { code: 'query_failed', message: 'summary unavailable', details: [] } }, 500))
      : defaultResponse(url, options))
    start('/imports/imp_1')
    await screen.findByRole('table', { name: 'Rejected records' })
    const rejects = screen.getByRole('region', { name: 'Rejects' })
    expect(within(rejects).getByText('Filter counts are unavailable.')).toBeInTheDocument()
    fireEvent.click(within(rejects).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/rejects/summary'))).toHaveLength(2))
  })

  it('opens an import report from history', async () => {
    start('/imports')
    fireEvent.click(await screen.findByRole('link', { name: 'imp_1' }))
    await screen.findAllByText('committed')
    expect(screen.getByRole('heading', { name: 'Import report' })).toBeInTheDocument()
  })

  it('paginates rejects and resets the page when the code filter changes', async () => {
    fetchMock.mockImplementation((url, options) => String(url).startsWith('/api/imports/imp_1/rejects?')
      ? Promise.resolve(json(String(url).includes('offset=50') ? [] : Array.from({ length: 50 }, (_, i) => ({ ...reject, locator: `line:${i}`, payload: {} }))))
      : defaultResponse(url, options))
    start('/imports/imp_1')
    await screen.findByRole('table', { name: 'Rejected records' })
    const rejects = screen.getByRole('region', { name: 'Rejects' })
    fireEvent.click(within(rejects).getByRole('button', { name: 'Next' }))
    await screen.findByText('No rejects on this page.')
    expect(fetchMock).toHaveBeenCalledWith('/api/imports/imp_1/rejects?limit=50&offset=50', undefined)
    expect(within(rejects).getByRole('button', { name: 'Next' })).toBeDisabled()
    fireEvent.change(within(rejects).getByLabelText('Code filter'), { target: { value: 'invalid_value' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/imports/imp_1/rejects?code=invalid_value&limit=50&offset=0', undefined))
    await screen.findByRole('table', { name: 'Rejected records' })
    expect(within(rejects).getByRole('button', { name: 'Previous' })).toBeDisabled()
    // the records panel has its own filter and pages
    const records = screen.getByRole('region', { name: 'Records' })
    expect(within(records).getByRole('option', { name: 'rejected (1)' })).toBeInTheDocument()
    fireEvent.change(within(records).getByLabelText('Outcome filter'), { target: { value: 'rejected' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/imports/imp_1/records?outcome=rejected&limit=50&offset=0', undefined))
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
