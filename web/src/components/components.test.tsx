import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { DataTable, Drawer, JsonText, KpiTile, Popover, QualityStrip, ScopeBar, ScopeChip, StateBlock, abbreviate } from './index'
import { ApiError } from '../api'

describe('KpiTile', () => {
  it('prints the exact value beside an abbreviation and coverage in the same element', () => {
    render(<KpiTile label="Input tokens" value={553447877} unit="tokens" coverage={{ known: 4770, total: 4770, unit: 'calls' }} definition="Sum of input tokens." />)
    const tile = screen.getByRole('region', { name: 'Input tokens' })
    expect(tile).toHaveTextContent('553.4M')
    expect(tile).toHaveTextContent('exact 553,447,877')
    expect(tile).toHaveTextContent('coverage 4,770 / 4,770 calls')
    fireEvent.click(screen.getByRole('button', { name: 'Definition of Input tokens' }))
    expect(screen.getByRole('dialog', { name: 'Input tokens' })).toHaveTextContent('Sum of input tokens.')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Definition of Input tokens' })).toHaveFocus()
  })
  it('shows Unavailable for a null value and for zero coverage, never 0', () => {
    render(<><KpiTile label="A" value={null} /><KpiTile label="B" value={0} coverage={{ known: 0, total: 12 }} /><KpiTile label="C" value={0} /></>)
    expect(screen.getByRole('region', { name: 'A' })).toHaveTextContent('Unavailable')
    expect(screen.getByRole('region', { name: 'B' })).toHaveTextContent('Unavailable')
    expect(screen.getByRole('region', { name: 'C' })).toHaveTextContent('0')
  })
  it('abbreviates only above 99,999', () => {
    expect(abbreviate(99_999)).toBe('99,999')
    expect(abbreviate(100_000)).toBe('100k')
    expect(abbreviate(1_204_331)).toBe('1.2M')
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
    render(<><QualityStrip items={[{ key: 'a', label: 'rejects', count: 0, explanation: 'A.' }, { key: 'b', label: 'missing usage', count: 20, explanation: 'B.', onList: list }]} /><ScopeChip label="day" value="2026-06-04" onRemove={remove} /></>)
    fireEvent.click(screen.getByRole('button', { name: /missing usage/ }))
    expect(screen.getByText('B.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'List these sessions' }))
    expect(list).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove day 2026-06-04' }))
    expect(remove).toHaveBeenCalled()
  })
})

describe('ScopeBar', () => {
  function Location() { const { search } = useLocation(); return <output>{search}</output> }
  it('writes the scope to the URL on commit, clears it, and resets the offset', () => {
    render(<MemoryRouter initialEntries={['/sessions?offset=50']}><Routes><Route path="/sessions" element={<><ScopeBar dimensions={[{ key: 'source', label: 'Source', options: ['tracelab'] }, { key: 'agent', label: 'Agent', options: [] }]} receipt="80 sessions" /><Location /></>} /></Routes></MemoryRouter>)
    const source = screen.getByLabelText('Source')
    fireEvent.change(source, { target: { value: 'trace & lab' } })
    fireEvent.keyDown(source, { key: 'Enter' })
    expect(screen.getByRole('status')).toHaveTextContent('?source=trace+%26+lab')
    expect(screen.getByRole('status')).not.toHaveTextContent('offset')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('status')).toHaveTextContent('')
    expect(screen.getByLabelText('Source')).toHaveValue('')
  })
})
