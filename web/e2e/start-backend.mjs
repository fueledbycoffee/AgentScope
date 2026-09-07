// Starts the backend for the browser tests on a unique throwaway database and
// raw-file directory, serving the built web app. Playwright's webServer waits
// on /api/health (which answers only after migrations and bundled mappings have
// loaded in the lifespan) and kills this process at the end; the temp root is
// removed on exit so a run can never touch, or be polluted by, another one.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = resolve(here, '..', '..')
const backend = join(repo, 'backend')
const dist = join(repo, 'web', 'dist', 'index.html')
if (!existsSync(dist)) {
  console.error('web/dist is missing: run `pnpm build` first (the e2e script does).')
  process.exit(2)
}
const root = mkdtempSync(join(tmpdir(), 'agentscope-e2e-'))
const port = process.env.E2E_PORT ?? '8765'
const child = spawn('uv', ['run', 'uvicorn', 'agentscope_app.interfaces.api.main:app', '--host', '127.0.0.1', '--port', port], {
  cwd: backend,
  stdio: 'inherit',
  env: {
    ...process.env,
    AGENTSCOPE_DATABASE_URL: `sqlite:///${join(root, 'agentscope.sqlite3')}`,
    AGENTSCOPE_RAW_FILE_DIR: join(root, 'raw'),
  },
})
const stop = () => {
  if (!child.killed) child.kill('SIGTERM')
}
child.on('exit', code => {
  rmSync(root, { recursive: true, force: true })
  process.exit(code ?? 0)
})
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop)
process.on('exit', stop)
