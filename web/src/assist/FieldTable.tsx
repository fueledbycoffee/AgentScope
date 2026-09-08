import type { MappingIssue } from '../api/types'
import { IconButton } from '../components'
import type { DocEdit, DocPath } from './document'
import { asString, type DocIndex, type FieldView, type Member, type RuleView } from './documentIndex'
import { controlId, resolveIssue } from './issuePaths'

/** The options this slice edits; the rest are shown as written until their controls land. */
const EDITABLE = {
  timestamp_format: ['iso8601', 'epoch_s', 'epoch_ms'],
  on_missing: ['null', 'default', 'reject'],
} as const
type EditableOption = keyof typeof EDITABLE

export interface FieldTableProps {
  index: DocIndex
  issues: MappingIssue[] | null
  /** True when the issues describe the text on screen. */
  current: boolean
  disabled: boolean
  onEdit: (edits: DocEdit[]) => void
  /** Open the JSON view at this document path (a section the table cannot represent). */
  onOpenJson: (path: DocPath) => void
}

const NOT_SET = ''

function OptionSelect({
  rule,
  field,
  option,
  member,
  disabled,
  onEdit,
}: {
  rule: RuleView
  field: FieldView
  option: EditableOption
  member: Member
  disabled: boolean
  onEdit: (edits: DocEdit[]) => void
}) {
  const ruleName = asString(rule.id) ?? `rule ${rule.index + 1}`
  const value = asString(member) ?? NOT_SET
  const known = (EDITABLE[option] as readonly string[]).includes(value)
  const id = controlId({ kind: 'field-option', ruleIndex: rule.index, field: field.name, option })
  return (
    <label className="dim">
      <span className="visually-hidden">{`${option} of ${field.name} in ${ruleName}`}</span>
      <select
        id={id ?? undefined}
        aria-label={`${option} of ${field.name} in ${ruleName}`}
        value={known ? value : NOT_SET}
        disabled={disabled}
        onChange={event => {
          const chosen = event.target.value
          onEdit([
            chosen === NOT_SET
              ? { op: 'remove', path: member.path }
              : { op: 'set', path: member.path, raw: JSON.stringify(chosen) },
          ])
        }}
      >
        <option value={NOT_SET}>{option} · not set</option>
        {EDITABLE[option].map(choice => (
          <option key={choice} value={choice}>{`${option}: ${choice}`}</option>
        ))}
        {member.raw !== null && !known && <option value={NOT_SET}>{`${option}: ${member.raw} (not editable here)`}</option>}
      </select>
    </label>
  )
}

function SourceCell({ field }: { field: FieldView }) {
  if (field.source.present.length === 0) return <span className="muted">Unavailable</span>
  return (
    <>
      {field.source.present.map(kind => (
        <span key={kind} className="mono" title={`${kind}, exactly as written`}>
          {kind === 'path' ? '' : `${kind}: `}
          {field.source.members[kind].raw}
        </span>
      ))}
      {field.source.present.length > 1 && (
        <span className="chip warn" title="the parser refuses a field with more than one source">
          {field.source.present.join(' + ')}
        </span>
      )}
    </>
  )
}

/**
 * The document's rules as rows over the canonical text. Every cell shows the exact source text at
 * its path, and every edit leaves as an edit batch for the planner: nothing here rebuilds a
 * document, so an untouched member keeps its bytes.
 */
export function FieldTable({ index, issues, current, disabled, onEdit, onOpenJson }: FieldTableProps) {
  const shown = current ? (issues ?? []) : []
  const issuesFor = (ruleIndex: number, field?: string) =>
    shown.filter(issue => {
      const control = resolveIssue(issue.path)
      if (!('ruleIndex' in control) || control.ruleIndex !== ruleIndex) return false
      return field === undefined ? !('field' in control) : 'field' in control && control.field === field
    })

  return (
    <div className="field-table">
      {index.duplicates.length > 0 && (
        <p className="notice warn" role="status">
          {index.duplicates.length} section{index.duplicates.length === 1 ? '' : 's'} of this document
          declare the same key twice. JSON keeps the last one, so nothing here can safely show or edit
          them: repair them in the JSON view.
        </p>
      )}
      {index.rules.length === 0 && <p className="state-block">No rules yet. The assistant proposes them, or you can write them in the JSON view.</p>}
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
            </div>
            {rule.malformed !== null && (
              <p className="issue error">
                {rule.malformed}. <button type="button" className="link" onClick={() => onOpenJson(rule.path)}>Repair it in the JSON view</button>.
              </p>
            )}
            {ruleIssues.length > 0 && (
              <ul className="issues" aria-label={`Issues of ${ruleName}`}>
                {ruleIssues.map((issue, at) => (
                  <li key={at} className={issue.severity === 'error' ? 'issue error' : 'issue warn'}>
                    <span className="mono code">{issue.code}</span> {issue.message}
                  </li>
                ))}
              </ul>
            )}
            {rule.fields.length > 0 && (
              <div className="table-wrap">
                <table className="data compact">
                  <caption className="visually-hidden">{`Fields of ${ruleName}`}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Target</th>
                      <th scope="col">Source</th>
                      <th scope="col">Transforms</th>
                      <th scope="col">Options</th>
                      <th scope="col">Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rule.fields.map(field => {
                      const fieldIssues = issuesFor(rule.index, field.name)
                      return (
                        <tr key={field.name}>
                          <th scope="row" className="mono">{field.name}</th>
                          <td>{field.malformed === null ? <SourceCell field={field} /> : <span className="muted">—</span>}</td>
                          <td>
                            {field.transforms === null && <span className="muted">—</span>}
                            {field.transforms?.map(transform => (
                              <span key={transform.index} className="chip mono" title={transform.raw}>
                                {transform.name ?? transform.raw}
                              </span>
                            ))}
                          </td>
                          <td>
                            {field.malformed !== null ? (
                              <>
                                <span className="issue error">{field.malformed}</span>{' '}
                                <button type="button" className="link" onClick={() => onOpenJson(field.path)}>
                                  Repair it in the JSON view
                                </button>
                              </>
                            ) : (
                              <div className="options">
                                {(Object.keys(EDITABLE) as EditableOption[]).map(option => (
                                  <OptionSelect
                                    key={option}
                                    rule={rule}
                                    field={field}
                                    option={option}
                                    member={field.options[option]}
                                    disabled={disabled}
                                    onEdit={onEdit}
                                  />
                                ))}
                                {Object.entries(field.options)
                                  .filter(([option, member]) => member.raw !== null && !(option in EDITABLE))
                                  .map(([option, member]) => (
                                    <span key={option} className="chip mono" title={`${option}, as written; its control lands with the rest of the table`}>
                                      {option}: {member.raw}
                                    </span>
                                  ))}
                                {field.extras.map(extra => (
                                  <span key={String(extra.path.at(-1))} className="chip" title="a key the DSL does not name; it is kept as written">
                                    {String(extra.path.at(-1))}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>
                            {fieldIssues.length === 0 ? (
                              <span className="muted">—</span>
                            ) : (
                              fieldIssues.map((issue, at) => (
                                <span key={at} className={issue.severity === 'error' ? 'issue error' : 'issue warn'} title={issue.message}>
                                  <span className="mono code">{issue.code}</span>
                                </span>
                              ))
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
