import { IconButton } from '../components'
import type { DocEdit } from './document'
import { asString, type DocIndex, type RuleView } from './documentIndex'
import { CONDITION_OPS, ENTITIES, parentChoices, referrers, VALUELESS_OPS } from './dsl'
import { controlId } from './issuePaths'
import { RawJsonInput, TextValueInput } from './RawJsonInput'


export interface RuleHeaderProps {
  rule: RuleView
  index: DocIndex
  disabled: boolean
  onEdit: (edits: DocEdit[]) => void
  onRefuse: (reason: string) => void
  onAddField: (rule: RuleView) => void
  issueId: (id: string | null) => string | undefined
}


/**
 * The rule's own declarations: id, entity, select, parent, native_key and its `where` conditions.
 *
 * A rename or a delete that would break a `parent` reference is refused with the rules that hold
 * it, rather than cascading silently: references are the user's to change, and the refusal names
 * exactly what to change.
 */
export function RuleHeader({ rule, index, disabled, onEdit, onRefuse, onAddField, issueId }: RuleHeaderProps) {
  const id = asString(rule.id)
  const name = id ?? `rule ${rule.index + 1}`
  const ctl = (part: 'id' | 'entity' | 'select' | 'parent' | 'native_key' | 'where') =>
    controlId({ kind: 'rule', ruleIndex: rule.index, part })
  const entity = asString(rule.entity) ?? ''
  const held = referrers(index, id)

  const parents = parentChoices(index, rule)
  const parentValue = asString(rule.parent) ?? ''
  const parentKnown = parents.some(other => asString(other.id) === parentValue)

  const rename = (next: string) => {
    if (next === id) return
    if (held.length > 0) {
      onRefuse(
        `${name} is the parent of ${held.map(other => asString(other.id) ?? `rule ${other.index + 1}`).join(', ')}. ` +
          'Change those references first: renaming it here would leave them pointing at a rule that no longer exists.',
      )
      return
    }
    onEdit([{ op: 'set', path: [...rule.path, 'id'], raw: JSON.stringify(next) }])
  }

  const conditions = rule.where ?? []

  return (
    <div className="rule-head">
      <div className="row">
        <label className="dim">
          <span>Rule id</span>
          <TextValueInput
            id={ctl('id') ?? undefined}
            label={`id of ${name}`}
            value={rule.id.raw}
            disabled={disabled}
            describedBy={issueId(ctl('id'))}
            invalid={issueId(ctl('id')) !== undefined}
            onCommit={raw => rename(JSON.parse(raw) as string)}
          />
        </label>
        <label className="dim">
          <span>Entity</span>
          <select
            id={ctl('entity') ?? undefined}
            className="option"
            aria-label={`entity of ${name}`}
            aria-describedby={issueId(ctl('entity'))}
            value={ENTITIES.includes(entity as (typeof ENTITIES)[number]) ? entity : ''}
            disabled={disabled}
            onChange={event =>
              onEdit([
                event.target.value === ''
                  ? { op: 'remove', path: [...rule.path, 'entity'] }
                  : { op: 'set', path: [...rule.path, 'entity'], raw: JSON.stringify(event.target.value) },
              ])
            }
          >
            <option value="">not set</option>
            {ENTITIES.map(choice => (
              <option key={choice} value={choice}>{choice}</option>
            ))}
          </select>
        </label>
        <label className="dim">
          <span>Select</span>
          <TextValueInput
            id={ctl('select') ?? undefined}
            label={`select of ${name}`}
            value={rule.select.raw}
            disabled={disabled}
            placeholder="$"
            describedBy={issueId(ctl('select'))}
            onCommit={raw => onEdit([{ op: 'set', path: [...rule.path, 'select'], raw }])}
          />
        </label>
        <label className="dim">
          <span>Parent</span>
          <select
            id={ctl('parent') ?? undefined}
            className="option"
            aria-label={`parent of ${name}`}
            aria-invalid={rule.parent.raw !== null && !parentKnown ? true : undefined}
            aria-describedby={issueId(ctl('parent'))}
            value={parentKnown ? parentValue : ''}
            disabled={disabled}
            onChange={event =>
              onEdit([
                event.target.value === ''
                  ? { op: 'remove', path: [...rule.path, 'parent'] }
                  : { op: 'set', path: [...rule.path, 'parent'], raw: JSON.stringify(event.target.value) },
              ])
            }
          >
            <option value="">no parent</option>
            {parents.map(other => (
              <option key={other.index} value={asString(other.id) ?? ''}>{asString(other.id)}</option>
            ))}
            {rule.parent.raw !== null && !parentKnown && (
              <option value="">{`${rule.parent.raw} — kept, but no rule before this one declares it`}</option>
            )}
          </select>
        </label>
      </div>

      <div className="row">
        <span className="dim">
          <span>Native key</span>
          {!rule.nativeKey.present ? (
            <>
              <span className="muted">not declared</span>
              <IconButton
                name="plus"
                label={`Declare a native key for ${name}`}
                className="btn small icon-only"
                disabled={disabled}
                onClick={() => onEdit([{ op: 'set', path: [...rule.path, 'native_key'], raw: '[]' }])}
              />
            </>
          ) : (
            <>
              {rule.nativeKey.items.length === 0 && <span className="muted">declared empty</span>}
              {rule.nativeKey.items.map((item, at) => (
                <span key={at} className="path-entry">
                  <TextValueInput
                    label={`native key ${at + 1} of ${name}`}
                    value={item.raw}
                    disabled={disabled}
                    onCommit={raw => onEdit([{ op: 'set', path: item.path, raw }])}
                  />
                  <IconButton
                    name="trash"
                    label={`Remove native key ${at + 1} of ${name}`}
                    className="btn small icon-only"
                    disabled={disabled}
                    onClick={() => onEdit([{ op: 'remove', path: item.path }])}
                  />
                </span>
              ))}
              <IconButton
                name="plus"
                label={`Add a native key part to ${name}`}
                className="btn small icon-only"
                disabled={disabled}
                onClick={() =>
                  onEdit([{ op: 'insert', path: [...rule.path, 'native_key'], index: rule.nativeKey.items.length, raw: '""' }])
                }
              />
              <IconButton
                name="x"
                label={`Undeclare the native key of ${name}`}
                className="btn small icon-only"
                disabled={disabled}
                onClick={() => onEdit([{ op: 'remove', path: [...rule.path, 'native_key'] }])}
              />
            </>
          )}
        </span>
        <IconButton
          name="plus"
          label={`Add a field to ${name}`}
          className="btn small icon-only"
          disabled={disabled}
          onClick={() => onAddField(rule)}
        />
      </div>

      <div className="conditions">
        <span className="dim"><span>Where</span>{conditions.length === 0 && <span className="muted">no conditions</span>}</span>
        {conditions.map((condition, at) => {
          const op = condition.op.raw !== null && condition.op.raw.startsWith('"') ? (JSON.parse(condition.op.raw) as string) : ''
          const conditionPath = condition.path
          const valuePath = condition.value.path
          const pathRaw = condition.pathMember.raw
          const valueRaw = condition.value.raw
          return (
            <span key={at} className="condition">
              <TextValueInput
                id={controlId({ kind: 'condition', ruleIndex: rule.index, index: at, part: 'path' }) ?? undefined}
                label={`condition ${at + 1} path of ${name}`}
                value={pathRaw}
                disabled={disabled}
                placeholder="$.field"
                describedBy={issueId(controlId({ kind: 'condition', ruleIndex: rule.index, index: at, part: 'path' }))}
                onCommit={raw => onEdit([{ op: 'set', path: [...conditionPath, 'path'], raw }])}
              />
              <select
                id={controlId({ kind: 'condition', ruleIndex: rule.index, index: at, part: 'op' }) ?? undefined}
                className="option"
                aria-label={`condition ${at + 1} operator of ${name}`}
                aria-describedby={issueId(controlId({ kind: 'condition', ruleIndex: rule.index, index: at, part: 'op' }))}
                value={CONDITION_OPS.includes(op as (typeof CONDITION_OPS)[number]) ? op : ''}
                disabled={disabled}
                onChange={event => {
                  const next = event.target.value
                  const edits: DocEdit[] = [{ op: 'set', path: [...conditionPath, 'op'], raw: JSON.stringify(next) }]
                  // exists and not_exists ignore a value: the member is removed, not disabled
                  if (VALUELESS_OPS.has(next) && valueRaw !== null) edits.push({ op: 'remove', path: valuePath })
                  onEdit(edits)
                }}
              >
                <option value="">op</option>
                {CONDITION_OPS.map(choice => (
                  <option key={choice} value={choice}>{choice}</option>
                ))}
              </select>
              {!VALUELESS_OPS.has(op) && (
                <RawJsonInput
                  id={controlId({ kind: 'condition', ruleIndex: rule.index, index: at, part: 'value' }) ?? undefined}
                  label={`condition ${at + 1} value of ${name}`}
                  value={valueRaw}
                  disabled={disabled}
                  placeholder="value (JSON)"
                  describedBy={issueId(controlId({ kind: 'condition', ruleIndex: rule.index, index: at, part: 'value' }))}
                  onCommit={raw => onEdit([{ op: 'set', path: valuePath, raw }])}
                />
              )}
              <IconButton
                name="trash"
                label={`Remove condition ${at + 1} of ${name}`}
                className="btn small icon-only"
                disabled={disabled}
                onClick={() => onEdit([{ op: 'remove', path: conditionPath }])}
              />
            </span>
          )
        })}
        <IconButton
          name="plus"
          label={`Add a condition to ${name}`}
          className="btn small icon-only"
          disabled={disabled}
          onClick={() =>
            onEdit(
              rule.where === null
                ? [{ op: 'set', path: [...rule.path, 'where'], raw: '[{"path": "$", "op": "exists"}]' }]
                : [{ op: 'insert', path: [...rule.path, 'where'], index: conditions.length, raw: '{"path": "$", "op": "exists"}' }],
            )
          }
        />
      </div>
    </div>
  )
}
