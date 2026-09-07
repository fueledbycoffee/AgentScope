/**
 * The assistant page's state machine, pure and framework-free (ADR-005 in the browser).
 *
 * Invariants it enforces:
 * - every context mutation bumps `generation` and drops the prepared context, its
 *   acknowledgement and any pending run; late results for an older generation are ignored;
 * - a run always sends the exact request snapshot that was prepared, with the digest the
 *   server returned for it, never a rebuilt request;
 * - with a sample included, nothing is sent until the user acknowledged the payload text of
 *   this very digest; a new digest needs a new acknowledgement;
 * - one operation at a time; the model never triggers save, preview or import;
 * - downstream gates (validated → saved → previewed → import) invalidate synchronously on any
 *   edit, undo, proposal application or identity change.
 */
import type {
  AssistantOutcome,
  AssistantRequest,
  ChatHistoryTurn,
  ImportPreview,
  MappingIssue,
  PreparedContext,
  SavedMapping,
} from '../api/types'
import type { ChatTurn } from './Conversation'

export const HISTORY_LIMIT = 20
export const TURN_LIMIT = 4_000

export type Busy = 'none' | 'preparing' | 'awaiting_ack' | 'running' | 'validating' | 'saving' | 'previewing' | 'importing'

export interface Notice { kind: 'info' | 'warn' | 'error'; text: string }

export interface AssistState {
  generation: number
  uploadId: string
  identity: { name: string; source: string }
  includeSample: boolean
  documentText: string
  documentVersion: number
  turns: ChatTurn[]
  /** Text the user typed and is sending now; kept on errors so nothing is lost. */
  pendingMessage: string | null
  prepared: { generation: number; request: AssistantRequest; response: PreparedContext } | null
  /** The digest the user acknowledged in the payload drawer, when a sample is on. */
  acknowledged: string | null
  lastOutcome: { generation: number; outcome: AssistantOutcome } | null
  validation: { documentVersion: number; issues: MappingIssue[]; executable: boolean } | null
  saved: { documentText: string; record: SavedMapping } | null
  preview: { savedId: string; report: ImportPreview } | null
  undo: string | null
  busy: Busy
  notices: Notice[]
  omittedHistory: number
}

export function initialState(uploadId: string): AssistState {
  return {
    generation: 0,
    uploadId,
    identity: { name: '', source: '' },
    includeSample: false,
    documentText: '',
    documentVersion: 0,
    turns: [],
    pendingMessage: null,
    prepared: null,
    acknowledged: null,
    lastOutcome: null,
    validation: null,
    saved: null,
    preview: null,
    undo: null,
    busy: 'none',
    notices: [],
    omittedHistory: 0,
  }
}

// --- context mutations (each one invalidates prepared/ack/run) --------------------------------

function invalidate(state: AssistState): AssistState {
  return { ...state, generation: state.generation + 1, prepared: null, acknowledged: null, busy: state.busy === 'awaiting_ack' || state.busy === 'preparing' ? 'none' : state.busy }
}

/** Every change to the document text moves the version and clears validation, save and preview. */
function editDocument(state: AssistState, text: string, undo: string | null): AssistState {
  return invalidate({
    ...state,
    documentText: text,
    documentVersion: state.documentVersion + 1,
    validation: null,
    saved: null,
    preview: null,
    undo,
  })
}

export function setIdentity(state: AssistState, identity: { name: string; source: string }): AssistState {
  return invalidate({ ...state, identity, validation: null, saved: null, preview: null })
}

export function setIncludeSample(state: AssistState, on: boolean): AssistState {
  return invalidate({ ...state, includeSample: on })
}

export function setDocumentText(state: AssistState, text: string): AssistState {
  return editDocument(state, text, null)
}

export function undoDocument(state: AssistState): AssistState {
  if (state.undo === null) return state
  return editDocument(state, state.undo, null)
}

/** The identity is the user's; it must not contain anything the server's redactor would rewrite. */
export function identityProblem(identity: { name: string; source: string }): string | null {
  for (const [field, value] of Object.entries(identity)) {
    if (!value.trim()) return `${field} is required`
    if (value.length > 100) return `${field} must be at most 100 characters`
    if (/[@/\\]|:\/\/|\bsk-|\bghp_|\d+\.\d+\.\d+\.\d+/.test(value)) return `${field} must not contain e-mail addresses, paths, credentials or IP addresses`
  }
  return null
}

