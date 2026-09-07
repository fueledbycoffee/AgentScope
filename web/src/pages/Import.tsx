import { useResource } from '../useResource'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { commitImport, listMappings, previewImport, uploadFile } from '../api'
import type { ImportPreview, Upload } from '../api'
import { Counts, ErrorNotice, JsonView, ResourceState, Table } from '../components'

export default function ImportPage() {
  const navigate = useNavigate()
  const mappings = useResource(useCallback(() => listMappings({ limit: 500 }), []))
  const [upload, setUpload] = useState<Upload>()
  const [mappingId, setMappingId] = useState('')
  const [preview, setPreview] = useState<ImportPreview>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<unknown>()
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const mapping = mappings.data?.find(item => item.id === mappingId)

  async function run(label: string, action: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(label)
    setError(undefined)
    try { await action() } catch (cause) { setError(cause) }
    finally { inFlight.current = false; setBusy('') }
  }

  return <>
    <h1>Import traces</h1>
    <p>Upload JSONL, JSONL.gz, or Parquet, inspect the mapping preview, then confirm the import.</p>
    <ResourceState {...mappings} />
    <label htmlFor="trace-file">Trace file</label>
    <input id="trace-file" type="file" accept=".jsonl,.jsonl.gz,.gz,.parquet" disabled={!!busy}
      onChange={event => {
        const file = event.target.files?.[0]
        setUpload(undefined); setPreview(undefined); setMappingId(''); setError(undefined)
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
        <Table caption="First decoded records (up to 20)" headers={['Locator', 'Payload']}>
          {upload.preview.map(row => <tr key={row.locator}><td>{row.locator}</td><td><JsonView value={row.payload} /></td></tr>)}
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
      <button disabled={!!busy || !mapping} onClick={() => {
        setPreview(undefined)
        void run('Previewing…', async () => setPreview(await previewImport({ upload_id: upload.upload_id, mapping_id: mappingId, sample: 200 })))
      }}>Preview</button>
      {preview && mapping && <section><h2>Import preview</h2>
        <p>Source records and emitted observations are counted separately. One record can emit several entities.</p>
        <Counts title="Source records sampled" counts={preview.records} />
        <Counts title="Entity observations" counts={preview.entities} />
        <Counts title="Warnings" counts={preview.warnings} />
        {Object.keys(preview.warnings).length === 0 && <p>No warnings.</p>}
        <Table caption="Rejects sample" headers={['Locator', 'Rule', 'Path', 'Code', 'Field', 'Message']}>
          {preview.rejects.map((row, index) => <tr key={index}><td>{row.locator}</td><td>{row.rule_id}</td><td>{row.path}</td><td>{row.code}</td><td>{row.field}</td><td>{row.message}</td></tr>)}
        </Table>
        {preview.rejects.length === 0 && <p>No rejects in this sample.</p>}
        <Table caption="Emissions sample" headers={['Entity', 'Path', 'Locator', 'Fields']}>
          {preview.emissions.map((row, index) => <tr key={index}><td>{row.entity}</td><td>{row.path}</td><td>{row.locator}</td><td><JsonView value={row.fields} /></td></tr>)}
        </Table>
        <h3>Confirm import</h3>
        <p>Import all {upload.record_count} records from <strong>{upload.filename}</strong> into source <strong>{mapping.source}</strong> using {mapping.name}, revision {mapping.revision}.</p>
        <p className="hash">SHA-256: {upload.sha256}</p>
        <p>The preview covers {preview.records.sampled} records. The full import may have additional warnings or rejects.</p>
        <button disabled={!!busy} onClick={() => void run('Importing…', async () => {
          const report = await commitImport({ upload_id: upload.upload_id, mapping_id: mapping.id, source: mapping.source })
          if (mounted.current) navigate(`/imports/${encodeURIComponent(report.import_id)}`)
        })}>Import</button>
      </section>}
    </>}
  </>
}
