import { describe, expect, it } from 'vitest'
import type { AssistantOutcome, PreparedContext, SavedMapping } from '../api/types'
import {
  acknowledge,
  applyDocumentEdits,
  bootstrapArrived,
  bootstrapFailed,
  setImportSource,
  startBootstrap,
  buildRequest,
  canImport,
  canPreview,
  canSave,
  identityProblem,
  initialState,
  RUN_SUPERSEDED,
  outcomeArrived,
  preparedArrived,
  previewArrived,
  projectHistory,
  requestFailed,
  runnable,
  savedArrived,
  setDocumentText,
  setIdentity,
  setIncludeSample,
  startPrepare,
  undoDocument,
  validationArrived,
  type AssistState,
} from './assistRuntime'

const identity = { name: 'assisted', source: 'tracelab' }
const prepared = (digest: string, includeSample = false): PreparedContext => ({
  kind: 'propose',
  context_sha256: digest,
  bytes: 10,
  payload_text: '{}',
  payload: {},
  redactions: {},
  truncated: {},
  sample_included: includeSample,
  sample_count: includeSample ? 1 : 0,
})
const outcome = (mapping: Record<string, unknown> | null, extra: Partial<AssistantOutcome> = {}): AssistantOutcome => ({
  proposal: mapping === null ? null : { mapping: mapping as never, explanations: [], ambiguities: [], questions: [], model: 'fake/deterministic-1', executable: true },
  issues: [],
  attempts: 1,
  diagnostics: { finish: 'stop', model: 'fake/deterministic-1', raw_text: '', failure: null, context_sha256: 'd', sample_included: false },
  ...extra,
})
const saved = (id: string): SavedMapping => ({ id, name: 'assisted', source: 'tracelab', revision: 1, created_by: 'user', input_format: 'jsonl', created: true })

function ready(): AssistState {
  return setIdentity(initialState('upl_1'), identity)
}

/**
 * A run response as the server writes it. A proposal is only ever applied from this text: there is
 * no fallback to the parsed object, whose numbers the browser has already rounded.
 */
const rawResponse = (mapping: Record<string, unknown>) =>
  `{"proposal":{"mapping":${JSON.stringify(mapping)},"explanations":[],"ambiguities":[],"questions":[],"model":"fake/deterministic-1","executable":true},"issues":[],"attempts":1,"diagnostics":{}}`

/** Drive one full send: prepare, (ack), run, outcome. */
function send(state: AssistState, message: string, mapping: Record<string, unknown>, digest = 'd1'): AssistState {
  const started = startPrepare(state, message)
  if (!('request' in started)) throw new Error('could not start')
  let next = preparedArrived(started.state, started.generation, started.request, prepared(digest, started.request.include_sample ?? false))
  if (started.request.include_sample) next = acknowledge(next, digest)
  const run = runnable(next)
  if (run === null) throw new Error('not runnable')
  return outcomeArrived(next, run.generation, outcome(mapping), rawResponse(mapping))
}

