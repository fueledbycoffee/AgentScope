import { describe, expect, it } from 'vitest'
import type { Ambiguity } from '../api/types'
import { FIELD_OPTIONS, indexDocument } from './documentIndex'
import { offerFor, resolveTarget, suggestionsFor } from './suggestions'

const DOC = `{
  "name": "epoch-assist",
  "source": "assist",
  "rules": [
    {
      "id": "session",
      "entity": "session",
      "fields": { "external_id": { "path": "$.session" } }
    },
    {
      "id": "model_call",
      "entity": "model_call",
      "fields": {
        "session_external_id": { "path": "$.session" },
        "started_at": { "path": "$.ts", "timestamp_format": "epoch_ms" },
        "ended_at": { "path": "$.calls[*].ts" },
        "input_tokens": { "path": "$.tokens" }
      }
    }
  ]
}`
const index = indexDocument(DOC)
const modelCall = index.rules[1]
const startedAt = modelCall.fields.find(field => field.name === 'started_at')!
const endedAt = modelCall.fields.find(field => field.name === 'ended_at')!

const ambiguity = (target: string, options: string[]): Ambiguity => ({
  target,
  options,
  what_settles_it: 'the magnitude of ts',
})

describe('resolving an ambiguity target', () => {
  it('keeps an option the target names', () => {
    expect(resolveTarget(index, 'rules[1].fields.started_at.timestamp_format')).toEqual({
      kind: 'field', ruleIndex: 1, field: 'started_at', option: 'timestamp_format',
    })
    expect(resolveTarget(index, 'model_call.started_at.on_invalid')).toEqual({
      kind: 'field', ruleIndex: 1, field: 'started_at', option: 'on_invalid',
    })
  })

  it('resolves entity.field and a unique bare field name', () => {
    expect(resolveTarget(index, 'model_call.started_at')).toEqual({ kind: 'field', ruleIndex: 1, field: 'started_at', option: null })
    expect(resolveTarget(index, 'started_at')).toEqual({ kind: 'field', ruleIndex: 1, field: 'started_at', option: null })
  })

  it('asks which rule when several declare the field, and gives up when none do', () => {
    const twoRules = indexDocument(DOC.replace('"external_id": { "path": "$.session" }', '"external_id": { "path": "$.session" }, "started_at": { "path": "$.t" }'))
    const resolution = resolveTarget(twoRules, 'started_at')
    expect(resolution.kind).toBe('choose-rule')
    if (resolution.kind !== 'choose-rule') throw new Error('expected a choice')
    expect(resolution.choices.map(choice => choice.ruleIndex)).toEqual([0, 1])
    expect(resolveTarget(index, 'nope')).toEqual({ kind: 'none' })
    expect(resolveTarget(index, 'rules[9].fields.x')).toEqual({ kind: 'none' })
  })
})

describe('turning an option string into operations', () => {
  it('matches only the option the target named', () => {
    const suggestions = suggestionsFor(modelCall, startedAt, 'timestamp_format', 'epoch_s')
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].edits).toEqual([
      { op: 'set', path: ['rules', 1, 'fields', 'started_at', 'timestamp_format'], raw: '"epoch_s"' },
    ])
    expect(suggestions[0].description).toBe('set timestamp_format of model_call · started_at to "epoch_s"')
  })

  it('offers every operation a value could name when the target named none', () => {
    // `reject` is a legal value of on_missing and of on_invalid: the user says which
    const reject = suggestionsFor(modelCall, startedAt, null, 'reject')
    expect(reject.map(suggestion => suggestion.operation).sort()).toEqual(['on_invalid', 'on_missing'])
    // `null` is legal for both policies too
    expect(suggestionsFor(modelCall, startedAt, null, 'null').map(s => s.operation).sort()).toEqual(['on_invalid', 'on_missing'])
    // `true` names one operation and is still an explicit pick, never applied on its own
    const boolean = suggestionsFor(modelCall, startedAt, null, 'true')
    expect(boolean.map(s => s.operation)).toEqual(['empty_as_missing'])
    expect(boolean[0].edits[0]).toEqual({ op: 'set', path: ['rules', 1, 'fields', 'started_at', 'empty_as_missing'], raw: 'true' })
  })

  it('never turns a bare unit into a unit edit, but takes an explicit pair', () => {
    expect(suggestionsFor(modelCall, startedAt, null, 'min').map(s => s.operation)).toEqual(['bounds'])
    expect(suggestionsFor(modelCall, startedAt, null, 's').map(s => s.operation)).toEqual([])
    for (const text of ['s→ms', 's -> ms', 's to ms']) {
      const pair = suggestionsFor(modelCall, startedAt, null, text)
      expect(pair.map(s => s.operation), text).toEqual(['unit'])
      expect(pair[0].edits[0]).toEqual({ op: 'set', path: ['rules', 1, 'fields', 'started_at', 'unit'], raw: '{"from":"s","to":"ms"}' })
    }
  })

  it('says what the parser will make of it, without deciding for the parser', () => {
    // bounds needs a path containing [*] (parser.py:439-473)
    expect(suggestionsFor(modelCall, startedAt, 'bounds', 'min')[0].warning).toMatch(/needs a path containing/)
    expect(suggestionsFor(modelCall, endedAt, 'bounds', 'min')[0].warning).toBeNull()
    const typed = indexDocument(DOC.replace('"timestamp_format": "epoch_ms"', '"type": "string"'))
    const field = typed.rules[1].fields.find(f => f.name === 'started_at')!
    expect(suggestionsFor(typed.rules[1], field, 'timestamp_format', 'epoch_s')[0].warning).toMatch(/ignores timestamp_format on a string/)
  })

  it('blocks on_missing: default until a default exists', () => {
    const blocked = suggestionsFor(modelCall, startedAt, 'on_missing', 'default')
    expect(blocked[0].blocked).toMatch(/set a default/)
    const withDefault = indexDocument(DOC.replace('"timestamp_format": "epoch_ms"', '"default": null'))
    const field = withDefault.rules[1].fields.find(f => f.name === 'started_at')!
    expect(suggestionsFor(withDefault.rules[1], field, 'on_missing', 'default')[0].blocked).toBeNull()
  })

  it('leaves prose alone', () => {
    expect(suggestionsFor(modelCall, startedAt, null, 'a validated swe-chat tag')).toEqual([])
  })
})

