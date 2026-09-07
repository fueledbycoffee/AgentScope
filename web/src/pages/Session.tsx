import { display } from '../format'
import { useResource } from '../useResource'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getRawRecord, getSession } from '../api'
import type { RawReference } from '../api'
import { JsonView, ResourceState, Table } from '../components'

function SourceDrawer({ reference, onClose }: { reference: RawReference; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const resource = useResource(useCallback(() => getRawRecord(reference), [reference]))
  useEffect(() => {
    const element = dialog.current!
    const opener = document.activeElement as HTMLElement | null
    element.showModal()
    return () => { element.close(); opener?.focus() }
  }, [])
  return <dialog ref={dialog} className="drawer" aria-labelledby="source-title" onCancel={onClose}>
    <button onClick={onClose}>Close source record</button>
    <h2 id="source-title">Source record</h2>
    <dl><dt>File SHA-256</dt><dd className="hash">{reference.file_sha256}</dd><dt>Locator</dt><dd>{reference.locator}</dd></dl>
    <ResourceState {...resource} />
    {resource.data && <JsonView value={resource.data.payload} />}
  </dialog>
}

export default function SessionPage() {
  const { id = '' } = useParams()
  const resource = useResource(useCallback(() => getSession(id), [id]))
  const [source, setSource] = useState<{ sessionId: string; reference: RawReference }>()
  const session = resource.data
  return <><h1>Session detail</h1><ResourceState {...resource} />
    {session && <>
      <dl className="session-fields">{Object.entries({
        'Session ID': session.id, 'External ID': session.external_id, Source: session.source, Agent: session.agent,
        Repository: session.repo, User: session.user,
        'Observed start': session.observed_start_at, 'Observed end': session.observed_end_at,
        'Declared start': session.declared_started_at, 'Declared end': session.declared_ended_at,
        'Model calls': session.model_call_count, 'Tool calls': session.tool_call_count,
        'Input tokens': session.input_tokens.value,
        'Input token coverage': `${session.input_tokens.coverage.known} / ${session.input_tokens.coverage.total} calls`,
      }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{display(value)}</dd></div>)}</dl>
      <p>Observed timestamps describe the span in imported data, not active time.</p>
      <Table caption="Recorded model-call observations" headers={['ID', 'Sequence', 'Model', 'Started', 'Ended', 'Input tokens', 'Output tokens', 'Token semantics', 'Source']}>
        {session.model_calls.map(call => <tr key={call.id}><td>{call.id}</td><td>{display(call.sequence)}</td><td>{display(call.model)}</td>
          <td>{display(call.started_at)}</td><td>{display(call.ended_at)}</td><td>{display(call.input_tokens)}</td><td>{display(call.output_tokens)}</td><td>{display(call.token_semantics)}</td>
          <td><button aria-label={`Source record for model call ${call.id}`} onClick={() => setSource({ sessionId: id, reference: call.raw_record })}>Source record</button></td>
        </tr>)}
      </Table>
      {session.model_calls.length === 0 && <p>No model calls recorded.</p>}
      <Table caption="Recorded tool-call observations" headers={['ID', 'Model call', 'Tool', 'Started', 'Ended', 'Wall latency (ms)', 'Error', 'Source']}>
        {session.tool_calls.map(call => <tr key={call.id}><td>{call.id}</td><td>{display(call.model_call_id)}</td><td>{display(call.tool_name)}</td>
          <td>{display(call.started_at)}</td><td>{display(call.ended_at)}</td><td>{display(call.wall_latency_ms)}</td><td>{call.is_error === null ? 'Unavailable' : call.is_error ? 'Yes' : 'No'}</td>
          <td><button aria-label={`Source record for tool call ${call.id}`} onClick={() => setSource({ sessionId: id, reference: call.raw_record })}>Source record</button></td>
        </tr>)}
      </Table>
      {session.tool_calls.length === 0 && <p>No tool calls recorded.</p>}
      <h2>Diagnostics</h2>
      {session.diagnostics.length === 0 ? <p>No diagnostics.</p> : <Table caption="Session diagnostics" headers={['Code', 'Field', 'Message']}>
        {session.diagnostics.map((item, index) => <tr key={index}><td>{item.code}</td><td>{item.field}</td><td>{item.message}</td></tr>)}
      </Table>}
    </>}
    {source?.sessionId === id && <SourceDrawer reference={source.reference} onClose={() => setSource(undefined)} />}
  </>
}
