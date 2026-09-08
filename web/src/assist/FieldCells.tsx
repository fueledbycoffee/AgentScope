import { useState, type ReactNode } from 'react'
import { IconButton } from '../components'
import type { DocEdit, DocPath } from './document'
import type { FieldView, Member } from './documentIndex'
import { OPTION_DOMAINS, plain, UNITS, ENUM_MAP_POLICIES, type EnumOption } from './dsl'
import { RawJsonInput, TextValueInput } from './RawJsonInput'

const setOrRemove = (path: DocPath, value: string, quoted = true): DocEdit =>
  value === '' ? { op: 'remove', path } : { op: 'set', path, raw: quoted ? JSON.stringify(value) : value }

export interface CellContext {
  /** Names every control after its rule as well as its field: two rules may share a field name. */
  ruleName: string
  disabled: boolean
  onEdit: (edits: DocEdit[]) => void
  /** Send a section the table must not rewrite to the JSON view. */
  onOpenJson: (path: DocPath) => void
  /** Issues attached to a control id, for `aria-invalid` and `aria-describedby`. */
  issueId: (id: string | null) => string | undefined
  idFor: (part: string, extra?: string) => string
}

/** A labelled select over one closed domain, with an explicit "not set" that removes the member. */
export function OptionSelect({
  option,
  member,
  label,
  context,
  domain,
  quoted = true,
}: {
  option: string
  member: Member
  label: string
  context: CellContext
  domain: readonly string[]
  quoted?: boolean
}) {
  const id = context.idFor('opt', option)
  const described = context.issueId(id)
  // the type is part of the value: JSON `null` is not the policy "null", and the string "false" is
  // not the flag false. The parser refuses the wrong one, so the control must not show it as chosen
  const rawOf = (choice: string) => (quoted ? JSON.stringify(choice) : choice)
  const selected = domain.find(choice => member.raw === rawOf(choice))
  const wrongType = member.raw !== null && selected === undefined
  return (
    <>
      <select
        id={id}
        className="option"
        aria-label={label}
        aria-invalid={described !== undefined || wrongType ? true : undefined}
        aria-describedby={described}
        value={selected ?? ''}
        disabled={context.disabled}
        onChange={event => context.onEdit([setOrRemove(member.path, event.target.value, quoted)])}
      >
        <option value="">{`${option} · not set`}</option>
        {domain.map(choice => (
          <option key={choice} value={choice}>{`${option}: ${choice}`}</option>
        ))}
      </select>
      {wrongType && (
        <span className="chip warn mono" title={`${option} is ${member.raw}, which is not a valid value`}>
          {member.raw} — not a valid value
        </span>
      )}
    </>
  )
}

/**
 * `unit` is an ordered pair, so it is only written once both halves are known — but a half the
 * user has just picked is remembered as a draft until then, or the pair could never be created.
 *
 * An existing pair is edited at the member the user changed, never rebuilt: rebuilding it would
 * drop anything else the object carries, which the parser accepts and the document must keep.
 */