describe('every option name the backend can target', () => {
  it('resolves without throwing, whatever option the target names', () => {
    // FIELD_OPTIONS is the DSL's own list; unit and default have no closed domain, and a target
    // may name any of them. None may throw while a chip is being built.
    for (const option of FIELD_OPTIONS) {
      const resolved = resolveTarget(index, `rules[1].fields.started_at.${option}`)
      expect(resolved, option).toEqual({ kind: 'field', ruleIndex: 1, field: 'started_at', option })
      for (const text of ['s to ms', 'epoch_s', 'null', 'anything at all']) {
        expect(() => suggestionsFor(modelCall, startedAt, option, text), `${option} / ${text}`).not.toThrow()
      }
    }
  })

  it('executes an explicit unit pair the target asked for, and leaves default as prose', () => {
    const unit = suggestionsFor(modelCall, startedAt, 'unit', 's to ms')
    expect(unit.map(entry => entry.operation)).toEqual(['unit'])
    expect(unit[0].edits[0]).toEqual({ op: 'set', path: ['rules', 1, 'fields', 'started_at', 'unit'], raw: '{"from":"s","to":"ms"}' })
    // a default has no closed domain: nothing can be inferred from an option string
    expect(suggestionsFor(modelCall, startedAt, 'default', 'null')).toEqual([])
    expect(offerFor(index, ambiguity('rules[1].fields.started_at.default', ['null'])).kind).toBe('prose')
  })

  it('edits an existing unit at its members, keeping what no control owns', () => {
    const withUnit = indexDocument(DOC.replace(
      '"input_tokens": { "path": "$.tokens" }',
      '"wall_latency_ms": { "path": "$.ms", "unit": {"from": "s", "to": "ms", "extension": 9007199254740993} }',
    ))
    const rule = withUnit.rules[1]
    const field = rule.fields.find(entry => entry.name === 'wall_latency_ms')!
    const suggestion = suggestionsFor(rule, field, 'unit', 'us to ms')[0]
    expect(suggestion.edits).toEqual([
      { op: 'set', path: ['rules', 1, 'fields', 'wall_latency_ms', 'unit', 'from'], raw: '"us"' },
      { op: 'set', path: ['rules', 1, 'fields', 'wall_latency_ms', 'unit', 'to'], raw: '"ms"' },
    ])
    expect(suggestion.description).toContain('us')
  })

  it('completes a partial unit at its members, keeping the rest', () => {
    const partial = indexDocument(DOC.replace(
      '"input_tokens": { "path": "$.tokens" }',
      '"wall_latency_ms": { "path": "$.ms", "unit": {"from": "s", "extension": 9007199254740993} }',
    ))
    const rule = partial.rules[1]
    const field = rule.fields.find(entry => entry.name === 'wall_latency_ms')!
    expect(suggestionsFor(rule, field, 'unit', 'us to ms')[0].edits).toEqual([
      { op: 'set', path: ['rules', 1, 'fields', 'wall_latency_ms', 'unit', 'from'], raw: '"us"' },
      { op: 'set', path: ['rules', 1, 'fields', 'wall_latency_ms', 'unit', 'to'], raw: '"ms"' },
    ])
  })

  it('offers the pair through the whole path a proposal takes', () => {
    const offer = offerFor(index, ambiguity('rules[1].fields.started_at.unit', ['s to ms', 'ns to ms']))
    expect(offer.kind).toBe('operations')
    if (offer.kind !== 'operations') throw new Error('expected operations')
    expect(offer.options.map(entry => entry.text)).toEqual(['s to ms', 'ns to ms'])
  })
})

describe('what an ambiguity offers', () => {
  it('offers the executable options and keeps the rest as prose', () => {
    const offer = offerFor(index, ambiguity('model_call.started_at', ['epoch_s', 'epoch_ms']))
    expect(offer.kind).toBe('operations')
    if (offer.kind !== 'operations') throw new Error('expected operations')
    expect(offer.options.map(option => option.text)).toEqual(['epoch_s', 'epoch_ms'])
    // one match still needs a click: the option list is the user's choice, not ours
    expect(offer.options[0].suggestions).toHaveLength(1)

    expect(offerFor(index, ambiguity('model_call.token_semantics', ['unknown', 'a validated swe-chat tag'])).kind).toBe('prose')
    expect(offerFor(index, ambiguity('', ['epoch_s'])).kind).toBe('prose')
  })

  it('asks for the rule first when the target names several', () => {
    const twoRules = indexDocument(DOC.replace('"external_id": { "path": "$.session" }', '"external_id": { "path": "$.session" }, "started_at": { "path": "$.t" }'))
    const asked = offerFor(twoRules, ambiguity('started_at', ['epoch_s']))
    expect(asked.kind).toBe('choose-rule')
    const picked = offerFor(twoRules, ambiguity('started_at', ['epoch_s']), 1)
    expect(picked.kind).toBe('operations')
    if (picked.kind !== 'operations') throw new Error('expected operations')
    expect(picked.options[0].suggestions[0].edits[0].path).toEqual(['rules', 1, 'fields', 'started_at', 'timestamp_format'])
  })
})
