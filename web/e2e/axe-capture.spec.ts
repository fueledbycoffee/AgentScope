import { test } from '@playwright/test'
import { baselineRoutes, sweep } from './routes.js'
import { writeBaseline } from './axe.js'

/**
 * Records the accessibility baseline. Run it against a clean checkout of
 * origin/main, with the same engine and the same route states the regression
 * check uses:
 *
 *   git archive origin/main web | tar -x -C <tmp>      # main's web/
 *   pnpm --dir <tmp>/web install && pnpm --dir <tmp>/web build
 *   cp -R <tmp>/web/dist web/dist                      # the backend serves web/dist
 *   AXE_BASELINE=1 E2E_PORT=8796 pnpm --dir web exec playwright test --project=settings axe-capture
 *   pnpm --dir web build                               # restore this branch's dist
 *
 * Routes that do not exist on main (/settings) get no baseline entry, so they
 * must be clean. Skipped unless AXE_BASELINE is set.
 */
test.skip(!process.env.AXE_BASELINE, 'set AXE_BASELINE=1 to record the baseline')

test('record the accessibility baseline', async ({ page }) => {
  test.setTimeout(300_000)
  writeBaseline(await sweep(page, baselineRoutes()))
})
