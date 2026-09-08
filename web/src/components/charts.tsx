import { createContext, useContext, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
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

const MAX_PRESS_MOVEMENT = 5

interface BarPress {
  source: 'mouse' | 'pointer'
  clientX: number
  clientY: number
  pointerId?: number
  dragged: boolean
}

function useBarActivation(activate: () => void) {
  const press = useRef<BarPress | undefined>(undefined)
  const suppressClick = useRef(false)

  const moved = (current: BarPress, clientX: number, clientY: number) => (
    Math.abs(clientX - current.clientX) > MAX_PRESS_MOVEMENT
    || Math.abs(clientY - current.clientY) > MAX_PRESS_MOVEMENT
  )
  const finish = (current: BarPress, clientX: number, clientY: number) => {
    suppressClick.current = true
    if (!current.dragged && !moved(current, clientX, clientY)) activate()
  }

  return {
    onClick: (event: ReactMouseEvent<SVGRectElement>) => {
      // Pointer/mouse release already activated the bar. Keep click for keyboard and
      // scripted activation, which arrive without a preceding physical release.
      if (suppressClick.current && event.detail !== 0) {
        suppressClick.current = false
        return
      }
      suppressClick.current = false
      activate()
    },
    onPointerDown: (event: ReactPointerEvent<SVGRectElement>) => {
      if (event.button !== 0) return
      suppressClick.current = false
      press.current = {
        source: 'pointer', pointerId: event.pointerId,
        clientX: event.clientX, clientY: event.clientY, dragged: false,
      }
    },
    onPointerMove: (event: ReactPointerEvent<SVGRectElement>) => {
      const current = press.current
      if (current?.source === 'pointer' && current.pointerId === event.pointerId && moved(current, event.clientX, event.clientY)) {
        current.dragged = true
      }
    },
    onPointerUp: (event: ReactPointerEvent<SVGRectElement>) => {
      const current = press.current
      press.current = undefined
      if (current?.source === 'pointer' && current.pointerId === event.pointerId) {
        finish(current, event.clientX, event.clientY)
      }
    },
    onPointerCancel: () => { press.current = undefined },
    onMouseDown: (event: ReactMouseEvent<SVGRectElement>) => {
      if (event.button !== 0 || press.current?.source === 'pointer') return
      suppressClick.current = false
      press.current = {
        source: 'mouse', clientX: event.clientX, clientY: event.clientY, dragged: false,
      }
    },
    onMouseMove: (event: ReactMouseEvent<SVGRectElement>) => {
      const current = press.current
      if (current?.source === 'mouse' && moved(current, event.clientX, event.clientY)) current.dragged = true
    },
    onMouseUp: (event: ReactMouseEvent<SVGRectElement>) => {
      const current = press.current
      if (current?.source !== 'mouse') return
      press.current = undefined
      finish(current, event.clientX, event.clientY)
    },
  }
}

export function AccessibleBarShape({ shape, onSelect, onFocus }: {
  shape: ShapeProps
  onSelect?: (point: ChartPoint) => void
  onFocus: (point?: ChartPoint) => void
}) {
  const point = shape.payload
  const activate = () => { if (point) onSelect?.(point) }
  const activation = useBarActivation(activate)
  if (!point || !shape.width || !shape.height) return null
  const key = (event: KeyboardEvent<SVGRectElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }
  return <rect key={point.key} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={3} fill={shape.fill}
    className="chart-bar" role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
    aria-label={`${point.label}: ${groupExactText(point.valueText)}${point.coverage ? `; coverage ${groupExactText(String(point.coverage.known))} / ${groupExactText(String(point.coverage.total))}` : ''}`}
    {...activation} onFocus={() => onFocus(point)} onBlur={() => onFocus()} onKeyDown={key} />
}

interface PointShapeContextValue {
  onSelect?: (point: ChartPoint) => void
  onFocus: (point?: ChartPoint) => void
}

const PointShapeContext = createContext<PointShapeContextValue>({ onFocus: () => undefined })

function ContextualPointBarShape({ shape }: { shape: ShapeProps }) {
  const context = useContext(PointShapeContext)
  return <AccessibleBarShape shape={shape} onSelect={context.onSelect} onFocus={context.onFocus} />
}

/** A stable Recharts shape type and data key keep each rect mounted while tooltip state changes. */
function PointBarShape(shape: ShapeProps) {
  return <ContextualPointBarShape key={shape.payload?.key} shape={shape} />
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
  const shapeContext = useMemo(() => ({ onSelect, onFocus: setFocused }), [onSelect])
  const width = Math.max(560, data.length * 40)
  return <section className="chart" aria-label={title}>
    <div className="panel-head" style={{ marginBottom: 0 }}><h3>{title}</h3>{unit && <span className="count">{unit}</span>}</div>
    {data.length === 0 ? <p className="state-block">Nothing in scope.</p> : <PointShapeContext.Provider value={shapeContext}><div className="chart-scroll"><div style={{ width }}><ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" />
        <YAxis width={48} tickLine={false} axisLine={false} tickFormatter={value => abbreviateDecimalText(String(value))} />
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: 'var(--surface-3)' }} />
        <Bar dataKey="plotValue" fill={color} isAnimationActive={false} activeBar={false}
          shape={PointBarShape} />
      </BarChart>
    </ResponsiveContainer></div></div></PointShapeContext.Provider>}
    <p className="hint" aria-live="polite">{focused ? `${focused.label}: ${groupExactText(focused.valueText)}${unit ? ` ${unit}` : ''} · coverage ${groupExactText(String(focused.coverage.known))} / ${groupExactText(String(focused.coverage.total))}` : hint}</p>
    <HiddenTable title={title} data={data} unit={unit} />
  </section>
}

