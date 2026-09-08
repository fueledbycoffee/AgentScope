import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, commitImport, listMappings, previewImport, uploadFile } from '../api'
import type { Upload } from '../api'
import { Icon, IconButton, JsonView, ResourceState, Table } from '../components'
import { entityCounts } from '../format'
import { ImportRoute, Receipt, StageBar, StageHeader, StatGroup } from '../import/components'
import {
  EMPTY_IMPORT_STATE, aggregatePreview, clampStep, duplicateHashes, importReducer, mappingCandidates,
  mixedSources, parseStoredImportState, requestFor, requestedStep, selectedMappings, serializeImportState,
  totalRecords,
} from '../import/importRuntime'
import type { ImportEntry, ImportStep } from '../import/importRuntime'
import '../import/import.css'
import { useFileBar } from '../shellHooks'
import { useResource } from '../useResource'

const STORAGE_KEY = 'agentscope-import-page'

function loadStored() {
  try {
    return parseStoredImportState(sessionStorage.getItem(STORAGE_KEY))
  } catch {
    return EMPTY_IMPORT_STATE
  }
}

function formatName(format: Upload['format']): string {
  return format === 'jsonl'
    ? 'JSON Lines, decoded and counted by the server.'
    : 'Apache Parquet, decoded and counted by the server.'
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 413) return 'This file is over the 25 MiB upload limit. Choose a smaller trace file.'
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function RouteError({ error, filename }: { error: unknown; filename?: string }) {
  return <div className="import-route-alert" role="alert" data-import-error tabIndex={-1}>
    <strong>{filename ? `${filename}: ${errorMessage(error)}` : errorMessage(error)}</strong>
    {error instanceof ApiError && <>
      <span>Code: <code>{error.code}</code></span>
      {error.details.length > 0 && <details><summary>Error details</summary><pre className="json">{JSON.stringify(error.details, null, 2)}</pre></details>}
    </>}
  </div>
}

function formatFact(entries: ImportEntry[]): string | undefined {
  if (entries.length === 0) return undefined
  const bytes = entries.reduce((total, entry) => total + entry.upload.size_bytes, 0).toLocaleString('en-US')
  return entries.length === 1
    ? `${bytes} B · ${entries[0].upload.sha256.slice(0, 12)}…`
    : `${entries.length} files · ${bytes} B`
}

