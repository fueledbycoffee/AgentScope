import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ROUTES, baselineRoutes, sweep } from './routes.js'
import { writeBaseline } from './axe.js'

/**
 * Records the accessibility baseline against a clean checkout of origin/main,
 * with the same engine and the same route states the regression check uses.
 *
 *   git archive origin/main web | tar -x -C "$TMP"
 *   pnpm --dir "$TMP/web" install --frozen-lockfile && pnpm --dir "$TMP/web" build
 *   rm -rf web/dist && cp -R "$TMP/web/dist" web/dist    # REPLACE it: copying into
 *                                                        # an existing dist makes
 *                                                        # web/dist/dist and serves
 *                                                        # this branch's build
 *   AXE_BASELINE=1 E2E_PORT=8796 pnpm --dir web exec playwright test --project=settings axe-capture
 *   pnpm --dir web build                                 # restore this branch's dist
 *
 * The recipe is only a recipe, so the capture verifies the served build itself
 * before recording anything: if a route this branch adds is reachable, the
 * server is serving this branch and the run refuses rather than whitelisting
 * this branch's own regressions. Skipped unless AXE_BASELINE is set.
 */
test.skip(!process.env.AXE_BASELINE, 'set AXE_BASELINE=1 to record the baseline')

/**
 * Refuse to record a baseline from a build that already contains the work being
 * reviewed. Every route marked `newInThisBranch` must be unknown to the served
 * app; the SPA renders "Page not found" for a route it does not have.
 */
async function assertServingTheBaselineBuild(page: Page) {
  const added = ROUTES.filter(route => route.newInThisBranch)
  expect(added.length, 'mark this branch\'s new routes so the guard has something to check')
    .toBeGreaterThan(0)
  for (const route of added) {
    await page.goto(await route.path(page))
    await expect(
      page.getByRole('heading', { name: 'Page not found' }),
      `${route.name} is served, so web/dist is this branch's build, not the baseline's — `
      + 'remove web/dist before copying the archived build over it',
    ).toBeVisible()
  }
}

test('record the accessibility baseline', async ({ page }) => {
  test.setTimeout(300_000)
  await assertServingTheBaselineBuild(page)
  writeBaseline(await sweep(page, baselineRoutes()))
})
