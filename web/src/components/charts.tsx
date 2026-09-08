import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ChartPoint, TokenMeasure, TokenRow } from '../dashboard/dashboardData'
import { groupExactText } from './exactText'
import { abbreviateDecimalText } from './primitives'

interface ShapeProps {
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
  payload?: ChartPoint
}

export function AccessibleBarShape({ shape, onSelect, onFocus }: {
  shape: ShapeProps
  onSelect?: (point: ChartPoint) => void
  onFocus: (point?: ChartPoint) => void
}) {
  const point = shape.payload
  if (!point || !shape.width || !shape.height) return null
  const activate = () => onSelect?.(point)
  const key = (event: KeyboardEvent<SVGRectElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }
  return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={3} fill={shape.fill}
    className="chart-bar" role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
    aria-label={`${point.label}: ${groupExactText(point.valueText)}${point.coverage ? `; coverage ${groupExactText(String(point.coverage.known))} / ${groupExactText(String(point.coverage.total))}` : ''}`} onClick={activate}
    onFocus={() => onFocus(point)} onBlur={() => onFocus()} onKeyDown={key} />
}

function Tip({ active, payload, unit }: { active?: boolean; payload?: { payload: ChartPoint }[]; unit?: string }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return <div className="chart-tip"><b>{point.label}</b> · <span className="exact">{groupExactText(point.valueText)}</span>{unit ? ` ${unit}` : ''} · coverage {groupExactText(String(point.coverage.known))} / {groupExactText(String(point.coverage.total))}</div>
}

function HiddenTable({ title, data, unit }: { title: string; data: ChartPoint[]; unit?: string }) {
  return <table className="visually-hidden"><caption>{title}, exact values</caption>
    <thead><tr><th scope="col">Item</th><th scope="col">{unit ?? 'Value'}</th><th scope="col">Coverage</th></tr></thead>
    <tbody>{data.map(point => <tr key={point.key}><td>{point.label}</td><td>{groupExactText(point.valueText)}</td><td>{groupExactText(String(point.coverage.known))} / {groupExactText(String(point.coverage.total))}</td></tr>)}</tbody>
  </table>
}

interface ChartProps { title: string; data: ChartPoint[]; unit?: string; onSelect?: (point: ChartPoint) => void; hint?: string; color?: string }

/** Vertical UTC day bars. Exact strings live outside floating-point geometry. */
export function DayBars({ title, data, unit, onSelect, hint, color = 'var(--s1)' }: ChartProps) {
  const [focused, setFocused] = useState<ChartPoint>()
  const width = Math.max(560, data.length * 40)
  return <section className="chart" aria-label={title}>
    <div className="panel-head" style={{ marginBottom: 0 }}><h3>{title}</h3>{unit && <span className="count">{unit}</span>}</div>
    {data.length === 0 ? <p className="state-block">Nothing in scope.</p> : <div className="chart-scroll"><div style={{ width }}><ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" />
        <YAxis width={48} tickLine={false} axisLine={false} tickFormatter={value => abbreviateDecimalText(String(value))} />
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: 'var(--surface-3)' }} />
        <Bar dataKey="plotValue" fill={color} isAnimationActive={false}
          shape={props => <AccessibleBarShape shape={props as ShapeProps} onSelect={onSelect} onFocus={setFocused} />} />
      </BarChart>
    </ResponsiveContainer></div></div>}
    <p className="hint" aria-live="polite">{focused ? `${focused.label}: ${groupExactText(focused.valueText)}${unit ? ` ${unit}` : ''} · coverage ${groupExactText(String(focused.coverage.known))} / ${groupExactText(String(focused.coverage.total))}` : hint}</p>
    <HiddenTable title={title} data={data} unit={unit} />
  </section>
}

