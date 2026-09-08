import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../components'
import type { DocEdit } from './document'
import { asString, type DocIndex } from './documentIndex'
import { INPUT_FORMATS } from './dsl'
import { controlId } from './issuePaths'
import { RawJsonInput, TextValueInput } from './RawJsonInput'

export interface DocumentHeadProps {
  index: DocIndex
  identity: { name: string; source: string }
  disabled: boolean
  /** An identity change travels with the document edit that carries it, in one batch. */
  onEdit: (edits: DocEdit[], identity?: { name: string; source: string }) => void
  issueId: (id: string | null) => string | undefined
}

/**
 * What the document declares about itself: versions, input format, its name and source, the
 * `unmapped` list and free-text `notes`.
 *
 * The name and source here *are* the mapping identity: editing one writes both, in a single batch,
 * so the document and the request that carries it can never disagree.
 */
export function DocumentHead({ index, identity, disabled, onEdit, issueId }: DocumentHeadProps) {
  const head = index.head
  const format = asString(head.input_format) ?? ''
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const [notesDraft, setNotesDraft] = useState(asString(index.notes) ?? '')
  const editingNotes = useRef(false)
  const notes = asString(index.notes) ?? ''
  useEffect(() => {
    if (!editingNotes.current) setNotesDraft(notes)
  }, [notes])

  const idFor = (key: string) => controlId({ kind: 'head', key }) ?? undefined

  return (
    <section className="document-head" aria-label="Document">
      <div className="row">
        <label className="dim">
          <span>Name</span>
          <TextValueInput
            id={idFor('name')}
            label="Mapping name in the document"
            value={head.name.raw}
            disabled={disabled}
            describedBy={issueId(idFor('name') ?? null)}
            onCommit={raw => onEdit([{ op: 'set', path: ['name'], raw }], { ...identity, name: JSON.parse(raw) as string })}
          />
        </label>
        <label className="dim">
          <span>Source</span>
          <TextValueInput
            id={idFor('source')}
            label="Source in the document"
            value={head.source.raw}
            disabled={disabled}
            describedBy={issueId(idFor('source') ?? null)}
            onCommit={raw => onEdit([{ op: 'set', path: ['source'], raw }], { ...identity, source: JSON.parse(raw) as string })}
          />
        </label>
        <label className="dim">
          <span>Input format</span>
          <select
            id={idFor('input_format')}
            className="option"
            aria-label="Input format"
            aria-describedby={issueId(idFor('input_format') ?? null)}
            value={INPUT_FORMATS.includes(format as (typeof INPUT_FORMATS)[number]) ? format : ''}
            disabled={disabled}
            onChange={event =>
              onEdit([
                event.target.value === ''
                  ? { op: 'remove', path: ['input_format'] }
                  : { op: 'set', path: ['input_format'], raw: JSON.stringify(event.target.value) },
              ])
            }
          >
            <option value="">not set</option>
            {INPUT_FORMATS.map(choice => (
              <option key={choice} value={choice}>{choice}</option>
            ))}
          </select>
        </label>
        <label className="dim">
          <span>DSL version</span>
          <RawJsonInput
            id={idFor('dsl_version')}
            label="dsl_version"
            value={head.dsl_version.raw}
            disabled={disabled}
            placeholder="1"
            describedBy={issueId(idFor('dsl_version') ?? null)}
            onCommit={raw => onEdit([{ op: 'set', path: ['dsl_version'], raw }])}
          />
        </label>
        <label className="dim">
          <span>Target schema</span>
          <RawJsonInput
            id={idFor('target_schema_version')}
            label="target_schema_version"
            value={head.target_schema_version.raw}
            disabled={disabled}
            placeholder="1"
            describedBy={issueId(idFor('target_schema_version') ?? null)}
            onCommit={raw => onEdit([{ op: 'set', path: ['target_schema_version'], raw }])}
          />
        </label>
      </div>

      {index.extras.length > 0 && (
        <p className="muted">
          Kept as written, with no control of their own:{' '}
          {index.extras.map(extra => String(extra.path.at(-1))).join(', ')}.
        </p>
      )}

      <div className="unmapped">
        <span className="dim">
          <span>Unmapped</span>
          {index.unmapped.length === 0 && index.unmappedProblem === null && <span className="muted">nothing declared</span>}
        </span>
        {index.unmapped.map(entry => (
          <span key={entry.index} className="path-entry">
            <TextValueInput
              id={controlId({ kind: 'unmapped', index: entry.index, part: 'path' }) ?? undefined}
              label={`unmapped path ${entry.index + 1}`}
              value={entry.pathMember.raw}
              disabled={disabled}
              placeholder="$.field"
              describedBy={issueId(controlId({ kind: 'unmapped', index: entry.index, part: 'path' }))}
              onCommit={raw => onEdit([{ op: 'set', path: [...entry.path, 'path'], raw }])}
            />
            <TextValueInput
              id={controlId({ kind: 'unmapped', index: entry.index, part: 'reason' }) ?? undefined}
              label={`unmapped reason ${entry.index + 1}`}
              value={entry.reason.raw}
              disabled={disabled}
              placeholder="why it is not mapped"
              describedBy={issueId(controlId({ kind: 'unmapped', index: entry.index, part: 'reason' }))}
              onCommit={raw => onEdit([{ op: 'set', path: [...entry.path, 'reason'], raw }])}
            />
            <IconButton
              name="trash"
              label={`Remove unmapped entry ${entry.index + 1}`}
              className="btn small icon-only"
              disabled={disabled}
              onClick={() => onEdit([{ op: 'remove', path: entry.path }])}
            />
          </span>
        ))}
        {index.unmappedProblem === null && (
          <IconButton
            name="plus"
            label="Declare an unmapped path"
            className="btn small icon-only"
            disabled={disabled}
            onClick={() =>
              onEdit(
                index.unmapped.length === 0
                  ? [{ op: 'set', path: ['unmapped'], raw: '[{"path": "$", "reason": ""}]' }]
                  : [{ op: 'insert', path: ['unmapped'], index: index.unmapped.length, raw: '{"path": "$", "reason": ""}' }],
              )
            }
          />
        )}
      </div>

      <label className="dim notes">
        <span>Notes</span>
        <textarea
          ref={notesRef}
          aria-label="Notes"
          rows={2}
          value={notesDraft}
          disabled={disabled}
          placeholder="what a reader should know about this mapping"
          onFocus={() => { editingNotes.current = true }}
          onChange={event => setNotesDraft(event.target.value)}
          onBlur={() => {
            editingNotes.current = false
            if (notesDraft === notes) return
            onEdit([
              notesDraft === ''
                ? { op: 'remove', path: ['notes'] }
                : { op: 'set', path: ['notes'], raw: JSON.stringify(notesDraft) },
            ])
          }}
        />
      </label>
    </section>
  )
}
