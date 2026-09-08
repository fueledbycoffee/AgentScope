import { describe, expect, it } from 'vitest'
import {
  patchScope, readScope, resolveApiScope, resolvePeriod, scopeHref, scopeKey, scopeSearch,
} from './scope'
import type { DrillEnvelopeV1 } from './scope'

const drill: DrillEnvelopeV1 = {
  version: 1,
  label: 'accounting',
  value: 'tracelab-codex',
  scope: {
    source: 'tracelab',
    model: 'gpt-5.5-codex',
    token_semantics: 'tracelab-codex',
    activity_grain: 'model_call',
  },
}

describe('scope URL contract', () => {
  it.each([
    ['7d', '2026-09-02T00:00:00.000Z', '2026-09-09T00:00:00.000Z'],
    ['30d', '2026-08-10T00:00:00.000Z', '2026-09-09T00:00:00.000Z'],
    ['90d', '2026-06-11T00:00:00.000Z', '2026-09-09T00:00:00.000Z'],
  ])('resolves %s as an N-day UTC half-open range', (period, startedFrom, startedBefore) => {
    expect(resolvePeriod(period, new Date('2026-09-08T23:59:59.999Z'))).toMatchObject({
      started_from: startedFrom,
      started_before: startedBefore,
    })
  })

  it('changes at UTC midnight independently of the local-zone representation', () => {
    expect(resolvePeriod('7d', new Date('2026-09-08T23:59:59.999Z'))?.started_from).toBe('2026-09-02T00:00:00.000Z')
    expect(resolvePeriod('7d', new Date('2026-09-09T00:00:00.000Z'))?.started_from).toBe('2026-09-03T00:00:00.000Z')
    expect(resolvePeriod('7d', new Date('2026-09-08T02:00:00+02:00'))).toEqual(resolvePeriod('7d', new Date('2026-09-08T00:00:00Z')))
  })

  it('round-trips the complete allowlisted envelope as part of identity and links', () => {
    const state = { source: 'trace & lab', model: 'm=1', period: '7d', drill }
    const key = scopeKey(state)
    expect(readScope(new URLSearchParams(key))).toEqual(state)
    expect(scopeSearch(state)).toContain('drill=')
    expect(scopeHref(state, 'agent', 'codex')).toEqual(expect.objectContaining({ pathname: '/sessions' }))
    expect(String((scopeHref(state, 'agent', 'codex') as { search: string }).search)).toContain('drill=')
  })

  it('preserves exact whitespace in URL reads, writes, and the effective base scope', () => {
    const model = ' padded-model '
    const read = readScope(new URLSearchParams({ model }))
    expect(read.model).toBe(model)
    expect(resolveApiScope(read).model).toBe(model)

    const patched = patchScope(new URLSearchParams(), { model })
    expect(patched.get('model')).toBe(model)
    expect(readScope(patched).model).toBe(model)
    expect(scopeSearch({ model })).toBe('?model=+padded-model+')
  })

  it.each([
    '{',
    JSON.stringify({ version: 2, label: 'tool', value: 'Read', scope: {} }),
    JSON.stringify({ version: 1, label: 'tool', value: 'Read', scope: { session_ids: ['private'] } }),
    JSON.stringify({ version: 1, label: 'tool', value: 'Read', scope: { unknown: 'field' } }),
    JSON.stringify({ version: 1, label: 'tool', value: 'Read', scope: { model: 'claude', model_is_unknown: true } }),
    JSON.stringify({ version: 1, label: 'day', value: 'today', scope: { started_from: 'not-a-date' } }),
    JSON.stringify({ version: 1, label: 'quality', value: 'unknown timestamps', scope: { timestamp_missing: true } }),
    JSON.stringify({ version: 1, label: 'day', value: 'today', scope: { witness_required: true } }),
    'x'.repeat(8_193),
  ])('ignores malformed, private, unknown or oversized envelopes', encoded => {
    expect(readScope(new URLSearchParams({ drill: encoded })).drill).toBeUndefined()
  })

  it('deletes a removed base filter and unknown predicate from the effective drill', () => {
    for (const envelope of [drill, { ...drill, scope: { ...drill.scope, model: undefined, model_is_unknown: true } }]) {
      const search = new URLSearchParams(scopeSearch({ model: 'gpt-5.5-codex', drill: envelope }))
      search.set('offset', '50')
      const next = patchScope(search, { model: undefined })
      const state = readScope(next)
      expect(next.has('offset')).toBe(false)
      expect(state.drill?.scope).not.toHaveProperty('model')
      expect(state.drill?.scope).not.toHaveProperty('model_is_unknown')
      expect(resolveApiScope(state)).not.toHaveProperty('model')
      expect(resolveApiScope(state)).not.toHaveProperty('model_is_unknown')
    }
  })

  it('keeps a drill for base changes, removes it for Period, and clears pagination', () => {
    const current = new URLSearchParams(scopeSearch({ source: 'tracelab', drill }))
    current.set('offset', '50')
    expect(readScope(patchScope(current, { agent: 'codex' })).drill).toBeDefined()
    const period = patchScope(current, { period: '30d' })
    expect(readScope(period).drill).toBeUndefined()
    expect(period.has('offset')).toBe(false)
  })

  it('lets the drill carry its witnessed date scope until Period changes', () => {
    const witnessed = { ...drill, scope: { ...drill.scope, started_from: '2026-01-01T00:00:00Z' } }
    expect(resolveApiScope({ period: '7d', drill: witnessed }, new Date('2026-09-08T12:00:00Z')).started_from).toBe('2026-01-01T00:00:00Z')
  })

  it('keeps valid microsecond drill intervals distinct at full precision', () => {
    const precise = JSON.stringify({
      version: 1,
      label: 'day',
      value: 'microseconds',
      scope: {
        started_from: '2026-09-07T00:00:00.000001Z',
        started_before: '2026-09-07T00:00:00.000002Z',
        activity_grain: 'model_call',
      },
    })

    expect(readScope(new URLSearchParams({ drill: precise })).drill?.scope).toMatchObject({
      started_from: '2026-09-07T00:00:00.000001Z',
      started_before: '2026-09-07T00:00:00.000002Z',
    })
  })

  it('lets an explicit base value override and clear a mutually exclusive unknown predicate', () => {
    expect(resolveApiScope({ model: 'claude', agent: 'codex', drill: {
      ...drill,
      scope: { ...drill.scope, model_is_unknown: true, agent_is_unknown: true },
    } })).toMatchObject({ model: 'claude', agent: 'codex' })
    expect(resolveApiScope({ model: 'claude', agent: 'codex', drill: {
      ...drill,
      scope: { ...drill.scope, model_is_unknown: true, agent_is_unknown: true },
    } })).not.toMatchObject({ model_is_unknown: true, agent_is_unknown: true })
  })

  it('ignores unsupported pasted period values', () => {
    expect(readScope(new URLSearchParams('period=forever'))).toEqual({})
  })
})
