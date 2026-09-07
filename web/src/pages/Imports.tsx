import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getImport, getRejectSummary, listImports, listRecords, listRejects } from '../api'
import type { ImportReport, ImportSummary, ImportedFile, ImportReject, RawReference, RecordRow, RejectSummary } from '../api'
import { DataTable, Icon, IconButton, Notice, Pagination, SourceRecordDialog, StateBlock, StatusPill } from '../components'
import type { Column } from '../components'
import { display, entityCounts, PAGE_SIZE } from '../format'
import { useScope } from '../scope'
import { useFileBar } from '../shellHooks'
import { useResource } from '../useResource'

const n = (value: number | null | undefined) => value == null ? 'Unavailable' : value.toLocaleString('en-US')

/* ------------------------------------------------------------------ history */

/** One label for the mappings of an attempt: the file bindings decide, not the attempt-level echo. */
function mappingLabel(report: ImportSummary) {
  const names = Array.from(new Set(report.files.map(f => f.mapping ? `${f.mapping.name} · rev ${f.mapping.revision}` : '')))
    .filter(Boolean)
  if (names.length === 0) return `${report.mapping.name} · rev ${report.mapping.revision}`
  return names.length === 1 ? names[0] : `${names.length} mappings: ${names.join(', ')}`
}

/** The ledger of every attempt, newest first. Entities show a dash on attempts that inserted nothing. */
export function ImportsPage() {
  const [offset, setOffset] = useState(0)
  const resource = useResource(useCallback(() => listImports({ limit: PAGE_SIZE, offset }), [offset]))
  useFileBar('Imports', [])
  const columns: Column<ImportSummary>[] = [
    { key: 'id', header: 'Import', mono: true, render: r => <Link to={`/imports/${encodeURIComponent(r.import_id)}`}>{r.import_id}</Link> },
    { key: 'status', header: 'Status', render: r => <StatusPill status={r.status} /> },
    { key: 'source', header: 'Source', render: r => r.source },
    { key: 'files', header: 'Files', wrap: true, render: r => r.files.map(f => f.filename).join(', ') },
    { key: 'mapping', header: 'Mapping', render: r => mappingLabel(r) },
    { key: 'records', header: 'Records', render: r => (['accepted', 'partial', 'duplicate', 'rejected', 'ignored'] as const).filter(k => k === 'accepted' || r.records[k]).map(k => `${n(r.records[k])} ${k}`).join(' · ') },
    { key: 'sessions', header: 'Sessions', align: 'num', render: r => r.status === 'committed' ? n(entityCounts(r.entities).session) : <span className="muted">—</span> },
    { key: 'calls', header: 'Model calls', align: 'num', render: r => r.status === 'committed' ? n(entityCounts(r.entities).model_call) : <span className="muted">—</span> },
    { key: 'rejected', header: 'Rejected records', align: 'num', render: r => <span style={r.records.rejected ? { color: 'var(--bad)' } : undefined}>{n(r.records.rejected)}</span> },
    { key: 'started', header: 'Started', mono: true, render: r => r.started_at },
    { key: 'error', header: 'Error', wrap: true, render: r => r.error ?? <span className="muted">—</span> },
  ]
  return <>
    <div className="page-head"><h1>Imports</h1><span className="sub">every attempt, newest first</span></div>
    <section className="panel">
      <StateBlock loading={resource.loading} error={resource.error} retry={resource.retry} lines={5}>
        {resource.data && <>
          <DataTable caption="Import attempts, newest first" hideCaption columns={columns} rows={resource.data} rowKey={r => r.import_id}
            empty={offset > 0 ? 'No imports on this page.' : 'No imports yet.'} />
          {resource.data.length === 0 && offset === 0 && <p><Link className="btn primary small" to="/import"><Icon name="upload" />Import a trace file</Link></p>}
          <Pagination offset={offset} count={resource.data.length} onChange={setOffset} />
        </>}
      </StateBlock>
    </section>
  </>
}