describe('identity and request building', () => {
  it('refuses identities the server would redact and requires both fields', () => {
    expect(identityProblem({ name: '', source: 'x' })).toMatch(/required/)
    expect(identityProblem({ name: 'sean@example.com', source: 'x' })).toMatch(/must not contain/)
    expect(identityProblem({ name: 'ok', source: '/Users/sean' })).toMatch(/must not contain/)
    expect(identityProblem({ name: 'a'.repeat(101), source: 'x' })).toMatch(/100/)
    expect(identityProblem(identity)).toBeNull()
    // shapes the server keeps must pass here too
    expect(identityProblem({ name: 'sk-traces', source: 'team/service' })).toBeNull()
    expect(identityProblem({ name: 'v1.2.3', source: 'repo/sub' })).toBeNull()
    expect(identityProblem({ name: 'sk-or-v1-' + 'k'.repeat(40), source: 'x' })).toMatch(/must not/)
  })

  it('proposes first, then revises with the current document and a bounded history', () => {
    const first = buildRequest(ready(), 'analyse')
    expect('request' in first && first.request.kind).toBe('propose')
    let state = send(ready(), 'analyse', { name: 'assisted', source: 'tracelab', rules: [] })
    for (let i = 0; i < 25; i += 1) state = { ...state, turns: [...state.turns, { id: `x${i}`, role: 'user', content: `t${i}` }] }
    const revise = buildRequest(state, 'change it')
    expect('request' in revise).toBe(true)
    if ('request' in revise) {
      expect(revise.request.kind).toBe('revise')
      expect(revise.request.current_mapping_text).toBe(state.documentText) // the text itself, verbatim
      expect(revise.request.history).toHaveLength(20)
      expect(revise.omitted).toBe(state.turns.length - 20)
    }
  })

  it('takes the identity from the document, and refuses one that cannot declare it', () => {
    // a document the user pastes or edits carries the identity: the two can never disagree
    const state = setDocumentText(ready(), '{"name": "other", "source": "elsewhere"}')
    expect(state.identity).toEqual({ name: 'other', source: 'elsewhere' })
    const built = buildRequest({ ...state, turns: [{ id: 'a', role: 'user', content: 'x' }] }, 'm')
    expect('request' in built && built.request.kind).toBe('revise')
    // a document that declares neither still has to match the identity the user typed
    const silent = buildRequest({ ...setDocumentText(ready(), '{"rules": []}'), turns: [{ id: 'a', role: 'user', content: 'x' }] }, 'm')
    expect('problem' in silent && silent.problem).toMatch(/name and source/)
    const broken = buildRequest({ ...setDocumentText(ready(), '[1]'), turns: [{ id: 'a', role: 'user', content: 'x' }] }, 'm')
    expect('problem' in broken && broken.problem).toMatch(/JSON object/)
  })

  it('drops over-long turns and the oldest ones from the projection', () => {
    const turns = [{ id: 'a', role: 'user' as const, content: 'x'.repeat(4_001) }, { id: 'b', role: 'assistant' as const, content: 'ok' }]
    expect(projectHistory(turns)).toEqual({ history: [{ role: 'assistant', content: 'ok' }], omitted: 1 })
  })
})

describe('prepare, acknowledge, run', () => {
  it('runs directly after a prepare without a sample and applies the proposal with undo', () => {
    const state = send(ready(), 'analyse', { name: 'assisted', source: 'tracelab', rules: [] })
    expect(state.busy).toBe('none')
    expect(state.turns.map(t => t.role)).toEqual(['user', 'assistant'])
    expect(state.turns[1].meta).toMatch(/proposal applied · fake\/deterministic-1 · 1 call · executable/)
    expect(state.turns[1].content).toBe('Proposal applied, no open questions.')
    expect(JSON.parse(state.documentText)).toEqual({ name: 'assisted', source: 'tracelab', rules: [] })
    expect(state.validation?.executable).toBe(true)
    expect(state.undo).toBeNull() // the document was empty before
    const again = send(state, 'more', { name: 'assisted', source: 'tracelab', rules: [], notes: 'v2' })
    expect(again.undo?.documentText).toBe(state.documentText)
    const undone = undoDocument(again)
    expect(undone.documentText).toBe(state.documentText)
    expect(undone.validation).toBeNull()
  })

  it('waits for the acknowledgement of exactly this digest when a sample is on', () => {
    const state = setIncludeSample(ready(), true)
    const started = startPrepare(state, 'analyse')
    if (!('request' in started)) throw new Error('could not start')
    const waiting = preparedArrived(started.state, started.generation, started.request, prepared('d1', true))
    expect(waiting.busy).toBe('awaiting_ack')
    expect(runnable(waiting)).toBeNull()
    expect(acknowledge(waiting, 'other').busy).toBe('awaiting_ack') // another digest acknowledges nothing
    const acked = acknowledge(waiting, 'd1')
    expect(acked.busy).toBe('running')
    expect(runnable(acked)?.digest).toBe('d1')
  })

  it('ignores prepare and run results from an older generation', () => {
    const state = ready()
    const started = startPrepare(state, 'analyse')
    if (!('request' in started)) throw new Error('could not start')
    const changed = setIncludeSample(started.state, true) // the user changed the context meanwhile
    const late = preparedArrived(changed, started.generation, started.request, prepared('d1'))
    expect(late.prepared).toBeNull()
    expect(runnable(late)).toBeNull()
    const fresh = send(ready(), 'analyse', { name: 'assisted', source: 'tracelab' })
    const stale = outcomeArrived(setDocumentText(fresh, '{"name":"assisted","source":"tracelab","x":1}'), fresh.generation, outcome({ name: 'evil' }))
    expect(stale.documentText).toContain('"x":1')
  })

  it('never runs twice at once and keeps the draft when a request fails', () => {
    const state = ready()
    const started = startPrepare(state, 'first')
    if (!('request' in started)) throw new Error('could not start')
    const second = startPrepare(started.state, 'second')
    expect('request' in second).toBe(false)
    const failed = requestFailed(started.state, started.generation, 502, 'assistant_failed')
    expect(failed.busy).toBe('none')
    expect(failed.prepared).toBeNull()
    expect(failed.notices[0].text).toBe('assistant_failed')
    expect(failed.pendingMessage).toBe('first') // the draft stays for the user
  })

  it('renders a refusal as an assistant turn and leaves the document alone', () => {
    const state = setDocumentText(ready(), '{"name":"assisted","source":"tracelab"}')
    const started = startPrepare({ ...state, turns: [{ id: 'a', role: 'user', content: 'x' }] }, 'try')
    if (!('request' in started)) throw new Error('could not start')
    const running = preparedArrived(started.state, started.generation, started.request, prepared('d9'))
    const refused = outcomeArrived(running, started.generation, outcome(null, { diagnostics: { finish: 'refusal', model: 'm', raw_text: '', failure: 'refusal', context_sha256: 'd9', sample_included: false } }))
    expect(refused.documentText).toBe(state.documentText)
    expect(refused.turns.at(-1)?.content).toMatch(/did not return a proposal \(refusal\)/)
  })
})

