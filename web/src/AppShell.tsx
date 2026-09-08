import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useScope } from './scope'
import { Icon } from './components/icons'
import type { IconName } from './components/icons'
import { ThemeToggle } from './components/ThemeToggle'

const ROUTES: readonly [string, string, boolean, IconName][] = [
  ['/overview', 'Overview', true, 'overview'], ['/sessions', 'Sessions', true, 'sessions'], ['/imports', 'Imports', false, 'imports'],
  ['/mappings', 'Mappings', false, 'mappings'], ['/definitions', 'Definitions', false, 'definitions'],
]
/** The 48 px rail and the 52 px bar slot; every route renders inside `main`. */
export function AppShell({ bar, children }: { bar: ReactNode; children: ReactNode }) {
  const { link } = useScope()
  return <div className="shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="rail">
      <Link className="brand" to={link('/overview')}>AgentScope</Link>
      <nav aria-label="Main navigation">{ROUTES.map(([to, label, scoped, icon]) => <NavLink key={to} to={scoped ? link(to) : to}><Icon name={icon} /><span>{label}</span></NavLink>)}</nav>
      <div className="end">
        <ThemeToggle />
        <Link className="btn small icon-only has-tip" to="/settings" aria-label="Settings" data-tip="Settings"><Icon name="settings" /></Link>
        <Link className="btn primary small" to="/import" title="Import traces"><Icon name="upload" /><span>Import</span></Link>
      </div>
    </header>
    {bar}
    <main id="main" className="page">{children}</main>
  </div>
}
