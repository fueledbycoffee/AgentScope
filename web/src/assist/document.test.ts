import { describe, expect, it } from 'vitest'
import {
  describeEdits,
  keysAt,
  nodeAt,
  planEdits,
  rawAt,
  rawValueOf,
  scanDocument,
  type DocEdit,
  type DocTree,
} from './document'

/** A document with everything a JSON.parse round trip would ruin. */
const DOC = `{
  "name": "épreuve 😀",
  "big": 9007199254740993,
  "decimal": 1.0,
  "exponent": 1e3,
  "\\u0078": "escaped key",
  "rules": [
    {
      "id": "session",
      "fields": {
        "external_id": { "path": "$.session" },
        "started_at": { "path": "$.ts", "timestamp_format": "epoch_ms" }
      }
    },
    {
      "id": "model_call",
      "fields": {}
    }
  ]
}`

const tree = (text: string): DocTree => {
  const scanned = scanDocument(text)
  if ('problem' in scanned) throw new Error(`${scanned.problem} at ${scanned.offset}`)
  return scanned
}

const applied = (text: string, edits: DocEdit[]): string => {
  const result = planEdits(text, edits)
  if ('problem' in result) throw new Error(result.problem)
  return result.text
}

const refused = (text: string, edits: DocEdit[]): string => {
  const result = planEdits(text, edits)
  if (!('problem' in result)) throw new Error(`expected a refusal, got:\n${result.text}`)
  return result.problem
}

describe('the span index', () => {
  it('reads values as written, not as JavaScript would', () => {
    const t = tree(DOC)
    expect(rawAt(t, ['big'])).toBe('9007199254740993')
    expect(rawAt(t, ['decimal'])).toBe('1.0')
    expect(rawAt(t, ['exponent'])).toBe('1e3')
    // what the browser would have done instead
    expect(String(JSON.parse(DOC).big)).toBe('9007199254740992')
    expect(JSON.stringify(JSON.parse(DOC).decimal)).toBe('1')
  })

  it('addresses a member by its decoded key and keeps the spelling', () => {
    const t = tree(DOC)
    expect(rawAt(t, ['x'])).toBe('"escaped key"')
    expect(keysAt(t, [])?.find(key => key.decoded === 'x')?.raw).toBe('"\\u0078"')
  })

  it('walks arrays and nested objects', () => {
    const t = tree(DOC)
    expect(rawAt(t, ['rules', 0, 'id'])).toBe('"session"')
    expect(rawAt(t, ['rules', 1, 'fields'])).toBe('{}')
    expect(rawAt(t, ['rules', 0, 'fields', 'started_at', 'timestamp_format'])).toBe('"epoch_ms"')
    expect(rawAt(t, ['rules', 2])).toBeNull()
    expect(rawAt(t, ['nope'])).toBeNull()
  })

  it('refuses to address anything inside an object with duplicate keys', () => {
    const t = tree('{"a": {"x": 1, "\\u0078": 2}, "b": 3}')
    expect(t.duplicates).toEqual([['a']])
    expect(nodeAt(t, ['a'])).toBeNull()
    expect(nodeAt(t, ['a', 'x'])).toBeNull()
    expect(rawAt(t, ['b'])).toBe('3') // the rest of the document stays usable
  })

  it('takes a value out of any raw JSON text', () => {
    const response = '{"\\u0070roposal": {"mapping": {"big": 9007199254740993}}, "attempts": 1}'
    expect(rawValueOf(response, ['proposal', 'mapping'])).toBe('{"big": 9007199254740993}')
    expect(rawValueOf(response, ['proposal', 'nope'])).toBeNull()
    expect(rawValueOf('not json', ['proposal'])).toBeNull()
  })
})

