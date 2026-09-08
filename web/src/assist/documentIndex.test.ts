import { describe, expect, it } from 'vitest'
import { asString, indexDocument } from './documentIndex'

const DOC = `{
  "dsl_version": 1,
  "target_schema_version": 1,
  "name": "epoch-assist",
  "source": "assist",
  "input_format": "jsonl",
  "notes": "drafted with the assistant",
  "extra_key": {"kept": 9007199254740993},
  "rules": [
    {
      "id": "session",
      "entity": "session",
      "select": "$",
      "native_key": [],
      "where": [{"path": "$.kind", "op": "eq", "value": 1.0}],
      "fields": {
        "external_id": { "path": "$.session", "on_missing": "reject" },
        "started_at": {
          "path": "$.ts",
          "timestamp_format": "epoch_ms",
          "empty_as_missing": false,
          "default": null,
          "transforms": ["trim", {"enum_map": {"mapping": {"a": 1.0}, "unmapped": "keep"}}],
          "unknown_option": 1
        }
      }
    },
    {
      "id": "tool_call",
      "entity": "tool_call",
      "parent": "model_call",
      "fields": { "broken": [1, 2] }
    }
  ],
  "unmapped": [{"path": "$.x", "reason": "no target"}]
}`

describe('the indexed view', () => {
  it('reads the head, notes and unknown document keys', () => {
    const index = indexDocument(DOC)
    expect(index.ok).toBe(true)
    expect(asString(index.head.name)).toBe('epoch-assist')
    expect(index.head.dsl_version.raw).toBe('1')
    expect(asString(index.notes)).toBe('drafted with the assistant')
    expect(index.extras.map(extra => extra.path)).toEqual([['extra_key']])
    expect(index.unmapped).toHaveLength(1)
    expect(asString(index.unmapped[0].reason)).toBe('no target')
  })

  it('shows values as written, never as JavaScript would', () => {
    const index = indexDocument(DOC)
    const started = index.rules[0].fields.find(field => field.name === 'started_at')!
    expect(started.source.members.path.raw).toBe('"$.ts"')
    expect(index.rules[0].where?.[0].value.raw).toBe('1.0')
    expect(index.rules[0].where?.[0].op.raw).toBe('"eq"')
    expect(index.extras[0].raw).toContain('9007199254740993')
  })

  it('keeps absent, null, false and empty apart', () => {
    const index = indexDocument(DOC)
    const [session, tool] = index.rules
    const started = session.fields.find(field => field.name === 'started_at')!
    expect(started.options.default.raw).toBe('null') // declared null
    expect(started.options.empty_as_missing.raw).toBe('false') // declared false
    expect(started.options.bounds.raw).toBeNull() // absent
    expect(session.nativeKey).toEqual({ present: true, items: [] }) // declared empty
    expect(tool.nativeKey.present).toBe(false) // not declared at all
  })

  it('keeps both transform forms as written and names them', () => {
    const index = indexDocument(DOC)
    const started = index.rules[0].fields.find(field => field.name === 'started_at')!
    expect(started.transforms?.map(transform => [transform.form, transform.name])).toEqual([
      ['short', 'trim'],
      ['object', 'enum_map'],
    ])
    expect(started.transforms?.[1].raw).toContain('"a": 1.0')
  })

  it('keeps a field key the DSL does not name', () => {
    const started = indexDocument(DOC).rules[0].fields.find(field => field.name === 'started_at')!
    expect(started.extras.map(extra => extra.path.at(-1))).toEqual(['unknown_option'])
  })

  it('marks a field that is not an object without touching its siblings', () => {
    const index = indexDocument(DOC)
    const broken = index.rules[1].fields[0]
    expect(broken.malformed).toMatch(/must be a JSON object/)
    expect(index.rules[0].fields).toHaveLength(2)
    expect(asString(index.rules[1].parent)).toBe('model_call')
  })

  it('marks a rule whose fields are not an object, and one that is not an object', () => {
    const badFields = indexDocument('{"rules": [{"id": "a", "fields": []}]}')
    expect(badFields.malformed[0].reason).toMatch(/fields must be a JSON object/)
    const badRule = indexDocument('{"rules": ["nope"]}')
    expect(badRule.rules[0].malformed).toMatch(/a rule must be a JSON object/)
  })

  it('reports duplicate keys instead of choosing one of them', () => {
    const index = indexDocument('{"rules": [{"id": "a", "id": "b", "fields": {}}]}')
    expect(index.duplicates).toEqual([['rules', 0]])
    expect(index.rules[0].id.raw).toBeNull() // unaddressable, not "the last one"
  })

  it('tells a missing container from a malformed one, everywhere it indexes one', () => {
    // every one of these is present but of the wrong JSON type: none of them is "absent", and none
    // may be silently replaced by a control that thinks it is creating the section
    const index = indexDocument(`{
      "rules": [
        {
          "id": "r",
          "entity": "session",
          "where": {"path": "$"},
          "native_key": "id",
          "fields": {
            "external_id": { "path": "$.a", "transforms": {"trim": {"extension": 9007199254740993}} },
            "other": { "paths": {"0": "$.b"} }
          }
        }
      ],
      "unmapped": {"path": "$.x"}
    }`)
    const rule = index.rules[0]
    const [external, other] = rule.fields
    expect(external.transforms).toBeNull()
    expect(external.transformsProblem).toMatch(/transforms must be a JSON array/)
    expect(other.source.paths).toBeNull()
    expect(other.pathsProblem).toMatch(/paths must be a JSON array/)
    expect(rule.where).toBeNull()
    expect(rule.whereProblem).toMatch(/where must be a JSON array/)
    expect(rule.nativeKeyProblem).toMatch(/native_key must be a JSON array/)
    expect(rule.nativeKey.present).toBe(true)
    // each one is also listed for the document, so the repair view can be reached from the top
    const reasons = index.malformed.map(entry => entry.reason).join(' | ')
    expect(reasons).toMatch(/transforms/)
    expect(reasons).toMatch(/paths/)
    expect(reasons).toMatch(/where/)
    expect(reasons).toMatch(/native_key/)
    expect(reasons).toMatch(/unmapped/)
  })

  it('leaves an absent container absent, with no problem attached', () => {
    const index = indexDocument('{"rules": [{"id": "r", "entity": "session", "fields": {"external_id": {"path": "$.a"}}}]}')
    const rule = index.rules[0]
    expect(rule.where).toBeNull()
    expect(rule.whereProblem).toBeNull()
    expect(rule.nativeKey.present).toBe(false)
    expect(rule.nativeKeyProblem).toBeNull()
    expect(rule.fields[0].transforms).toBeNull()
    expect(rule.fields[0].transformsProblem).toBeNull()
    expect(index.malformed).toEqual([])
  })

  it('reports very deep nesting as a repair, not as a crash', () => {
    const deep = `{"extra":${'['.repeat(4000)}0${']'.repeat(4000)}}`
    expect(() => JSON.parse(deep)).not.toThrow() // the browser itself accepts it
    const index = indexDocument(deep)
    expect(index.ok).toBe(false)
    expect(index.problem).toMatch(/nested|deep/i)
  })

  it('says why a document cannot be shown as rows at all', () => {
    expect(indexDocument('').problem).toMatch(/empty/)
    expect(indexDocument('[1]').problem).toMatch(/must be a JSON object/)
    const broken = indexDocument('{"a": 01}')
    expect(broken.ok).toBe(false)
    expect(broken.offset).toBeGreaterThan(0)
  })
})
