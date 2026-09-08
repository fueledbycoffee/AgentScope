import { describe, expect, it } from 'vitest'
import { indexDocument } from './documentIndex'
import { controlId, controlIdFor, resolveIssue } from './issuePaths'

describe('the issue-path resolver', () => {
  it('resolves the paths the domain parser actually emits', () => {
    expect(resolveIssue('$')).toEqual({ kind: 'document' })
    expect(resolveIssue('dsl_version')).toEqual({ kind: 'head', key: 'dsl_version' })
    expect(resolveIssue('rules[0].id')).toEqual({ kind: 'rule', ruleIndex: 0, part: 'id' })
    expect(resolveIssue('rules[2].fields')).toEqual({ kind: 'rule', ruleIndex: 2, part: 'fields' })
    expect(resolveIssue('rules[0].native_key[2]')).toEqual({ kind: 'document' })
    expect(resolveIssue('rules[0].where[1].value')).toEqual({ kind: 'condition', ruleIndex: 0, index: 1, part: 'value' })
    expect(resolveIssue('rules[0].fields.started_at.bounds')).toEqual({
      kind: 'field-option', ruleIndex: 0, field: 'started_at', option: 'bounds',
    })
    expect(resolveIssue('rules[1].fields.x.transforms[2]')).toEqual({
      kind: 'transform', ruleIndex: 1, field: 'x', index: 2,
    })
    expect(resolveIssue('rules[0].fields.started_at.path')).toEqual({
      kind: 'field-source', ruleIndex: 0, field: 'started_at', part: 'path',
    })
    expect(resolveIssue('unmapped[0].reason')).toEqual({ kind: 'unmapped', index: 0, part: 'reason' })
  })

  it('sends an ambiguous path to the JSON view instead of guessing a control', () => {
    // the parser concatenates unescaped keys: a field named "a.b" is indistinguishable from a
    // nested path, so nothing here may pick one reading
    expect(resolveIssue('rules[0].fields.a.b')).toEqual({ kind: 'document' })
    expect(resolveIssue('rules[0].fields.started_at.unit.from')).toEqual({ kind: 'document' })
    expect(resolveIssue('rules[0].fields.started_at.unknown_key')).toEqual({ kind: 'document' })
    expect(resolveIssue('rules[x].id')).toEqual({ kind: 'document' })
  })

  it('reads a dotted field name against the document that has it', () => {
    // the parser concatenates unescaped keys, so this one path can mean two different things
    const both = indexDocument('{"rules": [{"id": "r", "entity": "tool_call", "fields": {"wall_latency_ms": {"path": "$.a"}, "wall_latency_ms.type": {"path": "$.b"}}}]}')
    // the longest field name the document really has wins: the issue belongs to the second field
    expect(resolveIssue('rules[0].fields.wall_latency_ms.type', both)).toEqual({
      kind: 'field-source', ruleIndex: 0, field: 'wall_latency_ms.type', part: 'path',
    })
    // with only the plain field present, the same path is that field's type option
    const one = indexDocument('{"rules": [{"id": "r", "entity": "tool_call", "fields": {"wall_latency_ms": {"path": "$.a"}}}]}')
    expect(resolveIssue('rules[0].fields.wall_latency_ms.type', one)).toEqual({
      kind: 'field-option', ruleIndex: 0, field: 'wall_latency_ms', option: 'type',
    })
    // with neither, the issue stays on the rule rather than pointing at a field that is not there
    const none = indexDocument('{"rules": [{"id": "r", "entity": "tool_call", "fields": {"other": {"path": "$.a"}}}]}')
    expect(resolveIssue('rules[0].fields.wall_latency_ms.type', none)).toEqual({ kind: 'rule', ruleIndex: 0, part: 'fields' })
    // and a dotted name is reachable as a whole field too
    expect(resolveIssue('rules[0].fields.wall_latency_ms.type.bounds', both)).toEqual({
      kind: 'field-option', ruleIndex: 0, field: 'wall_latency_ms.type', option: 'bounds',
    })
  })

  it('builds ids that cannot collide, whatever the key contains', () => {
    expect(controlIdFor('rules[0].fields.started_at.on_missing')).toBe('ctl-r0-fstarted_at-opt-on_missing')
    const dotted = controlId({ kind: 'field-option', ruleIndex: 0, field: 'a.b', option: 'type' })
    const nested = controlId({ kind: 'field-option', ruleIndex: 0, field: 'a', option: 'type' })
    expect(dotted).not.toBe(nested)
    // the encoding must be injective: two different names may never share an id, or
    // getElementById would focus the wrong field's control
    const spaced = controlId({ kind: 'field-option', ruleIndex: 0, field: 'a b', option: 'type' })
    const escaped = controlId({ kind: 'field-option', ruleIndex: 0, field: 'a_20b', option: 'type' })
    expect(spaced).not.toBe(escaped)
    const seen = new Set<string | null>()
    for (const field of ['a b', 'a_20b', 'a%20b', 'a.b', 'a-b', 'a/b', 'a"b', 'é😀']) {
      const id = controlId({ kind: 'field-option', ruleIndex: 0, field, option: 'type' })
      expect(seen.has(id), field).toBe(false)
      seen.add(id)
    }
    expect(controlId({ kind: 'field-source', ruleIndex: 3, field: 'a b/c', part: 'literal' })).toMatch(/^ctl-r3-f/)
    expect(controlIdFor('$')).toBeNull()
  })
})
