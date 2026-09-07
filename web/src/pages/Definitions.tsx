import { useCallback } from 'react'
import { getMetricsSummary } from '../api'
import { DataTable, StateBlock } from '../components'
import { useFileBar } from '../shellHooks'
import { useResource } from '../useResource'

interface Row { key: string; metric: string; unit: string; definition: string; semantics: string }

/**
 * Every metric the API defines today, with its unit and definition. Semantics
 * tags and comparability rules arrive with the metric layer (#10); this page
 * renders what the summary returns rather than restating it by hand.
 */
export default function DefinitionsPage() {
  const resource = useResource(useCallback(() => getMetricsSummary({}), []))
  useFileBar('Definitions', [])
  const rows: Row[] = resource.data ? [
    { key: 'sessions', metric: 'Sessions', unit: 'sessions', definition: resource.data.sessions.definition, semantics: '—' },
    { key: 'model_calls', metric: 'Model calls', unit: 'observations', definition: resource.data.model_calls.definition, semantics: '—' },
    { key: 'tool_calls', metric: 'Tool calls', unit: 'observations', definition: resource.data.tool_calls.definition, semantics: '—' },
    { key: 'input_tokens', metric: 'Input tokens', unit: resource.data.input_tokens.unit, definition: resource.data.input_tokens.definition, semantics: Object.keys(resource.data.input_tokens.by_semantics).join(', ') || '—' },
  ] : []
  return <>
    <div className="page-head"><h1>Definitions</h1><span className="sub">what every number means, from the same source the tiles use</span></div>
    <section className="panel">
      <StateBlock loading={resource.loading} error={resource.error} retry={resource.retry} lines={4}>
        <DataTable caption="Metric definitions" hideCaption columns={[
          { key: 'metric', header: 'Metric', render: row => row.metric },
          { key: 'unit', header: 'Unit', render: row => row.unit },
          { key: 'definition', header: 'Definition', wrap: true, render: row => row.definition },
          { key: 'semantics', header: 'Token semantics seen', render: row => row.semantics },
        ]} rows={rows} rowKey={row => row.key} empty="No definitions yet." />
      </StateBlock>
    </section>
  </>
}
