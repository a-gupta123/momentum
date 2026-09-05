import { expect, test, type Page } from '@playwright/test';

import { openPlanner, waitForPlanner } from './helpers';

/**
 * Layout integrity at the widths the app is actually used at.
 *
 * Horizontal overflow is the one layout bug that is both very common and
 * completely objective, so it is worth asserting rather than eyeballing: a
 * single unwrapped label or a fixed-width chart pushes the whole page sideways
 * and every tap target moves. Catching it here is cheaper than noticing it in
 * a screenshot three commits later.
 */
const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const ROUTES = ['/', '/today', '/goals', '/insights', '/settings'] as const;

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
}

/** Elements wider than the viewport, named so a failure is actionable. */
async function offendingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const names: string[] = [];

    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Only report the element itself, not every ancestor that contains it.
      if (rect.right <= limit + 1 && rect.left >= -1) continue;
      if (element.closest('[data-slot="dialog-content"]')) continue;

      const tag = element.tagName.toLowerCase();
      const cls = element.className?.toString().slice(0, 60) ?? '';
      names.push(`${tag}.${cls} (${Math.round(rect.left)}→${Math.round(rect.right)})`);
      if (names.length >= 5) break;
    }
    return names;
  });
}

test.describe('no horizontal overflow', () => {
  // These assertions are about CSS, not about the two device profiles, so they
  // only need to run once rather than in both projects.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Viewport is set per case.');
  });

  for (const size of WIDTHS) {
    for (const route of ROUTES) {
      test(`${route} at ${size.name} (${size.width}px)`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });

        if (route === '/') {
          await page.goto(route);
        } else {
          await openPlanner(page, route);
        }

        const overflow = await horizontalOverflow(page);
        expect(
          overflow,
          `offenders: ${(await offendingElements(page)).join(' | ')}`,
        ).toBeLessThanOrEqual(1);
      });
    }
  }
});

test.describe('the page can actually scroll', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One check is enough.');
  });

  /**
   * A sticky full-height sidebar next to `min-h-dvh` content is an easy way to
   * accidentally trap the scroll container. If the planner ever stops
   * scrolling, everything below the fold becomes unreachable.
   */
  test('today scrolls to its own bottom', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await openPlanner(page);

    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 1200);
    await page.waitForFunction((start: number) => window.scrollY > start, before);

    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  });
});

test.describe('touch targets', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'Needs a touch profile.');
  });

  /**
   * 44px is the accepted floor for a reliable thumb target. The bottom bar is
   * the most-used navigation in the app, so it is the one that has to hold.
   */
  test('the mobile navigation clears 44px', async ({ page }) => {
    await openPlanner(page);

    const links = page.getByRole('navigation', { name: 'Main' }).last().getByRole('link');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const box = await links.nth(index).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('theme', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Not device specific.');
  });

  test('dark mode is a designed theme, not an inversion', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openPlanner(page);

    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // Not pure black and not the light canvas: a real dark surface.
    expect(background).not.toBe('rgb(0, 0, 0)');
    expect(background).not.toBe('rgb(255, 255, 255)');

    await page.emulateMedia({ colorScheme: 'light' });
    await page.reload();
    await waitForPlanner(page);

    const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(light).not.toBe(background);
  });
});