describe('the edit planner', () => {
  it('leaves every untouched character exactly as it was', () => {
    const next = applied(DOC, [
      { op: 'set', path: ['rules', 0, 'fields', 'started_at', 'timestamp_format'], raw: '"epoch_s"' },
    ])
    expect(next).toContain('"timestamp_format": "epoch_s"')
    // the whole document minus the changed lexeme is identical
    expect(next.replace('"epoch_s"', '"epoch_ms"')).toBe(DOC)
    const t = tree(next)
    expect(rawAt(t, ['big'])).toBe('9007199254740993')
    expect(rawAt(t, ['decimal'])).toBe('1.0')
    expect(rawAt(t, ['name'])).toBe('"épreuve 😀"')
  })

  it('edits a value that sits after non-ASCII text', () => {
    const next = applied(DOC, [{ op: 'set', path: ['big'], raw: '9007199254740994' }])
    expect(tree(next).text).toContain('"épreuve 😀"')
    expect(rawAt(tree(next), ['big'])).toBe('9007199254740994')
  })

  it('edits an escaped key by its decoded name and keeps the spelling', () => {
    const next = applied(DOC, [{ op: 'set', path: ['x'], raw: '{"kept": 1.0}' }])
    expect(next).toContain('"\\u0078": {"kept": 1.0}')
    expect(rawAt(tree(next), ['x'])).toBe('{"kept": 1.0}')
  })

  it('renames a key without touching its value', () => {
    const next = applied(DOC, [{ op: 'rename', path: ['x'], key: 'plain' }])
    expect(next).toContain('"plain": "escaped key"')
    expect(rawAt(tree(next), ['plain'])).toBe('"escaped key"')
  })

  it('removes two adjacent members in one batch (the comma both spans claim)', () => {
    const text = '{"a":1,"b":2,"c":3}'
    expect(applied(text, [{ op: 'remove', path: ['b'] }, { op: 'remove', path: ['c'] }])).toBe('{"a":1}')
    expect(applied(text, [{ op: 'remove', path: ['a'] }, { op: 'remove', path: ['b'] }])).toBe('{"c":3}')
    expect(applied(text, [{ op: 'remove', path: ['a'] }, { op: 'remove', path: ['c'] }])).toBe('{"b":2}')
  })

  it('removes every member and every element', () => {
    expect(applied('{"a":1,"b":2}', [{ op: 'remove', path: ['a'] }, { op: 'remove', path: ['b'] }])).toBe('{}')
    expect(applied('{"a":[1,2]}', [
      { op: 'remove', path: ['a', 0] },
      { op: 'remove', path: ['a', 1] },
    ])).toBe('{"a":[]}')
  })

  it('creates two members in one empty object in one batch', () => {
    const next = applied(DOC, [
      { op: 'set', path: ['rules', 1, 'fields', 'session_external_id'], raw: '{"path": "$.session"}' },
      { op: 'set', path: ['rules', 1, 'fields', 'external_id'], raw: '{"path": "$.id"}' },
    ])
    const t = tree(next)
    expect(rawAt(t, ['rules', 1, 'fields', 'session_external_id'])).toBe('{"path": "$.session"}')
    expect(rawAt(t, ['rules', 1, 'fields', 'external_id'])).toBe('{"path": "$.id"}')
  })

  it('creates exactly one missing level, never two', () => {
    const one = applied(DOC, [
      { op: 'set', path: ['rules', 0, 'fields', 'started_at', 'unit'], raw: '{"from": "s", "to": "ms"}' },
    ])
    expect(rawAt(tree(one), ['rules', 0, 'fields', 'started_at', 'unit', 'from'])).toBe('"s"')
    expect(refused(DOC, [
      { op: 'set', path: ['rules', 0, 'fields', 'started_at', 'unit', 'from'], raw: '"s"' },
    ])).toMatch(/does not exist; create it in one change/)
  })

  it('refuses an edit inside a value the same batch replaces or removes', () => {
    expect(refused('{"unit":{"from":"s","to":"ms"}}', [
      { op: 'set', path: ['unit'], raw: '{"from":"us","to":"ms"}' },
      { op: 'set', path: ['unit', 'from'], raw: '"min"' },
    ])).toMatch(/which this batch replaces or removes/)
    expect(refused('{"unit":{"from":"s"}}', [
      { op: 'remove', path: ['unit'] },
      { op: 'set', path: ['unit', 'from'], raw: '"min"' },
    ])).toMatch(/which this batch replaces or removes/)
    // a set and an insert on the same array is the same conflict, caught one rule earlier
    expect(refused('{"a":[1,2]}', [
      { op: 'set', path: ['a'], raw: '[3]' },
      { op: 'insert', path: ['a'], index: 0, raw: '9' },
    ])).toMatch(/changed twice/)
    expect(refused('{"a":[{"b":1}]}', [
      { op: 'set', path: ['a'], raw: '[]' },
      { op: 'set', path: ['a', 0, 'b'], raw: '2' },
    ])).toMatch(/which this batch replaces or removes/)
  })

  it('composes a rename with an edit beneath it', () => {
    const next = applied('{"a": {"b": 1.0, "c": 2}}', [
      { op: 'rename', path: ['a'], key: 'renamed' },
      { op: 'set', path: ['a', 'c'], raw: '3' },
    ])
    expect(next).toBe('{"renamed": {"b": 1.0, "c": 3}}')
  })

  it('refuses a rename that collides, in the input or in the result', () => {
    expect(refused('{"a":1,"b":2}', [{ op: 'rename', path: ['a'], key: 'b' }])).toMatch(/two members named "b"/)
    // neither name exists in the input: only the final member set shows the collision
    expect(refused('{"a":1,"b":2}', [
      { op: 'rename', path: ['a'], key: 'c' },
      { op: 'rename', path: ['b'], key: 'c' },
    ])).toMatch(/two members named "c"/)
    expect(refused('{"a":1}', [{ op: 'set', path: ['b'], raw: '2' }, { op: 'rename', path: ['a'], key: 'b' }]))
      .toMatch(/two members named "b"/)
  })

  it('refuses two operations on one path', () => {
    expect(refused('{"a":1}', [
      { op: 'set', path: ['a'], raw: '2' },
      { op: 'set', path: ['a'], raw: '3' },
    ])).toMatch(/changed twice/)
    expect(refused('{"a":1}', [
      { op: 'remove', path: ['a'] },
      { op: 'rename', path: ['a'], key: 'b' },
    ])).toMatch(/changed twice/)
  })

  it('reorders array elements and carries their raw text', () => {
    const text = '{"rules":[{"id":"a","big":9007199254740993},{"id":"b"},{"id":"c"}]}'
    const moved = applied(text, [{ op: 'move', path: ['rules', 0], index: 2 }])
    expect(moved).toBe('{"rules":[{"id":"b"},{"id":"c"},{"id":"a","big":9007199254740993}]}')
    // a moved element carries an edit made to it in the same batch
    const both = applied(text, [
      { op: 'move', path: ['rules', 0], index: 1 },
      { op: 'set', path: ['rules', 0, 'id'], raw: '"renamed"' },
    ])
    expect(both).toBe('{"rules":[{"id":"b"},{"id":"renamed","big":9007199254740993},{"id":"c"}]}')
  })

  it('inserts elements and refuses a contested destination', () => {
    const text = '{"a":[1,2]}'
    // the container's own separator is reused, so a compact array stays compact
    expect(applied(text, [{ op: 'insert', path: ['a'], index: 1, raw: '1.5' }])).toBe('{"a":[1,1.5,2]}')
    expect(applied(text, [
      { op: 'insert', path: ['a'], index: 0, raw: '0' },
      { op: 'insert', path: ['a'], index: 3, raw: '3' },
    ])).toBe('{"a":[0,1,2,3]}')
    expect(refused(text, [
      { op: 'insert', path: ['a'], index: 0, raw: '0' },
      { op: 'move', path: ['a', 1], index: 0 },
    ])).toMatch(/two changes claim index 0/)
    expect(refused(text, [{ op: 'insert', path: ['a'], index: 9, raw: '0' }])).toMatch(/cannot insert at index 9/)
    expect(refused(text, [{ op: 'set', path: ['a', 5], raw: '0' }])).toMatch(/out of range/)
  })

  it('refuses raw text that is not exactly one JSON value', () => {
    for (const raw of ['', '1 2', '{"a":1', '01', 'undefined', '{"a":1} trailing']) {
      expect(refused('{"a":1}', [{ op: 'set', path: ['a'], raw }]), raw).toMatch(/is not one JSON value/)
    }
  })

  it('refuses to edit inside a section with duplicate keys', () => {
    const text = '{"a": {"x": 1, "\\u0078": 2}}'
    expect(refused(text, [{ op: 'set', path: ['a', 'x'], raw: '3' }])).toMatch(/duplicate keys/)
    expect(refused(text, [{ op: 'set', path: ['a'], raw: '{}' }])).toMatch(/duplicate keys/)
  })

  it('refuses a batch against a document that is not valid JSON', () => {
    expect(refused('{"a":01}', [{ op: 'set', path: ['a'], raw: '1' }])).toMatch(/not valid JSON/)
  })

  it('keeps the document unchanged when a batch is refused', () => {
    const before = DOC
    const result = planEdits(DOC, [
      { op: 'set', path: ['decimal'], raw: '2.0' },
      { op: 'set', path: ['nope', 'deeper'], raw: '1' },
    ])
    expect(result).toHaveProperty('problem')
    expect(DOC).toBe(before)
    expect(rawAt(tree(DOC), ['decimal'])).toBe('1.0')
  })

  it('keeps CRLF, tabs and compact layouts readable and editable', () => {
    const crlf = '{\r\n\t"a": 1,\r\n\t"b": 2\r\n}'
    const next = applied(crlf, [{ op: 'set', path: ['a'], raw: '1.0' }])
    expect(next).toBe('{\r\n\t"a": 1.0,\r\n\t"b": 2\r\n}')
    expect(applied('{"a":1}', [{ op: 'set', path: ['b'], raw: '2' }])).toBe('{"a":1, "b": 2}')
  })

  it('reads back after several batches, losing nothing', () => {
    let text = DOC
    text = applied(text, [{ op: 'rename', path: ['rules', 0, 'fields', 'started_at'], key: 'ended_at' }])
    text = applied(text, [{ op: 'set', path: ['rules', 0, 'fields', 'ended_at', 'on_missing'], raw: '"reject"' }])
    text = applied(text, [{ op: 'remove', path: ['exponent'] }])
    text = applied(text, [{ op: 'insert', path: ['rules'], index: 0, raw: '{"id": "first"}' }])
    const t = tree(text)
    expect(rawAt(t, ['big'])).toBe('9007199254740993')
    expect(rawAt(t, ['decimal'])).toBe('1.0')
    expect(rawAt(t, ['exponent'])).toBeNull()
    expect(rawAt(t, ['rules', 0, 'id'])).toBe('"first"')
    expect(rawAt(t, ['rules', 1, 'fields', 'ended_at', 'on_missing'])).toBe('"reject"')
    expect(rawAt(t, ['x'])).toBe('"escaped key"')
  })

  it('describes a batch in one line before it is applied', () => {
    expect(describeEdits([
      { op: 'set', path: ['rules', 1, 'fields', 'started_at', 'timestamp_format'], raw: '"epoch_s"' },
      { op: 'remove', path: ['rules', 1, 'fields', 'started_at', 'unit'] },
    ])).toBe('set rules[1].fields.started_at.timestamp_format to "epoch_s"; remove rules[1].fields.started_at.unit')
  })
})
