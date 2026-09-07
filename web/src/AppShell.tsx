import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useScope } from './scope'
import { useTheme } from './theme'
import type { Theme } from './theme'
import { Icon } from './components/icons'
import type { IconName } from './components/icons'

const ROUTES: readonly [string, string, boolean, IconName][] = [
  ['/overview', 'Overview', true, 'overview'], ['/sessions', 'Sessions', true, 'sessions'], ['/imports', 'Imports', false, 'imports'],
  ['/mappings', 'Mappings', false, 'mappings'], ['/definitions', 'Definitions', false, 'definitions'],
]
const THEMES: [Theme, IconName, string][] = [['light', 'sun', 'Light theme'], ['system', 'monitor', 'Follow the system theme'], ['dark', 'moon', 'Dark theme']]

/** The 48 px rail and the 52 px bar slot; every route renders inside `main`. */
export function AppShell({ bar, children }: { bar: ReactNode; children: ReactNode }) {
  const [theme, setTheme] = useTheme()
  const { link } = useScope()
  return <div className="shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="rail">
      <Link className="brand" to={link('/overview')}>AgentScope</Link>
      <nav aria-label="Main navigation">{ROUTES.map(([to, label, scoped, icon]) => <NavLink key={to} to={scoped ? link(to) : to}><Icon name={icon} /><span>{label}</span></NavLink>)}</nav>
      <div className="end">
        <div className="theme-toggle" role="group" aria-label="Theme">
          {THEMES.map(([option, icon, label]) => <button key={option} type="button" className="has-tip" aria-label={label} data-tip={label} aria-pressed={theme === option} onClick={() => setTheme(option)}><Icon name={icon} /></button>)}
        </div>
        <Link className="btn primary small" to="/import" title="Import traces"><Icon name="upload" /><span>Import</span></Link>
      </div>
    </header>
    {bar}
    <main id="main" className="page">{children}</main>
  </div>
}