describe('table edits', () => {
  const DOC = '{\n  "name": "assisted",\n  "source": "tracelab",\n  "big": 9007199254740993,\n  "rules": [{"id": "r", "fields": {"x": {"path": "$.a", "timestamp_format": "epoch_ms"}}}]\n}'

  it('applies a batch as one version, one undo entry and one gate invalidation', () => {
    let state = setDocumentText(ready(), DOC)
    state = validationArrived(state, state.documentVersion, [], true)
    state = savedArrived(state, state.documentText, saved('map_1'))
    const version = state.documentVersion
    const next = applyDocumentEdits(state, [
      { op: 'set', path: ['rules', 0, 'fields', 'x', 'timestamp_format'], raw: '"epoch_s"' },
      { op: 'set', path: ['rules', 0, 'fields', 'x', 'on_missing'], raw: '"reject"' },
    ])
    expect(next.documentVersion).toBe(version + 1) // one bump for the whole batch
    expect(next.undo?.documentText).toBe(DOC)
    expect(next.validation).toBeNull()
    expect(next.saved).toBeNull()
    expect(next.documentText).toContain('"epoch_s"')
    expect(next.documentText).toContain('"on_missing": "reject"')
    expect(next.documentText).toContain('9007199254740993') // untouched lexemes survive
    expect(undoDocument(next).documentText).toBe(DOC)
  })

  it('changes nothing at all when the planner refuses the batch', () => {
    let state = setDocumentText(ready(), DOC)
    state = validationArrived(state, state.documentVersion, [], true)
    const next = applyDocumentEdits(state, [
      { op: 'set', path: ['rules', 0, 'fields', 'x'], raw: '{}' },
      { op: 'set', path: ['rules', 0, 'fields', 'x', 'type'], raw: '"string"' },
    ])
    expect(next.documentText).toBe(state.documentText)
    expect(next.documentVersion).toBe(state.documentVersion)
    expect(next.undo).toBe(state.undo)
    expect(next.validation).toBe(state.validation)
    expect(next.notices.at(-1)?.text).toMatch(/was not applied/)
  })

  it('is a no-op when the batch would not change the text', () => {
    const state = setDocumentText(ready(), DOC)
    expect(applyDocumentEdits(state, [])).toBe(state)
  })
})

