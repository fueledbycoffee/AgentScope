import { Fragment, useState } from 'react'
import type { MappingIssue } from '../api/types'
import { IconButton } from '../components'
import type { DocEdit, DocPath } from './document'
import { asString, type DocIndex, type FieldView, type RuleView } from './documentIndex'
import { DocumentHead } from './DocumentHead'
import { OptionsCell, SourceCell, TransformsCell, type CellContext } from './FieldCells'
import { controlId, controlIdFor, resolveIssue } from './issuePaths'
import { TextValueInput } from './RawJsonInput'
import { referrers } from './dsl'
import { RuleHeader } from './RuleHeader'

export interface FieldTableProps {
  index: DocIndex
  identity: { name: string; source: string }
  issues: MappingIssue[] | null
  /** True when the issues describe the text on screen. */
  current: boolean
  disabled: boolean
  onEdit: (edits: DocEdit[], identity?: { name: string; source: string }) => void
  /** Say why a change was refused (a broken reference, a name already taken). */
  onRefuse: (reason: string) => void
  /** Open the JSON view at this document path (a section the table cannot represent). */
  onOpenJson: (path: DocPath) => void
}

/** A new rule that is legal the moment it exists: an entity and its required identity field. */
const SEEDS: Record<string, { entity: string; field: string }> = {
  session: { entity: 'session', field: 'external_id' },
  model_call: { entity: 'model_call', field: 'session_external_id' },
  tool_call: { entity: 'tool_call', field: 'session_external_id' },
}

/**
 * The document's rules as rows over the canonical text. Every cell shows the exact source text at
 * its path, and every edit leaves as an edit batch for the planner: nothing here rebuilds a
 * document, so an untouched member keeps its bytes.
 */
