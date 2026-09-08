import { useEffect, useRef, useState } from 'react'
import { uploadFile } from '../api'
import type { Upload } from '../api'
import { Icon } from '../components'

/** The 25 MiB the server accepts (`application/dto.py: MAX_UPLOAD_BYTES`). */
const MAX_BYTES = 25 * 1024 * 1024

export interface ReuploadTarget {
  importId: string
  /** The source that import wrote into, which is not necessarily the mapping's own source. */
  importSource: string
  importStatus: 'committed' | 'duplicate' | 'failed'
  filename: string
  sha256: string
  fileStatus: string
  fileDuplicateOf: string | null
  mappingId: string | null
  mappingName: string | null
  mappingRevision: number | null
}

export interface ReuploadDialogProps {
  target: ReuploadTarget
  onClose: () => void
  onResolved: (upload: Upload) => void
}

async function digestOf(file: File): Promise<string> {
  // the store hashes the bytes it receives, so a .jsonl.gz is hashed compressed: nothing here
  // decompresses, decodes or re-encodes the file before hashing it
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Reopen a file that has already been imported, to correct the mapping it was imported with.
 *
 * The report knows a file by its SHA-256, not by an upload id, so the same bytes have to be
 * presented again. They are hashed **here, before anything is uploaded**: a file that is not the
 * one the report names never leaves the machine. The server's own digest is compared again
 * afterwards, so a hash computed on the wrong bytes cannot slip through either.
 */
export function ReuploadDialog({ target, onClose, onResolved }: ReuploadDialogProps) {
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [seen, setSeen] = useState<Upload | null>(null)
  const selection = useRef(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const canHash = typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function'

  useEffect(() => {
    dialog.current?.showModal?.()
    // leaving the dialog cancels whatever it started: a hash that has not finished, an upload in
    // flight, and above all a completion that would navigate away from wherever the user now is
    return () => { selection.current += 1 }
  }, [])

  /** Closing is a cancellation, not just a hide. */
  const close = () => {
    selection.current += 1
    onClose()
  }

  async function choose(file: File | undefined) {
    if (file === undefined) return
    const mine = (selection.current += 1) // one selection at a time; a stale result is discarded
    setProblem(null)
    setSeen(null)
    if (file.size > MAX_BYTES) {
      setProblem(`${file.name} is ${file.size.toLocaleString('en-US')} bytes; the limit is ${MAX_BYTES.toLocaleString('en-US')}.`)
      return
    }
    try {
      setBusy(`Hashing ${file.name}…`)
      const digest = await digestOf(file)
      if (mine !== selection.current) return
      if (digest !== target.sha256) {
        setBusy(null)
        setProblem(
          `Those are different bytes, so nothing was uploaded.\nThe report's file: ${target.sha256}\nThe file you picked: ${digest}`,
        )
        return
      }
      setBusy(`Uploading ${file.name}…`)
      const upload = await uploadFile(file)
      if (mine !== selection.current) return // closed, unmounted or replaced while it was uploading
      if (upload.sha256 !== target.sha256) {
        setBusy(null)
        setProblem(`The server hashed those bytes as ${upload.sha256}, which is not the file this report names.`)
        return
      }
      setBusy(null)
      setSeen(upload)
      onResolved(upload)
    } catch (error) {
      if (mine !== selection.current) return
      setBusy(null)
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  const revision = target.mappingName === null ? 'no mapping binding' : `${target.mappingName} · revision ${target.mappingRevision}`

  return (
    <dialog ref={dialog} className="drawer" aria-label="Correct this file's mapping" onCancel={close} onClose={close}>
      <div className="panel-head">
        <h2>Correct the mapping of {target.filename}</h2>
        <button type="button" className="btn small icon-only has-tip" aria-label="Close" data-tip="Close" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <dl className="kv">
        <dt>Import</dt><dd className="mono">{target.importId}</dd>
        <dt>Source</dt><dd>{target.importSource}</dd>
        <dt>Mapping</dt><dd>{revision}</dd>
        <dt>SHA-256</dt><dd className="mono">{target.sha256}</dd>
      </dl>
      <p>
        Pick the same file again. It is hashed on this machine first and only uploaded if the bytes
        match, so a different file never leaves it. A compressed file is hashed as it is on disk,
        compressed: recompressing it produces different bytes, and a different hash.
      </p>
      {canHash ? (
        <label className="field">
          Trace file
          <input type="file" disabled={busy !== null} onChange={event => void choose(event.target.files?.[0])} />
        </label>
      ) : (
        <p className="issue error">
          This browser does not expose SHA-256 hashing to the page (it needs a secure context), so the
          file cannot be checked before it is uploaded. Open the assistant from the import page instead.
        </p>
      )}
      {busy !== null && <p role="status">{busy}</p>}
      {problem !== null && <p className="issue error" style={{ whiteSpace: 'pre-wrap' }}>{problem}</p>}
      {seen !== null && seen.already_imported.length > 0 && (
        <p className="muted">
          These bytes are already imported by {seen.already_imported.map(entry => entry.import_id).join(', ')}.
        </p>
      )}
    </dialog>
  )
}