/* ------------------------------------------------------------------- report */

function seconds(report: ImportReport) {
  const ms = Date.parse(report.finished_at) - Date.parse(report.started_at)
  return Number.isFinite(ms) ? `${Math.max(ms, 0) / 1000 < 1 ? '<1' : Math.round(ms / 1000)} s` : ''
}

/** The status lead, in the product's voice. */
function Lead({ report }: { report: ImportReport }) {
  const read = report.records.accepted + report.records.partial + report.records.rejected + report.records.ignored
  if (report.status === 'committed') return <Notice kind="info" title={`Committed in ${seconds(report)}. ${n(report.records.accepted + report.records.partial)} of ${n(read)} records accepted, ${n(report.records.rejected)} rejected${report.records.duplicate ? `, ${n(report.records.duplicate)} skipped as duplicates` : ''}.`}>
    <p><Link to="/overview">Open the overview</Link>{report.records.duplicate > 0 && <> · {report.files.filter(f => f.status === 'duplicate').length} file(s) were skipped as exact duplicates of {originals(report)}.</>}</p>
  </Notice>
  if (report.status === 'duplicate') return <Notice kind="warn" title="These bytes were already imported for this source. No observations were inserted.">
    <p>{report.files.length === 1 ? 'The file' : 'Every file'} matched an earlier committed import byte for byte: {originals(report)}. Record details live on that import.</p>
  </Notice>
  return <Notice kind="bad" title="Import failed. No observations were inserted.">{report.error && <p className="mono">{report.error}</p>}<p>The transaction was rolled back; the files are unchanged and can be imported again.</p></Notice>
}

function originals(report: ImportReport) {
  const ids = Array.from(new Set(report.files.map(f => f.duplicate_of).filter((id): id is string => !!id)))
  if (ids.length === 0) return <>an earlier import (see <Link to="/imports">the history</Link>)</>
  return <>{ids.map((id, index) => <span key={id}>{index > 0 && ', '}<Link to={`/imports/${encodeURIComponent(id)}`}>{id}</Link></span>)}</>
}

function CountPanel({ title, counts, order, hint }: { title: string; counts: Record<string, number>; order?: string[]; hint?: string }) {
  const keys = order ?? Object.keys(counts)
  return <section className="panel" aria-label={title}><div className="panel-head"><h2>{title}</h2>{hint && <span className="count">{hint}</span>}</div>
    <dl className="counts">{keys.map(key => <div key={key} className="count-item"><dt>{key.replaceAll('_', ' ')}</dt><dd className={(counts[key] ?? 0) === 0 ? 'zero' : undefined}>{n(counts[key] ?? 0)}</dd></div>)}</dl>
    {keys.length === 0 && <p className="state-block">None.</p>}
  </section>
}

type SummaryResource = { data?: RejectSummary; error?: unknown; retry: () => void }

function SummaryProblem({ summary }: { summary: SummaryResource }) {
  if (!summary.error) return null
  return <Notice kind="warn" title="Filter counts are unavailable."><p>The summary request failed; the rows below are unaffected. <button className="btn small" onClick={summary.retry}><Icon name="refresh" />Retry</button></p></Notice>
}

