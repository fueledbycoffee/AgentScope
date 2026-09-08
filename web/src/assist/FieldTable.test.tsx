import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MappingIssue } from '../api/types'
import { planEdits, type DocEdit } from './document'
import { indexDocument } from './documentIndex'
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
  render(
    <FieldTable
      index={indexDocument(text)}
      identity={{ name: 'epoch-assist', source: 'assist' }}
      issues={issues}
      current
      disabled={false}
      onEdit={onEdit}
      onRefuse={onRefuse}
      onOpenJson={onOpenJson}
    />,
  )
  const apply = (call = 0) => {
    const planned = planEdits(text, onEdit.mock.calls[call][0])
    if ('problem' in planned) throw new Error(planned.problem)
    return planned.text
  }
  return { onEdit, onOpenJson, onRefuse, apply }
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

  it('writes unit only once both halves are chosen', () => {
    const { onEdit } = show()
    fireEvent.change(screen.getByLabelText('unit from of started_at in model_call'), { target: { value: 's' } })
    expect(onEdit.mock.calls[0][0]).toEqual([]) // half a unit is not a unit
    fireEvent.change(screen.getByLabelText('unit to of started_at in model_call'), { target: { value: 'ms' } })
    expect(onEdit.mock.calls[1][0]).toEqual([]) // still half: the other select has not been committed
    const withUnit = indexDocument(DOC.replace('"bounds": "min"', '"unit": {"from": "s", "to": "ms"}'))
    expect(withUnit.rules[0].fields[1].unit.from.raw).toBe('"s"')
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

  it('keeps focus on the control after an edit re-renders its row', () => {
    const { onEdit } = show()
    const select = screen.getByLabelText('timestamp_format of started_at in model_call')
    select.focus()
    fireEvent.change(select, { target: { value: 'epoch_s' } })
    expect(onEdit).toHaveBeenCalled()
    // the row re-renders from the new text; the same control keeps the focus
    expect(document.activeElement).toBe(screen.getByLabelText('timestamp_format of started_at in model_call'))
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
