import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import DashboardPage from './pages/Dashboard'
import ImportPage from './pages/Import'
import { ImportsPage, ReportPage } from './pages/Imports'
import SessionPage from './pages/Session'

export default function App() {
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header><Link className="brand" to="/dashboard">AgentScope</Link>
      <nav aria-label="Main navigation"><NavLink to="/import">Import</NavLink><NavLink to="/imports">Imports history</NavLink><NavLink to="/dashboard">Dashboard</NavLink></nav>
    </header>
    <main id="main"><Routes>
      <Route path="/" element={<Navigate to="/import" replace />} />
      <Route path="/import" element={<ImportPage />} />
      <Route path="/imports" element={<ImportsPage />} />
      <Route path="/imports/:id" element={<ReportPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/sessions/:id" element={<SessionPage />} />
      <Route path="*" element={<><h1>Page not found</h1><Link to="/import">Import traces</Link></>} />
    </Routes></main>
  </>
}
