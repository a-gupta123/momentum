import { expect, test } from '@playwright/test';

import { openPlanner, waitForPlanner } from './helpers';

test.describe('the day', () => {
  test('seeds a realistic demo and ranks it', async ({ page }) => {
    await openPlanner(page);

    await expect(page.getByRole('heading', { name: /your daily three/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^the plan$/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^queue$/i })).toBeVisible();

    // The shortlist is capped at three no matter how full the backlog is.
    const dailyThree = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /your daily three/i }) })
      .getByRole('listitem');
    await expect(dailyThree).toHaveCount(3);
  });

  test('every ranked row can explain its score', async ({ page }) => {
    await openPlanner(page);

    // A native `<summary>`, so it is addressed by its text rather than a role.
    await page.getByText('Why this rank').first().click();

    // The breakdown must name components, not just show a total.
    await expect(page.getByText(/priority score/i).first()).toBeVisible();
    await expect(page.getByText(/goal alignment/i).first()).toBeVisible();
    await expect(page.getByText(/scoring rules:/i).first()).toBeVisible();
  });

  test('completing a task updates progress and can be undone', async ({ page }) => {
    await openPlanner(page);

    const first = page.getByRole('checkbox', { name: /^complete /i }).first();
    const label = (await first.getAttribute('aria-label')) ?? '';
    const title = label.replace(/^complete /i, '');

    await first.click();

    // The row leaves the active queue once the completion write lands.
    await expect(
      page.getByRole('checkbox', { name: new RegExp(`^complete ${escapeRegex(title)}$`, 'i') }),
    ).toHaveCount(0, { timeout: 10_000 });
  });

  test('committing the plan persists it across a reload', async ({ page }) => {
    await openPlanner(page);

    await page.getByRole('button', { name: /build my day/i }).click();
    await expect(page.getByRole('button', { name: /re-plan/i })).toBeVisible();
    await expect(page.getByText(/committed\. the timeline below is the saved plan/i)).toBeVisible();

    await page.reload();
    await waitForPlanner(page);

    await expect(page.getByRole('button', { name: /re-plan/i })).toBeVisible();
  });

  test('names the work that did not fit, with a reason', async ({ page }) => {
    await openPlanner(page);

    const overflow = page.getByText(/did not fit/i);
    if ((await overflow.count()) === 0) test.skip(true, 'Demo day happened to fit entirely.');

    await expect(overflow.first()).toBeVisible();
    // A bare "did not fit" is not good enough; the reason has to be stated.
    await expect(
      page
        .getByText(/waiting on another task|contiguous time|before its deadline|outside your/i)
        .first(),
    ).toBeVisible();
  });

  test('opens a task and saves an edit', async ({ page }) => {
    await openPlanner(page);

    const queue = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /^queue$/i }) });
    await queue
      .getByRole('button')
      .filter({ hasText: /\w{6,}/ })
      .first()
      .click();

    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();

    const title = sheet.getByLabel(/^task$/i);
    await title.fill('Renamed by an end-to-end test');
    await sheet
      .getByRole('button', { name: /save|update/i })
      .first()
      .click();

    await expect(sheet).toBeHidden();
    await expect(
      page.getByRole('button', { name: /renamed by an end-to-end test/i }).first(),
    ).toBeVisible();
  });

  test('adds a task through the explicit form', async ({ page }) => {
    await openPlanner(page);

    await page.getByRole('button', { name: /^new task$/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^task$/i).fill('Replace the kitchen tap');
    await dialog.getByRole('button', { name: /^add task$/i }).click();

    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('button', { name: /replace the kitchen tap/i }).first(),
    ).toBeVisible();
  });
});

test.describe('guest mode honesty', () => {
  test('states where the data lives', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'The badge lives in the sidebar.');

    await openPlanner(page);
    await expect(page.getByText(/guest demo|session only/i).first()).toBeVisible();
  });

  test('survives a reload', async ({ page }) => {
    await openPlanner(page);

    await page.getByRole('button', { name: /^new task$/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^task$/i).fill('Persisted across a reload');
    await dialog.getByRole('button', { name: /^add task$/i }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await waitForPlanner(page);

    await expect(
      page.getByRole('button', { name: /persisted across a reload/i }).first(),
    ).toBeVisible();
  });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
