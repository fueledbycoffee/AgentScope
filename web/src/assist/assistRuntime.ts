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
  ChatHistoryTurn,
  ImportPreview,
  MappingIssue,
  PreparedContext,
  SavedMapping,
} from '../api/types'
import type { AssistantRequestText as AssistantRequest } from '../api'
import type { ChatTurn } from './Conversation'
import { planEdits, type DocEdit } from './document'
import { asString, indexDocument } from './documentIndex'
import { isJsonObjectText } from './jsonGrammar'
import { extractMappingText, prettyJson } from './jsonText'

export const HISTORY_LIMIT = 20
export const TURN_LIMIT = 4_000

export type Busy = 'none' | 'preparing' | 'awaiting_ack' | 'running' | 'validating' | 'saving' | 'previewing' | 'importing'

export interface Notice { kind: 'info' | 'warn' | 'error'; text: string }

/** Where the page was entered from, when that was an import report. */
export interface AssistOrigin {
  importId: string
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
  /** How many times the current message was re-prepared after a 409; one automatic retry. */
  staleRetries: number
  lastOutcome: { generation: number; outcome: AssistantOutcome } | null
  /**
   * The document version a proposal created. Its ambiguities and explanations describe *that*
   * text, so they stop being applicable the moment the document moves on; anchoring to the
   * version the application produced (not the generation before it) is what makes a stale click
   * impossible rather than unlikely.
   */
  proposalAnchor: { documentVersion: number } | null
  validation: { documentVersion: number; issues: MappingIssue[]; executable: boolean } | null
  saved: { documentText: string; record: SavedMapping } | null
  preview: { savedId: string; report: ImportPreview } | null
  /** The text *and* the identity to restore: the two must move together or a revise breaks. */
  undo: { documentText: string; identity: { name: string; source: string } } | null
  busy: Busy
  notices: Notice[]
  omittedHistory: number
  /**
   * The report this correction started from. It is deliberately *not* a notice: `startPrepare`
   * clears those, and the sentence about what that import did must not disappear when a message
   * is sent.
   */
  origin: AssistOrigin | null
  /** Loading the saved mapping is an asynchronous document replacement, so it has states. */
  bootstrap: { phase: 'idle' | 'loading' | 'ready' | 'failed'; documentVersion: number; problem: string | null }
  /**
   * The source the import will be committed into. Without an origin this stays null and the
   * mapping's own source is used, as before; entered from a report it defaults to that report's
   * source, which is not necessarily the mapping's.
   */
  importSource: string | null
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
    staleRetries: 0,
    lastOutcome: null,
    proposalAnchor: null,
    validation: null,
    saved: null,
    preview: null,
    undo: null,
    busy: 'none',
    notices: [],
    omittedHistory: 0,
    origin: null,
    bootstrap: { phase: 'idle', documentVersion: 0, problem: null },
    importSource: null,
  }
}

// --- entering from an import report ------------------------------------------------------------

export function startBootstrap(state: AssistState, origin: AssistOrigin): AssistState {
  return {
    ...state,
    origin,
    importSource: origin.importSource,
    bootstrap: { phase: origin.mappingId === null ? 'failed' : 'loading', documentVersion: state.documentVersion, problem: origin.mappingId === null ? 'That file has no mapping binding on this report, so there is nothing to reopen. Start from a proposal instead.' : null },
  }
}

/**
 * The saved document arrived. A load that lost a race — the user edited meanwhile, or the origin
 * changed — is never applied silently; it is offered instead.
 */
export function bootstrapArrived(state: AssistState, importId: string, documentText: string, identity: { name: string; source: string }): AssistState {
  if (state.origin?.importId !== importId || state.bootstrap.phase !== 'loading') return state
  if (state.documentVersion !== state.bootstrap.documentVersion) {
    return {
      ...state,
      bootstrap: { ...state.bootstrap, phase: 'failed', problem: 'You changed the document while the saved mapping was loading, so it was not replaced.' },
    }
  }
  const next = editDocument(state, documentText, null, identity)
  return { ...next, bootstrap: { phase: 'ready', documentVersion: next.documentVersion, problem: null } }
}

export function bootstrapFailed(state: AssistState, importId: string, problem: string): AssistState {
  if (state.origin?.importId !== importId) return state
  return { ...state, bootstrap: { ...state.bootstrap, phase: 'failed', problem } }
}

