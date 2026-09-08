import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MappingIssue } from '../api/types'
import { planEdits, type DocEdit } from './document'
import { indexDocument } from './documentIndex'
import { controlIdFor } from './issuePaths'
import { FieldTable } from './FieldTable'

const DOC = `{
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
      "native_key": [],
      "where": [{"path": "$.kind", "op": "eq", "value": 9007199254740993}],
      "fields": {
        "session_external_id": { "path": "$.session", "big": 9007199254740993 },
        "started_at": { "path": "$.ts", "timestamp_format": "epoch_ms", "bounds": "min", "transforms": ["trim"] },
        "broken": [1, 2]
      }
    },
    {
      "id": "tool_call",
      "entity": "tool_call",
      "parent": "model_call",
      "fields": { "session_external_id": { "literal": 1.0 } }
    }
  ],
  "unmapped": [{"path": "$.x", "reason": "no target"}],
  "notes": "drafted"
}`

const issue = (path: string, code: string, severity = 'error'): MappingIssue => ({
  stage: 'semantic', path, code, message: `${code} at ${path}`, severity,
})

function show(text = DOC, issues: MappingIssue[] | null = null) {
  const onEdit = vi.fn<(edits: DocEdit[], identity?: { name: string; source: string }) => void>()
  const onOpenJson = vi.fn()
  const onRefuse = vi.fn()
  const table = (source: string) => (
    <FieldTable
      index={indexDocument(source)}
      identity={{ name: 'epoch-assist', source: 'assist' }}
      issues={issues}
      current
      disabled={false}
      onEdit={onEdit}
      onRefuse={onRefuse}
      onOpenJson={onOpenJson}
    />
  )
  const { rerender } = render(table(text))
  /** What the page does after an edit: index the new text and render the table from it. */
  const rerenderWith = (next: string) => rerender(table(next))
  const apply = (call = 0) => {
    const planned = planEdits(text, onEdit.mock.calls[call][0])
    if ('problem' in planned) throw new Error(planned.problem)
    return planned.text
  }
  return { onEdit, onOpenJson, onRefuse, apply, rerenderWith }
}

