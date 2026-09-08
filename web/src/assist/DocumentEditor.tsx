import { useEffect, useRef } from 'react'
import { lineFor } from './jsonText'

export interface DocumentEditorProps {
  text: string
  onChange: (text: string) => void
  disabled: boolean
  /** An issue to go to: the line of that path is selected and scrolled into view. */
  focusRequest: { path: string; nonce: number } | null
  /** Told when a path has no line here, so the page can say so instead of doing nothing. */
  onNotFound: (path: string) => void
}

/**
 * The mapping document as text: the source of truth for validation, saving and revision.
 * Nothing re-serialises it; what is shown is what is sent.
 */
export function DocumentEditor({ text, onChange, disabled, focusRequest, onNotFound }: DocumentEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null)
  const handled = useRef(0)

  useEffect(() => {
    if (focusRequest === null || focusRequest.nonce === handled.current) return
    handled.current = focusRequest.nonce
    const line = lineFor(text, focusRequest.path)
    const element = area.current
    if (element === null) return
    if (line === null) {
      onNotFound(focusRequest.path)
      element.focus()
      return
    }
    const offset = text.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0)
    element.focus()
    element.setSelectionRange(offset, offset)
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 18
    element.scrollTop = Math.max(0, (line - 3) * lineHeight)
  }, [focusRequest, text, onNotFound])

  return (
    <textarea
      ref={area}
      className="editor mono"
      aria-label="Mapping document (JSON)"
      spellCheck={false}
      value={text}
      disabled={disabled}
      placeholder='{"dsl_version": 1, "target_schema_version": 1, "name": "…", "source": "…", "input_format": "jsonl", "rules": []}'
      onChange={event => onChange(event.target.value)}
    />
  )
}
