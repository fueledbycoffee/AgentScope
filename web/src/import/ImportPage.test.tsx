import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { mapping, preview, report, upload } from '../test/fixtures'
import { serializeImportState } from './importRuntime'

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function response(input: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'http://localhost')
  if (url.pathname === '/api/mappings') return Promise.resolve(json([mapping, { ...mapping, id: 'map_2', revision: 2 }]))
  if (url.pathname === '/api/uploads') return Promise.resolve(json(upload))
  if (url.pathname === '/api/imports/preview') return Promise.resolve(json(preview))
  if (url.pathname === '/api/imports' && options?.method === 'POST') return Promise.resolve(json(report))
  if (url.pathname === '/api/imports/imp_1') return Promise.resolve(json(report))
  if (url.pathname === '/api/imports/imp_1/rejects/summary') return Promise.resolve(json({ codes: {}, rules: {}, files: {}, outcomes: {} }))
  if (url.pathname === '/api/imports/imp_1/records' || url.pathname === '/api/imports/imp_1/rejects') return Promise.resolve(json([]))
  throw new Error(`Unexpected request: ${url}`)
}

function start(route = '/import') {
  render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
}

async function uploadOne() {
  const input = await screen.findByLabelText('Trace file')
  fireEvent.change(input, { target: { files: [new File(['{}'], 'sample.jsonl')] } })
  await screen.findByRole('heading', { name: 'Uploaded file' })
}

beforeEach(() => {
  sessionStorage.clear()
  fetchMock.mockImplementation(response)
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('guided import route', () => {
  it('moves through four focused stops and keeps the assistant link below compatible cards', async () => {
    start()
    await uploadOne()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to mapping' }))
    const mappingHeading = await screen.findByRole('heading', { name: 'Choose how to read it' })
    expect(mappingHeading).toHaveFocus()
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent?.startsWith('Neither fits?') === true)).toHaveTextContent('Set up a new mapping with the assistant')
    expect(screen.getByRole('radio', { name: /tracelab-v1.*revision 2/ })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Run a dry run' }))
    const previewHeading = await screen.findByRole('heading', { name: 'Dry run on up to 200 records per file' })
    await waitFor(() => expect(screen.getByText('Expected an integer')).toBeInTheDocument())
    expect(previewHeading).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Mapping' }))
    expect(await screen.findByRole('heading', { name: 'Choose how to read it' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Run a dry run' }))
    await screen.findByText('Expected an integer')
    fireEvent.click(screen.getByRole('button', { name: 'Looks right, continue' }))
    expect(await screen.findByRole('heading', { name: 'Confirm and run' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Import 3 records' }))
    expect(await screen.findByRole('heading', { name: 'Import report' })).toBeInTheDocument()
  })

  it('restores a trimmed reachable Preview deep link', async () => {
    sessionStorage.setItem('agentscope-import-page', serializeImportState({ entries: [{
      upload,
      mappingId: mapping.id,
      preview: { value: preview, detailsAvailable: true },
    }] }))
    start('/import?step=3')
    expect(await screen.findByRole('heading', { name: 'Dry run on up to 200 records per file' })).toBeInTheDocument()
    expect(screen.getByText('Sample details were not retained across reload.')).toBeInTheDocument()
    expect(screen.getByText('3', { selector: 'dd' })).toBeInTheDocument()
  })

  it('makes the assistant the Mapping primary when no saved mapping reads the format', async () => {
    fetchMock.mockImplementation((input, options) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/uploads') return Promise.resolve(json({ ...upload, format: 'parquet', filename: 'trace.parquet' }))
      return response(input, options)
    })
    start()
    await uploadOne()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to mapping' }))
    expect(await screen.findByText('No saved mapping reads parquet.')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Set up a new mapping with the assistant' })).toHaveLength(2)
  })

  it('warns when the trimmed import state cannot survive a reload', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    start()
    await uploadOne()
    expect(await screen.findByText('This import will not survive a reload.')).toBeInTheDocument()
  })

  it('shows upload-limit guidance, focuses it, and preserves an earlier file', async () => {
    start()
    await uploadOne()
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'payload_too_large', message: 'too large', details: [] } }, 413))
    fireEvent.change(screen.getByLabelText('Add another trace file'), { target: { files: [new File(['too much'], 'large.jsonl')] } })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('large.jsonl: This file is over the 25 MiB upload limit')
    expect(alert).toHaveFocus()
    const uploaded = screen.getByRole('heading', { name: 'Uploaded file' }).closest('section')!
    expect(within(uploaded).getByText('sample.jsonl.gz')).toBeInTheDocument()
  })

  it('blocks a batch whose selected mappings declare different sources', async () => {
    const otherMapping = { ...mapping, id: 'map_other', name: 'other-v1', source: 'other', created_by: 'user' }
    fetchMock.mockImplementation((input, options) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/mappings') return Promise.resolve(json([mapping, otherMapping]))
      return response(input, options)
    })
    start()
    await uploadOne()
    fetchMock.mockResolvedValueOnce(json({ ...upload, upload_id: 'upl_2', sha256: 'b'.repeat(64), filename: 'second.jsonl' }))
    fireEvent.change(screen.getByLabelText('Add another trace file'), { target: { files: [new File(['{}'], 'second.jsonl')] } })
    await screen.findByText('second.jsonl')
    fireEvent.click(screen.getByRole('button', { name: 'Continue to mapping' }))
    const secondGroup = await screen.findByRole('group', { name: 'Mapping for second.jsonl' })
    fireEvent.click(within(secondGroup).getByRole('radio', { name: /other-v1.*source other/ }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('different sources')
    expect(alert).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Run a dry run' })).toBeDisabled()
  })
})
