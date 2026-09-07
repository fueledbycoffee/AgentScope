import type { PreparedContext } from '../api/types'
import { Drawer, Icon, JsonText } from '../components'

export interface PayloadDrawerProps {
  prepared: PreparedContext
  /** Set when a sample is included and the run waits for the user's acknowledgement. */
  awaitingAck: boolean
  onAcknowledge: (digest: string) => void
  onClose: () => void
}

function counts(map: { [key: string]: number }, empty: string) {
  const entries = Object.entries(map)
  if (entries.length === 0) return empty
  return entries.map(([k, v]) => `${k} ${v.toLocaleString('en-US')}`).join(' · ')
}

/**
 * The exact text the model will receive as its data message, verbatim from the prepare
 * response (never re-serialised), with its digest, size, redaction counts and trimming.
 */
export function PayloadDrawer({ prepared, awaitingAck, onAcknowledge, onClose }: PayloadDrawerProps) {
  return (
    <Drawer title="What the assistant will see" onClose={onClose}>
      <dl className="kv">
        <dt>Digest</dt><dd className="mono">{prepared.context_sha256}</dd>
        <dt>Size</dt><dd>{prepared.bytes.toLocaleString('en-US')} bytes</dd>
        <dt>Sample</dt><dd>{prepared.sample_included ? `${prepared.sample_count} redacted record${prepared.sample_count === 1 ? '' : 's'} included` : 'not included (profile only)'}</dd>
        <dt>Redacted</dt><dd>{counts(prepared.redactions, 'nothing matched the redaction rules')}</dd>
        <dt>Trimmed</dt><dd>{counts(prepared.truncated, 'nothing; the whole context fits the budget')}</dd>
      </dl>
      <p className="muted">The adapter adds a fixed instruction preamble that contains none of your data; this text is the only data it sends. Redaction removes known shapes of secrets and personal locators; it is not anonymisation.</p>
      {awaitingAck && (
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => onAcknowledge(prepared.context_sha256)}>
            <Icon name="play" />Send this
          </button>
          <button type="button" className="btn" onClick={onClose}>Not now</button>
        </div>
      )}
      <JsonText text={prepared.payload_text} />
    </Drawer>
  )
}
