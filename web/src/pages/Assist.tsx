import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ApiError,
  commitImport,
  prepareContext,
  previewImport,
  profileUpload,
  runAssistant,
  saveMappingText,
  validateMappingText,
} from '../api'
import type { FieldProfile, Upload } from '../api'
import { IconButton, Notice } from '../components'
import { useFileBar } from '../shellHooks'
import {
  acknowledge,
  applyDocumentEdits,
  canImport,
  canPreview,
  canSave,
  identityProblem,
  initialState,
  outcomeArrived,
  parseDocument,
  preparedArrived,
  previewArrived,
  requestFailed,
  runnable,
  savedArrived,
  setBusy,
  setDocumentText,
  setIdentity,
  setIncludeSample,
  startPrepare,
  undoDocument,
  validationArrived,
  type AssistState,
} from '../assist/assistRuntime'
import { ActionBar } from '../assist/ActionBar'
import { showPath, type DocPath } from '../assist/document'
import { indexDocument } from '../assist/documentIndex'
import { controlIdFor } from '../assist/issuePaths'
import { FieldTable } from '../assist/FieldTable'
import { IssueList } from '../assist/IssueList'
import { ViewSwitch, type DocumentView } from '../assist/ViewSwitch'
import { Conversation } from '../assist/Conversation'
import { DocumentEditor } from '../assist/DocumentEditor'
import { EvidenceRail } from '../assist/EvidenceRail'
import { PayloadDrawer } from '../assist/PayloadDrawer'
import '../assist/assist.css'

/** The request snapshot for the pending message, rebuilt from the same state the runtime validated. */
function pendingRequest(s: AssistState) {
  const built = startPrepare({ ...s, busy: 'none' }, s.pendingMessage ?? '')
  return 'request' in built ? built.request : null
}

function messageOf(error: unknown): { status: number; message: string } {
  if (error instanceof ApiError) return { status: error.status, message: error.message }
  return { status: 0, message: error instanceof Error ? error.message : String(error) }
}

/**
 * The assistant page (ADR-005 in the browser): profile → prepare → (acknowledge) → run, then the
 * explicit gates validate → save → preview → import. All rules live in assistRuntime; this
 * component only wires effects to them.
 */
