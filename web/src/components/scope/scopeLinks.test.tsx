import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ScopeCell, ScopeChips } from './scopeLinks'
import { patchScope } from './scopeUrl'

/** Shows the URL under test, so an assertion reads like the address bar. */
function Url() {
  const { pathname, search } = useLocation()
  return <span data-testid="url">{pathname + search}</span>
}

function at(route: string, node: React.ReactNode, path = '*') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes><Route path={path} element={<>{node}<Url /></>} /></Routes>
    </MemoryRouter>,
  )
}

const url = () => screen.getByTestId('url').textContent

describe('patchScope is the one URL edit', () => {
  const patch = (search: string, values: Record<string, string | undefined>) =>
    patchScope(new URLSearchParams(search), values).toString()

  it('encodes values that contain URL punctuation', () => {
    expect(patch('', { source: 'trace & lab' })).toBe('source=trace+%26+lab')
    expect(patch('', { model: 'a+b&c=d#e/f' })).toBe('model=a%2Bb%26c%3Dd%23e%2Ff')
    expect(patch('', { agent: 'claué-code' })).toBe('agent=clau%C3%A9-code')
  })

  it('trims, and treats an empty value as a removal', () => {
    expect(patch('', { source: '  swe  ' })).toBe('source=swe')
    expect(patch('source=swe', { source: '   ' })).toBe('')
    expect(patch('source=swe', { source: undefined })).toBe('')
  })

  it('preserves every other parameter, the drill envelope included', () => {
    const next = patch('source=a&agent=b&model=c&period=7d&drill=%7B%22v%22%3A1%7D', { agent: '' })
    expect(next).toContain('source=a')
    expect(next).toContain('model=c')
    expect(next).toContain('period=7d')
    expect(next).toContain('drill=')
    expect(next).not.toContain('agent=')
  })

  it('resets pagination on both an addition and a removal', () => {
    expect(patch('offset=50', { source: 'a' })).toBe('source=a')
    expect(patch('source=a&offset=50', { source: '' })).toBe('')
  })
})

describe('ScopeCell', () => {
  it('is an anchor, so a scoped view opens in a new tab', () => {
    at('/sessions', <ScopeCell dimension="agent" value="codex" />)
    const link = screen.getByRole('link', { name: 'Filter by agent codex' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/sessions?agent=codex')
    expect(link).toHaveAttribute('data-tip', 'Filter by agent codex')
  })

  it('marks the active value and clears it on the next click', () => {
    at('/sessions?agent=codex', <ScopeCell dimension="agent" value="codex" />)
    const link = screen.getByRole('link', { name: 'Clear the agent filter codex' })
    expect(link).toHaveAttribute('aria-current', 'true')
    expect(link).toHaveClass('scope-cell', 'active')
    expect(link).toHaveAttribute('href', '/sessions')
  })

  it('names clearing even on a cell that targets another route', () => {
    at('/imports?source=tracelab', <ScopeCell dimension="source" value="tracelab" target="/sessions" />)
    // The active-value name wins over the target-route name.
    expect(screen.getByRole('link', { name: 'Clear the source filter tracelab' })).toBeInTheDocument()
  })

  it('says where an unscoped route will take you', () => {
    at('/imports', <ScopeCell dimension="source" value="tracelab" target="/sessions" />)
    expect(screen.getByRole('link', { name: 'Show sessions from source tracelab' }))
      .toHaveAttribute('href', '/sessions?source=tracelab')
  })

  it('carries the scope and the drill envelope to the target route, and drops page parameters', () => {
    at('/imports?source=tracelab&drill=%7B%22v%22%3A1%7D&outcome=rejected',
      <ScopeCell dimension="agent" value="codex" target="/sessions" />)
    const href = screen.getByRole('link', { name: /Show sessions/ }).getAttribute('href')!
    expect(href).toContain('source=tracelab')
    expect(href).toContain('drill=')     // a chart drill is not lost by clicking a cell
    expect(href).toContain('agent=codex')
    expect(href).not.toContain('outcome') // that belonged to the page being left
  })

  it('keeps other parameters on the same route', () => {
    at('/sessions?source=tracelab&offset=50', <ScopeCell dimension="agent" value="codex" />)
    const href = screen.getByRole('link', { name: /Filter by agent/ }).getAttribute('href')!
    expect(href).toContain('source=tracelab')
    expect(href).not.toContain('offset') // a scope edit starts from the first page
  })

  it('is plain text for a value that cannot be filtered on', () => {
    at('/sessions', <ScopeCell dimension="agent" value={null} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
  })

  it('is plain text for a dimension the API does not accept yet, and never a link that narrows nothing', () => {
    at('/sessions/ses_1', <ScopeCell dimension="model" value="gpt-5.5" target="/sessions" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('gpt-5.5')).toBeInTheDocument()
  })
})

describe('ScopeChips', () => {
  it('renders nothing while no filter is active', () => {
    at('/sessions', <ScopeChips />)
    expect(screen.queryByRole('group', { name: 'Active filters' })).not.toBeInTheDocument()
  })

  it('shows one named, removable chip per active key', () => {
    at('/sessions?source=tracelab&agent=codex', <ScopeChips />)
    const group = screen.getByRole('group', { name: 'Active filters' })
    expect(group).toHaveTextContent('Source tracelab')
    expect(group).toHaveTextContent('Agent codex')
    expect(within(group).getByRole('button', { name: 'Remove Agent codex' })).toHaveAttribute('data-tip', 'Remove Agent codex')
  })

  it('removes exactly one key and leaves the rest of the URL alone', () => {
    at('/sessions?source=tracelab&agent=codex&offset=50', <ScopeChips />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Agent codex' }))
    expect(url()).toBe('/sessions?source=tracelab')
  })

  it('offers Clear all only when there is more than one, and clears the drill with it', () => {
    at('/sessions?source=tracelab', <ScopeChips />)
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument()

    at('/sessions?source=tracelab&agent=codex&drill=%7B%22v%22%3A1%7D', <ScopeChips />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear all' })[0])
    expect(screen.getAllByTestId('url')[1].textContent).toBe('/sessions')
  })

  it('moves focus to the next chip when one is removed', async () => {
    at('/sessions?source=tracelab&agent=codex', <ScopeChips />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Source tracelab' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Agent codex' })).toHaveFocus())
  })

  it('announces and takes focus when the last chip goes, rather than dropping it', async () => {
    at('/sessions?agent=codex', <ScopeChips />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Agent codex' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Filters cleared'))
    expect(screen.getByRole('status')).toHaveFocus()
    expect(document.body).not.toHaveFocus()
  })
})