/** Horizontal exact bars for recorded tool names. */
export function HBars({ title, data, unit, onSelect, hint, color = 'var(--s2)' }: ChartProps) {
  const [focused, setFocused] = useState<ChartPoint>()
  const shapeContext = useMemo(() => ({ onSelect, onFocus: setFocused }), [onSelect])
  const height = Math.max(120, 28 * data.length + 24)
  return <section className="chart" aria-label={title}>
    <div className="panel-head" style={{ marginBottom: 0 }}><h3>{title}</h3>{unit && <span className="count">{unit}</span>}</div>
    {data.length === 0 ? <p className="state-block">Nothing in scope.</p> : <PointShapeContext.Provider value={shapeContext}><div className="chart-scroll vertical"><ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false} />
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: 'var(--surface-3)' }} />
        <Bar dataKey="plotValue" fill={color} isAnimationActive={false} activeBar={false} barSize={16}
          label={{ position: 'right', fill: 'var(--ink-3)', fontSize: 11, formatter: (value: unknown) => abbreviateDecimalText(String(value)) }}
          shape={PointBarShape} />
      </BarChart>
    </ResponsiveContainer></div></PointShapeContext.Provider>}
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
  const activate = () => { if (row && measure) onSelect?.(row, measure) }
  const activation = useBarActivation(activate)
  if (!row || !measure || measure.valueText === null || !shape.width || !shape.height) return null
  const label = `${row.label}, ${series}: ${groupExactText(measure.valueText)}`
  return <rect key={`${series}:${row.key}`} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={3} fill={shape.fill}
    className="chart-bar" role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
    aria-label={label} {...activation} onFocus={() => onFocus(label)} onBlur={() => onFocus()}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() } }} />
}

interface TokenShapeContextValue {
  onSelect?: (row: TokenRow, measure: TokenMeasure) => void
  onFocus: (text?: string) => void
}

const TokenShapeContext = createContext<TokenShapeContextValue>({ onFocus: () => undefined })

function ContextualTokenBarShape({ shape, series }: { shape: TokenShapeProps; series: 'input' | 'output' }) {
  const context = useContext(TokenShapeContext)
  return <TokenShape shape={shape} series={series} onSelect={context.onSelect} onFocus={context.onFocus} />
}

function InputTokenBarShape(shape: TokenShapeProps) {
  return <ContextualTokenBarShape key={`input:${shape.payload?.key ?? ''}`} shape={shape} series="input" />
}

function OutputTokenBarShape(shape: TokenShapeProps) {
  return <ContextualTokenBarShape key={`output:${shape.payload?.key ?? ''}`} shape={shape} series="output" />
}

export function TokenBars({ title, rows, onSelect }: { title: string; rows: TokenRow[]; onSelect?: (row: TokenRow, measure: TokenMeasure) => void }) {
  const [focused, setFocused] = useState<string>()
  const shapeContext = useMemo(() => ({ onSelect, onFocus: setFocused }), [onSelect])
  const data: TokenPlotRow[] = rows.map(row => ({
    ...row,
    inputPlot: row.input?.plotValue ?? undefined,
    outputPlot: row.output?.plotValue ?? undefined,
  }))
  const height = Math.max(140, rows.length * 42 + 28)
  return <section className="chart token-chart" aria-label={title}>
    <div className="panel-head"><h3>{title}</h3><span className="chart-legend"><i className="input" />Input <i className="output" />Output</span></div>
    {rows.length === 0 ? <p className="state-block">No token usage in scope.</p> : <TokenShapeContext.Provider value={shapeContext}><div className="chart-scroll vertical"><ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={170} tickLine={false} axisLine={false} />
        <Tooltip formatter={(_value, name, item) => {
          const row = item.payload as TokenPlotRow
          const measure = row[name === 'Input' ? 'input' : 'output']
          return [measure?.valueText === null || measure?.valueText === undefined ? 'Unavailable' : groupExactText(measure.valueText), name]
        }} />
        <Bar name="Input" dataKey="inputPlot" fill="var(--s1)" isAnimationActive={false} activeBar={false} barSize={10}
          shape={InputTokenBarShape} />
        <Bar name="Output" dataKey="outputPlot" fill="var(--s2)" isAnimationActive={false} activeBar={false} barSize={10}
          shape={OutputTokenBarShape} />
      </BarChart>
    </ResponsiveContainer></div></TokenShapeContext.Provider>}
    <p className="hint" aria-live="polite">{focused ?? 'Select a bar to list its matching sessions.'}</p>
    <table className="visually-hidden"><caption>{title}, exact values</caption>
      <thead><tr><th>Model and accounting</th><th>Input</th><th>Input coverage</th><th>Output</th><th>Output coverage</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.key}><td>{row.label}</td><td>{row.input?.valueText == null ? 'Unavailable' : groupExactText(row.input.valueText)}</td><td>{row.input ? `${groupExactText(String(row.input.coverage.known))} / ${groupExactText(String(row.input.coverage.total))}` : 'Unavailable'}</td><td>{row.output?.valueText == null ? 'Unavailable' : groupExactText(row.output.valueText)}</td><td>{row.output ? `${groupExactText(String(row.output.coverage.known))} / ${groupExactText(String(row.output.coverage.total))}` : 'Unavailable'}</td></tr>)}</tbody>
    </table>
  </section>
}
