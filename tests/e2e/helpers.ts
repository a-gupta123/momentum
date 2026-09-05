import type { Page } from '@playwright/test';

import { GUEST_STORAGE_KEY } from '@/lib/validation/guest-state';

/**
 * Opens the planner on a clean slate.
 *
 * The key is cleared *before* the app's first script runs. Clearing it after
 * navigation would race the store's initial load: the seeded demo dataset
 * would already be in memory and would simply be written back.
 *
 * `addInitScript` runs on every navigation, including `page.reload()`, so the
 * reset is guarded by a session-scoped sentinel. Without it, any test that
 * reloads to check persistence would wipe the very data it is asserting on and
 * fail for a reason that has nothing to do with the app.
 */
export async function openPlanner(page: Page, path = '/today'): Promise<void> {
  await page.addInitScript((key: string) => {
    const sentinel = '__momentum_e2e_reset';
    if (window.sessionStorage.getItem(sentinel) === null) {
      window.sessionStorage.setItem(sentinel, '1');
      window.localStorage.removeItem(key);
    }
  }, GUEST_STORAGE_KEY);

  await page.goto(path);
  await waitForPlanner(page);
}

/** Waits for the store to finish its first snapshot load. */
export async function waitForPlanner(page: Page): Promise<void> {
  // The heading only renders once `status === 'ready'`; the skeleton has none.
  await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible' });
}

/** Reads the persisted guest state, for assertions about what was written. */
export async function readGuestState(page: Page): Promise<unknown> {
  const raw = await page.evaluate(
    (key: string) => window.localStorage.getItem(key),
    GUEST_STORAGE_KEY,
  );
  return raw === null ? null : JSON.parse(raw);
}

/** Types into the natural-language composer and submits it. */
export async function capture(page: Page, text: string): Promise<void> {
  const composer = page.getByRole('textbox', { name: /what is on your mind/i });
  await composer.click();
  await composer.fill(text);
  await page.getByRole('button', { name: /^interpret$/i }).click();
}
