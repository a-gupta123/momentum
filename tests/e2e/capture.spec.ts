import { expect, test } from '@playwright/test';

import { capture, openPlanner, readGuestState } from './helpers';

/**
 * The capture loop is the product's central claim: type a sentence, review
 * what the app understood, and only then does anything change.
 *
 * These tests run without an OpenAI key, so they exercise the deterministic
 * parser — which is the right thing to pin down in CI anyway. The AI path is
 * non-deterministic by construction and cannot be asserted on; the fallback is
 * the contract that must hold on every deployment.
 */
test.describe('natural language capture', () => {
  test('turns a sentence into a reviewable action and applies it', async ({ page }) => {
    await openPlanner(page);

    await capture(page, 'Draft the quarterly retrospective by Friday, about 90 minutes');

    const preview = page.getByRole('region', { name: /proposed changes/i });
    await expect(preview).toBeVisible();
    await expect(preview.getByText(/draft the quarterly retrospective/i).first()).toBeVisible();

    // Nothing is written before the user confirms — this is the whole promise.
    await expect(
      page.getByRole('button', { name: /^draft the quarterly retrospective$/i }),
    ).toHaveCount(0);

    await preview.getByRole('button', { name: /^apply /i }).click();

    await expect(preview).toBeHidden();
    await expect(
      page.getByRole('button', { name: /draft the quarterly retrospective/i }).first(),
    ).toBeVisible();
  });

  test('discarding a preview changes nothing', async ({ page }) => {
    await openPlanner(page);
    const before = await readGuestState(page);

    await capture(page, 'Book the dentist next Tuesday');

    const preview = page.getByRole('region', { name: /proposed changes/i });
    await expect(preview).toBeVisible();
    await preview.getByRole('button', { name: /^discard$/i }).click();

    await expect(preview).toBeHidden();
    expect(await readGuestState(page)).toEqual(before);
  });

  test('a deselected action is not applied', async ({ page }) => {
    await openPlanner(page);

    await capture(page, 'Email the landlord\nRenew the gym membership');

    const preview = page.getByRole('region', { name: /proposed changes/i });
    await expect(preview).toBeVisible();

    const checkboxes = preview.getByRole('checkbox');
    await expect(checkboxes).toHaveCount(2);
    await checkboxes.first().click();

    await preview.getByRole('button', { name: /^apply 1 change$/i }).click();
    await expect(preview).toBeHidden();

    // The kept action lands; the deselected one is nowhere on the page. A task
    // legitimately appears in several places at once (queue, timeline,
    // shortlist), so presence is what is asserted, not a count.
    await expect(
      page.getByRole('button', { name: /renew the gym membership/i }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /email the landlord/i })).toHaveCount(0);
  });

  test('says which parser read the note', async ({ page }) => {
    await openPlanner(page);
    await capture(page, 'Water the plants');

    const preview = page.getByRole('region', { name: /proposed changes/i });
    // Either label is correct depending on deployment; what matters is that
    // the app never leaves the user guessing which one ran.
    await expect(preview.getByText(/read by (ai|the built-in parser)/i)).toBeVisible();
  });
});
