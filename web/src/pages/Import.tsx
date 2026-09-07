import { entityCounts } from '../format'
import { useResource } from '../useResource'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { commitImport, listMappings, previewImport, uploadFile } from '../api'
import type { ImportPreview, ImportRequest, Mapping, Upload } from '../api'
import { Counts, ErrorNotice, Icon, IconButton, JsonView, ResourceState, Table } from '../components'
import { useFileBar } from '../shellHooks'

/** One previewed (file, mapping) pair waiting in the batch. */
interface Pair { upload: Upload; mapping: Mapping; preview: ImportPreview }

// The page's batch survives a detour to the assistant (same tab) but not a new tab.
const STORAGE_KEY = 'agentscope-import-page'
interface Stored { batch: Pair[]; upload?: Upload; mappingId: string }
function loadStored(): Stored {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Stored
  } catch { /* unavailable or corrupt storage: start empty */ }
  return { batch: [], mappingId: '' }
}
function store(value: Stored | null) {
  try {
    if (value === null) sessionStorage.removeItem(STORAGE_KEY)
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch { /* storage is a convenience */ }
}

function requestFor(pairs: Pair[], source: string): ImportRequest {
  if (pairs.length === 1) return { upload_id: pairs[0].upload.upload_id, mapping_id: pairs[0].mapping.id, source }
  return { source, files: pairs.map(pair => ({ upload_id: pair.upload.upload_id, mapping_id: pair.mapping.id })) }
}

export default function ImportPage() {
  const navigate = useNavigate()
  const mappings = useResource(useCallback(() => listMappings({ limit: 500 }), []))
  const [stored] = useState(loadStored)
  const [upload, setUpload] = useState<Upload | undefined>(stored.upload)
  const [mappingId, setMappingId] = useState(stored.mappingId)
  const [preview, setPreview] = useState<ImportPreview>()
  const [batch, setBatch] = useState<Pair[]>(stored.batch)
  useEffect(() => { store({ batch, upload, mappingId }) }, [batch, upload, mappingId])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<unknown>()
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const mapping = mappings.data?.find(item => item.id === mappingId)
  const current: Pair | undefined = upload && mapping && preview ? { upload, mapping, preview } : undefined
  const pairs = current ? [...batch, current] : batch
  const source = pairs[0]?.mapping.source
  const mixedSources = new Set(pairs.map(pair => pair.mapping.source)).size > 1
  const batchMixed = new Set(batch.map(pair => pair.mapping.source)).size > 1
  const duplicateInBatch = !!current && batch.some(pair => pair.upload.sha256 === current.upload.sha256)
  useFileBar('Import', upload ? [
    { label: 'File', value: upload.filename },
    { label: 'SHA-256', value: `${upload.sha256.slice(0, 12)}…`, mono: true },
    { label: 'Records', value: upload.record_count.toLocaleString('en-US') },
    ...(mapping ? [{ label: 'Mapping', value: `${mapping.name} · revision ${mapping.revision}` }] : []),
    ...(batch.length ? [{ label: 'Batch', value: `${batch.length} queued` }] : []),
  ] : [])

  async function run(label: string, action: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(label)
    setError(undefined)
    try { await action() } catch (cause) { setError(cause) }
    finally { inFlight.current = false; setBusy('') }
  }

  function resetCurrent() {
    setUpload(undefined); setPreview(undefined); setMappingId(''); setError(undefined)
  }

  return <>
    <h1>Import traces</h1>
    <p>Upload JSONL, JSONL.gz, or Parquet, inspect the mapping preview, then confirm the import. Several files can go into one import, each with its own mapping.</p>
    <ResourceState {...mappings} />
    {batch.length > 0 && <section aria-label="Files in this import"><h2>Files in this import</h2>
      <Table caption="Batch" headers={['Filename', 'SHA-256', 'Records', 'Mapping', 'Source', 'Preview', '']}>
        {batch.map(pair => <tr key={pair.upload.upload_id}><td>{pair.upload.filename}</td><td className="hash">{pair.upload.sha256}</td><td>{pair.upload.record_count}</td>
          <td>{pair.mapping.name} · revision {pair.mapping.revision}</td><td>{pair.mapping.source}</td>
          <td>{pair.preview.records.sampled} sampled · {pair.preview.rejects.length} rejects</td>
          <td><IconButton name="trash" label={`Remove ${pair.upload.filename}`} className="btn small icon-only" disabled={!!busy} onClick={() => setBatch(batch.filter(item => item !== pair))} /></td></tr>)}
      </Table>
      {!current && <>
        {batchMixed && <p className="error" role="alert">The mappings in this batch declare different sources. One import writes to one source.</p>}
        <p>Import {batch.length} {batch.length === 1 ? 'file' : 'files'} ({batch.reduce((total, pair) => total + pair.upload.record_count, 0)} records) into source <strong>{batch[0].mapping.source}</strong>, each with its own mapping, or add another file below.</p>
        <button className="btn primary" disabled={!!busy || batchMixed} onClick={() => void run('Importing…', async () => {
          const report = await commitImport(requestFor(batch, batch[0].mapping.source))
          store(null)
          if (mounted.current) navigate(`/imports/${encodeURIComponent(report.import_id)}`)
        })}><Icon name="upload" />{batch.length === 1 ? 'Import' : `Import ${batch.length} files`}</button>
      </>}
    </section>}
    <label htmlFor="trace-file">{batch.length > 0 ? 'Add another trace file' : 'Trace file'}</label>
    <input id="trace-file" type="file" accept=".jsonl,.jsonl.gz,.gz,.parquet" disabled={!!busy}
      onChange={event => {
        const file = event.target.files?.[0]
        resetCurrent()
        if (file) void run('Uploading…', async () => setUpload(await uploadFile(file)))
        event.target.value = ''
      }} />
    {!!busy && <p role="status">{busy}</p>}
    <ErrorNotice error={error} />
    {upload && <>
      <section><h2>Uploaded file</h2>
        <dl><dt>Filename</dt><dd>{upload.filename}</dd><dt>SHA-256</dt><dd className="hash">{upload.sha256}</dd>
          <dt>Size</dt><dd>{upload.size_bytes} bytes</dd><dt>Format</dt><dd>{upload.format}</dd>
          <dt>Record count</dt><dd>{upload.record_count}</dd></dl>
        {upload.already_imported.length > 0 && <aside className="notice"><h3>Already imported</h3>
          <p>These bytes have been imported before. Importing again for the same source adds no observations.</p>
          <ul>{upload.already_imported.map(item => <li key={item.import_id}>
            <Link to={`/imports/${encodeURIComponent(item.import_id)}`}>{item.import_id}</Link> — {item.imported_at}
          </li>)}</ul></aside>}
        <Table caption="First decoded records (up to 20)" headers={['Locator', 'Payload', 'Error']}>
          {upload.preview.map(row => <tr key={row.locator}><td>{row.locator}</td><td><JsonView value={row.payload} /></td><td>{row.error ?? '—'}</td></tr>)}
        </Table>
      </section>
      <label htmlFor="mapping">Mapping</label>
      <select id="mapping" value={mappingId} disabled={!!busy || mappings.loading} onChange={event => {
        setMappingId(event.target.value); setPreview(undefined); setError(undefined)
      }}><option value="">Choose a mapping</option>
        {mappings.data?.filter(item => item.input_format === upload.format).map(item =>
          <option key={item.id} value={item.id}>{item.name} · revision {item.revision} · {item.source}</option>)}
      </select>
      {mappings.data && !mappings.data.some(item => item.input_format === upload.format) &&
        <p>No mappings available for {upload.format}.</p>}
      <p className="row">
        <IconButton name="braces" label="Draft a mapping with the assistant" className="btn has-tip" data-tip="Draft a mapping with the assistant" disabled={!!busy}
          onClick={() => navigate(`/import/assist/${encodeURIComponent(upload.upload_id)}`, { state: { upload } })} />
        <span className="muted">No mapping fits? Let the assistant propose one from this file's profile.</span>
      </p>
      <button className="btn" disabled={!!busy || !mapping} onClick={() => {
        setPreview(undefined)
        void run('Previewing…', async () => setPreview(await previewImport({ upload_id: upload.upload_id, mapping_id: mappingId, sample: 200 })))
      }}><Icon name="eye" />Preview</button>
      {preview && mapping && <section><h2>Import preview</h2>
        <p>Source records and emitted observations are counted separately. One record can emit several entities.</p>
        <Counts title="Source records sampled" counts={preview.records} />
        <Counts title="Entity observations" counts={entityCounts(preview.entities)} />
        <Counts title="Warnings" counts={preview.warnings} />
        {Object.keys(preview.warnings).length === 0 && <p>No warnings.</p>}
        <Table caption="Rejects sample" headers={['Locator', 'Rule', 'Path', 'Code', 'Field', 'Message']}>
          {preview.rejects.map((row, index) => <tr key={index}><td>{row.locator}</td><td>{row.rule_id}</td><td>{row.path}</td><td>{row.code}</td><td>{row.field ?? '—'}</td><td>{row.message}</td></tr>)}
        </Table>
        {preview.rejects.length === 0 && <p>No rejects in this sample.</p>}
        <Table caption="Emissions sample" headers={['Entity', 'Path', 'Locator', 'Fields']}>
          {preview.emissions.map((row, index) => <tr key={index}><td>{row.entity}</td><td>{row.path}</td><td>{row.locator}</td><td><JsonView value={row.fields} /></td></tr>)}
        </Table>
        <h3>Confirm import</h3>
        {pairs.length === 1
          ? <p>Import all {upload.record_count} records from <strong>{upload.filename}</strong> into source <strong>{mapping.source}</strong> using {mapping.name}, revision {mapping.revision}.</p>
          : <p>Import {pairs.length} files ({pairs.reduce((total, pair) => total + pair.upload.record_count, 0)} records) into source <strong>{source}</strong>, each with the mapping shown above; this file uses {mapping.name}, revision {mapping.revision}.</p>}
        <p className="hash">SHA-256: {upload.sha256}</p>
        <p>The preview covers {preview.records.sampled} records. The full import may have additional warnings or rejects.</p>
        {duplicateInBatch && <p className="error" role="alert">This file has the same bytes as one already in the batch. Remove one of them.</p>}
        {mixedSources && <p className="error" role="alert">The mappings in this batch declare different sources. One import writes to one source.</p>}
        <div className="actions">
          <button className="btn primary" disabled={!!busy || duplicateInBatch || mixedSources || !source} onClick={() => void run('Importing…', async () => {
            const report = await commitImport(requestFor(pairs, source!))
            store(null)
            if (mounted.current) navigate(`/imports/${encodeURIComponent(report.import_id)}`)
          })}><Icon name="upload" />{pairs.length === 1 ? 'Import' : `Import ${pairs.length} files`}</button>
          <button type="button" className="btn" disabled={!!busy || duplicateInBatch} onClick={() => { if (current) { setBatch([...batch, current]); resetCurrent() } }}><Icon name="plus" />Add to batch and choose another file</button>
        </div>
      </section>}
    </>}
  </>
}
