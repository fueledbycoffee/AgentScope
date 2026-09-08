import { describe, expect, it } from 'vitest'
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

  it('builds ids that cannot collide, whatever the key contains', () => {
    expect(controlIdFor('rules[0].fields.started_at.on_missing')).toBe('ctl-r0-fstarted_at-opt-on_missing')
    const dotted = controlId({ kind: 'field-option', ruleIndex: 0, field: 'a.b', option: 'type' })
    const nested = controlId({ kind: 'field-option', ruleIndex: 0, field: 'a', option: 'type' })
    expect(dotted).not.toBe(nested)
    expect(controlId({ kind: 'field-source', ruleIndex: 3, field: 'a b/c', part: 'literal' })).toMatch(/^ctl-r3-f/)
    expect(controlIdFor('$')).toBeNull()
  })
})