function Records({ id, files, summary }: { id: string; files: ImportedFile[]; summary: SummaryResource }) {
  const [outcome, setOutcome] = useState('')
  const [file, setFile] = useState('')
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<RawReference>()
  const resource = useResource(useCallback(() => listRecords(id, { outcome, file_sha256: file, limit: PAGE_SIZE, offset }), [id, outcome, file, offset]))
  const nameOf = (sha: string) => files.find(f => f.sha256 === sha)?.filename ?? sha.slice(0, 12)
  const columns: Column<RecordRow>[] = [
    ...(files.length > 1 ? [{ key: 'file', header: 'File', render: (r: RecordRow) => nameOf(r.file_sha256) }] : []),
    { key: 'locator', header: 'Locator', mono: true, render: r => r.locator },
    { key: 'outcome', header: 'Outcome', render: r => <StatusPill status={r.outcome} /> },
    { key: 'entities', header: 'Entities', render: r => Object.entries(r.entity_counts).map(([k, v]) => `${k.replaceAll('_', ' ')} ${v}`).join(', ') || <span className="muted">—</span> },
    { key: 'warnings', header: 'Warnings', render: r => Object.entries(r.warning_counts).map(([k, v]) => `${k} ${v}`).join(', ') || <span className="muted">—</span> },
    { key: 'raw', header: 'Source', render: r => <IconButton name="braces" label={`Raw payload for ${r.locator}`} className="btn small icon-only" onClick={() => setOpen({ file_sha256: r.file_sha256, locator: r.locator })} /> },
  ]
  const outcomes = summary.data?.outcomes ?? {}
  const replayed = files.filter(f => f.status === 'duplicate')
  return <section className="panel" id="records" aria-label="Records">
    <div className="panel-head"><h2>Records</h2><span className="count">one row per source record read in this attempt</span></div>
    {replayed.length > 0 && <p style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)', marginBottom: 12 }}>{replayed.map(f => f.filename).join(', ')}: skipped as exact duplicates, so their records are not listed here; see the original import.</p>}
    <SummaryProblem summary={summary} />
    <div className="row" style={{ marginBottom: 12 }}>
      <label className="dim"><span>Outcome</span><select aria-label="Outcome filter" value={outcome} onChange={e => { setOutcome(e.target.value); setOffset(0) }}>
        <option value="">All</option>
        {(['accepted', 'partial', 'duplicate', 'rejected', 'ignored'] as const).map(o => <option key={o} value={o}>{o}{outcomes[o] !== undefined ? ` (${n(outcomes[o])})` : ''}</option>)}
      </select></label>
      {files.length > 1 && <label className="dim"><span>File</span><select aria-label="Record file filter" value={file} onChange={e => { setFile(e.target.value); setOffset(0) }}>
        <option value="">All files</option>{files.map(f => <option key={f.sha256} value={f.sha256}>{f.filename}</option>)}
      </select></label>}
    </div>
    <StateBlock loading={resource.loading} error={resource.error} retry={resource.retry} lines={4}>
      {resource.data && <>
        <DataTable caption="Record outcomes" hideCaption columns={columns} rows={resource.data} rowKey={r => `${r.file_sha256}:${r.locator}`} empty={offset > 0 ? 'No records on this page.' : 'No records match.'} />
        <Pagination offset={offset} count={resource.data.length} onChange={setOffset} />
      </>}
    </StateBlock>
    {open && <SourceRecordDialog reference={open} onClose={() => setOpen(undefined)} importId={id} />}
  </section>
}

