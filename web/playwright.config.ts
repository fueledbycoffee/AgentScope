import { defineConfig, devices } from '@playwright/test'

const port = process.env.E2E_PORT ?? '8765'

/**
 * Browser smoke tests against the built backend (which serves web/dist).
 * One worker, serial specs, no retries: the suite mutates one throwaway
 * database created by e2e/start-backend.mjs and torn down with the server.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  // One database for the whole run: the smoke spec's unscoped totals must be measured before the
  // assistant spec imports its own source, so the assistant project depends on the smoke project.
  projects: [
    { name: 'chromium', testMatch: /smoke\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'assistant', testMatch: /assist\.spec\.ts/, dependencies: ['chromium'], use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node e2e/start-backend.mjs',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    // SIGTERM first so start-backend.mjs can remove its temp root; SIGKILL only after that.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
