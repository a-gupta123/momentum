import { test, type Page } from '@playwright/test';

import { openPlanner } from './helpers';

/**
 * Screenshot capture for design review.
 *
 * Not assertions — this is a deliberate, opt-in pass that renders every route
 * at every supported width in both themes so the whole surface can be looked
 * at in one go. Run with `E2E_SHOTS=1 npx playwright test screenshots`.
 *
 * Kept out of the default run because it produces no verdict: a screenshot
 * suite that always passes is noise in CI and a slow way to find nothing.
 */
const SHOULD_RUN = process.env.E2E_SHOTS === '1';

/**
 * `review` sweeps everything into a git-ignored folder for eyeballing.
 * `readme` writes the handful of images the README actually embeds.
 */
const MODE = process.env.E2E_SHOTS_MODE === 'readme' ? 'readme' : 'review';

const WIDTHS = [
  { name: '390', width: 390, height: 900 },
  { name: '768', width: 768, height: 1100 },
  { name: '1280', width: 1280, height: 900 },
  { name: '1440', width: 1440, height: 950 },
] as const;

const ROUTES = [
  { name: 'landing', path: '/' },
  { name: 'today', path: '/today' },
  { name: 'goals', path: '/goals' },
  { name: 'insights', path: '/insights' },
  { name: 'settings', path: '/settings' },
  { name: 'signin', path: '/signin' },
] as const;

/** What the README embeds: the two pages worth showing, plus one phone shot. */
const README_SHOTS = [
  { name: 'today', path: '/today', theme: 'light', width: 1440, height: 950 },
  { name: 'today-dark', path: '/today', theme: 'dark', width: 1440, height: 950 },
  { name: 'insights', path: '/insights', theme: 'dark', width: 1440, height: 950 },
  { name: 'goals', path: '/goals', theme: 'light', width: 1440, height: 950 },
  { name: 'today-mobile', path: '/today', theme: 'light', width: 390, height: 844 },
] as const;

async function open(page: Page, path: string) {
  if (path === '/' || path === '/signin') {
    await page.goto(path);
  } else {
    await openPlanner(page, path);
  }
  // The timeline's "now" marker mounts after hydration; let it land before
  // capturing so screenshots do not disagree with what the page looks like.
  await page.waitForTimeout(600);
}

test.describe('captures', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!SHOULD_RUN, 'Set E2E_SHOTS=1 to capture.');
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Viewport is set per case.');
  });

  for (const shot of README_SHOTS) {
    test(`readme ${shot.name}`, async ({ page }) => {
      test.skip(MODE !== 'readme', 'Set E2E_SHOTS_MODE=readme.');

      await page.emulateMedia({ colorScheme: shot.theme });
      await page.setViewportSize({ width: shot.width, height: shot.height });
      await open(page, shot.path);

      await page.screenshot({
        path: `public/screenshots/${shot.name}.png`,
        // Not full-page: the README wants a viewport-shaped image, not a
        // 3000px-tall strip that renders as a sliver in a code host's markdown.
        fullPage: false,
      });
    });
  }

  for (const theme of ['light', 'dark'] as const) {
    for (const size of WIDTHS) {
      for (const route of ROUTES) {
        test(`review ${route.name} ${size.name} ${theme}`, async ({ page }) => {
          test.skip(MODE !== 'review', 'Set E2E_SHOTS_MODE=review.');

          await page.emulateMedia({ colorScheme: theme });
          await page.setViewportSize({ width: size.width, height: size.height });
          await open(page, route.path);

          await page.screenshot({
            path: `screenshots/${theme}/${size.name}-${route.name}.png`,
            fullPage: true,
          });
        });
      }
    }
  }
});