function UnitPair({ field, context }: { field: FieldView; context: CellContext }) {
  const unit = field.options.unit
  const committedFrom = plain(field.unit.from)
  const committedTo = plain(field.unit.to)
  // the draft is tied to the committed pair it was started from, so a document that changes
  // elsewhere (a proposal, an undo, the JSON view) drops it during render rather than in an effect
  const basis = `${committedFrom}|${committedTo}`
  const [draft, setDraft] = useState<{ from?: string; to?: string; basis: string }>({ basis })
  const current = draft.basis === basis ? draft : { basis }
  const from = current.from ?? committedFrom
  const to = current.to ?? committedTo
  const exists = unit.raw !== null

  const write = (half: 'from' | 'to', value: string) => {
    // an object that is already there is edited at the member the user changed, whatever else it
    // holds; only an absent one is written whole, and only once both halves are known
    if (exists) {
      setDraft({ basis })
      if (value !== '') {
        context.onEdit([{ op: 'set', path: field.unit[half].path, raw: JSON.stringify(value) }])
        return
      }
      // clearing a half removes the whole unit only when the object holds nothing this control
      // does not own; anything else there means removing just the member the user cleared
      const unknown = (field.unit.keys ?? []).filter(key => key !== 'from' && key !== 'to')
      context.onEdit([{ op: 'remove', path: unknown.length === 0 ? unit.path : field.unit[half].path }])
      return
    }
    if (value === '') {
      setDraft({ basis })
      return
    }
    const next = { from, to, [half]: value }
    if (next.from === '' || next.to === '') {
      setDraft({ ...current, [half]: value })
      return
    }
    setDraft({ basis })
    context.onEdit([{ op: 'set', path: unit.path, raw: JSON.stringify({ from: next.from, to: next.to }) }])
  }
  const select = (half: 'from' | 'to', value: string) => (
    <select
      id={context.idFor('opt', half === 'from' ? 'unit' : 'unit-to')}
      className="option"
      aria-label={`unit ${half} of ${field.name} in ${context.ruleName}`}
      aria-describedby={context.issueId(context.idFor('opt', 'unit'))}
      value={value}
      disabled={context.disabled}
      onChange={event => write(half, event.target.value)}
    >
      <option value="">{`unit ${half} · not set`}</option>
      {UNITS.map(choice => (
        <option key={choice} value={choice}>{`${half}: ${choice}`}</option>
      ))}
    </select>
  )
  if (field.unitProblem !== null) {
    return <RepairLink problem={field.unitProblem} what={`unit of ${field.name} in ${context.ruleName}`} path={unit.path} context={context} />
  }
  return (
    <span className="unit">
      {select('from', from)}
      {select('to', to)}
    </span>
  )
}

/** Every option of one field: six closed domains, the unit pair and the raw `default`. */
export function OptionsCell({ field, context }: { field: FieldView; context: CellContext }) {
  const defaultMember = field.options.default
  return (
    <div className="options">
      {(Object.keys(OPTION_DOMAINS) as EnumOption[]).map(option => (
        <OptionSelect
          key={option}
          option={option}
          member={field.options[option]}
          label={`${option} of ${field.name} in ${context.ruleName}`}
          context={context}
          domain={OPTION_DOMAINS[option]}
          quoted={option !== 'empty_as_missing'}
        />
      ))}
      <UnitPair field={field} context={context} />
      <span className="default">
        <RawJsonInput
          id={context.idFor('opt', 'default')}
          label={`default of ${field.name} in ${context.ruleName}`}
          value={defaultMember.raw}
          disabled={context.disabled}
          placeholder="default (JSON)"
          describedBy={context.issueId(context.idFor('opt', 'default'))}
          onCommit={raw => context.onEdit([{ op: 'set', path: defaultMember.path, raw }])}
        />
        {defaultMember.raw !== null && (
          <IconButton
            name="trash"
            label={`Remove the default of ${field.name} in ${context.ruleName}`}
            className="btn small icon-only"
            disabled={context.disabled}
            onClick={() => context.onEdit([{ op: 'remove', path: defaultMember.path }])}
          />
        )}
        {defaultMember.raw !== null && plain(field.options.on_missing) !== 'default' && (
          <span className="chip" title="the engine only reads default when on_missing is default">
            unused
          </span>
        )}
      </span>
    </div>
  )
}

/** A section the table refuses to touch, with the way to repair it. */
export function RepairLink({ problem, what, path, context }: { problem: string; what: string; path: DocPath; context: CellContext }) {
  return (
    <span className="repair">
      <span className="issue error">{problem}</span>{' '}
      <button type="button" className="link" aria-label={`Repair ${what} in the JSON view`} onClick={() => context.onOpenJson(path)}>
        Repair it in the JSON view
      </button>
    </span>
  )
}

