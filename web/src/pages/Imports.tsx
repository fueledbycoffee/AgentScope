import { entityCounts, PAGE_SIZE } from '../format'
import { useResource } from '../useResource'
import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getImport, listImports, listRejects } from '../api'
import { Counts, JsonView, Pagination, ResourceState, Table } from '../components'

export function ImportsPage() {
  const [offset, setOffset] = useState(0)
  const resource = useResource(useCallback(() => listImports({ limit: PAGE_SIZE, offset }), [offset]))
  return <><h1>Imports history</h1><ResourceState {...resource} />
    {resource.data && <>
      <Table caption="Import attempts, newest first" headers={['Import', 'Source', 'Status', 'Started', 'Files', 'Records', 'Entities', 'Error']}>
        {resource.data.map(report => <tr key={report.import_id}>
          <td><Link to={`/imports/${encodeURIComponent(report.import_id)}`}>{report.import_id}</Link></td>
          <td>{report.source}</td><td>{report.status}</td><td>{report.started_at}</td>
          <td>{report.files.map(file => file.filename).join(', ')}</td>
          <td>{Object.entries(report.records).map(([key, value]) => `${key}: ${value}`).join(', ')}</td>
          <td>{Object.entries(entityCounts(report.entities)).map(([key, value]) => `${key}: ${value}`).join(', ')}</td>
          <td>{report.error ?? '—'}</td>
        </tr>)}
      </Table>
      {resource.data.length === 0 && <p>No imports on this page. <Link to="/import">Import a trace file</Link>.</p>}
      <Pagination offset={offset} count={resource.data.length} onChange={setOffset} />
    </>}
  </>
}

function Rejects({ id }: { id: string }) {
  const [offset, setOffset] = useState(0)
  const [code, setCode] = useState('')
  const resource = useResource(useCallback(() => listRejects(id, { code, limit: PAGE_SIZE, offset }), [id, code, offset]))
  return <section id="rejects"><h2>Rejects</h2>
    <label htmlFor="reject-code">Reject code filter</label>
    <input id="reject-code" value={code} onChange={event => { setCode(event.target.value); setOffset(0) }} />
    <ResourceState {...resource} />
    {resource.data && <>
      <Table caption="Rejected records" headers={['Locator', 'Rule', 'Path', 'Code', 'Field', 'Message', 'Payload']}>
        {resource.data.map((row, index) => <tr key={index}><td>{row.locator}</td><td>{row.rule_id}</td><td>{row.path}</td><td>{row.code}</td><td>{row.field ?? '—'}</td><td>{row.message}</td>
          <td><details><summary>Payload</summary><JsonView value={row.payload} /></details></td></tr>)}
      </Table>
      {resource.data.length === 0 && <p>No rejects on this page.</p>}
      <Pagination offset={offset} count={resource.data.length} onChange={setOffset} />
    </>}
  </section>
}

export function ReportPage() {
  const { id = '' } = useParams()
  const resource = useResource(useCallback(() => getImport(id), [id]))
  const report = resource.data
  return <><h1>Import report</h1><ResourceState {...resource} />
    {report && <>
      <dl><dt>Import ID</dt><dd>{report.import_id}</dd><dt>Status</dt><dd>{report.status}</dd>
        <dt>Source</dt><dd>{report.source}</dd><dt>Mapping</dt><dd>{report.mapping.name} · revision {report.mapping.revision} · {report.mapping.id}</dd>
        <dt>Started</dt><dd>{report.started_at}</dd><dt>Finished</dt><dd>{report.finished_at}</dd></dl>
      {report.status === 'duplicate' && <p className="notice">These bytes were already imported for this source. No observations were inserted.</p>}
      {report.status === 'failed' && <div role="alert"><p>Import failed. No observations were inserted.</p>
        {report.error && <p>{report.error}</p>}</div>}
      <p>Records count source records; entities count emitted observations.</p>
      <Counts title="Source records" counts={report.records} />
      <Counts title="Entity observations" counts={entityCounts(report.entities)} />
      <Counts title="Warnings" counts={report.warnings} />
      <Table caption="Imported files" headers={['Filename', 'SHA-256', 'Size (bytes)', 'Format', 'Records']}>
        {report.files.map((file, index) => <tr key={index}><td>{file.filename}</td><td className="hash">{file.sha256}</td><td>{file.size_bytes}</td><td>{file.format}</td><td>{file.record_count}</td></tr>)}
      </Table>
      <div className="actions"><a href="#rejects">View rejects ({report.reject_count})</a><Link to="/dashboard">Open dashboard</Link><Link to="/imports">Imports history</Link></div>
      <Rejects key={id} id={id} />
    </>}
  </>
}
