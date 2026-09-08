import { useCallback } from 'react'
import { getMetricDefinitions } from '../api'
import type { MetricDefinition } from '../api'
import { DataTable, StateBlock } from '../components'
import { useFileBar } from '../shellHooks'
import { useResource } from '../useResource'

const optional = (value: string | null) => value ?? 'Not applicable'

/** The complete server registry, without a client-owned second glossary. */
export default function DefinitionsPage() {
  const resource = useResource(useCallback(() => getMetricDefinitions(), []))
  useFileBar('Definitions', [])
  return <>
    <div className="page-head"><h1>Definitions</h1><span className="sub">the server registry that governs every dashboard number</span></div>
    <section className="panel">
      <StateBlock loading={resource.loading} error={resource.error} retry={resource.retry} lines={7}>
        <DataTable caption="Metric definitions" columns={[
          { key: 'metric', header: 'Metric / version', wrap: true, render: (row: MetricDefinition) => <span id={row.id}><b>{row.label}</b><br /><code>{row.id}</code> · v{row.version}{row.headline_kpi && <><br /><span className="pill">headline</span></>}{row.diagnostic && <><br /><span className="pill">definition only</span></>}</span> },
          { key: 'unit', header: 'Unit / grain', render: row => <>{row.unit}<br />{row.grain}</> },
          { key: 'definition', header: 'Definition / formula', wrap: true, render: row => <>{row.description}<br /><span className="muted">{row.formula}</span>{row.caveat && <><br />Caveat: {row.caveat}</>}</> },
          { key: 'population', header: 'Population / scope', wrap: true, render: row => <>{optional(row.population)}<br />{row.scope}</> },
          { key: 'null', header: 'Null / coverage', wrap: true, render: row => <>{row.null_handling}<br />Coverage field: {optional(row.coverage_field)}</> },
          { key: 'semantics', header: 'Semantics / comparability', wrap: true, render: row => <>{optional(row.semantics_field)}<br />{row.comparability_rule}{row.model_group_required && <><br />Model group required</>}</> },
          { key: 'display', header: 'Display / quantiles', wrap: true, render: row => <>{row.display_decimal_places} decimal places · {row.display_rounding}<br />{row.quantile_rule}<br />Median: {row.median_rule}</> },
        ]} rows={resource.data ?? []} rowKey={row => row.id} empty="No metric definitions were published." />
      </StateBlock>
    </section>
  </>
}
