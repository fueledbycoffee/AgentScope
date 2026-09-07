import { useState } from 'react'
import { DataTable, Drawer, JsonText, KpiTile, Notice, Pagination, Popover, QualityStrip, ScopeChip, Skeleton, StateBlock, StatusPill } from '../components'
import { DayBars, HBars } from '../components/charts'
import { ApiError } from '../api'

/**
 * Development-only gallery: every component in every state, so a reviewer can
 * see the system without importing data. Switch the theme with the rail
 * toggle; tokens are root-scoped, so one theme shows at a time.
 */
export default function GalleryPage() {
  const [drawer, setDrawer] = useState(false)
  const [chip, setChip] = useState(true)
  const [selected, setSelected] = useState<string>()
  const days = Array.from({ length: 14 }, (_, index) => ({ name: `06-${String(index + 1).padStart(2, '0')}`, value: [120, 88, 260, 140, 300, 90, 210, 330, 180, 240, 60, 410, 150, 200][index] }))
  const tools = [['Bash', 2032], ['Read', 1534], ['Edit', 1013], ['Grep', 484], ['Glob', 377], ['Agent', 180], ['WebFetch', 103]].map(([name, value]) => ({ name: String(name), value: Number(value) }))
  return <>
    <div className="page-head"><h1>Component gallery</h1><span className="sub">development only</span></div>
    <section className="panel"><div className="panel-head"><h2>KPI tiles</h2></div>
      <div className="grid kpis">
        <KpiTile label="Sessions" value={80} definition="Distinct sessions in scope." note="1 import in scope" />
        <KpiTile label="Input tokens" value={553447877} unit="tokens" coverage={{ known: 4770, total: 4770, unit: 'calls' }} definition="Sum of input tokens over calls with a known value." semantics={{ 'tracelab-claude': 191700000, 'tracelab-codex': 361747877 }} />
        <KpiTile label="Output tokens" value={1204331} unit="tokens" coverage={{ known: 4750, total: 4770, unit: 'calls' }} definition="Sum of output tokens over calls with a known value." />
        <KpiTile label="Cache read tokens" value={null} coverage={{ known: 0, total: 3187, unit: 'calls' }} definition="Unavailable outside tracelab-claude semantics." />
      </div></section>
    <section className="panel"><div className="panel-head"><h2>Charts</h2><span className="count">{selected ? `selected ${selected}` : 'click or focus a bar'}</span></div>
      <div className="grid charts">
        <DayBars title="Activity by day" unit="model calls" data={days} onSelect={setSelected} hint="Click a day to list its sessions." />
        <HBars title="Tool calls" unit="calls" data={tools} onSelect={setSelected} hint="Click a tool to list sessions using it." />
      </div></section>
    <QualityStrip items={[
      { key: 'rejects', label: 'rejects', count: 0, explanation: 'Records no rule could turn into an observation.' },
      { key: 'missing', label: 'missing usage', count: 20, explanation: 'Model calls without a known input token count.', onList: () => setSelected('missing usage') },
      { key: 'unknown', label: 'unknown timestamps', count: 0, explanation: 'Observations whose timestamp could not be parsed.' },
      { key: 'unlinked', label: 'unlinked tools', count: 41, explanation: 'Tool calls with no enclosing model call.', onList: () => setSelected('unlinked tools') },
    ]} />
    <section className="panel"><div className="panel-head"><h2>Status, notices, chips, popover</h2></div>
      <div className="row">{['committed', 'duplicate', 'failed', 'running', 'pending'].map(status => <StatusPill key={status} status={status} />)}
        {chip && <ScopeChip label="day" value="2026-06-04" onRemove={() => setChip(false)} />}
        <Popover label="Definition of Sessions" title="Sessions"><dl className="facts"><dt>Definition</dt><dd>Distinct sessions in scope.</dd><dt>Coverage</dt><dd>80 / 80</dd></dl></Popover>
        <button className="btn" onClick={() => setDrawer(true)}>Open drawer</button>
      </div>
      <div className="stack" style={{ marginTop: 12 }}>
        <Notice title="These bytes were imported before.">Importing again for the same source adds no observations.</Notice>
        <Notice kind="warn" title="1 diagnostic">conflicting_value on agent: record line:188731 says claude-code, record line:188728 says codex.</Notice>
        <Notice kind="bad" title="Import failed. Nothing was inserted.">IntegrityError: UNIQUE constraint failed.</Notice>
      </div></section>
    <section className="panel"><div className="panel-head"><h2>States</h2></div>
      <div className="grid panels">
        <div><h3>Loading</h3><StateBlock loading lines={4} /></div>
        <div><h3>Error</h3><StateBlock loading={false} error={new ApiError(409, { code: 'import_conflict', message: 'Another import committed these bytes', details: [] })} retry={() => undefined} /></div>
        <div><h3>Skeleton</h3><Skeleton lines={3} /></div>
      </div></section>
    <section className="panel"><div className="panel-head"><h2>Data table</h2></div>
      <DataTable caption="Sessions in scope" count={3} columns={[
        { key: 'id', header: 'Session', mono: true, render: (row: { id: string; n: number }) => row.id },
        { key: 'n', header: 'Model calls', align: 'num', render: row => row.n },
      ]} rows={[{ id: 'claude:781a3b4c', n: 2 }, { id: 'claude:b739f066', n: 27 }, { id: 'codex:2875b5ae', n: 90 }]} rowKey={row => row.id} empty="No sessions." />
      <Pagination offset={0} count={3} onChange={() => undefined} />
      <DataTable caption="Empty table" columns={[{ key: 'a', header: 'A', render: () => null }]} rows={[]} rowKey={() => ''} empty="Nothing in scope yet." />
    </section>
    {drawer && <Drawer title="Source record" onClose={() => setDrawer(false)}>
      <dl className="facts"><dt>File SHA-256</dt><dd className="hash">d044a766e12c7eceae2eb1ed71e42d95cf0aec2f10c8d61a06cecc0381fb9897</dd><dt>Locator</dt><dd className="mono">line:487</dd></dl>
      <JsonText text={'{\n  "provider": "claude",\n  "input_tokens_total": 17786,\n  "big": 9007199254740993\n}'} highlight="9007199254740993" />
    </Drawer>}
  </>
}