export function setImportSource(state: AssistState, source: string): AssistState {
  return invalidate({ ...state, importSource: source })
}

// --- context mutations (each one invalidates prepared/ack/run) --------------------------------

function invalidate(state: AssistState): AssistState {
  return { ...state, generation: state.generation + 1, prepared: null, acknowledged: null, busy: state.busy === 'awaiting_ack' || state.busy === 'preparing' ? 'none' : state.busy }
}

/** Every change to the document text moves the version and clears validation, save and preview. */
function editDocument(
  state: AssistState,
  text: string,
  undo: AssistState['undo'],
  identity = state.identity,
): AssistState {
  return invalidate({
    ...state,
    documentText: text,
    documentVersion: state.documentVersion + 1,
    identity,
    validation: null,
    saved: null,
    preview: null,
    undo,
  })
}

/** The identity a document declares, when it is addressable; the user's own otherwise. */
export function identityOf(text: string, fallback: { name: string; source: string }): { name: string; source: string } {
  const index = indexDocument(text)
  if (!index.ok) return fallback
  return { name: asString(index.head.name) ?? fallback.name, source: asString(index.head.source) ?? fallback.source }
}

export function setIdentity(state: AssistState, identity: { name: string; source: string }): AssistState {
  return invalidate({ ...state, identity, validation: null, saved: null, preview: null })
}

export function setIncludeSample(state: AssistState, on: boolean): AssistState {
  return invalidate({ ...state, includeSample: on })
}

export function setDocumentText(state: AssistState, text: string): AssistState {
  // a direct edit of the JSON view may have changed name or source: the identity follows it
  return editDocument(state, text, null, identityOf(text, state.identity))
}

/**
 * Apply an edit batch from the field table: one version bump, one undo entry, the gates
 * invalidated once. A batch the planner refuses changes nothing at all — text, version, undo and
 * every gate stay as they were and the reason is shown.
 */
export function applyDocumentEdits(state: AssistState, edits: DocEdit[], identity?: { name: string; source: string }): AssistState {
  const planned = planEdits(state.documentText, edits)
  if ('problem' in planned) {
    return { ...state, notices: [...state.notices, { kind: 'warn', text: `That change was not applied: ${planned.problem}.` }] }
  }
  if (planned.text === state.documentText && identity === undefined) return state
  const undo = { documentText: state.documentText, identity: state.identity }
  return editDocument(state, planned.text, undo, identity ?? identityOf(planned.text, state.identity))
}

export function undoDocument(state: AssistState): AssistState {
  if (state.undo === null) return state
  // the identity is restored with the text, so the next revise still matches the document
  return editDocument(state, state.undo.documentText, null, state.undo.identity)
}

// The shapes the server's redactor rewrites (domain/redaction.py), approximated; the server stays
// the authority and answers 400 with the field when the client lets something through.
const REDACTABLE = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // e-mail
  /:\/\/[^/\s@]+@/, // URL user info
  /(^|[^\w/])(\/Users\/|\/home\/|\/root(\/|$)|~\/|[A-Za-z]:\\Users\\)/, // home paths
  /\bsk-(or-|ant-)?[A-Za-z0-9_-]{20,}/, /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abp]-[A-Za-z0-9-]{10,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bAIza[0-9A-Za-z_-]{30,}/, /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/,
  /(^|[^\w.])\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?![\w.])/, // IPv4
]

