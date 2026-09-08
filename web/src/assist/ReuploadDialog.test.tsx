import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReuploadDialog, type ReuploadTarget } from './ReuploadDialog'

/** The SHA-256 of the bytes in `FILE`, computed by the same digest the dialog uses. */
const CONTENT = '{"session": "s1", "ts": 1757000000}\n'
let digest = ''

const target = (over: Partial<ReuploadTarget> = {}): ReuploadTarget => ({
  importId: 'imp_1',
  importSource: 'tracelab',
  importStatus: 'committed',
  filename: 'trace.jsonl',
  sha256: digest,
  fileStatus: 'committed',
  fileDuplicateOf: null,
  mappingId: 'map_1',
  mappingName: 'tracelab-v1',
  mappingRevision: 1,
  ...over,
})

const file = (content: string, name = 'trace.jsonl') => new File([content], name, { type: 'application/x-ndjson' })

let uploads: { name: string; sha: string }[] = []

beforeEach(async () => {
  uploads = []
  const bytes = new TextEncoder().encode(CONTENT)
  digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body as FormData
    const sent = body.get('file') as File
    const text = await sent.text()
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')
    uploads.push({ name: String(path), sha })
    return {
      ok: true,
      status: 201,
      json: async () => ({ upload_id: 'upl_9', filename: sent.name, sha256: sha, size_bytes: text.length, format: 'jsonl', record_count: 1, preview: [], already_imported: [{ import_id: 'imp_1', imported_at: 'now' }] }),
    } as unknown as Response
  }))
})
afterEach(() => vi.unstubAllGlobals())

function show(over: Partial<ReuploadTarget> = {}) {
  const onResolved = vi.fn()
  const onClose = vi.fn()
  render(<ReuploadDialog target={target(over)} onClose={onClose} onResolved={onResolved} />)
  return { onResolved, onClose }
}

describe('reopening a file from its report', () => {
  it('names the import, its source and the file’s own mapping revision', () => {
    show()
    const dialog = screen.getByRole('dialog', { name: "Correct this file's mapping" })
    expect(dialog).toHaveTextContent('imp_1')
    expect(dialog).toHaveTextContent('tracelab')
    expect(dialog).toHaveTextContent('tracelab-v1 · revision 1')
    expect(dialog).toHaveTextContent(digest)
  })

  it('refuses different bytes before anything is uploaded', async () => {
    const { onResolved } = show()
    fireEvent.change(screen.getByLabelText('Trace file'), { target: { files: [file('{"other": 1}\n')] } })
    await screen.findByText(/Those are different bytes/)
    expect(uploads).toHaveLength(0) // the wrong file never left the machine
    expect(onResolved).not.toHaveBeenCalled()
    expect(screen.getByText(/Those are different bytes/)).toHaveTextContent(digest)
  })

  it('uploads matching bytes and hands the upload back', async () => {
    const { onResolved } = show()
    fireEvent.change(screen.getByLabelText('Trace file'), { target: { files: [file(CONTENT)] } })
    await waitFor(() => expect(onResolved).toHaveBeenCalled())
    expect(uploads).toEqual([{ name: '/api/uploads', sha: digest }])
    expect(onResolved.mock.calls[0][0].upload_id).toBe('upl_9')
    expect(await screen.findByText(/already imported by imp_1/)).toBeInTheDocument()
  })

  it('accepts the same bytes under a different filename, because bytes are what identify them', async () => {
    const { onResolved } = show()
    fireEvent.change(screen.getByLabelText('Trace file'), { target: { files: [file(CONTENT, 'renamed.jsonl')] } })
    await waitFor(() => expect(onResolved).toHaveBeenCalled())
  })

  it('discards a selection that was replaced while it was hashing', async () => {
    const { onResolved } = show()
    const input = screen.getByLabelText('Trace file')
    fireEvent.change(input, { target: { files: [file('{"first": 1}\n')] } })
    fireEvent.change(input, { target: { files: [file(CONTENT)] } })
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1))
    expect(uploads).toHaveLength(1)
    // the first file was wrong, but its refusal must not overwrite the second's result
    expect(screen.queryByText(/Those are different bytes/)).not.toBeInTheDocument()
  })

  it('refuses a file over the upload limit before reading it', async () => {
    const { onResolved } = show()
    const huge = new File([''], 'huge.jsonl')
    Object.defineProperty(huge, 'size', { value: 26 * 1024 * 1024 })
    fireEvent.change(screen.getByLabelText('Trace file'), { target: { files: [huge] } })
    expect(await screen.findByText(/the limit is/)).toBeInTheDocument()
    expect(uploads).toHaveLength(0)
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('aborts when the server hashes the bytes differently', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ upload_id: 'upl_9', filename: 'trace.jsonl', sha256: 'f'.repeat(64), size_bytes: 1, format: 'jsonl', record_count: 1, preview: [], already_imported: [] }),
    } as unknown as Response)))
    const { onResolved } = show()
    fireEvent.change(screen.getByLabelText('Trace file'), { target: { files: [file(CONTENT)] } })
    expect(await screen.findByText(/The server hashed those bytes as/)).toBeInTheDocument()
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('cancels a pending completion when the dialog is closed', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>(resolve => { release = resolve })
    vi.stubGlobal('fetch', vi.fn(async () => {
      await held
      return {
        ok: true, status: 201,
        json: async () => ({ upload_id: 'upl_9', filename: 'trace.jsonl', sha256: digest, size_bytes: 1, format: 'jsonl', record_count: 1, preview: [], already_imported: [] }),
      } as unknown as Response
    }))
    const { onResolved, onClose } = show()
    fireEvent.change(screen.getByLabelText('Trace file'), { target: { files: [file(CONTENT)] } })
    await screen.findByText(/Uploading/)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
    release!()
    await new Promise(resolve => setTimeout(resolve, 0))
    // a response that arrives after the dialog is gone must not navigate anywhere
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('cancels a pending completion when the dialog is unmounted', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>(resolve => { release = resolve })
    vi.stubGlobal('fetch', vi.fn(async () => {
      await held
      return {
        ok: true, status: 201,
        json: async () => ({ upload_id: 'upl_9', filename: 'trace.jsonl', sha256: digest, size_bytes: 1, format: 'jsonl', record_count: 1, preview: [], already_imported: [] }),
      } as unknown as Response
    }))
    const onResolved = vi.fn()
    const { unmount } = render(<ReuploadDialog target={target()} onClose={vi.fn()} onResolved={onResolved} />)
    fireEvent.change(screen.getByLabelText('Trace file'), { target: { files: [file(CONTENT)] } })
    await screen.findByText(/Uploading/)
    unmount()
    release!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('does not start an upload for a file picked before the dialog closed', async () => {
    const { onResolved } = show()
    fireEvent.change(screen.getByLabelText('Trace file'), { target: { files: [file(CONTENT)] } })
    // closed while the bytes are still being hashed
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(uploads).toHaveLength(0)
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('disables the entry when the browser cannot hash, instead of uploading first', () => {
    const subtle = crypto.subtle
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true })
    show()
    expect(screen.queryByLabelText('Trace file')).not.toBeInTheDocument()
    expect(screen.getByText(/does not expose SHA-256 hashing/)).toBeInTheDocument()
    Object.defineProperty(globalThis.crypto, 'subtle', { value: subtle, configurable: true })
  })
})
