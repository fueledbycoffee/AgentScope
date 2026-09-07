import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useTheme } from './theme'
import type { Theme } from './theme'

const ROUTES = [
  ['/overview', 'Overview'], ['/sessions', 'Sessions'], ['/imports', 'Imports'], ['/mappings', 'Mappings'], ['/definitions', 'Definitions'],
] as const

/** The 48 px rail and the 52 px bar slot; every route renders inside `main`. */
export function AppShell({ bar, children }: { bar: ReactNode; children: ReactNode }) {
  const [theme, setTheme] = useTheme()
  return <div className="shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="rail">
      <Link className="brand" to="/overview">AgentScope</Link>
      <nav aria-label="Main navigation">{ROUTES.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}</nav>
      <div className="end">
        <div className="theme-toggle" role="group" aria-label="Theme">
          {(['light', 'system', 'dark'] as Theme[]).map(option => <button key={option} type="button" aria-pressed={theme === option} onClick={() => setTheme(option)}>{option}</button>)}
        </div>
        <Link className="btn primary small" to="/import">Import</Link>
      </div>
    </header>
    {bar}
    <main id="main" className="page">{children}</main>
  </div>
}