// --- history projection ---------------------------------------------------------------------------

/** The API accepts at most 20 plain turns of 4,000 characters; older ones are dropped and counted. */
export function projectHistory(turns: ChatTurn[]): { history: ChatHistoryTurn[]; omitted: number } {
  const usable = turns.filter(t => t.content.length <= TURN_LIMIT)
  const kept = usable.slice(-HISTORY_LIMIT)
  return { history: kept.map(t => ({ role: t.role, content: t.content })), omitted: turns.length - kept.length }
}

/** The document as a JSON object, or the reason it cannot be sent. */
export function parseDocument(text: string): { document: { [key: string]: unknown } } | { problem: string } {
  if (!text.trim()) return { problem: 'The mapping document is empty' }
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { problem: 'The mapping document must be a JSON object' }
    return { document: parsed as { [key: string]: unknown } }
  } catch (error) {
    return { problem: `The mapping document is not valid JSON: ${(error as Error).message}` }
  }
}

// --- prepare → (ack) → run ------------------------------------------------------------------------

/** Build the request for the message the user is sending: the first one proposes, later ones revise. */
export function buildRequest(state: AssistState, message: string): { request: AssistantRequest; omitted: number } | { problem: string } {
  const identity = identityProblem(state.identity)
  if (identity) return { problem: identity }
  const { history, omitted } = projectHistory(state.turns)
  if (state.documentText.trim() === '' && state.turns.length === 0) {
    return { request: { kind: 'propose', upload_id: state.uploadId, identity: state.identity, include_sample: state.includeSample, message, history }, omitted }
  }
  const parsed = parseDocument(state.documentText)
  if ('problem' in parsed) return { problem: parsed.problem }
  if (parsed.document.name !== state.identity.name || parsed.document.source !== state.identity.source) {
    return { problem: 'The document’s name and source must match the identity above' }
  }
  return {
    request: {
      kind: 'revise',
      upload_id: state.uploadId,
      identity: state.identity,
      include_sample: state.includeSample,
      current_mapping: parsed.document as AssistantRequest['current_mapping'],
      message,
      history,
    },
    omitted,
  }
}

export function startPrepare(state: AssistState, message: string): { state: AssistState; request: AssistantRequest; generation: number } | { state: AssistState } {
  if (state.busy !== 'none') return { state }
  const built = buildRequest(state, message)
  if ('problem' in built) return { state: { ...state, notices: [...state.notices, { kind: 'error', text: built.problem }] } }
  const next: AssistState = { ...state, busy: 'preparing', pendingMessage: message, omittedHistory: built.omitted, notices: [] }
  return { state: next, request: built.request, generation: next.generation }
}

export function preparedArrived(state: AssistState, generation: number, request: AssistantRequest, response: PreparedContext): AssistState {
  if (generation !== state.generation) return state // stale: the context changed meanwhile
  const prepared = { generation, request, response }
  if (request.include_sample) {
    // the sample leaves only after the user saw exactly this text
    const acknowledged = state.acknowledged === response.context_sha256
    return { ...state, prepared, busy: acknowledged ? 'running' : 'awaiting_ack' }
  }
  return { ...state, prepared, busy: 'running' }
}

/** The payload drawer rendered this digest's text and the user pressed "Send this". */
export function acknowledge(state: AssistState, digest: string): AssistState {
  if (state.prepared === null || state.prepared.response.context_sha256 !== digest) return state
  return { ...state, acknowledged: digest, busy: state.busy === 'awaiting_ack' ? 'running' : state.busy }
}

/** What to send now, or null when a run is not allowed. */
export function runnable(state: AssistState): { request: AssistantRequest; digest: string; generation: number } | null {
  if (state.busy !== 'running' || state.prepared === null || state.prepared.generation !== state.generation) return null
  const digest = state.prepared.response.context_sha256
  if (state.prepared.request.include_sample && state.acknowledged !== digest) return null
  return { request: state.prepared.request, digest, generation: state.generation }
}