export default function AssistPage() {
  const { uploadId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const upload = (location.state as { upload?: Upload } | null)?.upload
  const [state, setState] = useState<AssistState>(() => initialState(uploadId))
  const [profile, setProfile] = useState<FieldProfile | null>(null)
  const [profileError, setProfileError] = useState<unknown>()
  const [drawerRequested, setDrawerOpen] = useState(false)
  const [view, setView] = useState<DocumentView>('json')
  const [focusRequest, setFocusRequest] = useState<{ path: string; nonce: number } | null>(null)
  // the drawer opens by itself when a sample needs acknowledging
  const drawerOpen = drawerRequested || state.busy === 'awaiting_ack'
  const inFlight = useRef<{ kind: string; generation: number } | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const update = useCallback((fn: (s: AssistState) => AssistState) => {
    if (mounted.current) setState(fn)
  }, [])

  // the profile (cached server-side) is the evidence; it does not depend on the identity
  useEffect(() => {
    let cancelled = false
    profileUpload(uploadId)
      .then(report => { if (!cancelled) setProfile(report.profile) })
      .catch(error => { if (!cancelled) setProfileError(error) })
    return () => { cancelled = true }
  }, [uploadId])

  useFileBar('Assistant', [
    { label: 'File', value: upload?.filename ?? uploadId },
    ...(upload ? [{ label: 'SHA-256', value: `${upload.sha256.slice(0, 12)}…`, mono: true }, { label: 'Records', value: upload.record_count.toLocaleString('en-US') }] : []),
    ...(profile ? [{ label: 'Paths', value: profile.fields.length.toLocaleString('en-US') }] : []),
  ])

  // effect: a prepare is pending for this generation
  useEffect(() => {
    if (state.busy !== 'preparing') return
    const generation = state.generation
    if (inFlight.current?.kind === 'prepare' && inFlight.current.generation === generation) return
    inFlight.current = { kind: 'prepare', generation }
    const started = pendingRequest(state)
    if (!started) return
    prepareContext(started)
      .then(response => update(s => preparedArrived(s, generation, started, response)))
      .catch(error => { const { status, message } = messageOf(error); update(s => requestFailed(s, generation, status, message)) })
  }, [state, update])

  // effect: a run is allowed for this generation
  useEffect(() => {
    const run = runnable(state)
    if (run === null) return
    if (inFlight.current?.kind === 'run' && inFlight.current.generation === run.generation) return
    inFlight.current = { kind: 'run', generation: run.generation }
    runAssistant(run.request, run.digest)
      .then(({ outcome, rawText }) => update(s => outcomeArrived(s, run.generation, outcome, rawText)))
      .catch(error => { const { status, message } = messageOf(error); update(s => requestFailed(s, run.generation, status, message)) })
  }, [state, update])

  function send(text: string) {
    update(s => {
      const started = startPrepare(s, text)
      return started.state
    })
  }

  const documentVersion = state.documentVersion
  function documentProblem(): string | null {
    const parsed = parseDocument(state.documentText)
    return 'problem' in parsed ? parsed.problem : null
  }
  function validate() {
    const problem = documentProblem()
    if (problem) { update(s => ({ ...s, notices: [...s.notices, { kind: 'error', text: problem }] })); return }
    update(s => setBusy(s, 'validating'))
    validateMappingText(state.documentText)
      .then(result => update(s => validationArrived(s, documentVersion, result.issues, result.executable)))
      .catch(error => update(s => ({ ...setBusy(s, 'none'), notices: [...s.notices, { kind: 'error', text: messageOf(error).message }] })))
  }
  function save() {
    const problem = documentProblem()
    if (problem) { update(s => ({ ...s, notices: [...s.notices, { kind: 'error', text: problem }] })); return }
    const text = state.documentText
    update(s => setBusy(s, 'saving'))
    saveMappingText(text)
      .then(record => update(s => savedArrived(s, text, record)))
      .catch(error => update(s => ({ ...setBusy(s, 'none'), notices: [...s.notices, { kind: 'error', text: messageOf(error).message }] })))
  }
  function preview() {
    const saved = state.saved
    if (!saved) return
    update(s => setBusy(s, 'previewing'))
    previewImport({ upload_id: uploadId, mapping_id: saved.record.id, sample: 200 })
      .then(report => update(s => previewArrived(s, saved.record.id, report)))
      .catch(error => update(s => ({ ...setBusy(s, 'none'), notices: [...s.notices, { kind: 'error', text: messageOf(error).message }] })))
  }
  function doImport() {
    const saved = state.saved
    if (!saved || canImport(state) !== null) return
    update(s => setBusy(s, 'importing'))
    commitImport({ upload_id: uploadId, mapping_id: saved.record.id, source: saved.record.source })
      .then(report => { if (mounted.current) navigate(`/imports/${encodeURIComponent(report.import_id)}`) })
      .catch(error => update(s => ({ ...setBusy(s, 'none'), notices: [...s.notices, { kind: 'error', text: messageOf(error).message }] })))
  }

  // the table is an indexed view over the same text; the JSON view stays the default until the
  // table covers the whole DSL, so nothing that exists today loses its editor
  const index = useMemo(() => indexDocument(state.documentText), [state.documentText])
  const documentLines = state.documentText ? state.documentText.split('\n').length : 0
  const tableProblem = index.problem === null ? null : `The field table needs a JSON object: ${index.problem}`
  // a document that stops being addressable falls back to the repair view during render, so the
  // table is never asked to show rows it cannot build
  const shownView: DocumentView = tableProblem === null ? view : 'json'

  /** Go to an issue: the control that owns it when the table shows one, else its line in the JSON. */
  const jumpTo = useCallback((path: string) => {
    const id = controlIdFor(path)
    const element = id === null ? null : document.getElementById(id)
    if (element !== null) {
      element.focus()
      element.scrollIntoView({ block: 'center' })
      return
    }
    setView('json')
    setFocusRequest(previous => ({ path, nonce: (previous?.nonce ?? 0) + 1 }))
  }, [])

  const identityIssue = identityProblem(state.identity)
  const busyLabel = { none: '', preparing: 'Preparing the context…', awaiting_ack: 'Waiting for you to review the payload', running: 'Asking the assistant…', validating: 'Validating…', saving: 'Saving…', previewing: 'Previewing…', importing: 'Importing…' }[state.busy]
  const chatDisabled = identityIssue ? `Enter a mapping name and source first (${identityIssue})` : undefined
  const validateReason = state.busy !== 'none' ? 'Wait for the current operation to finish' : state.documentText.trim() === '' ? 'No document yet' : null

  return (
    <>
      <div className="page-head">
        <h1>Mapping assistant</h1>
        {!upload && <p className="muted">Upload details are not available after a reload; the profile and the assistant still work.</p>}
      </div>
      <form className="row identity" onSubmit={e => e.preventDefault()} aria-label="Mapping identity">
        <label className="field">Mapping name
          <input value={state.identity.name} disabled={state.busy !== 'none'} onChange={e => update(s => setIdentity(s, { ...s.identity, name: e.target.value }))} placeholder="my-source-v1" />
        </label>
        <label className="field">Source
          <input value={state.identity.source} disabled={state.busy !== 'none'} onChange={e => update(s => setIdentity(s, { ...s.identity, source: e.target.value }))} placeholder="my-source" />
        </label>
        {identityIssue && state.identity.name && state.identity.source && <p className="muted">{identityIssue}</p>}
      </form>
      {state.notices.map((notice, index) => (
        <Notice key={index} kind={notice.kind === 'error' ? 'bad' : notice.kind === 'warn' ? 'warn' : 'info'}>{notice.text}</Notice>
      ))}
      {profileError !== undefined && <Notice kind="bad">The profile could not be computed: {messageOf(profileError).message}</Notice>}
      <div className="assist">
        <EvidenceRail
          profile={profile}
          loading={profile === null && profileError === undefined}
          includeSample={state.includeSample}
          onIncludeSample={on => update(s => setIncludeSample(s, on))}
          onShowPayload={() => setDrawerOpen(true)}
          payloadAvailable={state.prepared !== null}
          disabled={state.busy !== 'none'}
        />
        <div className="stack">
          <section className="assist-editor" aria-labelledby="document-title">
            <div className="panel-head">
              <h2 id="document-title">Mapping document</h2>
              <span className="muted">{documentLines.toLocaleString('en-US')} lines</span>
              <ViewSwitch view={shownView} onChange={setView} tableDisabled={tableProblem ?? undefined} />
              <IconButton name="refresh" label="Undo the last change" className="btn small icon-only" disabled={state.undo === null || state.busy !== 'none'} onClick={() => update(undoDocument)} />
            </div>
            {shownView === 'json' ? (
              <DocumentEditor
                text={state.documentText}
                onChange={text => update(s => setDocumentText(s, text))}
                disabled={state.busy !== 'none'}
                focusRequest={focusRequest}
                onNotFound={path => update(s => ({ ...s, notices: [...s.notices, { kind: 'info', text: `${path || '$'} has no line in this document; it is missing rather than wrong.` }] }))}
              />
            ) : (
              <FieldTable
                index={index}
                issues={state.validation?.issues ?? null}
                current={state.validation?.documentVersion === state.documentVersion}
                disabled={state.busy !== 'none'}
                onEdit={edits => update(s => applyDocumentEdits(s, edits))}
                onOpenJson={(path: DocPath) => jumpTo(showPath(path))}
              />
            )}
            <IssueList
              issues={state.validation?.issues ?? null}
              current={state.validation?.documentVersion === state.documentVersion}
              onJump={jumpTo}
            />
          </section>
          <ActionBar
            busy={busyLabel}
            validateReason={validateReason}
            saveReason={canSave(state)}
            previewReason={canPreview(state)}
            importReason={canImport(state)}
            saved={state.saved?.record ?? null}
            preview={state.preview?.report ?? null}
            filename={upload?.filename ?? uploadId}
            sha256={upload?.sha256 ?? null}
            recordCount={upload?.record_count ?? profile?.total_records ?? null}
            source={state.saved?.record.source ?? state.identity.source}
            onValidate={validate}
            onSave={save}
            onPreview={preview}
            onImport={doImport}
          />
        </div>
        <div className="stack">
          <Conversation turns={state.turns} busy={state.busy !== 'none'} onSend={send} disabledReason={chatDisabled} status={busyLabel || undefined} />
          {state.omittedHistory > 0 && <p className="muted" role="note">{state.omittedHistory} earlier turn{state.omittedHistory === 1 ? '' : 's'} stay visible here but are no longer sent to the assistant (history limit: 20 turns of 4,000 characters).</p>}
          {state.pendingMessage !== null && state.busy === 'none' && (
            <div className="notice warn" role="status">
              <div>
                <p className="title">Not sent</p>
                <p className="mono">{state.pendingMessage}</p>
                <div className="actions">
                  <button type="button" className="btn small" onClick={() => send(state.pendingMessage ?? '')}>Send again</button>
                  <button type="button" className="btn small" onClick={() => update(s => ({ ...s, pendingMessage: null }))}>Discard</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {drawerOpen && state.prepared && (
        <PayloadDrawer
          prepared={state.prepared.response}
          awaitingAck={state.busy === 'awaiting_ack'}
          onAcknowledge={digest => { update(s => acknowledge(s, digest)); setDrawerOpen(false) }}
          onClose={() => { setDrawerOpen(false); if (state.busy === 'awaiting_ack') update(s => requestFailed(s, s.generation, 0, 'Sending was cancelled; nothing left the server.')) }}
        />
      )}
    </>
  )
}