export default function ImportPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const mappings = useResource(useCallback(() => listMappings({ limit: 500 }), []))
  const [state, dispatch] = useReducer(importReducer, undefined, loadStored)
  const [busy, setBusy] = useState<'upload' | 'preview' | 'import' | null>(null)
  const [uploadBytes, setUploadBytes] = useState(0)
  const [error, setError] = useState<{ stop: ImportStep; cause: unknown; filename?: string } | null>(null)
  const [storageWarning, setStorageWarning] = useState(false)
  const mounted = useRef(true)
  const generation = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current += 1 }
  }, [])

  useEffect(() => {
    if (mappings.data) dispatch({ type: 'reconcile', mappings: mappings.data })
  }, [mappings.data])

  useEffect(() => {
    try {
      if (state.entries.length === 0) sessionStorage.removeItem(STORAGE_KEY)
      else sessionStorage.setItem(STORAGE_KEY, serializeImportState(state))
    } catch {
      queueMicrotask(() => { if (mounted.current) setStorageWarning(true) })
    }
  }, [state])

  const wantedStep = requestedStep(searchParams)
  const effectiveStep: ImportStep = useMemo(() => {
    if (state.entries.length === 0) return 1
    if (!mappings.data) return Math.min(wantedStep, 2) as ImportStep
    return clampStep(wantedStep, state, mappings.data)
  }, [mappings.data, state, wantedStep])

  useEffect(() => {
    const waitingToResolveDeepLink = state.entries.length > 0 && mappings.loading && wantedStep > 2
    if (!waitingToResolveDeepLink && searchParams.get('step') !== String(effectiveStep)) {
      setSearchParams({ step: String(effectiveStep) }, { replace: true })
    }
  }, [effectiveStep, mappings.loading, searchParams, setSearchParams, state.entries.length, wantedStep])

  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('[data-import-step-heading]')
    if (!heading) return
    heading.setAttribute('tabindex', '-1')
    heading.focus()
  }, [effectiveStep])

  const currentMappings = mappings.data ?? []
  const resolvedMappings = selectedMappings(state.entries, currentMappings)
  const aggregate = aggregatePreview(state.entries)
  const records = totalRecords(state.entries)
  const hasDuplicates = duplicateHashes(state.entries)
  const hasMixedSources = mixedSources(state.entries, currentMappings)
  const allPreviewed = state.entries.length > 0 && state.entries.every(entry => entry.preview !== null)

  useEffect(() => {
    if (error || hasDuplicates || hasMixedSources) document.querySelector<HTMLElement>('[data-import-error]')?.focus()
  }, [effectiveStep, error, hasDuplicates, hasMixedSources])

  useFileBar('Import', state.entries.length === 0 ? [] : state.entries.length === 1 ? [
    { label: 'File', value: state.entries[0].upload.filename },
    { label: 'SHA-256', value: `${state.entries[0].upload.sha256.slice(0, 12)}…`, mono: true },
    { label: 'Records', value: state.entries[0].upload.record_count.toLocaleString('en-US') },
    ...(resolvedMappings ? [{ label: 'Mapping', value: `${resolvedMappings[0].name} · revision ${resolvedMappings[0].revision}` }] : []),
  ] : [
    { label: 'Files', value: String(state.entries.length) },
    { label: 'Records', value: records.toLocaleString('en-US') },
  ])

  const facts: Partial<Record<ImportStep, string>> = {
    1: formatFact(state.entries),
    2: resolvedMappings ? (resolvedMappings.length === 1
      ? `${resolvedMappings[0].name} · rev ${resolvedMappings[0].revision}`
      : `${resolvedMappings.length} mappings · ${resolvedMappings[0].source}`) : undefined,
    3: allPreviewed ? `${aggregate.records.sampled.toLocaleString('en-US')} sampled · ${aggregate.records.rejected.toLocaleString('en-US')} rejected · ${aggregate.records.ignored.toLocaleString('en-US')} ignored` : undefined,
  }

  function goTo(step: ImportStep, replace = false) {
    setError(null)
    setSearchParams({ step: String(step) }, { replace })
  }

  function continueToMapping() {
    for (const entry of state.entries) {
      if (entry.mappingId) continue
      const recommended = mappingCandidates(entry.upload, currentMappings)[0]
      if (recommended) dispatch({ type: 'mapping', uploadId: entry.upload.upload_id, mappingId: recommended.mapping.id })
    }
    goTo(2)
  }

  async function handleFiles(files: File[]) {
    if (busy || files.length === 0) return
    if (state.entries.length + files.length > 20) {
      setError({ stop: 1, cause: new Error('One import can contain at most 20 files.') })
      return
    }
    const token = ++generation.current
    setBusy('upload')
    setUploadBytes(files.reduce((total, file) => total + file.size, 0))
    setError(null)
    const added: ImportEntry[] = []
    let failed: { cause: unknown; filename: string } | undefined
    for (const file of files) {
      try {
        const uploaded = await uploadFile(file)
        const recommended = mappingCandidates(uploaded, currentMappings)[0]
        added.push({ upload: uploaded, mappingId: recommended?.mapping.id ?? null, preview: null })
      } catch (cause) {
        failed ??= { cause, filename: file.name }
      }
    }
    if (!mounted.current || token !== generation.current) return
    if (added.length > 0) dispatch({ type: 'add', entries: added })
    if (failed) setError({ stop: 1, ...failed })
    setBusy(null)
  }

  async function runPreview() {
    if (busy || !resolvedMappings || hasDuplicates || hasMixedSources) return
    const token = ++generation.current
    setBusy('preview')
    setError(null)
    goTo(3)
    try {
      const results = await Promise.all(state.entries.map(async (entry, index) => {
        try {
          return [entry.upload.upload_id, await previewImport({ upload_id: entry.upload.upload_id, mapping_id: resolvedMappings[index].id, sample: 200 })] as const
        } catch (cause) {
          throw { cause, filename: entry.upload.filename }
        }
      }))
      if (!mounted.current || token !== generation.current) return
      dispatch({ type: 'previews', previews: new Map(results) })
    } catch (failure) {
      if (!mounted.current || token !== generation.current) return
      const detail = failure as { cause?: unknown; filename?: string }
      setError({ stop: 3, cause: detail.cause ?? failure, filename: detail.filename })
    } finally {
      if (mounted.current && token === generation.current) setBusy(null)
    }
  }

  async function runImport() {
    if (busy || !allPreviewed || hasDuplicates || hasMixedSources) return
    const token = ++generation.current
    setBusy('import')
    setError(null)
    try {
      const report = await commitImport(requestFor(state.entries, currentMappings))
      try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* navigation still succeeds */ }
      if (!mounted.current || token !== generation.current) return
      navigate(`/imports/${encodeURIComponent(report.import_id)}`)
    } catch (cause) {
      if (mounted.current && token === generation.current) setError({ stop: 4, cause })
    } finally {
      if (mounted.current && token === generation.current) setBusy(null)
    }
  }

  function assistantLink(entry: ImportEntry, className?: string) {
    return <Link className={className} to={`/import/assist/${encodeURIComponent(entry.upload.upload_id)}`} state={{ upload: entry.upload }}>
      Set up a new mapping with the assistant
    </Link>
  }

  function FileStop() {
    const single = state.entries.length === 1 ? state.entries[0] : undefined
    return <>
      <StageHeader title="Import a trace file">Add one or more files, verify their identity, then choose how AgentScope should read them.</StageHeader>
      <div className="import-route-dropzone">
        <label htmlFor="trace-file">{state.entries.length ? 'Add another trace file' : 'Trace file'}</label>
        <input id="trace-file" type="file" multiple accept=".jsonl,.jsonl.gz,.gz,.gzip,.parquet" disabled={busy !== null}
          onChange={event => {
            void handleFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }} />
        <p>JSONL, JSONL.gz/gzip, or Parquet · up to 20 files per import</p>
      </div>
      {busy === 'upload' && <div className="notice" role="status"><div>
        <p className="title">Uploading {uploadBytes.toLocaleString('en-US')} bytes</p>
        <p>Server work: storing → hashing → counting. No records have been imported.</p>
      </div></div>}
      {error?.stop === 1 && <RouteError error={error.cause} filename={error.filename} />}
      {storageWarning && <div className="notice warn import-route-storage-warning" role="status"><div>
        <p className="title">This import will not survive a reload.</p><p>Browser session storage is unavailable or full. You can safely continue in this tab.</p>
      </div></div>}
      {single && <section className="import-route-stack" aria-labelledby="uploaded-file-heading">
        <div className="import-route-section-title">
          <h2 id="uploaded-file-heading">Uploaded file</h2>
          <IconButton name="trash" label={`Remove ${single.upload.filename}`} className="btn small icon-only" disabled={busy !== null}
            onClick={() => dispatch({ type: 'remove', uploadId: single.upload.upload_id })} />
        </div>
        <Receipt items={[
          { label: 'Filename', value: single.upload.filename },
          { label: 'Exact size', value: `${single.upload.size_bytes.toLocaleString('en-US')} bytes` },
          { label: 'SHA-256', value: single.upload.sha256, mono: true },
          { label: 'Format', value: formatName(single.upload.format) },
          { label: 'Record count', value: single.upload.record_count.toLocaleString('en-US') },
          { label: 'Seen before', value: single.upload.already_imported.length ? 'Yes' : 'No' },
        ]} />
        {single.upload.already_imported.length > 0 && <aside className="notice import-route-seen">
          <div><h3>Already imported</h3><p>These bytes have been imported before. Re-importing for the same source inserts no observations.</p></div>
          <ul>{single.upload.already_imported.map(item => <li key={item.import_id}>
            <Link to={`/imports/${encodeURIComponent(item.import_id)}`}>{item.import_id}</Link> · {item.imported_at}
          </li>)}</ul>
        </aside>}
        <details className="disclosure import-route-disclosure"><summary>Show the first 20 decoded records</summary>
          <Table caption="First decoded records (up to 20)" headers={['Locator', 'Payload', 'Error']}>
            {single.upload.preview.map(row => <tr key={row.locator}><td>{row.locator}</td><td><JsonView value={row.payload} /></td><td>{row.error ?? '—'}</td></tr>)}
          </Table>
          {single.upload.preview.length === 0 && <p className="muted">Decoded sample rows were not retained across this reload.</p>}
        </details>
      </section>}
      {state.entries.length > 1 && <section className="import-route-stack" aria-labelledby="uploaded-files-heading">
        <h2 id="uploaded-files-heading">Uploaded files</h2>
        <Table caption="Files ready for this import" headers={['Filename', 'Bytes', 'SHA-256', 'Format', 'Records', 'Seen before', '']}>
          {state.entries.map(entry => <tr key={entry.upload.upload_id}>
            <td>{entry.upload.filename}</td><td>{entry.upload.size_bytes.toLocaleString('en-US')}</td><td className="hash">{entry.upload.sha256}</td>
            <td>{entry.upload.format}</td><td>{entry.upload.record_count.toLocaleString('en-US')}</td>
            <td>{entry.upload.already_imported.length ? <Link to={`/imports/${encodeURIComponent(entry.upload.already_imported[0].import_id)}`}>Yes</Link> : 'No'}</td>
            <td><IconButton name="trash" label={`Remove ${entry.upload.filename}`} className="btn small icon-only" disabled={busy !== null}
              onClick={() => dispatch({ type: 'remove', uploadId: entry.upload.upload_id })} /></td>
          </tr>)}
        </Table>
        {state.entries.map(entry => <details key={entry.upload.upload_id} className="disclosure import-route-disclosure">
          <summary>Show the first 20 decoded records for {entry.upload.filename}</summary>
          <Table caption={`First decoded records for ${entry.upload.filename} (up to 20)`} headers={['Locator', 'Payload', 'Error']}>
            {entry.upload.preview.map(row => <tr key={row.locator}><td>{row.locator}</td><td><JsonView value={row.payload} /></td><td>{row.error ?? '—'}</td></tr>)}
          </Table>
          {entry.upload.preview.length === 0 && <p className="muted">Decoded sample rows were not retained across this reload.</p>}
        </details>)}
        {state.entries.some(entry => entry.upload.already_imported.length > 0) && <div className="notice"><div>
          <p className="title">Some bytes were seen before.</p><p>A same-source re-import inserts no observations for those files.</p>
        </div></div>}
      </section>}
      {hasDuplicates && <RouteError error={new Error('Two selected files have the same bytes. Remove one before continuing.')} />}
      <StageBar status={state.entries.length ? `Stop 1 of 4 · ${records.toLocaleString('en-US')} records stored, nothing imported` : undefined}
        primary={<button type="button" className="btn primary" disabled={busy !== null || state.entries.length === 0 || hasDuplicates || mappings.loading}
          onClick={continueToMapping}>Continue to mapping</button>} />
    </>
  }

  function MappingStop() {
    const withoutCandidate = state.entries.find(entry => mappingCandidates(entry.upload, currentMappings).length === 0)
    return <>
      <StageHeader title="Choose how to read it">Choose one format-compatible saved mapping for each file. Recommendations use only saved format, provenance, and revision facts.</StageHeader>
      <ResourceState {...mappings} />
      {mappings.data && <div className="import-route-mapping-list">{state.entries.map(entry => {
        const candidates = mappingCandidates(entry.upload, mappings.data!)
        return <fieldset key={entry.upload.upload_id} className="import-route-mapping-group">
          <legend>Mapping for {entry.upload.filename}</legend>
          {candidates.length > 0 ? <>
            <div className="import-route-mapping-cards">{candidates.map(candidate => <label key={candidate.mapping.id} className="import-route-mapping-card">
              <input type="radio" name={`mapping-${entry.upload.upload_id}`} value={candidate.mapping.id} checked={entry.mappingId === candidate.mapping.id}
                disabled={busy !== null} onChange={() => dispatch({ type: 'mapping', uploadId: entry.upload.upload_id, mappingId: candidate.mapping.id })} />
              <span className="import-route-mapping-copy">
                <span className="import-route-mapping-title"><strong>{candidate.mapping.name}</strong>
                  <span className="import-route-mapping-meta">revision {candidate.mapping.revision} · source {candidate.mapping.source} · {candidate.mapping.created_by}</span>
                  {candidate.recommended && <span className="import-route-badge recommended">Recommended</span>}
                  {candidate.superseded && <span className="import-route-badge">Superseded</span>}
                </span>
                <span className="import-route-mapping-reason">{candidate.reason}</span>
                <span className="import-route-mapping-id mono">{candidate.mapping.id}</span>
              </span>
            </label>)}</div>
            <p className="import-route-assistant-copy">Neither fits? {assistantLink(entry)} — it profiles the file and proposes a mapping; nothing is imported until you confirm.</p>
          </> : <div className="import-route-empty">
            <strong>No saved mapping reads {entry.upload.format}.</strong>
            <p>The assistant can profile {entry.upload.filename} and help you make one.</p>
            <p>{assistantLink(entry)}</p>
          </div>}
        </fieldset>
      })}</div>}
      {hasDuplicates && <RouteError error={new Error('Two files have the same bytes. Return to File and remove one.')} />}
      {hasMixedSources && <RouteError error={new Error('The selected mappings declare different sources. One import writes to one source.')} />}
      <StageBar onBack={() => goTo(1)} status={busy === 'preview' ? 'Applying each mapping to up to 200 records, nothing written' : undefined}
        primary={withoutCandidate
          ? assistantLink(withoutCandidate, 'btn primary')
          : <button type="button" className="btn primary" disabled={busy !== null || mappings.loading || !resolvedMappings || hasDuplicates || hasMixedSources}
              onClick={() => void runPreview()}>Run a dry run</button>} />
    </>
  }

  function PreviewStop() {
    const previewError = error?.stop === 3 ? error : null
    const detailsAvailable = state.entries.every(entry => entry.preview?.detailsAvailable)
    return <>
      <StageHeader title="Dry run on up to 200 records per file">The saved mappings were applied to a bounded sample. Nothing was written.</StageHeader>
      {busy === 'preview' && <div className="notice"><div><p className="title">Running the dry run</p><p>Applying each mapping to up to 200 records, nothing written.</p></div></div>}
      {previewError && <RouteError error={previewError.cause} filename={previewError.filename} />}
      {!busy && !previewError && allPreviewed && <>
        <StatGroup items={[
          { label: 'Records sampled', value: aggregate.records.sampled, detail: state.entries.length > 1 ? `across ${state.entries.length} files` : 'from this file' },
          { label: 'Accepted', value: aggregate.records.accepted, detail: `${aggregate.records.partial.toLocaleString('en-US')} partial` },
          { label: 'Rejected', value: aggregate.records.rejected, detail: 'each with a reason' },
          { label: 'Ignored', value: aggregate.records.ignored, detail: 'no rule selected the record' },
        ]} />
        <StatGroup title="Entity observations" note="one record can emit several observations" items={Object.entries(entityCounts(aggregate.entities)).map(([label, value]) => ({ label: label.replaceAll('_', ' '), value }))} />
        <StatGroup title="Warnings" note="fields the mapping tolerates" items={Object.keys(aggregate.warnings).length
          ? Object.entries(aggregate.warnings).map(([label, value]) => ({ label, value }))
          : [{ label: 'Warnings', value: 0, detail: 'No warnings in this sample' }]} />
        {!detailsAvailable && <div className="notice warn"><div><p className="title">Sample details were not retained across reload.</p><p>Counts are intact. Run the dry run again to restore reject and emission rows.</p></div></div>}
        <section className="import-route-stack"><h2>Rejects in the sample</h2>
          {aggregate.rejects.length > 0 ? <Table caption="Rejects sample" headers={['Locator', 'Rule', 'Path', 'Code', 'Field', 'Message']}>
            {aggregate.rejects.map((row, index) => <tr key={`${row.locator}-${index}`}><td>{row.locator}</td><td>{row.rule_id}</td><td>{row.path}</td><td>{row.code}</td><td>{row.field ?? '—'}</td><td>{row.message}</td></tr>)}
          </Table> : !detailsAvailable
            ? <div className="import-route-empty"><strong>Reject details are unavailable after this reload.</strong><p>Run the dry run again to restore the reject rows.</p></div>
            : aggregate.records.rejected > 0
              ? <div className="import-route-empty"><strong>Reject details are unavailable for this sample.</strong><p>Run the dry run again before confirming the import.</p></div>
              : <div className="import-route-empty"><strong>No rejects in this sample.</strong><p>The full run can still reject records; the report lists each reason.</p></div>}
        </section>
        <section className="import-route-stack"><div className="import-route-section-title"><h2>Emissions sample</h2><span>first five across the ordered files</span></div>
          <Table caption="Emissions sample" headers={['Entity', 'Path', 'Locator', 'Fields']}>
            {aggregate.emissions.map((row, index) => <tr key={`${row.locator}-${index}`}><td>{row.entity}</td><td>{row.path}</td><td>{row.locator}</td><td><JsonView value={row.fields} /></td></tr>)}
          </Table>
        </section>
      </>}
      <StageBar onBack={() => goTo(2)} status={busy === 'preview' ? 'Dry run in progress · nothing written' : undefined}
        primary={previewError
          ? <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void runPreview()}>Retry the dry run</button>
          : <button type="button" className="btn primary" disabled={busy !== null || !allPreviewed} onClick={() => goTo(4)}>Looks right, continue</button>} />
    </>
  }

  function ConfirmStop() {
    const selected = resolvedMappings ?? []
    const warningCount = Object.values(aggregate.warnings).reduce((total, count) => total + count, 0)
    return <>
      <StageHeader title="Confirm and run">This is exactly what will be written. The file hashes and mapping revisions are stored with the import for audit.</StageHeader>
      <div className="import-route-stack"><h2>Import receipt</h2>
        {state.entries.map((entry, index) => <Receipt key={entry.upload.upload_id} items={[
          { label: 'File', value: `${entry.upload.filename} · ${entry.upload.record_count.toLocaleString('en-US')} records` },
          { label: 'SHA-256', value: entry.upload.sha256, mono: true },
          { label: 'Mapping', value: selected[index] ? `${selected[index].name} revision ${selected[index].revision}` : 'Mapping not resolved' },
          { label: 'Mapping ID', value: selected[index]?.id ?? '', mono: true },
        ]} />)}
        <Receipt items={[
          { label: 'Import', value: `${records.toLocaleString('en-US')} records into source ${selected[0]?.source ?? ''}` },
          { label: 'Dry run', value: `${aggregate.records.sampled.toLocaleString('en-US')} sampled: ${aggregate.records.accepted.toLocaleString('en-US')} accepted, ${aggregate.records.partial.toLocaleString('en-US')} partial, ${aggregate.records.rejected.toLocaleString('en-US')} rejected, ${aggregate.records.ignored.toLocaleString('en-US')} ignored` },
          { label: 'Warnings', value: warningCount.toLocaleString('en-US') },
          { label: 'Outcome', value: state.entries.some(entry => entry.upload.already_imported.length) ? 'Previously seen same-source bytes insert no observations; all other records remain subject to the atomic import.' : 'On failure nothing is kept and the report shows the reason.' },
        ]} />
      </div>
      {error?.stop === 4 && <RouteError error={error.cause} />}
      {busy === 'import' && <div className="notice"><div>
        <p className="title">Importing {records.toLocaleString('en-US')} records in one transaction</p>
        <p>If anything fails, nothing is kept.</p>
      </div></div>}
      <StageBar onBack={() => goTo(3)} backDisabled={busy === 'import'} status={busy === 'import' ? `Importing exactly ${records.toLocaleString('en-US')} records` : undefined}
        primary={<button type="button" className="btn primary" disabled={busy !== null || !allPreviewed || hasDuplicates || hasMixedSources}
          onClick={() => void runImport()}><Icon name="upload" />Import {records.toLocaleString('en-US')} records</button>} />
    </>
  }

  return <ImportRoute step={effectiveStep} facts={facts} onSelect={goTo}>
    {effectiveStep === 1 && FileStop()}
    {effectiveStep === 2 && MappingStop()}
    {effectiveStep === 3 && PreviewStop()}
    {effectiveStep === 4 && ConfirmStop()}
  </ImportRoute>
}
