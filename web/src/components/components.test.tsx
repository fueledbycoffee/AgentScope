import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { DataTable, DayBars, Drawer, HBars, HeadlineTile, JsonText, KpiTile, Popover, QualityStrip, ScopeBar, ScopeChip, ScopeReceipt, StateBlock, TokenBars, abbreviate, abbreviateDecimalText } from './index'
import { AccessibleBarShape } from './charts'
import { ApiError } from '../api'
import type { MetricDisplay } from './index'
import { metricDefinitions } from '../test/fixtures'

const comparable: MetricDisplay = {
  valueText: '9007199254740993', recordedSumText: '9007199254740993',
  coverage: { known: 2, total: 2 }, comparability: 'comparable', reason: 'Comparable.', partitions: [],
}

describe('KpiTile', () => {
  it('renders count zero, comparable exact text, and null totals as unavailable without surface prose', () => {
    const mixed: MetricDisplay = {
      valueText: null, recordedSumText: '553447877', coverage: { known: 2, total: 2 },
      comparability: 'mixed', reason: 'not comparable: 2 token semantics in selection',
      partitions: [
        { semantics: 'tracelab-claude', valueText: '186454781', coverage: { known: 1, total: 1 } },
        { semantics: 'tracelab-codex', valueText: '366993096', coverage: { known: 1, total: 1 } },
      ],
    }
    const unavailable: MetricDisplay = {
      valueText: null, recordedSumText: null, coverage: { known: 0, total: 2 },
      comparability: 'unknown', reason: 'No known usage in scope.', partitions: [],
    }
    render(<><KpiTile label="Count" value={0} /><KpiTile label="Exact" display={comparable} />
      <KpiTile label="Unavailable metric" display={unavailable} /><KpiTile label="Mixed" display={mixed} /></>)
    expect(screen.getByRole('region', { name: 'Count' })).toHaveTextContent('0')
    const exact = screen.getByRole('region', { name: 'Exact' })
    expect(exact).toHaveTextContent('9007.2T')
    expect(exact).toHaveTextContent('exact 9,007,199,254,740,993')
    expect(screen.getByRole('region', { name: 'Unavailable metric' })).toHaveTextContent('Unavailable')
    const mixedTile = screen.getByRole('region', { name: 'Mixed' })
    expect(mixedTile).toHaveTextContent('Unavailable')
    expect(mixedTile).not.toHaveTextContent('not comparable')
    expect(mixedTile).not.toHaveTextContent('tracelab-claude')
    expect(mixedTile).not.toHaveTextContent('553447877')
  })

  it('uses product group names on the card and keeps raw accounting semantics in the popover', () => {
    const definition = metricDefinitions.find(item => item.id === 'input_tokens')!
    const mixed: MetricDisplay = {
      valueText: null, recordedSumText: '553448838', coverage: { known: 3, total: 3 },
      comparability: 'unknown', reason: 'not comparable: 3 token semantics in selection; unknown is unvalidated',
      partitions: [
        { semantics: 'tracelab-claude', valueText: '186454781', coverage: { known: 1, total: 1 } },
        { semantics: 'tracelab-codex', valueText: '366993096', coverage: { known: 1, total: 1 } },
        { semantics: 'unknown', valueText: '961', coverage: { known: 1, total: 1 } },
      ],
    }
    render(<MemoryRouter><KpiTile label="Input usage by accounting group" display={mixed} definition={definition} accountingGroups coverageUnit="calls" /></MemoryRouter>)
    const tile = screen.getByRole('region', { name: 'Input usage by accounting group' })
    expect(tile).toHaveTextContent('Claude186.5Mexact 186,454,781')
    expect(tile).toHaveTextContent('Codex367Mexact 366,993,096')
    expect(tile).toHaveTextContent('UnknownUnavailable')
    expect(tile).not.toHaveTextContent('Not comparable')
    expect(tile).not.toHaveTextContent('tracelab-claude')

    fireEvent.click(within(tile).getByRole('button', { name: 'Definition of Input usage by accounting group' }))
    const dialog = screen.getByRole('dialog', { name: 'Input usage by accounting group' })
    expect(dialog).toHaveTextContent('not comparable: 3 token semantics in selection')
    expect(dialog).toHaveTextContent('tracelab-claude: 186,454,781')
    expect(dialog).toHaveTextContent('tracelab-codex: 366,993,096')
  })

  it('returns focus from a complete registry popover and includes the cache-read result', () => {
    const definition = metricDefinitions.find(item => item.id === 'input_tokens')!
    const cacheRead: MetricDisplay = { valueText: null, recordedSumText: null, coverage: { known: 0, total: 2 }, comparability: 'unknown', reason: 'No known cache-read tokens in scope.', partitions: [] }
    render(<MemoryRouter><KpiTile label="Input usage by accounting group" display={comparable} unit="tokens" definition={definition} related={[{ label: 'Cache-read tokens', display: cacheRead }]} /></MemoryRouter>)
    const trigger = screen.getByRole('button', { name: 'Definition of Input usage by accounting group' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Input usage by accounting group' })
    expect(dialog).toHaveTextContent(definition.formula)
    expect(dialog).toHaveTextContent('Cache-read tokensUnavailable · coverage 0 / 2')
    expect(within(dialog).getByRole('link', { name: /Open complete definition/ })).toHaveAttribute('href', '/definitions#input_tokens')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('keeps cost detail off the surface and exposes it from the definition button', () => {
    const reason = 'Sum of priced groups; unpriced groups excluded, see priced coverage. 294 calls unpriced: no rate for this model id.'
    const definition = metricDefinitions.find(item => item.id === 'scheduled_cost_usd')!
    render(<MemoryRouter><HeadlineTile label="Scheduled cost" display={{ valueText: '132.8761978', recordedSumText: '132.8761978', coverage: { known: 4622, total: 4919 }, comparability: 'not_applicable', reason, partitions: [{ semantics: 'tracelab-claude', valueText: '107.8042053', coverage: { known: 1583, total: 1583 } }], pricedCoverage: { known: 180777240, total: 555935152, known_text: '180777240', total_text: '555935152' }, scheduleVersion: 'openrouter-v1' }} definition={definition} headlineText="$132.88" coverageText="priced 32.5 % of recorded tokens · 4,622 / 4,919 calls" showHeadlineExact /></MemoryRouter>)
    const tile = screen.getByRole('region', { name: 'Scheduled cost' })
    expect(tile).toHaveTextContent('$132.88')
    expect(tile).toHaveTextContent('exact 132.8761978')
    expect(tile).toHaveTextContent('priced 32.5 % of recorded tokens · 4,622 / 4,919 calls')
    expect(tile).not.toHaveTextContent('openrouter-v1')
    expect(tile).not.toHaveTextContent(reason)
    fireEvent.click(within(tile).getByRole('button', { name: 'Definition of Scheduled cost' }))
    const dialog = screen.getByRole('dialog', { name: 'Scheduled cost' })
    expect(dialog).toHaveTextContent('openrouter-v1')
    expect(dialog).toHaveTextContent(reason)
    expect(dialog).toHaveTextContent('tracelab-claude: 107.8042053')
  })

  it('uses a human observed-span headline while keeping its caveat in the popover', () => {
    const definition = { ...metricDefinitions.find(item => item.id === 'observed_span_ms')!, caveat: 'Neither active time nor task duration.' }
    render(<MemoryRouter><HeadlineTile label="Observed span" display={{ ...comparable, valueText: '60000', recordedSumText: '60000' }} headlineText="1.0 min" definition={definition} /></MemoryRouter>)
    const tile = screen.getByRole('region', { name: 'Observed span' })
    expect(tile).toHaveTextContent('1.0 min')
    expect(tile).not.toHaveTextContent('exact 60,000')
    expect(tile).not.toHaveTextContent('Neither active time nor task duration.')
    fireEvent.click(within(tile).getByRole('button', { name: 'Definition of Observed span' }))
    expect(screen.getByRole('dialog', { name: 'Observed span' })).toHaveTextContent('Neither active time nor task duration.')
  })
  it('abbreviates only above 99,999', () => {
    expect(abbreviate(99_999)).toBe('99,999')
    expect(abbreviate(100_000)).toBe('100k')
    expect(abbreviate(1_204_331)).toBe('1.2M')
    expect(abbreviateDecimalText('9007199254740993.5')).toBe('9007.2T')
  })

  it('groups an exact count and its coverage line', () => {
    render(<KpiTile label="Grouped count" display={{ ...comparable, valueText: '4770', recordedSumText: '4770', coverage: { known: 4770, total: 4770 } }} coverageUnit="calls" />)
    const tile = screen.getByRole('region', { name: 'Grouped count' })
    expect(tile).toHaveTextContent('4,770')
    expect(tile).toHaveTextContent('coverage 4,770 / 4,770 calls')
  })
})

describe('Popover', () => {
  it('closes on outside click without moving focus', () => {
    render(<><Popover label="Info">content</Popover><button>other</button></>)
    fireEvent.click(screen.getByRole('button', { name: 'Info' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'other' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('Drawer', () => {
  it('opens modally, closes on cancel and restores focus to the opener', () => {
    function Host() {
      const [open, setOpen] = useState(false)
      return <><button onClick={() => setOpen(true)}>open</button>{open && <Drawer title="Source record" onClose={() => setOpen(false)}><p>body</p></Drawer>}</>
    }
    render(<Host />)
    const opener = screen.getByRole('button', { name: 'open' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Source record' })
    expect(dialog).toHaveAttribute('open')
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})

describe('JsonText', () => {
  it('renders the text verbatim and highlights one span', () => {
    const { container } = render(<JsonText text={'{"big": 9007199254740993}'} highlight="9007199254740993" />)
    expect(container.querySelector('pre')).toHaveTextContent('{"big": 9007199254740993}')
    expect(container.querySelector('mark')).toHaveTextContent('9007199254740993')
  })
})

describe('DataTable', () => {
  it('right-aligns numeric columns and prints the empty sentence', () => {
    const { rerender } = render(<DataTable caption="Rows" count={1} columns={[{ key: 'n', header: 'N', align: 'num', render: (row: { n: number }) => row.n }]} rows={[{ n: 1 }]} rowKey={row => String(row.n)} empty="Nothing." />)
    expect(screen.getByRole('table', { name: /Rows/ })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '1' })).toHaveClass('num')
    rerender(<DataTable caption="Rows" columns={[{ key: 'n', header: 'N', render: (row: { n: number }) => row.n }]} rows={[]} rowKey={row => String(row.n)} empty="Nothing." />)
    expect(screen.getByText('Nothing.')).toBeInTheDocument()
  })
})

describe('StateBlock', () => {
  it('shows the API error code and a retry action', () => {
    const retry = vi.fn()
    render(<StateBlock loading={false} error={new ApiError(409, { code: 'import_conflict', message: 'Another import committed these bytes', details: [] })} retry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('import_conflict')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalled()
  })
})

describe('QualityStrip and chips', () => {
  it('expands one explanation at a time and removes a chip', () => {
    const list = vi.fn()
    const remove = vi.fn()
    render(<MemoryRouter><QualityStrip items={[{ key: 'a', label: 'rejects', count: 0, explanation: 'A.', actionHref: '/imports', actionLabel: 'View import attempts' }, { key: 'b', label: 'missing usage', count: 20, explanation: 'B.', onList: list }]} /><ScopeChip label="day" value="2026-06-04" onRemove={remove} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /missing usage/ }))
    expect(screen.getByText('B.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'List these sessions' }))
    expect(list).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove day 2026-06-04' }))
    expect(remove).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Remove day 2026-06-04' })).toHaveAttribute('data-tip', 'Remove day 2026-06-04')
  })
})

describe('ScopeBar', () => {
  function Location() { const { search } = useLocation(); return <output>{search}</output> }
  it('writes the scope to the URL on commit, clears it, and resets the offset', () => {
    render(<MemoryRouter initialEntries={['/sessions?offset=50']}><Routes><Route path="/sessions" element={<><ScopeBar dimensions={[{ key: 'source', label: 'Source', options: ['tracelab', 'trace & lab'] }, { key: 'agent', label: 'Agent', options: [] }]} receipt="80 sessions" /><Location /></>} /></Routes></MemoryRouter>)
    const source = screen.getByLabelText('Source')
    source.focus()
    fireEvent.change(source, { target: { value: 'trace & lab' } })
    expect(screen.getByRole('status')).toHaveTextContent('?source=trace+%26+lab')
    expect(screen.getByLabelText('Source')).toBe(source) // same element, still focused
    expect(source).toHaveFocus()
    expect(screen.getByRole('status')).not.toHaveTextContent('offset')
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(screen.getByRole('status')).toHaveTextContent('')
    expect(screen.getByLabelText('Source')).toHaveValue('')
  })
})

describe('exact charts', () => {
  const point = {
    key: '2026-09-07', label: '2026-09-07', valueText: '9007199254740993',
    plotValue: Number('9007199254740993'), coverage: { known: 2, total: 2 },
    drill: { version: 1 as const, label: 'day' as const, value: '2026-09-07', scope: { started_from: '2026-09-07T00:00:00Z' } },
  }

  it('activates a focusable bar with Enter and Space using its point object', () => {
    const select = vi.fn()
    const focus = vi.fn()
    render(<svg><AccessibleBarShape shape={{ x: 0, y: 0, width: 10, height: 20, payload: point }} onSelect={select} onFocus={focus} /></svg>)
    const bar = screen.getByRole('button', { name: /2026-09-07: 9,007,199,254,740,993; coverage 2 \/ 2/ })
    fireEvent.focus(bar)
    fireEvent.keyDown(bar, { key: 'Enter' })
    fireEvent.keyDown(bar, { key: ' ' })
    expect(focus).toHaveBeenCalledWith(point)
    expect(select).toHaveBeenCalledTimes(2)
    expect(select).toHaveBeenLastCalledWith(point)
  })

  it('completes a pointer press on release without activating again on its click', () => {
    const select = vi.fn()
    render(<svg><AccessibleBarShape shape={{ x: 0, y: 0, width: 10, height: 20, payload: point }} onSelect={select} onFocus={() => undefined} /></svg>)
    const bar = screen.getByRole('button')
    fireEvent.pointerDown(bar, { button: 0, pointerId: 7, clientX: 4, clientY: 5 })
    fireEvent.pointerUp(bar, { button: 0, pointerId: 7, clientX: 4, clientY: 5 })
    fireEvent.click(bar, { detail: 1 })
    expect(select).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledWith(point)

    fireEvent.pointerDown(bar, { button: 0, pointerId: 8, clientX: 4, clientY: 5 })
    fireEvent.pointerMove(bar, { pointerId: 8, clientX: 14, clientY: 5 })
    fireEvent.pointerUp(bar, { button: 0, pointerId: 8, clientX: 4, clientY: 5 })
    fireEvent.click(bar, { detail: 1 })
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('keeps exact text and coverage in the complete fallback tables', () => {
    const row = { key: 'claude\u0000sem', label: 'claude · sem', model: 'claude', semantics: 'sem', input: { valueText: '9007199254740993', plotValue: Number('9007199254740993'), coverage: { known: 1, total: 2 }, drill: point.drill } }
    render(<><DayBars title="Activity" data={[point]} /><TokenBars title="Tokens" rows={[row]} /></>)
    expect(screen.getByRole('table', { name: 'Activity, exact values' })).toHaveTextContent('9,007,199,254,740,993')
    expect(screen.getByRole('table', { name: 'Tokens, exact values' })).toHaveTextContent('9,007,199,254,740,9931 / 2UnavailableUnavailable')
  })

  it('renders an overlong-label bucket in the chart and table without offering a drill', () => {
    const label = 'x'.repeat(241)
    const select = vi.fn()
    const unlinked = { ...point, key: label, label, drill: undefined }
    render(<><svg><AccessibleBarShape shape={{ x: 0, y: 0, width: 10, height: 20, payload: unlinked }} onSelect={select} onFocus={() => undefined} /></svg>
      <HBars title="Tools" data={[unlinked]} onSelect={select} /></>)

    screen.getByRole('region', { name: 'Tools' })
    expect(document.querySelector('.chart-bar')).toHaveAttribute('aria-label', expect.stringContaining(label))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Tools, exact values' })).toHaveTextContent(label)
  })
})

describe('ScopeReceipt', () => {
  it('groups authoritative text and prints the resolved UTC period without numeric conversion', () => {
    render(<ScopeReceipt sessionsText="9007199254740993" modelCallsText="4" importsText="2" resolvedPeriodText="2026-09-02 → 2026-09-09 UTC" />)
    expect(screen.getByText('9,007,199,254,740,993')).toBeInTheDocument()
    expect(screen.getByText(/2026-09-02 → 2026-09-09 UTC/)).toBeInTheDocument()
  })
})


describe('theme', () => {
  it('keeps the choice in memory when storage throws, even over a stale saved value', async () => {
    const { setTheme, applyTheme } = await import('../theme')
    const original = Storage.prototype.setItem
    try {
      localStorage.setItem('agentscope-theme', 'light') // saved earlier; can no longer be replaced
      Storage.prototype.setItem = () => { throw new Error('quota') }
      setTheme('dark')
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
      applyTheme()
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    } finally {
      Storage.prototype.setItem = original
      localStorage.removeItem('agentscope-theme')
      setTheme('system')
    }
  })
})