function receipt(outcome: AssistantOutcome): string {
  const notes = outcome.diagnostics.adapter_notes?.length ? ` · ${outcome.diagnostics.adapter_notes.join(', ')}` : ''
  if (outcome.proposal === null) return `no proposal · ${outcome.diagnostics.model} · ${outcome.attempts} call${outcome.attempts > 1 ? 's' : ''} · ${outcome.diagnostics.failure ?? 'unknown'}${notes}`
  const validity = outcome.proposal.executable ? 'executable' : `${outcome.issues.filter(i => i.severity === 'error').length} issues`
  return `proposal applied · ${outcome.proposal.model} · ${outcome.attempts} call${outcome.attempts > 1 ? 's' : ''} · ${validity}${notes}`
}

function assistantText(outcome: AssistantOutcome): string {
  if (outcome.proposal === null) return `The assistant did not return a proposal (${outcome.diagnostics.failure ?? 'no reason given'}). The document is unchanged.`
  const lines: string[] = []
  for (const q of outcome.proposal.questions) lines.push(q)
  for (const a of outcome.proposal.ambiguities) lines.push(`${a.target}: ${a.options.join(' or ')} — ${a.what_settles_it}`)
  if (lines.length === 0) lines.push('Proposal applied, no open questions.')
  return lines.join('\n')
}

let turnCounter = 0
const newId = (prefix: string) => `${prefix}-${++turnCounter}`

export function outcomeArrived(state: AssistState, generation: number, outcome: AssistantOutcome): AssistState {
  if (generation !== state.generation || state.busy !== 'running') return state
  const userTurn: ChatTurn = { id: newId('u'), role: 'user', content: state.pendingMessage ?? '' }
  const assistantTurn: ChatTurn = { id: newId('a'), role: 'assistant', content: assistantText(outcome), meta: receipt(outcome) }
  let next: AssistState = { ...state, busy: 'none', pendingMessage: null, prepared: null, acknowledged: null, lastOutcome: { generation, outcome }, turns: [...state.turns, userTurn, assistantTurn] }
  if (outcome.proposal !== null) {
    next = editDocument(next, JSON.stringify(outcome.proposal.mapping, null, 2), state.documentText || null)
    next = { ...next, validation: { documentVersion: next.documentVersion, issues: outcome.issues, executable: outcome.proposal.executable } }
  }
  return next
}

/** A failed request: the draft stays, the context is dropped; 409 means "prepare again". */
export function requestFailed(state: AssistState, generation: number, status: number, message: string): AssistState {
  if (generation !== state.generation) return state
  const text = status === 409 ? 'The context changed since it was shown; it will be prepared again.' : message
  return { ...invalidate({ ...state, busy: 'none' }), notices: [...state.notices, { kind: status >= 500 ? 'error' : 'warn', text }] }
}

// --- gates: validate → save → preview → import -------------------------------------------------

export function validationArrived(state: AssistState, documentVersion: number, issues: MappingIssue[], executable: boolean): AssistState {
  if (documentVersion !== state.documentVersion) return state
  return { ...state, busy: state.busy === 'validating' ? 'none' : state.busy, validation: { documentVersion, issues, executable } }
}

export function canSave(state: AssistState): string | null {
  if (state.busy !== 'none') return 'Wait for the current operation to finish'
  if (state.validation === null || state.validation.documentVersion !== state.documentVersion) return 'Validate the document first'
  if (!state.validation.executable) return 'Fix the validation errors before saving'
  if (state.saved !== null && state.saved.documentText === state.documentText) return 'This document is already saved'
  return null
}

export function savedArrived(state: AssistState, documentText: string, record: SavedMapping): AssistState {
  if (documentText !== state.documentText) return state // an edit happened while saving
  return { ...state, busy: state.busy === 'saving' ? 'none' : state.busy, saved: { documentText, record }, preview: null }
}

export function canPreview(state: AssistState): string | null {
  if (state.busy !== 'none') return 'Wait for the current operation to finish'
  if (state.saved === null || state.saved.documentText !== state.documentText) return 'Save a revision of this exact document first'
  return null
}

export function previewArrived(state: AssistState, savedId: string, report: ImportPreview): AssistState {
  if (state.saved === null || state.saved.record.id !== savedId) return state
  return { ...state, busy: state.busy === 'previewing' ? 'none' : state.busy, preview: { savedId, report } }
}

export function canImport(state: AssistState): string | null {
  const previewGate = canPreview(state)
  if (previewGate) return previewGate
  if (state.preview === null || state.saved === null || state.preview.savedId !== state.saved.record.id) return 'Preview this revision first'
  return null
}

export function setBusy(state: AssistState, busy: Busy): AssistState {
  return { ...state, busy }
}