export function FieldTable({ index, identity, issues, current, disabled, onEdit, onRefuse, onOpenJson }: FieldTableProps) {
  const [adding, setAdding] = useState<{ rule: RuleView; name: string } | null>(null)
  const shown = current ? (issues ?? []) : []

  // an issue is attached to the control that owns it, for aria-invalid and aria-describedby
  const byControl = new Map<string, MappingIssue[]>()
  for (const issue of shown) {
    const id = controlIdFor(issue.path, index)
    if (id !== null) byControl.set(id, [...(byControl.get(id) ?? []), issue])
  }
  const issueId = (id: string | null | undefined) => (id != null && byControl.has(id) ? `${id}-issue` : undefined)

  const issuesFor = (ruleIndex: number, field?: string) =>
    shown.filter(issue => {
      const control = resolveIssue(issue.path, index)
      if (!('ruleIndex' in control) || control.ruleIndex !== ruleIndex) return false
      return field === undefined ? !('field' in control) : 'field' in control && control.field === field
    })

  const contextFor = (rule: RuleView, field: FieldView): CellContext => ({
    ruleName: asString(rule.id) ?? `rule ${rule.index + 1}`,
    disabled,
    onEdit: edits => onEdit(edits),
    onOpenJson,
    issueId,
    idFor: (part, extra) =>
      (part === 'opt'
        ? controlId({ kind: 'field-option', ruleIndex: rule.index, field: field.name, option: extra as never })
        : part === 'src'
          ? controlId({ kind: 'field-source', ruleIndex: rule.index, field: field.name, part: (extra ?? 'path') as 'path' })
          : controlId({ kind: 'transform', ruleIndex: rule.index, field: field.name, index: Number(extra) })) ?? '',
  })

  function addRule(entity: string) {
    const seed = SEEDS[entity]
    const taken = new Set(index.rules.map(rule => asString(rule.id)))
    let id = seed.entity
    for (let n = 2; taken.has(id); n += 1) id = `${seed.entity}_${n}`
    const rule = { id, entity: seed.entity, select: '$', fields: { [seed.field]: { path: '$.change_me' } } }
    onEdit(
      index.rules.length === 0
        ? [{ op: 'set', path: ['rules'], raw: JSON.stringify([rule]) }]
        : [{ op: 'insert', path: ['rules'], index: index.rules.length, raw: JSON.stringify(rule) }],
    )
  }

  function deleteRule(rule: RuleView) {
    const held = referrers(index, asString(rule.id))
    if (held.length > 0) {
      onRefuse(
        `${asString(rule.id) ?? `rule ${rule.index + 1}`} is the parent of ${held
          .map(other => asString(other.id) ?? `rule ${other.index + 1}`)
          .join(', ')}. Change those references first; deleting it here would leave them pointing at nothing.`,
      )
      return
    }
    onEdit([{ op: 'remove', path: rule.path }])
  }

  function renameField(rule: RuleView, field: FieldView, name: string) {
    const trimmed = name.trim()
    if (trimmed === '' || trimmed === field.name) return
    if (rule.fields.some(other => other.name === trimmed)) {
      onRefuse(`${asString(rule.id) ?? 'this rule'} already has a field named ${trimmed}, so ${field.name} was left as it is.`)
      return
    }
    onEdit([{ op: 'rename', path: field.path, key: trimmed }])
  }

  function addField(rule: RuleView, name: string) {
    const trimmed = name.trim()
    if (trimmed === '') return
    if (rule.fields.some(field => field.name === trimmed)) {
      onRefuse(`${asString(rule.id) ?? 'this rule'} already has a field named ${trimmed}.`)
      return
    }
    const fieldsPath: DocPath = [...rule.path, 'fields']
    onEdit(
      rule.fields.length === 0 && index.malformed.every(entry => String(entry.path.at(-1)) !== 'fields')
        ? [{ op: 'set', path: fieldsPath, raw: JSON.stringify({ [trimmed]: { path: '$.change_me' } }) }]
        : [{ op: 'set', path: [...fieldsPath, trimmed], raw: '{"path": "$.change_me"}' }],
    )
    setAdding(null)
  }

  return (
    <div className="field-table">
      <DocumentHead index={index} identity={identity} disabled={disabled} onEdit={onEdit} issueId={issueId} />

      {index.duplicates.length > 0 && (
        <p className="notice warn" role="status">
          {index.duplicates.length} section{index.duplicates.length === 1 ? '' : 's'} of this document
          declare the same key twice. JSON keeps the last one, so nothing here can safely show or edit
          them: repair them in the JSON view.
        </p>
      )}
      {index.malformed.map(entry => (
        <p key={String(entry.path)} className="issue error">
          {entry.reason}.{' '}
          <button type="button" className="link" onClick={() => onOpenJson(entry.path)}>Repair it in the JSON view</button>.
        </p>
      ))}

      {index.rules.length === 0 && index.rulesProblem === null && (
        <p className="state-block">No rules yet: add one, or ask the assistant to propose the mapping.</p>
      )}

      {index.rules.map(rule => {
        const ruleName = asString(rule.id) ?? `rule ${rule.index + 1}`
        const invalid = rule.fields.filter(field => field.malformed !== null).length
        const ruleIssues = issuesFor(rule.index)
        return (
          <section key={rule.index} className="rule" aria-label={`Rule ${ruleName}`}>
            <div className="panel-head">
              <h3>
                {ruleName} <span className="muted mono">{asString(rule.entity) ?? 'no entity'}</span>
              </h3>
              <span className="count">
                {rule.fields.length} field{rule.fields.length === 1 ? '' : 's'}
                {invalid > 0 && ` · ${invalid} invalid`}
                {ruleIssues.length > 0 && ` · ${ruleIssues.length} issue${ruleIssues.length === 1 ? '' : 's'}`}
              </span>
              <IconButton
                name="braces"
                label={`Open ${ruleName} in the JSON view`}
                className="btn small icon-only"
                onClick={() => onOpenJson(rule.path)}
              />
              <IconButton
                name="trash"
                label={`Delete ${ruleName}`}
                className="btn small icon-only"
                disabled={disabled}
                onClick={() => deleteRule(rule)}
              />
            </div>

            {rule.malformed !== null ? (
              <p className="issue error">
                {rule.malformed}.{' '}
                <button type="button" className="link" onClick={() => onOpenJson(rule.path)}>Repair it in the JSON view</button>.
              </p>
            ) : (
              <RuleHeader
                rule={rule}
                index={index}
                disabled={disabled}
                onEdit={onEdit}
                onOpenJson={onOpenJson}
                onRefuse={onRefuse}
                onAddField={target => setAdding({ rule: target, name: '' })}
                issueId={issueId}
              />
            )}

            {ruleIssues.length > 0 && (
              <ul className="issues" aria-label={`Issues of ${ruleName}`}>
                {ruleIssues.map((issue, at) => (
                  <li key={at} id={issueId(controlIdFor(issue.path, index)) ?? undefined} className={issue.severity === 'error' ? 'issue error' : 'issue warn'}>
                    <span className="mono code">{issue.code}</span> {issue.message}
                  </li>
                ))}
              </ul>
            )}

            {adding?.rule.index === rule.index && (
              <form
                className="row add-field"
                onSubmit={event => {
                  event.preventDefault()
                  addField(rule, adding.name)
                }}
              >
                <label className="dim">
                  <span>New field</span>
                  <input
                    autoFocus
                    aria-label={`Name of the new field in ${ruleName}`}
                    value={adding.name}
                    onChange={event => setAdding({ rule, name: event.target.value })}
                  />
                </label>
                <button type="submit" className="btn small">Add</button>
                <button type="button" className="btn small" onClick={() => setAdding(null)}>Cancel</button>
              </form>
            )}

            {rule.fields.length > 0 && (
              <div className="table-wrap">
                <table className="data compact">
                  <caption className="visually-hidden">{`Fields of ${ruleName}`}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Target</th>
                      <th scope="col">Source</th>
                      <th scope="col">Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rule.fields.map(field => {
                      const fieldIssues = issuesFor(rule.index, field.name)
                      const context = contextFor(rule, field)
                      // a field is two lines: eleven controls do not fit on one at 1280 px, and a
                      // second line reads better than a table that scrolls sideways inside the page
                      return (
                        <Fragment key={field.name}>
                          <tr className="field-line" aria-label={field.name}>
                            <th scope="row" className="mono" rowSpan={field.malformed === null ? 2 : 1}>
                              {/* the name is the key: renaming it is a key rename through the
                                  planner, so the mapping travels with it untouched */}
                              <TextValueInput
                                label={`target of ${field.name} in ${ruleName}`}
                                value={JSON.stringify(field.name)}
                                disabled={disabled}
                                onCommit={raw => renameField(rule, field, JSON.parse(raw) as string)}
                              />
                              <IconButton
                                name="trash"
                                label={`Remove ${field.name} from ${ruleName}`}
                                className="btn small icon-only"
                                disabled={disabled}
                                onClick={() => onEdit([{ op: 'remove', path: field.path }])}
                              />
                            </th>
                            {field.malformed !== null ? (
                              <td colSpan={2}>
                                <span className="issue error">{field.malformed}</span>{' '}
                                <button type="button" className="link" onClick={() => onOpenJson(field.path)}>
                                  Repair it in the JSON view
                                </button>
                              </td>
                            ) : (
                              <>
                                <td><SourceCell field={field} context={context} /></td>
                                <td>
                                  {fieldIssues.length === 0 ? (
                                    <span className="muted">—</span>
                                  ) : (
                                    fieldIssues.map((issue, at) => (
                                      <span
                                        key={at}
                                        id={issueId(controlIdFor(issue.path, index)) ?? undefined}
                                        className={issue.severity === 'error' ? 'issue error' : 'issue warn'}
                                      >
                                        <span className="mono code">{issue.code}</span> {issue.message}
                                      </span>
                                    ))
                                  )}
                                </td>
                              </>
                            )}
                          </tr>
                          {field.malformed === null && (
                            <tr className="field-line-two" aria-label={`${field.name} transforms and options`}>
                              <td colSpan={2}>
                                <TransformsCell field={field} context={context} />
                                <OptionsCell field={field} context={context} />
                                {field.extras.length > 0 && (
                                  <span className="extras">
                                    {field.extras.map(extra => (
                                      <span key={String(extra.path.at(-1))} className="chip" title="a key the DSL does not name; it is kept as written">
                                        {String(extra.path.at(-1))}: {extra.raw}
                                      </span>
                                    ))}
                                  </span>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      })}

      {/* creation is offered only where there is nothing to destroy: absent, or an empty list */}
      {index.rulesProblem === null && (
        <div className="row add-rule">
          <span className="dim"><span>Add a rule</span></span>
          {Object.keys(SEEDS).map(entity => (
            <button key={entity} type="button" className="btn small" disabled={disabled} onClick={() => addRule(entity)}>
              {entity}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