function Rejects({ id, files, summary, total, report }: { id: string; files: ImportedFile[]; summary: SummaryResource; total: number; report: ImportReport }) {
  const [code, setCode] = useState('')
  const [rule, setRule] = useState('')
  const [file, setFile] = useState('')
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<{ reference: RawReference }>()
  const resource = useResource(useCallback(() => listRejects(id, { code, rule_id: rule, file_sha256: file, limit: PAGE_SIZE, offset }), [id, code, rule, file, offset]))
  const nameOf = (sha?: string) => files.find(f => f.sha256 === sha)?.filename ?? sha?.slice(0, 12) ?? '—'
  const columns: Column<ImportReject>[] = [
    ...(files.length > 1 ? [{ key: 'file', header: 'File', render: (r: ImportReject) => nameOf(r.file_sha256) }] : []),
    { key: 'locator', header: 'Locator', mono: true, render: r => r.locator },
    { key: 'rule', header: 'Rule', render: r => r.rule_id },
    { key: 'path', header: 'Path', mono: true, render: r => r.path },
    { key: 'code', header: 'Code', mono: true, render: r => r.code },
    { key: 'field', header: 'Field', render: r => r.field ?? <span className="muted">—</span> },
    { key: 'message', header: 'Message', wrap: true, render: r => r.message },
    { key: 'raw', header: 'Source', render: r => <IconButton name="braces" label={`Raw payload for reject at ${r.locator}`} className="btn small icon-only" onClick={() => setOpen({ reference: { file_sha256: r.file_sha256 ?? files[0]?.sha256 ?? '', locator: r.locator } })} /> },
  ]
  if (total === 0) return <section className="panel" id="rejects" aria-label="Rejects"><div className="panel-head"><h2>Rejects</h2></div>
    <p className="state-block">{report.status === 'failed' ? 'No reject rows: the attempt failed before its records were evaluated.'
      : report.status === 'duplicate' ? 'No reject rows: nothing was read, the bytes were already imported.'
      : report.records.ignored > 0 ? `No reject rows. ${n(report.records.ignored)} record${report.records.ignored === 1 ? ' was' : 's were'} ignored because no rule selected ${report.records.ignored === 1 ? 'it' : 'them'}; the rest produced observations or were skipped as duplicates.`
      : 'No reject rows for this attempt.'}</p></section>
  const select = (label: string, value: string, set: (v: string) => void, options: Record<string, number>) =>
    <label className="dim"><span>{label}</span><select aria-label={`${label} filter`} value={value} onChange={e => { set(e.target.value); setOffset(0) }}>
      <option value="">All</option>{Object.entries(options).map(([k, v]) => <option key={k} value={k}>{k} ({n(v)})</option>)}
    </select></label>
  return <section className="panel" id="rejects" aria-label="Rejects">
    <div className="panel-head"><h2>Rejects</h2><span className="count">{n(total)} reject row{total === 1 ? '' : 's'}, one per rule that refused a record ({n(report.records.rejected)} record{report.records.rejected === 1 ? '' : 's'} rejected outright)</span></div>
    <SummaryProblem summary={summary} />
    <div className="row" style={{ marginBottom: 12 }}>
      {select('Code', code, setCode, summary.data?.codes ?? {})}
      {select('Rule', rule, setRule, summary.data?.rules ?? {})}
      {files.length > 1 && <label className="dim"><span>File</span><select aria-label="Reject file filter" value={file} onChange={e => { setFile(e.target.value); setOffset(0) }}>
        <option value="">All files</option>{files.map(f => <option key={f.sha256} value={f.sha256}>{f.filename}{summary.data?.files[f.sha256] ? ` (${n(summary.data.files[f.sha256])})` : ''}</option>)}
      </select></label>}
    </div>
    <StateBlock loading={resource.loading} error={resource.error} retry={resource.retry} lines={4}>
      {resource.data && <>
        <DataTable caption="Rejected records" hideCaption columns={columns} rows={resource.data} rowKey={(r, ) => `${r.file_sha256}:${r.locator}:${r.rule_id}:${r.path}:${r.code}`} empty={offset > 0 ? 'No rejects on this page.' : 'No rejects match these filters.'} />
        <Pagination offset={offset} count={resource.data.length} onChange={setOffset} />
      </>}
    </StateBlock>
    {open && <SourceRecordDialog reference={open.reference} onClose={() => setOpen(undefined)} importId={id} />}
  </section>
}