/** Horizontal exact bars for recorded tool names. */
export function HBars({ title, data, unit, onSelect, hint, color = 'var(--s2)' }: ChartProps) {
  const [focused, setFocused] = useState<ChartPoint>()
  const height = Math.max(120, 28 * data.length + 24)
  return <section className="chart" aria-label={title}>
    <div className="panel-head" style={{ marginBottom: 0 }}><h3>{title}</h3>{unit && <span className="count">{unit}</span>}</div>
    {data.length === 0 ? <p className="state-block">Nothing in scope.</p> : <div className="chart-scroll vertical"><ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false} />
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: 'var(--surface-3)' }} />
        <Bar dataKey="plotValue" fill={color} isAnimationActive={false} barSize={16}
          label={{ position: 'right', fill: 'var(--ink-3)', fontSize: 11, formatter: (value: unknown) => abbreviateDecimalText(String(value)) }}
          shape={props => <AccessibleBarShape shape={props as ShapeProps} onSelect={onSelect} onFocus={setFocused} />} />
      </BarChart>
    </ResponsiveContainer></div>}
    <p className="hint" aria-live="polite">{focused ? `${focused.label}: ${groupExactText(focused.valueText)}${unit ? ` ${unit}` : ''} · coverage ${groupExactText(String(focused.coverage.known))} / ${groupExactText(String(focused.coverage.total))}` : hint}</p>
    <HiddenTable title={title} data={data} unit={unit} />
  </section>
}

interface TokenPlotRow extends TokenRow { inputPlot?: number; outputPlot?: number }
interface TokenShapeProps extends Omit<ShapeProps, 'payload'> { payload?: TokenPlotRow }

function TokenShape({ shape, series, onSelect, onFocus }: {
  shape: TokenShapeProps
  series: 'input' | 'output'
  onSelect?: (row: TokenRow, measure: TokenMeasure) => void
  onFocus: (text?: string) => void
}) {
  const row = shape.payload
  const measure = row?.[series]
  if (!row || !measure || measure.valueText === null || !shape.width || !shape.height) return null
  const label = `${row.label}, ${series}: ${groupExactText(measure.valueText)}`
  const activate = () => onSelect?.(row, measure)
  return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={3} fill={shape.fill}
    className="chart-bar" role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
    aria-label={label} onClick={activate} onFocus={() => onFocus(label)} onBlur={() => onFocus()}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() } }} />
}

export function TokenBars({ title, rows, onSelect }: { title: string; rows: TokenRow[]; onSelect?: (row: TokenRow, measure: TokenMeasure) => void }) {
  const [focused, setFocused] = useState<string>()
  const data: TokenPlotRow[] = rows.map(row => ({
    ...row,
    inputPlot: row.input?.plotValue ?? undefined,
    outputPlot: row.output?.plotValue ?? undefined,
  }))
  const height = Math.max(140, rows.length * 42 + 28)
  return <section className="chart token-chart" aria-label={title}>
    <div className="panel-head"><h3>{title}</h3><span className="chart-legend"><i className="input" />Input <i className="output" />Output</span></div>
    {rows.length === 0 ? <p className="state-block">No token usage in scope.</p> : <div className="chart-scroll vertical"><ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={170} tickLine={false} axisLine={false} />
        <Tooltip formatter={(_value, name, item) => {
          const row = item.payload as TokenPlotRow
          const measure = row[name === 'Input' ? 'input' : 'output']
          return [measure?.valueText === null || measure?.valueText === undefined ? 'Unavailable' : groupExactText(measure.valueText), name]
        }} />
        <Bar name="Input" dataKey="inputPlot" fill="var(--s1)" isAnimationActive={false} barSize={10}
          shape={props => <TokenShape shape={props as TokenShapeProps} series="input" onSelect={onSelect} onFocus={setFocused} />} />
        <Bar name="Output" dataKey="outputPlot" fill="var(--s2)" isAnimationActive={false} barSize={10}
          shape={props => <TokenShape shape={props as TokenShapeProps} series="output" onSelect={onSelect} onFocus={setFocused} />} />
      </BarChart>
    </ResponsiveContainer></div>}
    <p className="hint" aria-live="polite">{focused ?? 'Select a bar to list its matching sessions.'}</p>
    <table className="visually-hidden"><caption>{title}, exact values</caption>
      <thead><tr><th>Model and accounting</th><th>Input</th><th>Input coverage</th><th>Output</th><th>Output coverage</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.key}><td>{row.label}</td><td>{row.input?.valueText == null ? 'Unavailable' : groupExactText(row.input.valueText)}</td><td>{row.input ? `${groupExactText(String(row.input.coverage.known))} / ${groupExactText(String(row.input.coverage.total))}` : 'Unavailable'}</td><td>{row.output?.valueText == null ? 'Unavailable' : groupExactText(row.output.valueText)}</td><td>{row.output ? `${groupExactText(String(row.output.coverage.known))} / ${groupExactText(String(row.output.coverage.total))}` : 'Unavailable'}</td></tr>)}</tbody>
    </table>
  </section>
}
