import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getMetricsSummary, getSession } from '../api'
import type { RawReference } from '../api'
import { DataTable, Notice, SourceRecordDialog, StateBlock } from '../components'
import type { Column } from '../components'
import { display } from '../format'
import { useScope } from '../scope'
import { useScopeBar } from '../shellHooks'
import { useResource } from '../useResource'
import type { ModelCall, ToolCall } from '../api'

/**
 * One session: identity, interval (declared vs observed), tokens with
 * coverage, the two observation tables, diagnostics only when there are any,
 * and the Source record drawer. The scope bar stays for context but is not
 * applied to the detail.
 */
export default function SessionPage() {
  const { id = '' } = useParams()
  const { scope, link } = useScope()
  const resource = useResource(useCallback(() => getSession(id), [id]))
  // The bar keeps the list's context: its receipt is recomputed for the current scope,
  // never carried over from the page that opened this one.
  const metrics = useResource(useCallback(() => getMetricsSummary(scope), [scope]))
  const [source, setSource] = useState<{ sessionId: string; reference: RawReference }>()
  useScopeBar(
    [{ key: 'source', label: 'Source', options: [] }, { key: 'agent', label: 'Agent', options: [] }],
    metrics.data ? { sessions: metrics.data.sessions.value, modelCalls: metrics.data.model_calls.value } : metrics.error ? {} : undefined,
    metrics.loading,
  )
  const session = resource.data
  const modelColumns: Column<ModelCall>[] = [
    { key: 'id', header: 'ID', mono: true, render: call => call.id },
    { key: 'seq', header: 'Seq', align: 'num', render: call => display(call.sequence) },
    { key: 'model', header: 'Model', render: call => display(call.model) },
    { key: 'started', header: 'Started', mono: true, render: call => display(call.started_at) },
    { key: 'ended', header: 'Ended', mono: true, render: call => display(call.ended_at) },
    { key: 'in', header: 'Input tokens', align: 'num', render: call => display(call.input_tokens) },
    { key: 'out', header: 'Output tokens', align: 'num', render: call => display(call.output_tokens) },
    { key: 'sem', header: 'Semantics', render: call => display(call.token_semantics) },
    { key: 'src', header: 'Source', render: call => <button className="btn small" aria-label={`Source record for model call ${call.id}`} onClick={() => setSource({ sessionId: id, reference: call.raw_record })}>Source record</button> },
  ]
  const toolColumns: Column<ToolCall>[] = [
    { key: 'id', header: 'ID', mono: true, render: call => call.id },
    { key: 'call', header: 'Model call', mono: true, render: call => call.model_call_id ?? <span className="pill">unlinked</span> },
    { key: 'tool', header: 'Tool', render: call => display(call.tool_name) },
    { key: 'started', header: 'Started', mono: true, render: call => display(call.started_at) },
    { key: 'ended', header: 'Ended', mono: true, render: call => display(call.ended_at) },
    { key: 'wall', header: 'Wall latency (ms)', align: 'num', render: call => display(call.wall_latency_ms) },
    { key: 'error', header: 'Error', render: call => call.is_error === null ? 'Unavailable' : call.is_error ? 'Yes' : 'No' },
    { key: 'src', header: 'Source', render: call => <button className="btn small" aria-label={`Source record for tool call ${call.id}`} onClick={() => setSource({ sessionId: id, reference: call.raw_record })}>Source record</button> },
  ]
  return <>
    <nav className="crumbs" aria-label="Breadcrumb"><Link to={link('/sessions')}>Sessions</Link><span>/</span><span className="mono">{id}</span></nav>
    <div className="page-head"><h1>Session detail</h1>{session && <span className="sub mono">{session.external_id}</span>}</div>
    <StateBlock loading={resource.loading} error={resource.error} retry={resource.retry} lines={6}>
      {resource.error ? <p><Link to={link('/sessions')}>Back to sessions in scope</Link></p> : null}
      {session && <>
        <div className="grid panels">
          <section className="panel"><div className="panel-head"><h2>Identity</h2></div>
            <dl className="facts"><dt>Session ID</dt><dd className="mono">{session.id}</dd><dt>External ID</dt><dd className="mono">{session.external_id}</dd>
              <dt>Source</dt><dd>{session.source}</dd><dt>Agent</dt><dd>{display(session.agent)}</dd><dt>Repository</dt><dd>{display(session.repo)}</dd><dt>User</dt><dd>{display(session.user)}</dd></dl></section>
          <section className="panel"><div className="panel-head"><h2>Interval</h2></div>
            <dl className="facts"><dt>Observed start</dt><dd className="mono">{display(session.observed_start_at)}</dd><dt>Observed end</dt><dd className="mono">{display(session.observed_end_at)}</dd>
              <dt>Declared start</dt><dd className="mono">{display(session.declared_started_at)}</dd><dt>Declared end</dt><dd className="mono">{display(session.declared_ended_at)}</dd></dl>
            <p style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)', marginTop: 8 }}>Observed timestamps describe the span in imported data, not active time.</p></section>
          <section className="panel"><div className="panel-head"><h2>Tokens</h2></div>
            <dl className="facts"><dt>Model calls</dt><dd>{display(session.model_call_count)}</dd><dt>Tool calls</dt><dd>{display(session.tool_call_count)}</dd>
              <dt>Input tokens</dt><dd>{display(session.input_tokens.value)}</dd><dt>Input token coverage</dt><dd>{session.input_tokens.coverage.known} / {session.input_tokens.coverage.total} calls</dd></dl></section>
        </div>
        {session.diagnostics.length > 0 && <Notice kind="warn" title={`${session.diagnostics.length} diagnostic${session.diagnostics.length > 1 ? 's' : ''}`}>
          <DataTable caption="Session diagnostics" hideCaption columns={[
            { key: 'code', header: 'Code', mono: true, render: item => item.code },
            { key: 'field', header: 'Field', render: item => item.field ?? '—' },
            { key: 'message', header: 'Message', wrap: true, render: item => item.message },
          ]} rows={session.diagnostics} rowKey={(item) => `${item.code}:${item.field}:${item.message}`} empty="" />
        </Notice>}
        <section className="panel"><div className="panel-head"><h2>Recorded model-call observations</h2><span className="count">{session.model_calls.length}</span></div>
          <DataTable caption="Recorded model-call observations" hideCaption columns={modelColumns} rows={session.model_calls} rowKey={call => call.id} empty="No model calls recorded." /></section>
        <section className="panel"><div className="panel-head"><h2>Recorded tool-call observations</h2><span className="count">{session.tool_calls.length}</span></div>
          <DataTable caption="Recorded tool-call observations" hideCaption columns={toolColumns} rows={session.tool_calls} rowKey={call => call.id} empty="No tool calls recorded." /></section>
      </>}
    </StateBlock>
    {source?.sessionId === id && <SourceRecordDialog reference={source.reference} onClose={() => setSource(undefined)} />}
  </>
}
