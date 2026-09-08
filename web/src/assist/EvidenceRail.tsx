import { useId, useState } from 'react'
import type { FieldProfile, FieldStat } from '../api/types'
import { Icon, IconButton } from '../components'
import { useMediaQuery } from '../useMediaQuery'

function fmt(n: number) {
  return n.toLocaleString('en-US')
}

function ExampleDisclosure({ stat }: { stat: FieldStat }) {
  const [open, setOpen] = useState(false)
  if (stat.examples.length === 0) return <span className="muted">—</span>
  return (
    <>
      <IconButton name="eye" label={`Examples of ${stat.path}`} className="btn small icon-only" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <ul className="examples">
          {stat.examples.map((example, index) => (
            <li key={index} className="mono">{typeof example === 'string' ? example : JSON.stringify(example)}</li>
          ))}
        </ul>
      )}
    </>
  )
}

function Types({ types }: { types: { [kind: string]: number } }) {
  return (
    <span className="types">
      {Object.entries(types).map(([kind, count]) => (
        <span key={kind} className="chip" title={`${fmt(count)} ${kind} values`}>{kind} <span className="count">{fmt(count)}</span></span>
      ))}
    </span>
  )
}

export interface EvidenceRailProps {
  profile: FieldProfile | null
  loading: boolean
  includeSample: boolean
  onIncludeSample: (on: boolean) => void
  onShowPayload: () => void
  payloadAvailable: boolean
  disabled: boolean
}

/**
 * What the assistant will see: the field profile with exact numbers (records / inspected,
 * nulls / values), the sample toggle and the way to the outgoing payload.
 */
export function EvidenceRail({ profile, loading, includeSample, onIncludeSample, onShowPayload, payloadAvailable, disabled }: EvidenceRailProps) {
  // below 1280 px the rail is a real disclosure, not content hidden by CSS: it collapses by
  // default and its button still states the numbers, so nothing is lost by closing it
  const narrow = useMediaQuery('(max-width: 1279px)')
  const [open, setOpen] = useState(false)
  const expanded = !narrow || open
  const id = useId()
  const summary = profile
    ? `${fmt(profile.inspected)} of ${fmt(profile.total_records)} records inspected, ${fmt(profile.fields.length)} paths`
    : loading ? 'profiling…' : 'unavailable'

  return (
    <aside className="assist-rail" aria-label="Evidence">
      <div className="panel-head">
        {narrow ? (
          <button type="button" className="btn small disclosure" aria-expanded={expanded} aria-controls={id} onClick={() => setOpen(!open)}>
            <Icon name={expanded ? 'chevronUp' : 'chevronDown'} />
            Evidence: {summary}
          </button>
        ) : (
          <h2>Evidence</h2>
        )}
        <IconButton name="braces" label="Show the exact text the assistant receives" className="btn small icon-only" disabled={!payloadAvailable} onClick={onShowPayload} />
      </div>
      <div id={id} hidden={!expanded}>
      {loading && <p className="state-block">Profiling…</p>}
      {profile && (
        <>
          <p className="muted">
            {fmt(profile.inspected)} of {fmt(profile.total_records)} records inspected · {fmt(profile.fields.length)} paths
            {Object.keys(profile.truncated).length > 0 && ` · limits: ${Object.entries(profile.truncated).map(([k, v]) => `${k} ${fmt(v)}`).join(', ')}`}
          </p>
          {profile.withheld.length > 0 && <p className="muted">{fmt(profile.withheld.length)} key{profile.withheld.length > 1 ? 's' : ''} withheld (they looked like credentials or personal locators).</p>}
          <label className="field row"><input type="checkbox" checked={includeSample} disabled={disabled} onChange={e => onIncludeSample(e.target.checked)} /> Include a redacted sample (up to 20 records); you will see the exact text before it is sent</label>
          <div className="table-wrap">
            <table className="data compact">
              <caption className="visually-hidden">Field profile</caption>
              <thead><tr><th scope="col">Path</th><th scope="col" className="num">Records</th><th scope="col" className="num">Nulls</th><th scope="col">Types</th><th scope="col">Hints</th><th scope="col"><span className="visually-hidden">Examples</span><Icon name="eye" aria-hidden="true" /></th></tr></thead>
              <tbody>
                {profile.fields.map(stat => (
                  <tr key={stat.path}>
                    <td className="mono">{stat.path}{stat.wrapper && <span className="chip" title={`accessors: ${stat.wrapper.accessors.join(', ')}`}>{stat.wrapper.kind}</span>}</td>
                    <td className="num" title={`${fmt(stat.records)} of ${fmt(profile.inspected)} inspected records have this path`}>{fmt(stat.records)}<span className="muted">/{fmt(profile.inspected)}</span></td>
                    <td className="num" title={`${fmt(stat.nulls)} of ${fmt(stat.values)} observed values are null`}>{fmt(stat.nulls)}<span className="muted">/{fmt(stat.values)}</span></td>
                    <td><Types types={stat.types} /></td>
                    <td>{stat.hints.map(h => <span key={h} className="chip">{h}</span>)}</td>
                    <td><ExampleDisclosure stat={stat} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {profile.unaddressable.length > 0 && (
            <details><summary>{fmt(profile.unaddressable.length)} key{profile.unaddressable.length > 1 ? 's' : ''} the mapping language cannot address</summary>
              <ul>{profile.unaddressable.map((u, i) => <li key={i} className="mono">{u.parent} · {u.key} <span className="muted">({u.reason})</span></li>)}</ul>
            </details>
          )}
        </>
      )}
      </div>
    </aside>
  )
}