describe('entering from an import report', () => {
  const origin = {
    importId: 'imp_1', importSource: 'tracelab', importStatus: 'committed' as const,
    filename: 'trace.jsonl', sha256: 'a'.repeat(64), fileStatus: 'committed', fileDuplicateOf: null,
    mappingId: 'map_1', mappingName: 'tracelab-v1', mappingRevision: 1,
  }
  const DOC = '{"name": "tracelab-v1", "source": "tracelab", "big": 9007199254740993, "rules": []}'

  it('loads the file’s own revision and takes its identity with it', () => {
    const started = startBootstrap(initialState('upl_1'), origin)
    expect(started.bootstrap.phase).toBe('loading')
    expect(started.importSource).toBe('tracelab') // the import's source, not the mapping's
    const ready = bootstrapArrived(started, 'imp_1', DOC, { name: 'tracelab-v1', source: 'tracelab' })
    expect(ready.bootstrap.phase).toBe('ready')
    expect(ready.documentText).toBe(DOC)
    expect(ready.identity).toEqual({ name: 'tracelab-v1', source: 'tracelab' })
    expect(ready.saved).toBeNull() // a loaded document is not a saved one
  })

  it('never overwrites an edit the user made while it was loading', () => {
    const started = startBootstrap(initialState('upl_1'), origin)
    const edited = setDocumentText(started, '{"name": "mine", "source": "tracelab"}')
    const late = bootstrapArrived(edited, 'imp_1', DOC, { name: 'tracelab-v1', source: 'tracelab' })
    expect(late.documentText).toBe(edited.documentText)
    expect(late.bootstrap.phase).toBe('failed')
    expect(late.bootstrap.problem).toMatch(/while the saved mapping was loading/)
  })

  it('ignores a load for another origin, and reports a failure', () => {
    const started = startBootstrap(initialState('upl_1'), origin)
    expect(bootstrapArrived(started, 'imp_other', DOC, { name: 'x', source: 'y' })).toBe(started)
    expect(bootstrapFailed(started, 'imp_other', 'nope')).toBe(started)
    expect(bootstrapFailed(started, 'imp_1', 'the mapping is gone').bootstrap.problem).toBe('the mapping is gone')
  })

  it('says so when the file has no mapping binding, instead of loading nothing', () => {
    const started = startBootstrap(initialState('upl_1'), { ...origin, mappingId: null })
    expect(started.bootstrap.phase).toBe('failed')
    expect(started.bootstrap.problem).toMatch(/no mapping binding/)
  })

  it('never leaves a run stranded when the saved revision arrives', () => {
    // the run is in flight when the load lands: its reply will be discarded as stale, so the
    // operation has to be ended here or every control stays disabled for good
    let state = setIdentity(startBootstrap(initialState('upl_1'), origin), { name: 'tracelab-v1', source: 'tracelab' })
    const started = startPrepare({ ...state, bootstrap: { ...state.bootstrap, phase: 'ready' } }, 'analyse')
    if (!('request' in started)) throw new Error('could not start')
    state = preparedArrived(started.state, started.generation, started.request, prepared('d1'))
    expect(state.busy).toBe('running')

    const loaded = bootstrapArrived({ ...state, bootstrap: { ...state.bootstrap, phase: 'loading' } }, 'imp_1', DOC, { name: 'tracelab-v1', source: 'tracelab' })
    expect(loaded.documentText).toBe(DOC)
    expect(loaded.busy).toBe('none')
    expect(loaded.notices.at(-1)?.text).toBe(RUN_SUPERSEDED)
    // the reply that arrives afterwards changes nothing at all
    const late = outcomeArrived(loaded, started.generation, outcome({ name: 'x', source: 'y' }), '{"proposal":{"mapping":{"a":1}}}')
    expect(late).toBe(loaded)
    expect(late.busy).toBe('none')
    // and the message is still there to send again
    expect(loaded.pendingMessage).toBe('analyse')
  })

  it('refuses to send while the saved revision is still loading', () => {
    const state = setIdentity(startBootstrap(initialState('upl_1'), origin), { name: 'tracelab-v1', source: 'tracelab' })
    const started = startPrepare(state, 'analyse')
    expect('request' in started).toBe(false)
    expect(started.state.busy).toBe('none')
    expect(started.state.notices.at(-1)?.text).toMatch(/loading/i)
  })

  it('ends a run that any other context change invalidates, not just a load', () => {
    let state = setIdentity(initialState('upl_1'), { name: 'a', source: 'b' })
    const started = startPrepare(state, 'analyse')
    if (!('request' in started)) throw new Error('could not start')
    state = preparedArrived(started.state, started.generation, started.request, prepared('d1'))
    expect(state.busy).toBe('running')
    // an edit, an identity change or a sample toggle all discard the reply: none may leave it busy
    expect(setDocumentText(state, '{"name": "a", "source": "b"}').busy).toBe('none')
    expect(setIdentity(state, { name: 'c', source: 'b' }).busy).toBe('none')
    expect(setIncludeSample(state, true).busy).toBe('none')
  })

  it('keeps the import source editable and separate from the mapping', () => {
    const started = setImportSource(startBootstrap(initialState('upl_1'), origin), 'tracelab-corrected')
    expect(started.importSource).toBe('tracelab-corrected')
    expect(started.origin?.importSource).toBe('tracelab')
  })
})

