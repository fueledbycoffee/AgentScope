/**
 * The lossless numeric codec, proved end to end in the browser's half of the boundary:
 * a raw HTTP response *string* → the editor's state machine → an edit made through the planner →
 * the bytes of the outbound save request. Numbers and strings the user did not edit must arrive
 * character for character; `JSON.parse` has already ruined them before any of this runs, which is
 * what the assertions below contrast against.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantOutcome } from '../api/types'
import { saveMappingText, validateMappingText } from '../api'
import { initialState, outcomeArrived, setDocumentText, UNREADABLE_PROPOSAL, type AssistState } from './assistRuntime'
import { planEdits, rawAt, scanDocument, type DocTree } from './document'

/** A mapping whose numbers and keys a JSON round trip would change. */
const MAPPING = `{
    "dsl_version": 1,
    "target_schema_version": 1,
    "name": "epoch-assist",
    "source": "assist",
    "input_format": "jsonl",
    "rules": [
      {
        "id": "model_call",
        "entity": "model_call",
        "select": "$",
        "where": [{"path": "$.id", "op": "eq", "value": 9007199254740993}],
        "fields": {
          "session_external_id": {"path": "$.session"},
          "sequence": {"literal": 1},
          "\\u0078_ratio": {"literal": 1.0},
          "started_at": {"path": "$.ts", "timestamp_format": "epoch_ms"}
        }
      }
    ]
  }`

/** A run response as the server writes it, with an escaped envelope key. */
const response = (mapping = MAPPING) =>
  `{"\\u0070roposal": {"mapping": ${mapping}, "explanations": [], "ambiguities": [], "questions": [], "model": "fake/deterministic-1", "executable": true}, "issues": [], "attempts": 1, "diagnostics": {"finish": "stop", "model": "fake/deterministic-1", "raw_text": "", "failure": null, "context_sha256": "d1", "sample_included": false}}`

const outcomeOf = (rawText: string): AssistantOutcome => JSON.parse(rawText) as AssistantOutcome

/** The state a reply arrives into: one message sent, a run in flight. */
function running(): AssistState {
  return {
    ...initialState('upl_1'),
    identity: { name: 'epoch-assist', source: 'assist' },
    pendingMessage: 'propose a mapping',
    busy: 'running',
  }
}

const tree = (text: string): DocTree => {
  const scanned = scanDocument(text)
  if ('problem' in scanned) throw new Error(`${scanned.problem} at ${scanned.offset}`)
  return scanned
}

let bodies: { path: string; body: string }[] = []

