import { useState } from 'react'
import type { Ambiguity } from '../api/types'
import { Icon } from '../components'
import type { DocEdit } from './document'
import type { DocIndex } from './documentIndex'
import { offerFor, type Suggestion } from './suggestions'

export interface SuggestionListProps {
  ambiguities: Ambiguity[]
  index: DocIndex
  /** False once the document moved past the proposal these came from. */
  current: boolean
  disabled: boolean
  onApply: (edits: DocEdit[]) => void
  /** Put an option the table cannot execute into the composer instead. */
  onAskAbout: (text: string) => void
}

function Entry({ suggestion, disabled, onApply }: { suggestion: Suggestion; disabled: boolean; onApply: (edits: DocEdit[]) => void }) {
  if (suggestion.blocked !== null) {
    return (
      <li className="suggestion blocked">
        <span className="mono">{suggestion.operation}</span> <span className="muted">{suggestion.blocked}</span>
      </li>
    )
  }
  return (
    <li className="suggestion">
      <button
        type="button"
        className="btn small has-tip"
        data-tip={suggestion.description}
        aria-label={suggestion.description}
        disabled={disabled}
        onClick={() => onApply(suggestion.edits)}
      >
        <Icon name="check" />
        {suggestion.operation}
      </button>
      {suggestion.warning !== null && <span className="issue warn">{suggestion.warning}</span>}
    </li>
  )
}

/**
 * The assistant's ambiguities, as edits when the document can carry them.
 *
 * An option is never applied on a guess: an operation is only executable when the target named it,
 * and otherwise the user picks which named operation was meant — even when only one matches. When
 * the document has moved on, the chips stop being applicable and say so, because they were
 * computed against a draft that no longer exists.
 */
export function SuggestionList({ ambiguities, index, current, disabled, onApply, onAskAbout }: SuggestionListProps) {
  const [picked, setPicked] = useState<Record<number, number>>({})
  if (ambiguities.length === 0) return null

  return (
    <section className="suggestions" aria-label="Ambiguities">
      <div className="panel-head">
        <h3>Ambiguities</h3>
        <span className="count">{ambiguities.length}</span>
      </div>
      {!current && (
        <p className="muted">
          These came with an earlier draft; the document has changed since, so they can no longer be
          applied. Ask again to get advice on the document as it is now.
        </p>
      )}
      <ul>
        {ambiguities.map((ambiguity, at) => {
          const offer = offerFor(index, ambiguity, picked[at])
          return (
            <li key={at} className="ambiguity">
              <p>
                <span className="mono">{ambiguity.target}</span> — {ambiguity.what_settles_it}
              </p>
              {offer.kind === 'choose-rule' && (
                <p className="muted">
                  Which rule?{' '}
                  {offer.choices.map(choice => (
                    <button
                      key={choice.ruleIndex}
                      type="button"
                      className="btn small"
                      disabled={disabled || !current}
                      onClick={() => setPicked(previous => ({ ...previous, [at]: choice.ruleIndex }))}
                    >
                      {choice.label}
                    </button>
                  ))}
                </p>
              )}
              {offer.kind === 'operations' &&
                offer.options.map(option => (
                  <div key={option.text} className="option-group">
                    <span className="mono">{option.text}</span>
                    <span className="muted">
                      {option.suggestions.length > 1 ? ' — which operation?' : ' — apply as:'}
                    </span>
                    <ul>
                      {option.suggestions.map(suggestion => (
                        <Entry key={suggestion.id} suggestion={suggestion} disabled={disabled || !current} onApply={onApply} />
                      ))}
                    </ul>
                  </div>
                ))}
              {offer.kind === 'prose' && (
                <p className="muted">
                  {ambiguity.options.join(' or ')} —{' '}
                  <button type="button" className="link" disabled={disabled} onClick={() => onAskAbout(`${ambiguity.target}: ${ambiguity.options.join(' or ')}`)}>
                    ask the assistant about it
                  </button>
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