/** `path`, ordered `paths` or a `literal`: exactly one of them, switched in a single batch. */
export function SourceCell({ field, context }: { field: FieldView; context: CellContext }) {
  const kinds = ['path', 'paths', 'literal'] as const
  const present = field.source.present
  const current = present.length === 1 ? present[0] : ''
  const id = context.idFor('src', 'kind')
  const described = context.issueId(context.idFor('src', 'path'))

  const switchTo = (kind: (typeof kinds)[number] | '') => {
    if (kind === '') return
    const edits: DocEdit[] = present.filter(other => other !== kind).map(other => ({ op: 'remove', path: field.source.members[other].path }))
    if (!present.includes(kind)) {
      const seed = kind === 'paths' ? '["$"]' : kind === 'literal' ? 'null' : '"$"'
      edits.push({ op: 'set', path: field.source.members[kind].path, raw: seed })
    }
    context.onEdit(edits)
  }

  const pathsCount = field.source.paths?.length ?? 0

  return (
    <div className="source">
      <select
        id={id}
        className="option"
        aria-label={`source kind of ${field.name} in ${context.ruleName}`}
        aria-invalid={present.length > 1 ? true : undefined}
        aria-describedby={described}
        value={current}
        disabled={context.disabled}
        onChange={event => switchTo(event.target.value as (typeof kinds)[number])}
      >
        {present.length !== 1 && <option value="">{present.length === 0 ? 'no source' : present.join(' + ')}</option>}
        {kinds.map(kind => (
          <option key={kind} value={kind}>{kind}</option>
        ))}
      </select>
      {present.length > 1 && (
        <span className="chip warn" title="a field takes exactly one source; choose which to keep">
          {present.join(' + ')}
        </span>
      )}
      {present.includes('path') && (
        <TextValueInput
          id={context.idFor('src', 'path')}
          label={`path of ${field.name} in ${context.ruleName}`}
          value={field.source.members.path.raw}
          disabled={context.disabled}
          placeholder="$.field"
          describedBy={described}
          invalid={described !== undefined}
          onCommit={raw => context.onEdit([{ op: 'set', path: field.source.members.path.path, raw }])}
        />
      )}
      {present.includes('literal') && (
        <RawJsonInput
          id={context.idFor('src', 'literal')}
          label={`literal of ${field.name} in ${context.ruleName}`}
          value={field.source.members.literal.raw}
          disabled={context.disabled}
          placeholder="literal (JSON)"
          describedBy={context.issueId(context.idFor('src', 'literal'))}
          onCommit={raw => context.onEdit([{ op: 'set', path: field.source.members.literal.path, raw }])}
        />
      )}
      {present.includes('paths') && field.pathsProblem !== null && (
        <RepairLink problem={field.pathsProblem} what={`paths of ${field.name} in ${context.ruleName}`} path={field.source.members.paths.path} context={context} />
      )}
      {present.includes('paths') && field.pathsProblem === null && (
        <span className="paths">
          {Array.from({ length: pathsCount }, (_unused, index) => (
            <span key={index} className="path-entry">
              <TextValueInput
                id={context.idFor('src', `paths-${index}`)}
                label={`path ${index + 1} of ${field.name} in ${context.ruleName}`}
                value={field.source.paths?.[index].raw ?? null}
                disabled={context.disabled}
                onCommit={raw => context.onEdit([{ op: 'set', path: [...field.source.members.paths.path, index], raw }])}
              />
              <IconButton
                name="chevronUp"
                label={`Move path ${index + 1} of ${field.name} in ${context.ruleName} earlier`}
                className="btn small icon-only"
                disabled={context.disabled || index === 0}
                onClick={() => context.onEdit([{ op: 'move', path: [...field.source.members.paths.path, index], index: index - 1 }])}
              />
              <IconButton
                name="chevronDown"
                label={`Move path ${index + 1} of ${field.name} in ${context.ruleName} later`}
                className="btn small icon-only"
                disabled={context.disabled || index === pathsCount - 1}
                onClick={() => context.onEdit([{ op: 'move', path: [...field.source.members.paths.path, index], index: index + 1 }])}
              />
              <IconButton
                name="trash"
                label={`Remove path ${index + 1} of ${field.name} in ${context.ruleName}`}
                className="btn small icon-only"
                disabled={context.disabled || pathsCount === 1}
                onClick={() => context.onEdit([{ op: 'remove', path: [...field.source.members.paths.path, index] }])}
              />
            </span>
          ))}
          <IconButton
            name="plus"
            label={`Add a fallback path to ${field.name} in ${context.ruleName}`}
            className="btn small icon-only"
            disabled={context.disabled}
            onClick={() => context.onEdit([{ op: 'insert', path: field.source.members.paths.path, index: pathsCount, raw: '"$"' }])}
          />
        </span>
      )}
    </div>
  )
}

