import { useState } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { abbreviate } from '../format'

/**
 * Chart wrappers over Recharts that apply the token colours, abbreviate axes
 * with the exact value in the tooltip and in a focus hint line, and expose one
 * `onSelect(value)` contract for drilling. A visually hidden table under each
 * chart carries the exact numbers for keyboard and screen-reader users.
 */

export interface Point { name: string; value: number }

function Tip({ active, payload, unit }: { active?: boolean; payload?: { payload: Point }[]; unit?: string }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return <div className="chart-tip"><b>{point.name}</b> · {point.value.toLocaleString('en-US')}{unit ? ` ${unit}` : ''}</div>
}

function HiddenTable({ title, data, unit }: { title: string; data: Point[]; unit?: string }) {
  return <table className="visually-hidden"><caption>{title}, exact values</caption>
    <thead><tr><th scope="col">Item</th><th scope="col">{unit ?? 'Value'}</th></tr></thead>
    <tbody>{data.map(point => <tr key={point.name}><td>{point.name}</td><td>{point.value.toLocaleString('en-US')}</td></tr>)}</tbody>
  </table>
}

interface ChartProps { title: string; data: Point[]; unit?: string; onSelect?: (name: string) => void; hint?: string; color?: string }

/** Vertical bars, one per day (or category). */
export function DayBars({ title, data, unit, onSelect, hint, color = 'var(--s1)' }: ChartProps) {
  const [focused, setFocused] = useState<Point>()
  return <section className="chart" aria-label={title}>
    <div className="panel-head" style={{ marginBottom: 0 }}><h3>{title}</h3>{unit && <span className="count">{unit}</span>}</div>
    {data.length === 0 ? <p className="state-block">Nothing in scope.</p> : <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" />
        <YAxis width={48} tickLine={false} axisLine={false} tickFormatter={value => abbreviate(Number(value))} />
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: 'var(--surface-3)' }} />
        <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} tabIndex={0}
          onClick={(point: { payload?: Point }) => point.payload && onSelect?.(point.payload.name)}
          onFocus={(point: { payload?: Point }) => setFocused(point.payload)} onBlur={() => setFocused(undefined)}
          onKeyDown={(point: { payload?: Point }, _index: number, event: { key: string }) => { if ((event.key === 'Enter' || event.key === ' ') && point.payload) onSelect?.(point.payload.name) }} />
      </BarChart>
    </ResponsiveContainer>}
    <p className="hint" aria-live="polite">{focused ? `${focused.name}: ${focused.value.toLocaleString('en-US')}${unit ? ` ${unit}` : ''}` : hint}</p>
    <HiddenTable title={title} data={data} unit={unit} />
  </section>
}

/** Horizontal bars, one per named item (models, tools). */
export function HBars({ title, data, unit, onSelect, hint, color = 'var(--s2)' }: ChartProps) {
  const [focused, setFocused] = useState<Point>()
  const height = Math.max(120, 28 * data.length + 24)
  return <section className="chart" aria-label={title}>
    <div className="panel-head" style={{ marginBottom: 0 }}><h3>{title}</h3>{unit && <span className="count">{unit}</span>}</div>
    {data.length === 0 ? <p className="state-block">Nothing in scope.</p> : <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} />
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: 'var(--surface-3)' }} />
        <Bar dataKey="value" fill={color} radius={[0, 3, 3, 0]} isAnimationActive={false} tabIndex={0} barSize={16}
          label={{ position: 'right', fill: 'var(--ink-3)', fontSize: 11, formatter: (value: unknown) => abbreviate(Number(value)) }}
          onClick={(point: { payload?: Point }) => point.payload && onSelect?.(point.payload.name)}
          onFocus={(point: { payload?: Point }) => setFocused(point.payload)} onBlur={() => setFocused(undefined)}
          onKeyDown={(point: { payload?: Point }, _index: number, event: { key: string }) => { if ((event.key === 'Enter' || event.key === ' ') && point.payload) onSelect?.(point.payload.name) }} />
      </BarChart>
    </ResponsiveContainer>}
    <p className="hint" aria-live="polite">{focused ? `${focused.name}: ${focused.value.toLocaleString('en-US')}${unit ? ` ${unit}` : ''}` : hint}</p>
    <HiddenTable title={title} data={data} unit={unit} />
  </section>
}