describe('the field table', () => {
  it('shows the rules, their fields and the document head as written', () => {
    show()
    expect(screen.getByRole('region', { name: 'Rule model_call' })).toHaveTextContent('3 fields · 1 invalid')
    expect(screen.getByLabelText('path of session_external_id in model_call')).toHaveValue('$.session')
    expect(screen.getByLabelText('literal of session_external_id in tool_call')).toHaveValue('1.0')
    expect(screen.getByLabelText('Mapping name in the document')).toHaveValue('epoch-assist')
    expect(screen.getByLabelText('Notes')).toHaveValue('drafted')
    expect(screen.getByLabelText('unmapped reason 1')).toHaveValue('no target')
    // a key the DSL does not name is kept and shown, never dropped
    const modelCall = within(screen.getByRole('region', { name: 'Rule model_call' }))
    expect(modelCall.getByRole('row', { name: 'session_external_id transforms and options' })).toHaveTextContent('big: 9007199254740993')
  })

  it('edits every closed option through the planner, and "not set" removes the member', () => {
    const { onEdit, apply } = show()
    fireEvent.change(screen.getByLabelText('timestamp_format of started_at in model_call'), { target: { value: 'epoch_s' } })
    expect(onEdit.mock.calls[0][0]).toEqual([
      { op: 'set', path: ['rules', 0, 'fields', 'started_at', 'timestamp_format'], raw: '"epoch_s"' },
    ])
    expect(apply()).toContain('"timestamp_format": "epoch_s"')
    expect(apply()).toContain('9007199254740993')

    fireEvent.change(screen.getByLabelText('bounds of started_at in model_call'), { target: { value: '' } })
    expect(onEdit.mock.calls[1][0]).toEqual([{ op: 'remove', path: ['rules', 0, 'fields', 'started_at', 'bounds'] }])
    expect(apply(1)).not.toContain('bounds')

    fireEvent.change(screen.getByLabelText('type of started_at in model_call'), { target: { value: 'timestamp' } })
    fireEvent.change(screen.getByLabelText('empty_as_missing of started_at in model_call'), { target: { value: 'true' } })
    fireEvent.change(screen.getByLabelText('on_invalid of started_at in model_call'), { target: { value: 'reject' } })
    expect(onEdit.mock.calls[3][0]).toEqual([
      { op: 'set', path: ['rules', 0, 'fields', 'started_at', 'empty_as_missing'], raw: 'true' },
    ]) // a boolean member, not the string "true"
    expect(apply(3)).toContain('"empty_as_missing": true')
    expect(apply(4)).toContain('"on_invalid": "reject"')
  })

  it('tells a policy from a string that merely looks like one', () => {
    // on_missing: null is the JSON null, which the parser refuses; "null" is the policy
    const wrong = DOC.replace('"bounds": "min"', '"on_missing": null, "empty_as_missing": "false"')
    const { onEdit, onOpenJson } = show(wrong)
    const policy = screen.getByLabelText('on_missing of started_at in model_call') as HTMLSelectElement
    expect(policy.value).toBe('') // not the "null" policy: this document says something else
    expect(policy).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByText(/not a valid value/).length).toBeGreaterThan(0)
    const flag = screen.getByLabelText('empty_as_missing of started_at in model_call') as HTMLSelectElement
    expect(flag.value).toBe('') // the string "false" is not the boolean false
    // choosing the policy repairs the type
    fireEvent.change(policy, { target: { value: 'null' } })
    expect(onEdit.mock.calls[0][0]).toEqual([
      { op: 'set', path: ['rules', 0, 'fields', 'started_at', 'on_missing'], raw: '"null"' },
    ])
    fireEvent.change(flag, { target: { value: 'false' } })
    expect(onEdit.mock.calls[1][0]).toEqual([
      { op: 'set', path: ['rules', 0, 'fields', 'started_at', 'empty_as_missing'], raw: 'false' },
    ])
    expect(onOpenJson).not.toHaveBeenCalled()
  })

  it('keeps a well-typed policy selected', () => {
    const right = DOC.replace('"bounds": "min"', '"on_missing": "null", "empty_as_missing": false')
    show(right)
    expect((screen.getByLabelText('on_missing of started_at in model_call') as HTMLSelectElement).value).toBe('null')
    expect((screen.getByLabelText('empty_as_missing of started_at in model_call') as HTMLSelectElement).value).toBe('false')
  })

  it('creates a unit pair from two empty selects, writing once both halves are known', () => {
    const { onEdit, apply } = show()
    // the field has no unit at all: picking one half must be remembered, not thrown away
    fireEvent.change(screen.getByLabelText('unit from of started_at in model_call'), { target: { value: 's' } })
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('unit from of started_at in model_call')).toHaveValue('s')
    fireEvent.change(screen.getByLabelText('unit to of started_at in model_call'), { target: { value: 'ms' } })
    expect(onEdit.mock.calls[0][0]).toEqual([
      { op: 'set', path: ['rules', 0, 'fields', 'started_at', 'unit'], raw: '{"from":"s","to":"ms"}' },
    ])
    expect(apply()).toContain('"unit": {"from":"s","to":"ms"}')
  })

  it('edits one half of an existing unit without touching the rest of it', () => {
    const withUnit = DOC.replace('"bounds": "min"', '"unit": {"from": "s", "to": "ms", "extension": 9007199254740993}')
    const { onEdit, apply } = show(withUnit)
    fireEvent.change(screen.getByLabelText('unit from of started_at in model_call'), { target: { value: 'us' } })
    expect(onEdit.mock.calls[0][0]).toEqual([
      { op: 'set', path: ['rules', 0, 'fields', 'started_at', 'unit', 'from'], raw: '"us"' },
    ])
    const next = apply()
    expect(next).toContain('"from": "us"')
    expect(next).toContain('"extension": 9007199254740993') // a member no control owns survives
    expect(next).toContain('"to": "ms"')
  })

  it('completes a partial unit without touching what else it holds', () => {
    const partial = DOC.replace('"bounds": "min"', '"unit": {"from": "s", "extension": 9007199254740993}')
    const { onEdit, apply } = show(partial)
    fireEvent.change(screen.getByLabelText('unit to of started_at in model_call'), { target: { value: 'ms' } })
    expect(onEdit.mock.calls[0][0]).toEqual([
      { op: 'set', path: ['rules', 0, 'fields', 'started_at', 'unit', 'to'], raw: '"ms"' },
    ])
    const next = apply()
    expect(next).toContain('"extension": 9007199254740993')
    expect(next).toContain('"to": "ms"')
    expect(next).toContain('"from": "s"')
  })

  it('clears one half of a unit that holds more, and only the whole one when it holds nothing else', () => {
    const rich = DOC.replace('"bounds": "min"', '"unit": {"from": "s", "to": "ms", "extension": 1}')
    const { onEdit, apply } = show(rich)
    fireEvent.change(screen.getByLabelText('unit from of started_at in model_call'), { target: { value: '' } })
    expect(onEdit.mock.calls[0][0]).toEqual([
      { op: 'remove', path: ['rules', 0, 'fields', 'started_at', 'unit', 'from'] },
    ])
    expect(apply()).toContain('"extension": 1')
  })

  it('removes the whole unit when a half goes back to "not set"', () => {
    const withUnit = DOC.replace('"bounds": "min"', '"unit": {"from": "s", "to": "ms"}')
    const { onEdit, apply } = show(withUnit)
    fireEvent.change(screen.getByLabelText('unit to of started_at in model_call'), { target: { value: '' } })
    expect(onEdit.mock.calls[0][0]).toEqual([{ op: 'remove', path: ['rules', 0, 'fields', 'started_at', 'unit'] }])
    expect(apply()).not.toContain('unit')
  })

  it('switches the source kind in one batch that removes the others', () => {
    const { onEdit, apply } = show()
    fireEvent.change(screen.getByLabelText('source kind of session_external_id in model_call'), { target: { value: 'literal' } })
    expect(onEdit.mock.calls[0][0]).toEqual([
      { op: 'remove', path: ['rules', 0, 'fields', 'session_external_id', 'path'] },
      { op: 'set', path: ['rules', 0, 'fields', 'session_external_id', 'literal'], raw: 'null' },
    ])
    const next = apply()
    expect(next).toContain('"literal": null')
    expect(next).not.toContain('"path": "$.session"')
    expect(next).toContain('"big": 9007199254740993') // the unknown key is untouched
  })

  it('edits a transform as raw JSON and reorders it, converting neither form', () => {
    const { onEdit, apply } = show()
    fireEvent.change(screen.getByLabelText('transform 1 of started_at in model_call'), { target: { value: '{"enum_map": {"mapping": {"a": 1.0}}}' } })
    fireEvent.blur(screen.getByLabelText('transform 1 of started_at in model_call'))
    expect(apply()).toContain('{"enum_map": {"mapping": {"a": 1.0}}}')
    fireEvent.click(screen.getByRole('button', { name: 'Add a transform to started_at in model_call' }))
    expect(onEdit.mock.calls[1][0]).toEqual([
      { op: 'insert', path: ['rules', 0, 'fields', 'started_at', 'transforms'], index: 1, raw: '"trim"' },
    ])
  })

  it('edits a typed condition value as raw JSON and drops the value for exists', () => {
    const { onEdit, apply } = show()
    expect(screen.getByLabelText('condition 1 value of model_call')).toHaveValue('9007199254740993')
    fireEvent.change(screen.getByLabelText('condition 1 value of model_call'), { target: { value: '{"nested": 1.0}' } })
    fireEvent.blur(screen.getByLabelText('condition 1 value of model_call'))
    expect(apply()).toContain('"value": {"nested": 1.0}')
    fireEvent.change(screen.getByLabelText('condition 1 operator of model_call'), { target: { value: 'exists' } })
    expect(onEdit.mock.calls[1][0]).toEqual([
      { op: 'set', path: ['rules', 0, 'where', 0, 'op'], raw: '"exists"' },
      { op: 'remove', path: ['rules', 0, 'where', 0, 'value'] },
    ])
  })

  it('keeps native_key absent, declared empty and declared apart', () => {
    const { onEdit, apply } = show()
    expect(screen.getByRole('region', { name: 'Rule model_call' })).toHaveTextContent('declared empty')
    expect(screen.getByRole('region', { name: 'Rule tool_call' })).toHaveTextContent('not declared')
    fireEvent.click(screen.getByRole('button', { name: 'Undeclare the native key of model_call' }))
    expect(onEdit.mock.calls[0][0]).toEqual([{ op: 'remove', path: ['rules', 0, 'native_key'] }])
    fireEvent.click(screen.getByRole('button', { name: 'Declare a native key for tool_call' }))
    expect(onEdit.mock.calls[1][0]).toEqual([{ op: 'set', path: ['rules', 1, 'native_key'], raw: '[]' }])
    expect(apply(1)).toContain('"native_key": []')
  })

  it('offers only the parents the parser accepts, and keeps an invalid one visible', () => {
    show()
    const parent = screen.getByLabelText('parent of tool_call') as HTMLSelectElement
    expect([...parent.options].map(option => option.textContent)).toContain('model_call')
    const wrong = indexDocument(DOC.replace('"parent": "model_call"', '"parent": "nope"'))
    expect(wrong.rules[1].parent.raw).toBe('"nope"')
  })

  it('renames a target in place, keeping its mapping', () => {
    const typo = DOC.replace('"started_at"', '"start_at"')
    const { onEdit, onRefuse, apply } = show(typo)
    const target = screen.getByLabelText('target of start_at in model_call')
    fireEvent.change(target, { target: { value: 'started_at' } })
    fireEvent.blur(target)
    expect(onEdit.mock.calls[0][0]).toEqual([
      { op: 'rename', path: ['rules', 0, 'fields', 'start_at'], key: 'started_at' },
    ])
    const next = apply()
    expect(next).toContain('"started_at": { "path": "$.ts"') // the mapping came with the name
    expect(onRefuse).not.toHaveBeenCalled()
  })

  it('refuses a rename onto a name the rule already has', () => {
    const { onEdit, onRefuse } = show()
    const target = screen.getByLabelText('target of started_at in model_call')
    fireEvent.change(target, { target: { value: 'session_external_id' } })
    fireEvent.blur(target)
    expect(onRefuse).toHaveBeenCalledWith(expect.stringContaining('session_external_id'))
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('mounts a control for every id an issue can resolve to', () => {
    const withUnit = DOC.replace('"bounds": "min"', '"unit": {"from": "s", "to": "ms"}')
    show(withUnit, [
      issue('rules[0].fields', 'required_field_unmapped'),
      issue('rules[0].fields.started_at.unit', 'unit_target_mismatch'),
      issue('rules[0].where', 'invalid_type'),
      issue('rules[0].native_key', 'invalid_type'),
    ])
    for (const path of ['rules[0].fields', 'rules[0].fields.started_at.unit', 'rules[0].where', 'rules[0].native_key']) {
      const id = controlIdFor(path, indexDocument(withUnit))
      expect(id, path).not.toBeNull()
      expect(document.getElementById(id!), `${path} -> ${id}`).not.toBeNull()
    }
  })

  it('never offers a parent the parser would refuse', () => {
    // only a tool_call may declare a parent (parser.py:304-333): a session must be offered none,
    // however many root model_call rules precede it
    const wrong = `{
      "rules": [
        { "id": "calls", "entity": "model_call", "select": "$", "fields": { "session_external_id": { "path": "$.s" } } },
        { "id": "sessions", "entity": "session", "fields": { "external_id": { "path": "$.s" } } },
        { "id": "tools", "entity": "tool_call", "fields": { "session_external_id": { "path": "$.s" } } }
      ]
    }`
    show(wrong)
    const session = screen.getByLabelText('parent of sessions') as HTMLSelectElement
    expect([...session.options].map(option => option.value)).toEqual([''])
    expect(session).toBeDisabled()
    const tool = screen.getByLabelText('parent of tools') as HTMLSelectElement
    expect([...tool.options].map(option => option.value)).toEqual(['', 'calls'])
  })

  it('refuses a rename or a delete that would break a parent reference', () => {
    const { onEdit, onRefuse } = show()
    const id = screen.getByLabelText('id of model_call')
    fireEvent.change(id, { target: { value: 'renamed' } })
    fireEvent.blur(id)
    expect(onRefuse).toHaveBeenCalledWith(expect.stringContaining('is the parent of tool_call'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete model_call' }))
    expect(onRefuse).toHaveBeenCalledTimes(2)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('adds a rule that is already legal, and a named field', () => {
    const { onEdit, apply } = show()
    fireEvent.click(screen.getByRole('button', { name: 'session' }))
    expect(apply()).toContain('"external_id"')
    fireEvent.click(screen.getByRole('button', { name: 'Add a field to model_call' }))
    fireEvent.change(screen.getByLabelText('Name of the new field in model_call'), { target: { value: 'provider' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onEdit.mock.calls[1][0]).toEqual([
      { op: 'set', path: ['rules', 0, 'fields', 'provider'], raw: '{"path": "$.change_me"}' },
    ])
    expect(apply(1)).toContain('"provider": {"path": "$.change_me"}')
  })

  it('writes the identity with the document when the name changes', () => {
    const { onEdit } = show()
    const name = screen.getByLabelText('Mapping name in the document')
    fireEvent.change(name, { target: { value: 'renamed' } })
    fireEvent.blur(name)
    expect(onEdit).toHaveBeenCalledWith(
      [{ op: 'set', path: ['name'], raw: '"renamed"' }],
      { name: 'renamed', source: 'assist' },
    )
  })

  it('never offers to create a section that exists but is malformed', () => {
    const broken = DOC.replace('"transforms": ["trim"]', '"transforms": {"trim": {"extension": 9007199254740993}}')
    const { onEdit, onOpenJson } = show(broken)
    // "Add a transform" would replace the whole section with ["trim"] and lose what is there
    expect(screen.queryByRole('button', { name: 'Add a transform to started_at in model_call' })).not.toBeInTheDocument()
    const row = screen.getByRole('row', { name: 'started_at transforms and options' })
    expect(row).toHaveTextContent('transforms must be a JSON array')
    fireEvent.click(within(row).getByRole('button', { name: /Repair transforms of started_at/ }))
    expect(onOpenJson).toHaveBeenCalledWith(['rules', 0, 'fields', 'started_at', 'transforms'])
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('routes a malformed where or native_key to the JSON view too', () => {
    const broken = DOC
      .replace('"where": [{"path": "$.kind", "op": "eq", "value": 9007199254740993}]', '"where": {"path": "$.kind"}')
      .replace('"native_key": []', '"native_key": "id"')
    const { onEdit, onOpenJson } = show(broken)
    const rule = within(screen.getByRole('region', { name: 'Rule model_call' }))
    expect(screen.queryByRole('button', { name: 'Add a condition to model_call' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Declare a native key for model_call' })).not.toBeInTheDocument()
    expect(rule.getByText(/where must be a JSON array/)).toBeInTheDocument()
    fireEvent.click(rule.getByRole('button', { name: /Repair native_key of model_call/ }))
    expect(onOpenJson).toHaveBeenCalledWith(['rules', 0, 'native_key'])
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('offers creation only where a container is absent or an empty list', () => {
    // a malformed rules section still indexes as zero rules: "add a rule" would replace it whole
    const { onEdit, onOpenJson } = show('{"name": "x", "source": "y", "rules": {"legacy": 9007199254740993}, "unmapped": {"nope": 1}}')
    expect(screen.queryByRole('button', { name: 'session' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Declare an unmapped path' })).not.toBeInTheDocument()
    expect(screen.getByText(/rules must be a JSON array/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Repair it in the JSON view' })[0])
    expect(onOpenJson).toHaveBeenCalledWith(['rules'])
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('still offers creation when the container is absent or empty', () => {
    const { onEdit, apply } = show('{"name": "x", "source": "y", "rules": []}')
    fireEvent.click(screen.getByRole('button', { name: 'session' }))
    expect(apply()).toContain('"external_id"')
    fireEvent.click(screen.getByRole('button', { name: 'Declare an unmapped path' }))
    expect(onEdit.mock.calls[1][0][0]).toMatchObject({ op: 'set', path: ['unmapped'] })
  })

  it('sends what it cannot represent to the JSON view instead of rewriting it', () => {
    const { onOpenJson } = show()
    expect(screen.getByRole('row', { name: /^broken/ })).toHaveTextContent('a field must be a JSON object')
    fireEvent.click(screen.getAllByRole('button', { name: 'Repair it in the JSON view' })[0])
    expect(onOpenJson).toHaveBeenCalledWith(['rules', 0, 'fields', 'broken'])
  })

  it('refuses to show or edit a section with duplicate keys', () => {
    show('{"rules": [{"id": "a", "id": "b", "fields": {}}]}')
    expect(screen.getByRole('status')).toHaveTextContent('declare the same key twice')
  })
})

describe('the field table, for keyboard and screen-reader users', () => {
  it('names every control and describes the invalid ones', () => {
    show(DOC, [
      issue('rules[0].fields.started_at.bounds', 'bounds_not_applicable'),
      issue('rules[0].fields', 'required_field_unmapped'),
    ])
    const bounds = screen.getByLabelText('bounds of started_at in model_call')
    expect(bounds).toHaveAttribute('aria-invalid', 'true')
    const describedBy = bounds.getAttribute('aria-describedby')!
    expect(document.getElementById(describedBy)).toHaveTextContent('bounds_not_applicable')
    // an issue with no control of its own stays on the rule
    expect(screen.getByRole('list', { name: 'Issues of model_call' })).toHaveTextContent('required_field_unmapped')
    // the control ids are the ones the resolver builds, so a jump can find them
    expect(bounds).toHaveAttribute('id', 'ctl-r0-fstarted_at-opt-bounds')
  })

  it('gives every icon-only control an accessible name and a visible tooltip', () => {
    show()
    for (const button of screen.getAllByRole('button')) {
      const name = button.getAttribute('aria-label')
      if (name === null) continue // the labelled text buttons (Add, Cancel, session…)
      expect(button.getAttribute('data-tip'), name).toBe(name)
    }
  })

  it('reaches every control of a row with the keyboard', () => {
    show()
    // a field is two table lines: its source and issues, then its transforms and options
    const lines = [
      screen.getAllByRole('row', { name: /^started_at/ })[0],
      screen.getByRole('row', { name: 'started_at transforms and options' }),
    ]
    const focusable = lines
      .flatMap(row => within(row).queryAllByRole('textbox').concat(within(row).queryAllByRole('combobox'), within(row).queryAllByRole('button')))
      .filter(control => !(control as HTMLButtonElement).disabled)
    expect(focusable.length).toBeGreaterThan(8)
    for (const control of focusable) {
      control.focus()
      expect(document.activeElement).toBe(control)
      expect(control.getAttribute('tabindex')).not.toBe('-1')
    }
  })

  it('keeps focus on the control after the edit is applied and the row re-renders', () => {
    const { onEdit, rerenderWith } = show()
    const select = screen.getByLabelText('timestamp_format of started_at in model_call')
    select.focus()
    fireEvent.change(select, { target: { value: 'epoch_s' } })
    // the page applies the batch and hands the table a new index: that is the render that could
    // remount the row and lose the focus, so it is the one this test has to perform
    const planned = planEdits(DOC, onEdit.mock.calls[0][0])
    if ('problem' in planned) throw new Error(planned.problem)
    rerenderWith(planned.text)
    const after = screen.getByLabelText('timestamp_format of started_at in model_call')
    expect(after).toHaveValue('epoch_s')
    expect(document.activeElement).toBe(after)
  })

  it('lets a raw value be typed one keystroke at a time without writing rubbish', () => {
    const { onEdit } = show()
    const input = screen.getByLabelText('condition 1 value of model_call')
    input.focus()
    for (const draft of ['-', '-1', '-1e', '-1e3']) {
      fireEvent.change(input, { target: { value: draft } })
      expect(document.activeElement).toBe(input)
    }
    expect(onEdit).not.toHaveBeenCalled() // nothing is written while the draft is incomplete
    fireEvent.blur(input)
    expect(onEdit.mock.calls[0][0]).toEqual([{ op: 'set', path: ['rules', 0, 'where', 0, 'value'], raw: '-1e3' }])
  })

  it('puts an incomplete draft back rather than writing it', () => {
    const { onEdit } = show()
    const input = screen.getByLabelText('condition 1 value of model_call')
    fireEvent.change(input, { target: { value: '{"a":' } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    fireEvent.blur(input)
    expect(onEdit).not.toHaveBeenCalled()
    expect(input).toHaveValue('9007199254740993')
  })
})