/** Transforms in both forms, as raw JSON entries that are never converted into one another. */
export function TransformsCell({ field, context }: { field: FieldView; context: CellContext }): ReactNode {
  const transforms = field.transforms
  const listPath: DocPath = [...field.path, 'transforms']
  if (field.transformsProblem !== null) {
    // present, but not a list: creating one here would silently replace whatever is there
    return <RepairLink problem={field.transformsProblem} what={`transforms of ${field.name} in ${context.ruleName}`} path={listPath} context={context} />
  }
  if (transforms === null) {
    return (
      <IconButton
        name="plus"
        label={`Add a transform to ${field.name} in ${context.ruleName}`}
        className="btn small icon-only"
        disabled={context.disabled}
        onClick={() => context.onEdit([{ op: 'set', path: listPath, raw: '["trim"]' }])}
      />
    )
  }
  return (
    <div className="transforms">
      {transforms.map(transform => (
        <span key={transform.index} className="transform">
          <RawJsonInput
            id={context.idFor('tr', String(transform.index))}
            label={`transform ${transform.index + 1} of ${field.name} in ${context.ruleName}`}
            value={transform.raw}
            disabled={context.disabled}
            describedBy={context.issueId(context.idFor('tr', String(transform.index)))}
            onCommit={raw => context.onEdit([{ op: 'set', path: transform.path, raw }])}
          />
          {transform.name === 'enum_map' && (
            <select
              className="option"
              aria-label={`enum_map policy of transform ${transform.index + 1} of ${field.name} in ${context.ruleName}`}
              value={transform.enumMapUnmapped === null ? '' : plain(transform.enumMapUnmapped)}
              disabled={context.disabled}
              onChange={event => {
                const policyPath = transform.enumMapUnmapped?.path ?? [...transform.path, 'enum_map', 'unmapped']
                context.onEdit([
                  event.target.value === ''
                    ? { op: 'remove', path: policyPath }
                    : { op: 'set', path: policyPath, raw: JSON.stringify(event.target.value) },
                ])
              }}
            >
              <option value="">unmapped · not set</option>
              {ENUM_MAP_POLICIES.map(policy => (
                <option key={policy} value={policy}>{`unmapped: ${policy}`}</option>
              ))}
            </select>
          )}
          <IconButton
            name="chevronUp"
            label={`Move transform ${transform.index + 1} of ${field.name} in ${context.ruleName} earlier`}
            className="btn small icon-only"
            disabled={context.disabled || transform.index === 0}
            onClick={() => context.onEdit([{ op: 'move', path: transform.path, index: transform.index - 1 }])}
          />
          <IconButton
            name="chevronDown"
            label={`Move transform ${transform.index + 1} of ${field.name} in ${context.ruleName} later`}
            className="btn small icon-only"
            disabled={context.disabled || transform.index === transforms.length - 1}
            onClick={() => context.onEdit([{ op: 'move', path: transform.path, index: transform.index + 1 }])}
          />
          <IconButton
            name="trash"
            label={`Remove transform ${transform.index + 1} of ${field.name} in ${context.ruleName}`}
            className="btn small icon-only"
            disabled={context.disabled}
            onClick={() => context.onEdit([{ op: 'remove', path: transform.path }])}
          />
        </span>
      ))}
      <IconButton
        name="plus"
        label={`Add a transform to ${field.name} in ${context.ruleName}`}
        className="btn small icon-only"
        disabled={context.disabled}
        onClick={() => context.onEdit([{ op: 'insert', path: listPath, index: transforms.length, raw: '"trim"' }])}
      />
    </div>
  )
}
