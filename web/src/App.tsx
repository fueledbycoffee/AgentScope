import { lazy, Suspense } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { AppShell } from './AppShell'
import { FileBar, ScopeBar, ScopeReceipt } from './components'
import { ShellProvider } from './shellContext'
import { useShellContext } from './shellHooks'
import DefinitionsPage from './pages/Definitions'
import ImportPage from './pages/Import'
import { ImportsPage, ReportPage } from './pages/Imports'
import MappingsPage from './pages/Mappings'
import OverviewPage from './pages/Overview'
import SessionPage from './pages/Session'
import SessionsPage from './pages/Sessions'

// The component gallery exists in development only; the production bundle never includes it.
const GalleryPage = import.meta.env.DEV ? lazy(() => import('./pages/Gallery')) : null
// The assistant page carries the chat library: loaded only when someone opens it.
const AssistPage = lazy(() => import('./pages/Assist'))

/** One page instance per upload: switching uploads must never carry another file's state along. */
function AssistRoute() {
  const { uploadId = '' } = useParams()
  return <Suspense fallback={<p>Loading the assistant…</p>}><AssistPage key={uploadId} /></Suspense>
}

function RedirectKeepingSearch({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={{ pathname: to, search }} replace />
}

function Bar() {
  const { pathname } = useLocation()
  const { dimensions, receipt, receiptLoading, file } = useShellContext()
  const dataRoute = pathname === '/overview' || pathname.startsWith('/sessions')
  if (dataRoute) return <ScopeBar dimensions={dimensions} loading={receiptLoading} receipt={receipt && <ScopeReceipt {...receipt} />} />
  return <FileBar items={file.items} title={file.title} />
}

export default function App() {
  return <ShellProvider><AppShell bar={<Bar />}>
    <Routes>
      <Route path="/" element={<RedirectKeepingSearch to="/overview" />} />
      <Route path="/dashboard" element={<RedirectKeepingSearch to="/overview" />} />
      <Route path="/overview" element={<OverviewPage />} />
      <Route path="/sessions" element={<SessionsPage />} />
      <Route path="/sessions/:id" element={<SessionPage />} />
      <Route path="/import" element={<ImportPage />} />
      <Route path="/import/assist/:uploadId" element={<AssistRoute />} />
      <Route path="/imports" element={<ImportsPage />} />
      <Route path="/imports/:id" element={<ReportPage />} />
      <Route path="/mappings" element={<MappingsPage />} />
      <Route path="/definitions" element={<DefinitionsPage />} />
      {GalleryPage && <Route path="/gallery" element={<Suspense fallback={<p>Loading gallery…</p>}><GalleryPage /></Suspense>} />}
      <Route path="*" element={<><h1>Page not found</h1><Link to="/overview">Back to the overview</Link></>} />
    </Routes>
  </AppShell></ShellProvider>
}