describe('gates', () => {
  it('validate → save → preview → import, each invalidated by an edit', () => {
    let state = send(ready(), 'analyse', { name: 'assisted', source: 'tracelab', rules: [] })
    expect(canSave(state)).toBeNull() // the outcome carried a validation of this version
    state = setDocumentText(state, '{"name":"assisted","source":"tracelab","rules":[],"notes":"edited"}')
    expect(canSave(state)).toMatch(/Validate/)
    state = validationArrived(state, state.documentVersion, [], true)
    expect(canSave(state)).toBeNull()
    expect(canPreview(state)).toMatch(/Save/)
    state = savedArrived(state, state.documentText, saved('map_1'))
    expect(canSave(state)).toMatch(/already saved/)
    expect(canPreview(state)).toBeNull()
    expect(canImport(state)).toMatch(/Preview/)
    state = previewArrived(state, 'map_1', { sample: 1 } as never)
    expect(canImport(state)).toBeNull()
    const edited = setDocumentText(state, '{"name":"assisted","source":"tracelab","rules":[],"notes":"again"}')
    expect(canPreview(edited)).toMatch(/Save/)
    expect(canImport(edited)).toMatch(/Save/)
    expect(edited.saved).toBeNull()
  })

  it('ignores a validation, save or preview for another document version', () => {
    const state = setDocumentText(ready(), '{"name":"assisted","source":"tracelab"}')
    const stale = validationArrived(state, state.documentVersion - 1, [], true)
    expect(stale.validation).toBeNull()
    const savedLate = savedArrived(state, 'other text', saved('map_1'))
    expect(savedLate.saved).toBeNull()
    const previewLate = previewArrived({ ...state, saved: { documentText: state.documentText, record: saved('map_1') } }, 'map_2', { sample: 1 } as never)
    expect(previewLate.preview).toBeNull()
  })

  it('a non-executable draft cannot be saved', () => {
    let state = setDocumentText(ready(), '{"dsl_version": 1}')
    state = validationArrived(state, state.documentVersion, [{ stage: 'schema', path: 'rules', code: 'no_rules', message: 'x', severity: 'error' }], false)
    expect(canSave(state)).toMatch(/Fix the validation errors/)
  })
})


describe('review regressions (PR #40)', () => {
  it('proposes again after a refusal left the document empty', () => {
    const state = ready()
    const started = startPrepare(state, 'try')
    if (!('request' in started)) throw new Error('could not start')
    const running = preparedArrived(started.state, started.generation, started.request, prepared('d9'))
    const refused = outcomeArrived(running, started.generation, outcome(null, { diagnostics: { finish: 'refusal', model: 'm', raw_text: '', failure: 'refusal', context_sha256: 'd9', sample_included: false } }))
    const again = buildRequest(refused, 'please try again')
    expect('request' in again && again.request.kind).toBe('propose')
  })

  it('re-prepares once after a 409, keeping the message, then stops', () => {
    const state = ready()
    const started = startPrepare(state, 'first')
    if (!('request' in started)) throw new Error('could not start')
    const running = preparedArrived(started.state, started.generation, started.request, prepared('d1'))
    const stale = requestFailed(running, running.generation, 409, 'stale')
    expect(stale.busy).toBe('preparing')
    expect(stale.pendingMessage).toBe('first')
    expect(stale.generation).toBe(running.generation + 1)
    const prepared2 = preparedArrived(stale, stale.generation, started.request, prepared('d2'))
    const staleAgain = requestFailed(prepared2, prepared2.generation, 409, 'stale')
    expect(staleAgain.busy).toBe('none') // one automatic retry only
    expect(staleAgain.notices.at(-1)?.text).toBe('stale')
  })

  it('shows the explanations in the assistant turn and takes the mapping text verbatim', () => {
    const state = ready()
    const started = startPrepare(state, 'analyse')
    if (!('request' in started)) throw new Error('could not start')
    const running = preparedArrived(started.state, started.generation, started.request, prepared('d1'))
    const withExplanation = outcome({ name: 'assisted', source: 'tracelab', rules: [] })
    withExplanation.proposal!.explanations = [{ target: 'session.external_id', path: '$.session_id', why: 'one per record', confidence: 0.95 }]
    const raw = '{"proposal":{"mapping":{"name":"assisted","source":"tracelab","rules":[],"where_value":9007199254740993,"literal":1.0},"explanations":[],"ambiguities":[],"questions":[],"model":"m","executable":true},"issues":[],"attempts":1,"diagnostics":{}}'
    const next = outcomeArrived(running, started.generation, withExplanation, raw)
    expect(next.turns.at(-1)?.content).toContain('Why (1 field):')
    expect(next.turns.at(-1)?.content).toContain('session.external_id ← $.session_id (95%): one per record')
    expect(next.documentText).toContain('9007199254740993')
    expect(next.documentText).toContain('"literal": 1.0')
  })
})
