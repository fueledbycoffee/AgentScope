import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, getRawRecord } from '../api'
import type { RawReference } from '../api'
import { useResource } from '../useResource'
import { Drawer, JsonText, Notice, StateBlock } from './primitives'

/**
 * The exact source record behind one observation: file hash, locator, the
 * stored payload text verbatim (browsers round large integers, so the text is
 * never rebuilt from `payload`), and where it came from.
 */
export function SourceRecordDialog({ reference, onClose, mapping, importId, highlight }: {
  reference: RawReference; onClose: () => void; mapping?: string; importId?: string; highlight?: string
}) {
  const resource = useResource(useCallback(() => getRawRecord(reference), [reference]))
  return <Drawer title="Source record" onClose={onClose} closeLabel="Close source record">
    <dl className="facts">
      <dt>File SHA-256</dt><dd className="hash">{reference.file_sha256}</dd>
      <dt>Locator</dt><dd className="mono">{reference.locator}</dd>
      {mapping && <><dt>Mapping</dt><dd>{mapping}</dd></>}
      {importId && <><dt>Import</dt><dd><Link to={`/imports/${encodeURIComponent(importId)}`}>{importId}</Link></dd></>}
    </dl>
    <p style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>
      {resource.data?.derived === 'parquet-row'
        ? 'Decoded Parquet row: values are shown exactly as converted from the file, not as source bytes.'
        : 'Numbers are shown exactly as stored; nothing is rounded.'}
    </p>
    {resource.error instanceof ApiError && resource.error.status === 404
      ? <Notice kind="warn" title="No stored payload for this record.">The record could not be decoded when it was read (an undecodable line has no JSON to keep), so only its locator is known.</Notice>
      : <StateBlock loading={resource.loading} error={resource.error} retry={resource.retry} lines={6}>
        {resource.data && <JsonText text={resource.data.payload_text} highlight={highlight} />}
      </StateBlock>}
  </Drawer>
}