/** The identity is the user's; it must not contain anything the server's redactor would rewrite. */
export function identityProblem(identity: { name: string; source: string }): string | null {
  for (const [field, value] of Object.entries(identity)) {
    if (!value.trim()) return `${field} is required`
    if (value.length > 100) return `${field} must be at most 100 characters`
    if (REDACTABLE.some(rule => rule.test(value))) return `${field} must not contain e-mail addresses, home paths, credentials or IP addresses`
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
  if (state.documentText.trim() === '') {
    // no document yet (first message, or the model refused so far): ask for a proposal
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
      // the text itself travels: the browser never re-serialises the document's numbers
      current_mapping_text: state.documentText,
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
  const next: AssistState = { ...state, busy: 'preparing', pendingMessage: message, omittedHistory: built.omitted, notices: [], staleRetries: 0 }
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

const EXPLANATIONS_SHOWN = 30

function assistantText(outcome: AssistantOutcome): string {
  if (outcome.proposal === null) return `The assistant did not return a proposal (${outcome.diagnostics.failure ?? 'no reason given'}). The document is unchanged.`
  const lines: string[] = []
  for (const q of outcome.proposal.questions) lines.push(q)
  for (const a of outcome.proposal.ambiguities) lines.push(`${a.target}: ${a.options.join(' or ')} — ${a.what_settles_it}`)
  if (lines.length === 0) lines.push('Proposal applied, no open questions.')
  const explanations = outcome.proposal.explanations
  if (explanations.length > 0) {
    lines.push('', `Why (${explanations.length} field${explanations.length === 1 ? '' : 's'}):`)
    for (const e of explanations.slice(0, EXPLANATIONS_SHOWN)) {
      lines.push(`${e.target} ← ${e.path} (${Math.round(e.confidence * 100)}%): ${e.why}`)
    }
    if (explanations.length > EXPLANATIONS_SHOWN) lines.push(`… ${explanations.length - EXPLANATIONS_SHOWN} more`)
  }
  return lines.join('\n')
}

let turnCounter = 0
const newId = (prefix: string) => `${prefix}-${++turnCounter}`

/** Said when a proposal cannot be taken from the response text; nothing is applied. */
export const UNREADABLE_PROPOSAL =
  'The reply carried a proposal, but its mapping could not be read from the response text as one JSON object. Nothing was applied and the document is unchanged; the raw reply is in the run diagnostics.'

export function outcomeArrived(state: AssistState, generation: number, outcome: AssistantOutcome, rawText?: string): AssistState {
  if (generation !== state.generation || state.busy !== 'running') return state
  // the server's own text, re-indented without parsing numbers. There is deliberately no fallback
  // to JSON.stringify(outcome.proposal.mapping): the browser has already rounded that object's
  // numbers, and applying it would attach the outcome's validation to a document the server never
  // saw, which would let Save through for changed data.
  const mappingText = outcome.proposal !== null && rawText ? extractMappingText(rawText) : null
  const readable = mappingText !== null && isJsonObjectText(mappingText)
  const unreadable = outcome.proposal !== null && !readable
  const userTurn: ChatTurn = { id: newId('u'), role: 'user', content: state.pendingMessage ?? '' }
  const assistantTurn: ChatTurn = {
    id: newId('a'),
    role: 'assistant',
    content: unreadable ? UNREADABLE_PROPOSAL : assistantText(outcome),
    meta: unreadable ? `not applied · ${outcome.diagnostics.model} · ${outcome.attempts} call${outcome.attempts > 1 ? 's' : ''}` : receipt(outcome),
  }
  let next: AssistState = { ...state, busy: 'none', pendingMessage: null, prepared: null, acknowledged: null, lastOutcome: { generation, outcome }, turns: [...state.turns, userTurn, assistantTurn] }
  if (unreadable) {
    // the document, its version, its undo entry and every gate stay exactly as they were
    return { ...next, notices: [...next.notices, { kind: 'error', text: UNREADABLE_PROPOSAL }] }
  }
  if (readable && outcome.proposal !== null) {
    const applied = prettyJson(mappingText)
    const undo = state.documentText ? { documentText: state.documentText, identity: state.identity } : null
    next = editDocument(next, applied, undo, identityOf(applied, state.identity))
    next = {
      ...next,
      validation: { documentVersion: next.documentVersion, issues: outcome.issues, executable: outcome.proposal.executable },
      proposalAnchor: { documentVersion: next.documentVersion },
    }
  }
  return next
}

/** A failed request: the draft stays, the context is dropped; 409 means "prepare again". */
export function requestFailed(state: AssistState, generation: number, status: number, message: string): AssistState {
  if (generation !== state.generation) return state
  if (status === 409 && state.pendingMessage !== null && state.staleRetries < 1) {
    // the server's view of the context moved: prepare the same message again (needs a new
    // acknowledgement when a sample is on); one automatic retry, then the user decides
    return {
      ...invalidate({ ...state, busy: 'none' }),
      busy: 'preparing',
      staleRetries: state.staleRetries + 1,
      notices: [...state.notices, { kind: 'warn', text: 'The context changed since it was shown; preparing it again.' }],
    }
  }
  return { ...invalidate({ ...state, busy: 'none' }), notices: [...state.notices, { kind: status >= 500 ? 'error' : 'warn', text: message }] }
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
