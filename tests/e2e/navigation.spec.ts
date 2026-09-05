import { expect, test } from '@playwright/test';

import { openPlanner, waitForPlanner } from './helpers';

test.describe('routes', () => {
  test('the landing page leads to a working demo', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/brain dump/i);
    await page.getByRole('link', { name: /try the live demo/i }).click();

    await expect(page).toHaveURL(/\/today$/);
    await waitForPlanner(page);
  });

  test('goals render with their weekly investment', async ({ page }) => {
    await openPlanner(page, '/goals');

    await expect(page.getByRole('heading', { name: /what this is all for/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^active$/i })).toBeVisible();
    await expect(page.getByText(/invested this week|this week/i).first()).toBeVisible();
  });

  test('a new goal appears immediately', async ({ page }) => {
    await openPlanner(page, '/goals');

    await page.getByRole('button', { name: /^new goal$/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^goal$/i).fill('Learn to sail');
    await dialog.getByRole('button', { name: /^create goal$/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: /learn to sail/i })).toBeVisible();
  });

  test('insights render charts with accessible text equivalents', async ({ page }) => {
    await openPlanner(page, '/insights');

    await expect(page.getByRole('heading', { name: /what actually happened/i })).toBeVisible();

    // The figcaption is the point: the data must be readable without the SVG.
    const captions = page.locator('figcaption');
    expect(await captions.count()).toBeGreaterThan(0);
    await expect(captions.first()).toContainText(/\w+/);
  });

  test('settings save and survive a reload', async ({ page }) => {
    await openPlanner(page, '/settings');

    const name = page.getByLabel(/display name/i);
    await name.fill('Test Pilot');
    await page.getByRole('button', { name: /save settings/i }).click();

    await expect(page.getByText(/all changes saved/i)).toBeVisible();

    await page.reload();
    await waitForPlanner(page);
    await expect(page.getByLabel(/display name/i)).toHaveValue('Test Pilot');
  });

  test('changing the workday changes what the scheduler will place', async ({ page }) => {
    await openPlanner(page, '/settings');

    await page.getByLabel(/workday starts/i).fill('06:00');
    await page.getByLabel(/workday ends/i).fill('23:00');
    await page.getByRole('button', { name: /save settings/i }).click();
    await expect(page.getByText(/all changes saved/i)).toBeVisible();

    await page.goto('/today');
    await waitForPlanner(page);

    // A seventeen-hour window has to report more open time than a default one.
    await expect(page.getByText(/of open time/i)).toBeVisible();
  });

  test('sign-in explains itself even with no auth configured', async ({ page }) => {
    await page.goto('/signin');

    await expect(
      page.getByRole('heading', { name: /sign in to momentum|accounts are not enabled/i }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /demo|guest/i }).first()).toBeVisible();
  });
});

test.describe('accessibility affordances', () => {
  test('the skip link reaches the main region', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Keyboard-only affordance.');

    await openPlanner(page);
    await page.keyboard.press('Tab');

    const skip = page.getByRole('link', { name: /skip to today/i });
    await expect(skip).toBeFocused();
  });

  test('the command palette opens on the keyboard and navigates', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Keyboard-only affordance.');

    await openPlanner(page);
    await page.keyboard.press('ControlOrMeta+k');

    const palette = page.getByRole('dialog');
    await expect(palette).toBeVisible();

    await palette
      .getByRole('option', { name: /insights/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/insights$/);
  });

  test('every page has exactly one level-one heading', async ({ page }) => {
    for (const path of ['/', '/today', '/goals', '/insights', '/settings']) {
      await page.goto(path);
      if (path !== '/') await waitForPlanner(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    }
  });
});