beforeEach(() => {
  bodies = []
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    bodies.push({ path, body: String(init?.body ?? '') })
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'map_1', name: 'epoch-assist', source: 'assist', revision: 1, created_by: 'user', input_format: 'jsonl', created: true, issues: [], executable: true }),
      text: async () => '{}',
    } as unknown as Response
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('the numeric codec, from response text to request bytes', () => {
  it('carries every lexeme through the editor and an edit into the save request', async () => {
    const rawText = response()
    const outcome = outcomeOf(rawText)
    // what the browser did to the numbers on the way in: this is what must never be sent
    const parsed = JSON.parse(rawText) as { proposal: { mapping: { rules: { where: { value: number }[] }[] } } }
    expect(String(parsed.proposal.mapping.rules[0].where[0].value)).toBe('9007199254740992')

    const applied = outcomeArrived(running(), 0, outcome, rawText)
    const before = tree(applied.documentText)
    expect(rawAt(before, ['rules', 0, 'where', 0, 'value'])).toBe('9007199254740993')
    expect(rawAt(before, ['rules', 0, 'fields', 'x_ratio', 'literal'])).toBe('1.0')
    expect(rawAt(before, ['rules', 0, 'fields', 'sequence', 'literal'])).toBe('1')

    // an edit of the kind the field table will make, through the planner
    const edited = planEdits(applied.documentText, [
      { op: 'set', path: ['rules', 0, 'fields', 'started_at', 'timestamp_format'], raw: '"epoch_s"' },
      { op: 'set', path: ['rules', 0, 'fields', 'session_external_id', 'on_missing'], raw: '"reject"' },
    ])
    if ('problem' in edited) throw new Error(edited.problem)
    const state = setDocumentText(applied, edited.text)

    await saveMappingText(state.documentText)
    await validateMappingText(state.documentText)
    expect(bodies.map(sent => sent.path)).toEqual(['/api/mappings', '/api/mappings/validate'])

    for (const sent of bodies) {
      const body = tree(sent.body)
      // values are located at their paths, not by substring: a right value at a wrong path fails
      expect(rawAt(body, ['document', 'rules', 0, 'where', 0, 'value'])).toBe('9007199254740993')
      expect(rawAt(body, ['document', 'rules', 0, 'fields', 'x_ratio', 'literal'])).toBe('1.0')
      expect(rawAt(body, ['document', 'rules', 0, 'fields', 'sequence', 'literal'])).toBe('1')
      expect(rawAt(body, ['document', 'rules', 0, 'fields', 'started_at', 'timestamp_format'])).toBe('"epoch_s"')
      expect(rawAt(body, ['document', 'rules', 0, 'fields', 'session_external_id', 'on_missing'])).toBe('"reject"')
      // the escaped key kept its spelling on the wire and still decodes to the same name
      expect(sent.body).toContain('"\\u0078_ratio"')
    }
  })

  it('keeps the document and every gate untouched when the reply cannot be read as text', () => {
    const saved = {
      ...running(),
      documentText: '{"name": "kept", "big": 9007199254740993}',
      documentVersion: 7,
      undo: '{"name": "older"}',
      validation: { documentVersion: 7, issues: [], executable: true },
      saved: { documentText: '{"name": "kept", "big": 9007199254740993}', record: { id: 'map_9', name: 'kept', source: 'assist', revision: 2, created_by: 'user', input_format: 'jsonl' as const, created: true } },
    }
    const unreadable = [
      response('{"a": 01}'), // not JSON: the grammar refuses it
      response('[1, 2]'), // a mapping that is not an object
      `{"proposal": {"model": "m", "executable": true}, "issues": [], "attempts": 1, "diagnostics": {"finish": "stop", "model": "m", "raw_text": "", "failure": null, "context_sha256": "d", "sample_included": false}}`, // no mapping member
      `{"proposal": {"mapping": {"a": 1}}, "proposal": {"mapping": {"a": 2}}, "issues": [], "attempts": 1, "diagnostics": {"finish": "stop", "model": "m", "raw_text": "", "failure": null, "context_sha256": "d", "sample_included": false}}`, // duplicate envelope keys
    ]
    for (const rawText of unreadable) {
      const outcome: AssistantOutcome = {
        proposal: { mapping: { a: 1 }, explanations: [], ambiguities: [], questions: [], model: 'm', executable: true },
        issues: [], attempts: 1,
        diagnostics: { finish: 'stop', model: 'm', raw_text: '', failure: null, context_sha256: 'd', sample_included: false },
      }
      const next = outcomeArrived(saved, 0, outcome, rawText)
      expect(next.documentText, rawText).toBe(saved.documentText)
      expect(next.documentVersion).toBe(saved.documentVersion)
      expect(next.undo).toBe(saved.undo)
      expect(next.validation).toBe(saved.validation) // the outcome's own validation is never attached
      expect(next.saved).toBe(saved.saved)
      expect(next.preview).toBe(saved.preview)
      expect(next.notices.some(notice => notice.text === UNREADABLE_PROPOSAL)).toBe(true)
      expect(next.turns[next.turns.length - 1].content).toBe(UNREADABLE_PROPOSAL)
    }
  })

  it('refuses to send a document that is not one JSON object', async () => {
    await expect(saveMappingText('{"a": 1} trailing')).rejects.toThrow(/not valid JSON/)
    await expect(saveMappingText('[1]')).rejects.toThrow(/single JSON object/)
    expect(bodies).toHaveLength(0)
  })
})
