import { describe, expect, it } from 'vitest'
import type { AssistantOutcome, PreparedContext, SavedMapping } from '../api/types'
import {
  acknowledge,
  buildRequest,
  canImport,
  canPreview,
  canSave,
  identityProblem,
  initialState,
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

/** Drive one full send: prepare, (ack), run, outcome. */
function send(state: AssistState, message: string, mapping: Record<string, unknown>, digest = 'd1'): AssistState {
  const started = startPrepare(state, message)
  if (!('request' in started)) throw new Error('could not start')
  let next = preparedArrived(started.state, started.generation, started.request, prepared(digest, started.request.include_sample ?? false))
  if (started.request.include_sample) next = acknowledge(next, digest)
  const run = runnable(next)
  if (run === null) throw new Error('not runnable')
  return outcomeArrived(next, run.generation, outcome(mapping))
}

describe('identity and request building', () => {
  it('refuses identities the server would redact and requires both fields', () => {
    expect(identityProblem({ name: '', source: 'x' })).toMatch(/required/)
    expect(identityProblem({ name: 'sean@example.com', source: 'x' })).toMatch(/must not contain/)
    expect(identityProblem({ name: 'ok', source: '/Users/sean' })).toMatch(/must not contain/)
    expect(identityProblem({ name: 'a'.repeat(101), source: 'x' })).toMatch(/100/)
    expect(identityProblem(identity)).toBeNull()
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
      expect(revise.request.current_mapping).toEqual({ name: 'assisted', source: 'tracelab', rules: [] })
      expect(revise.request.history).toHaveLength(20)
      expect(revise.omitted).toBe(state.turns.length - 20)
    }
  })

  it('refuses a document whose identity differs or that is not a JSON object', () => {
    const state = setDocumentText(ready(), '{"name": "other", "source": "tracelab"}')
    const built = buildRequest({ ...state, turns: [{ id: 'a', role: 'user', content: 'x' }] }, 'm')
    expect('problem' in built && built.problem).toMatch(/name and source/)
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
    expect(again.undo).toBe(state.documentText)
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
    const failed = requestFailed(started.state, started.generation, 409, 'stale')
    expect(failed.busy).toBe('none')
    expect(failed.prepared).toBeNull()
    expect(failed.notices[0].text).toMatch(/prepared again/)
    expect(failed.pendingMessage).toBe('first')
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
