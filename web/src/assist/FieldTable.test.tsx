import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MappingIssue } from '../api/types'
import { planEdits, type DocEdit } from './document'
import { indexDocument } from './documentIndex'
import { FieldTable } from './FieldTable'

const DOC = `{
  "name": "epoch-assist",
  "source": "assist",
  "rules": [
    {
      "id": "model_call",
      "entity": "model_call",
      "fields": {
        "session_external_id": { "path": "$.session", "big": 9007199254740993 },
        "started_at": { "path": "$.ts", "timestamp_format": "epoch_ms", "bounds": "min" },
        "broken": [1, 2]
      }
    }
  ]
}`

const issue = (path: string, code: string, severity = 'error'): MappingIssue => ({
  stage: 'semantic', path, code, message: `${code} at ${path}`, severity,
})

function show(text = DOC, issues: MappingIssue[] | null = null) {
  const onEdit = vi.fn<(edits: DocEdit[]) => void>()
  const onOpenJson = vi.fn()
  render(
    <FieldTable
      index={indexDocument(text)}
      issues={issues}
      current
      disabled={false}
      onEdit={onEdit}
      onOpenJson={onOpenJson}
    />,
  )
  return { onEdit, onOpenJson }
}

describe('the field table', () => {
  it('shows the rules and their fields as written', () => {
    show()
    expect(screen.getByRole('region', { name: 'Rule model_call' })).toHaveTextContent('3 fields · 1 invalid')
    expect(screen.getByRole('rowheader', { name: 'started_at' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /session_external_id/ })).toHaveTextContent('"$.session"')
    // an option without a control yet is shown as written, never hidden
    expect(screen.getByRole('row', { name: /started_at/ })).toHaveTextContent('bounds: "min"')
    // a key the DSL does not name is kept and visible
    expect(screen.getByRole('row', { name: /session_external_id/ })).toHaveTextContent('big')
  })

  it('edits an option as one planner batch that removes or sets exactly one member', () => {
    const { onEdit } = show()
    fireEvent.change(screen.getByLabelText('timestamp_format of started_at in model_call'), {
      target: { value: 'epoch_s' },
    })
    expect(onEdit).toHaveBeenCalledWith([
      { op: 'set', path: ['rules', 0, 'fields', 'started_at', 'timestamp_format'], raw: '"epoch_s"' },
    ])

    // the batch really applies to the text, and leaves every other lexeme alone
    const planned = planEdits(DOC, onEdit.mock.calls[0][0])
    if ('problem' in planned) throw new Error(planned.problem)
    expect(planned.text).toContain('"timestamp_format": "epoch_s"')
    expect(planned.text).toContain('9007199254740993')
    expect(planned.text.replace('"epoch_s"', '"epoch_ms"')).toBe(DOC)
  })

  it('removes the member when an option goes back to "not set"', () => {
    const { onEdit } = show()
    fireEvent.change(screen.getByLabelText('timestamp_format of started_at in model_call'), { target: { value: '' } })
    expect(onEdit).toHaveBeenCalledWith([
      { op: 'remove', path: ['rules', 0, 'fields', 'started_at', 'timestamp_format'] },
    ])
    const planned = planEdits(DOC, onEdit.mock.calls[0][0])
    if ('problem' in planned) throw new Error(planned.problem)
    expect(planned.text).not.toContain('timestamp_format')
    expect(planned.text).toContain('"bounds": "min"')
  })

  it('offers an unset option without inventing a value for it', () => {
    const { onEdit } = show()
    const onMissing = screen.getByLabelText('on_missing of started_at in model_call') as HTMLSelectElement
    expect(onMissing.value).toBe('')
    fireEvent.change(onMissing, { target: { value: 'reject' } })
    expect(onEdit).toHaveBeenCalledWith([
      { op: 'set', path: ['rules', 0, 'fields', 'started_at', 'on_missing'], raw: '"reject"' },
    ])
  })

  it('sends a field it cannot represent to the JSON view instead of rewriting it', () => {
    const { onOpenJson } = show()
    const row = screen.getByRole('row', { name: /broken/ })
    expect(row).toHaveTextContent('a field must be a JSON object')
    fireEvent.click(screen.getAllByRole('button', { name: 'Repair it in the JSON view' })[0])
    expect(onOpenJson).toHaveBeenCalledWith(['rules', 0, 'fields', 'broken'])
  })

  it('refuses to show or edit a section with duplicate keys', () => {
    show('{"rules": [{"id": "a", "id": "b", "fields": {}}]}')
    expect(screen.getByRole('status')).toHaveTextContent('declare the same key twice')
  })

  it('puts each issue on its row and gives every control a name and a tooltip', () => {
    show(DOC, [
      issue('rules[0].fields.started_at.bounds', 'bounds_not_applicable'),
      issue('rules[0].fields', 'required_field_unmapped'),
    ])
    expect(screen.getByRole('row', { name: /started_at/ })).toHaveTextContent('bounds_not_applicable')
    expect(screen.getByRole('list', { name: 'Issues of model_call' })).toHaveTextContent('required_field_unmapped')
    const open = screen.getByRole('button', { name: 'Open model_call in the JSON view' })
    expect(open).toHaveAttribute('data-tip', 'Open model_call in the JSON view')
    // the control an issue points at carries the id the resolver builds
    expect(screen.getByLabelText('timestamp_format of started_at in model_call'))
      .toHaveAttribute('id', 'ctl-r0-fstarted_at-opt-timestamp_format')
  })

  it('says so, rather than showing an empty table, when there are no rules', () => {
    show('{"name": "x", "source": "y"}')
    expect(screen.getByText(/No rules yet/)).toBeInTheDocument()
  })
})