export function ReportPage() {
  const { id = '' } = useParams()
  const { link } = useScope()
  const resource = useResource(useCallback(() => getImport(id), [id]))
  const summary = useResource(useCallback(() => getRejectSummary(id), [id]))
  const report = resource.data
  const mappings = report ? Array.from(new Set(report.files.map(f => f.mapping ? `${f.mapping.name} · revision ${f.mapping.revision}` : ''))).filter(Boolean) : []
  useFileBar('Report', report ? [
    { label: 'Import', value: report.import_id, mono: true },
    { label: 'Source', value: report.source },
    { label: mappings.length > 1 ? 'Mappings' : 'Mapping', value: mappings.length > 1 ? `${mappings.length} mappings` : mappings[0] ?? `${report.mapping.name} · revision ${report.mapping.revision}` },
    { label: 'Started', value: report.started_at, mono: true },
  ] : [])
  const fileColumns: Column<ImportedFile>[] = [
    { key: 'name', header: 'Filename', render: f => f.filename },
    { key: 'sha', header: 'SHA-256', mono: true, wrap: true, render: f => f.sha256 },
    { key: 'size', header: 'Bytes', align: 'num', render: f => n(f.size_bytes) },
    { key: 'format', header: 'Format', render: f => f.format },
    { key: 'records', header: 'Records', align: 'num', render: f => n(f.record_count) },
    { key: 'mapping', header: 'Mapping', render: f => f.mapping ? `${f.mapping.name} · rev ${f.mapping.revision}` : '—' },
    { key: 'status', header: 'Status', render: f => <StatusPill status={f.status} /> },
    { key: 'outcome', header: 'Outcome', render: f => Object.entries(f.records).filter(([, v]) => v).map(([k, v]) => `${k} ${n(v)}`).join(', ') || <span className="muted">—</span> },
  ]
  return <>
    <nav className="crumbs" aria-label="Breadcrumb"><Link to="/imports">Imports</Link><span>/</span><span className="mono">{id}</span></nav>
    <div className="page-head"><h1>Import report</h1>{report && <StatusPill status={report.status} />}</div>
    <StateBlock loading={resource.loading} error={resource.error} retry={resource.retry} lines={6}>
      {resource.error ? <p><Link to="/imports">Back to the imports</Link></p> : null}
      {report && <>
        <Lead report={report} />
        <dl className="facts"><dt>Import ID</dt><dd className="mono">{report.import_id}</dd><dt>Source</dt><dd>{report.source}</dd>
          <dt>{mappings.length > 1 ? 'Mappings' : 'Mapping'}</dt><dd>{mappings.length > 1 ? mappings.join(' · ') : <>{report.mapping.name} · revision {report.mapping.revision} · <span className="mono">{report.mapping.id}</span></>}</dd>
          <dt>Started</dt><dd className="mono">{report.started_at}</dd><dt>Finished</dt><dd className="mono">{display(report.finished_at)}</dd></dl>
        <p style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>Records count source records; entities count emitted observations. One record can emit several entities.</p>
        <div className="grid panels">
          <CountPanel title="Source records" counts={report.records} order={['accepted', 'partial', 'duplicate', 'rejected', 'ignored']} />
          <CountPanel title="Entity observations" counts={entityCounts(report.entities)} order={['session', 'model_call', 'tool_call']} />
          <CountPanel title="Warnings" counts={report.warnings} hint="absent: no such field · null: field present, value null" />
        </div>
        <section className="panel" aria-label="Imported files"><div className="panel-head"><h2>Imported files</h2><span className="count">{report.files.length}</span></div>
          <DataTable caption="Imported files" hideCaption columns={fileColumns} rows={report.files} rowKey={f => f.sha256} empty="No files." /></section>
        <div className="actions"><a className="btn small" href="#rejects"><Icon name="alert" />View rejects ({n(report.reject_count)})</a><a className="btn small" href="#records"><Icon name="sessions" />Browse records</a><Link className="btn small" to={link('/overview')}><Icon name="overview" />Open dashboard</Link><Link className="btn small" to="/imports"><Icon name="imports" />Imports history</Link></div>
        {report.status !== 'failed' && <Records key={`records-${id}`} id={id} files={report.files} summary={summary} />}
        <Rejects key={`rejects-${id}`} id={id} files={report.files} summary={summary} total={report.reject_count} report={report} />
      </>}
    </StateBlock>
  </>
}
