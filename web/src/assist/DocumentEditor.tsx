import { useId, useRef } from 'react'
import type { MappingIssue } from '../api/types'
import { IconButton } from '../components'
import { lineFor } from './jsonText'
import { num } from '../format'

export interface DocumentEditorProps {
  text: string
  onChange: (text: string) => void
  issues: MappingIssue[] | null
  /** True when the issues describe the current text. */
  current: boolean
  disabled: boolean
  canUndo: boolean
  onUndo: () => void
}

/**
 * The mapping document as text: the source of truth for validation, saving and revision.
 * Nothing re-serialises it; what is shown is what is sent.
 */
export function DocumentEditor({ text, onChange, issues, current, disabled, canUndo, onUndo }: DocumentEditorProps) {
  const id = useId()
  const area = useRef<HTMLTextAreaElement>(null)
  const errors = issues?.filter(i => i.severity === 'error') ?? []
  const warnings = issues?.filter(i => i.severity !== 'error') ?? []
  const lines = text ? text.split('\n').length : 0

  function jump(path: string) {
    const line = lineFor(text, path)
    const element = area.current
    if (line === null || !element) return
    const offset = text.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0)
    element.focus()
    element.setSelectionRange(offset, offset)
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 18
    element.scrollTop = Math.max(0, (line - 3) * lineHeight)
  }

  return (
    <section className="assist-editor" aria-labelledby={`${id}-title`}>
      <div className="panel-head">
        <h2 id={`${id}-title`}>Mapping document</h2>
        <span className="muted">{num(lines)} lines</span>
        <IconButton name="refresh" label="Undo the last proposal" className="btn small icon-only" disabled={!canUndo || disabled} onClick={onUndo} />
      </div>
      <textarea
        ref={area}
        id={`${id}-text`}
        className="editor mono"
        aria-label="Mapping document (JSON)"
        aria-invalid={current && errors.length > 0 ? true : undefined}
        aria-describedby={`${id}-issues`}
        spellCheck={false}
        value={text}
        disabled={disabled}
        placeholder='{"dsl_version": 1, "target_schema_version": 1, "name": "…", "source": "…", "input_format": "jsonl", "rules": []}'
        onChange={e => onChange(e.target.value)}
      />
      <div id={`${id}-issues`} className="issues">
        {issues === null && <p className="muted">Not validated yet.</p>}
        {issues !== null && !current && <p className="muted">Edited since the last validation.</p>}
        {issues !== null && current && issues.length === 0 && <p className="ok">No issues: the document is executable.</p>}
        {issues !== null && current && issues.length > 0 && (
          <ul aria-label="Validation issues">
            {[...errors, ...warnings].map((issue, index) => (
              <li key={index} className={issue.severity === 'error' ? 'issue error' : 'issue warn'}>
                <button type="button" className="link" onClick={() => jump(issue.path)} title="Jump to the line"><code>{issue.path || '$'}</code></button>
                <span className="mono code">{issue.code}</span> {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
