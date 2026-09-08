import { useEffect, useId, useRef, useState } from 'react'
import { isOneJsonValue } from './jsonGrammar'

export interface RawJsonInputProps {
  id?: string
  label: string
  /** The value as written, or null when the member is absent. */
  value: string | null
  disabled?: boolean
  placeholder?: string
  describedBy?: string
  invalid?: boolean
  onCommit: (raw: string) => void
}

/**
 * A value typed as raw JSON, so `1.0`, `9007199254740993`, a string, an object or a list all
 * reach the document exactly as written.
 *
 * Typing is a draft: `-`, `1e` and a lone quote are all legal keystrokes on the way to a value, so
 * the document is only written on blur or Enter, and only when the draft is one JSON value.
 * Escape puts the committed value back.
 */
export function RawJsonInput({ id, label, value, disabled, placeholder, describedBy, invalid, onCommit }: RawJsonInputProps) {
  const fallbackId = useId()
  const inputId = id ?? fallbackId
  const [draft, setDraft] = useState(value ?? '')
  const editing = useRef(false)

  useEffect(() => {
    if (!editing.current) setDraft(value ?? '')
  }, [value])

  const problem = draft.trim() !== '' && !isOneJsonValue(draft) ? 'not one JSON value' : null
  const problemId = `${inputId}-problem`

  function commit() {
    editing.current = false
    if (draft.trim() === '' || problem !== null) {
      setDraft(value ?? '')
      return
    }
    if (draft !== value) onCommit(draft)
  }

  return (
    <span className="raw-json">
      <input
        id={inputId}
        className="mono"
        type="text"
        aria-label={label}
        aria-invalid={problem !== null || invalid === true ? true : undefined}
        aria-describedby={[problem !== null ? problemId : null, describedBy ?? null].filter(Boolean).join(' ') || undefined}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => { editing.current = true }}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
          if (event.key === 'Escape') {
            editing.current = false
            setDraft(value ?? '')
          }
        }}
      />
      {problem !== null && <span id={problemId} className="issue error">{problem}</span>}
    </span>
  )
}

export interface TextValueInputProps {
  id?: string
  label: string
  /** The JSON string as written (quotes included), or null when absent. */
  value: string | null
  disabled?: boolean
  placeholder?: string
  describedBy?: string
  invalid?: boolean
  onCommit: (raw: string) => void
}

/** The same draft-and-commit behaviour for a plain string member, quoted on the way out. */
export function TextValueInput({ id, label, value, disabled, placeholder, describedBy, invalid, onCommit }: TextValueInputProps) {
  const fallbackId = useId()
  const inputId = id ?? fallbackId
  const decoded = value !== null && value.startsWith('"') ? (JSON.parse(value) as string) : (value ?? '')
  const [draft, setDraft] = useState(decoded)
  const editing = useRef(false)

  useEffect(() => {
    if (!editing.current) setDraft(decoded)
  }, [decoded])

  function commit() {
    editing.current = false
    if (draft !== decoded) onCommit(JSON.stringify(draft))
  }

  return (
    <input
      id={inputId}
      className="mono"
      type="text"
      aria-label={label}
      aria-invalid={invalid === true ? true : undefined}
      aria-describedby={describedBy}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onFocus={() => { editing.current = true }}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
        if (event.key === 'Escape') {
          editing.current = false
          setDraft(decoded)
        }
      }}
    />
  )
}
