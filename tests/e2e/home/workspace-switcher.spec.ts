/**
 * Home workspace switcher — real-app contract (design-system audit 2026-09-27).
 *
 * `packages/home/src/WorkspaceSwitcher.tsx` ships in the Home sidebar with no
 * browser-level coverage: its unit tests never open the real Popover, never
 * move real focus, and never paint it. This spec seeds real workspaces into
 * the real IndexedDB store, then drives the shipped component: listbox
 * semantics, pointer selection, the Popover keyboard contract (arrow opens
 * with focus in the panel), Escape/focus return, and light/dark captures.
 *
 * Run (heavy lease):
 *   node scripts/quality/heavy-lease.mjs "e2e: home workspace switcher" -- \
 *     env VARVE_E2E_PORT=1527 npx playwright test \
 *     tests/e2e/home/workspace-switcher.spec.ts --project=chromium --workers=1
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const OUT_DIR =
  process.env.VARVE_SWITCHER_VISUAL_QA_DIR ??
  join(process.cwd(), 'reports/ds-audit-2026-09-27/home-switcher');
mkdirSync(OUT_DIR, { recursive: true });

interface SeedWorkspace {
  id: string;
  name: string;
  kind: 'personal' | 'team';
  createdAt: number;
  updatedAt: number;
}

const WORKSPACES: SeedWorkspace[] = [
  { id: 'personal', name: 'Personal', kind: 'personal', createdAt: 1, updatedAt: 1 },
  { id: 'ws-studio', name: 'Studio Team', kind: 'team', createdAt: 1, updatedAt: 1 },
  { id: 'ws-labs', name: 'Labs', kind: 'team', createdAt: 1, updatedAt: 1 },
];

/**
 * Seed real workspace rows into the Home IndexedDB store, then reload.
 *
 * `preBootTheme` registers an init script so the theme is already in
 * localStorage on the very first navigation. The Home surface never runs the
 * graceful-shutdown finalizer, so each page load records an unclean shutdown
 * in the crash-loop counter (threshold 3 — see the probe record in
 * docs/audits/design-system-audit-2026-09-27.md §7.4); arriving at the app
 * in 2 loads instead of 3 keeps this suite clear of the safe-mode screen
 * without masking any assertion this spec makes.
 */
async function seedWorkspaces(page: Page, options?: { preBootTheme?: 'dark' }): Promise<void> {
  if (options?.preBootTheme) {
    const theme = options.preBootTheme;
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('varve-theme', value);
      } catch {
        /* storage unavailable — theme falls back to System */
      }
    }, theme);
  }
  await page.goto('/');
  await page.waitForSelector('.varve-home');
  // Let the app open/upgrade the database first so the store exists.
  await page.waitForTimeout(300);
  await page.evaluate(async (rows) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open('varve-home');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('workspaces', 'readwrite');
      const store = tx.objectStore('workspaces');
      // Clear first: the platform auto-creates a "Personal" row during the
      // initial boot, so seeding on top of it would make the option set
      // (and its order) depend on boot timing.
      store.clear();
      for (const row of rows) store.put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, WORKSPACES);
  await page.reload();
  await page.waitForSelector('.varve-home');
  await expect(page.getByRole('button', { name: 'Switch workspace' })).toBeVisible();
}

/** The Popover fades in; screenshots taken mid-fade show the sidebar
 * bleeding through the panel (verified correct in the stacking probe —
 * z=1000, opaque background). Wait until the panel settles at full opacity. */
async function waitForPopoverSettled(page: Page): Promise<void> {
  // Scope to THIS listbox's panel: other home surfaces can mount their own
  // `.varve-popover` (closed, opacity 0) earlier in the DOM, which a bare
  // querySelector would read forever.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const listbox = document.querySelector('[role="listbox"][aria-label="Workspaces"]');
          const panel = listbox?.closest('.varve-popover');
          const dropdown = document.querySelector('.workspace-switcher__dropdown');
          const opacities = [panel, dropdown]
            .filter((el): el is Element => el !== null)
            .map((el) => Number(getComputedStyle(el).opacity));
          return opacities.length > 0 ? Math.min(...opacities) : 0;
        }),
      { timeout: 5000 },
    )
    .toBeGreaterThanOrEqual(0.999);
}

test.describe('Home workspace switcher', () => {
  test('renders the active workspace and opens an accessible listbox', async ({ page }) => {
    await seedWorkspaces(page);
    const trigger = page.getByRole('button', { name: 'Switch workspace' });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger.locator('.workspace-switcher__label')).toHaveText('Personal');

    await trigger.click();

    const listbox = page.getByRole('listbox', { name: 'Workspaces' });
    await expect(listbox).toBeVisible();
    await waitForPopoverSettled(page);
    const options = listbox.getByRole('option');
    // Assert by name, not just count: a count mismatch alone cannot show
    // WHICH extra rows appeared (the first run failed with 5 options).
    const names = (await options.allInnerTexts()).map((t) => t.trim()).sort();
    expect(names).toEqual(['Labs', 'Personal', 'Studio Team']);
    await expect(options.filter({ hasText: 'Personal' })).toHaveAttribute('aria-selected', 'true');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await page.screenshot({
      path: join(OUT_DIR, 'home-switcher-popover-light.png'),
      clip: { x: 0, y: 0, width: 480, height: 420 },
    });
  });

  test('pointer selection switches workspaces and closes the popover', async ({ page }) => {
    await seedWorkspaces(page);
    const trigger = page.getByRole('button', { name: 'Switch workspace' });
    await trigger.click();
    await page.getByRole('option', { name: /Studio Team/ }).click();

    await expect(page.getByRole('listbox', { name: 'Workspaces' })).toBeHidden();
    await expect(trigger.locator('.workspace-switcher__label')).toHaveText('Studio Team');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('arrow key opens the popover with focus inside and Enter chooses', async ({ page }) => {
    await seedWorkspaces(page);
    const trigger = page.getByRole('button', { name: 'Switch workspace' });
    await trigger.focus();
    await page.keyboard.press('ArrowDown');

    const listbox = page.getByRole('listbox', { name: 'Workspaces' });
    await expect(listbox).toBeVisible();
    // Popover system contract: a keyboard open moves focus into the panel.
    const focusInside = await page.evaluate(
      () => document.activeElement?.closest('[role="listbox"]') !== null,
    );
    expect(focusInside).toBe(true);

    await page.keyboard.press('ArrowDown');
    // The contract is "Enter applies whatever has focus", not a specific row
    // order (IndexedDB key order determines the option sequence).
    const focusedName = await page.evaluate(() =>
      document.activeElement?.closest('[role="option"]')?.textContent?.trim(),
    );
    expect(focusedName).toBeTruthy();

    await page.keyboard.press('Enter');

    await expect(listbox).toBeHidden();
    await expect(trigger.locator('.workspace-switcher__label')).toHaveText(focusedName ?? '');
    // Popover system contract: focus returns to the trigger on close.
    await expect(trigger).toBeFocused();
  });

  test('Escape closes the popover and returns focus to the trigger', async ({ page }) => {
    await seedWorkspaces(page);
    const trigger = page.getByRole('button', { name: 'Switch workspace' });
    await trigger.click();
    await expect(page.getByRole('listbox', { name: 'Workspaces' })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('listbox', { name: 'Workspaces' })).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('dark theme capture of the open switcher', async ({ page }) => {
    await seedWorkspaces(page, { preBootTheme: 'dark' });
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

    const trigger = page.getByRole('button', { name: 'Switch workspace' });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByRole('listbox', { name: 'Workspaces' })).toBeVisible();
    await waitForPopoverSettled(page);

    await page.screenshot({
      path: join(OUT_DIR, 'home-switcher-popover-dark.png'),
      clip: { x: 0, y: 0, width: 480, height: 420 },
    });
  });

  test('switcher survives repeated open/close cycles without console errors', async ({ page }) => {
    await seedWorkspaces(page);
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));

    const trigger = page.getByRole('button', { name: 'Switch workspace' });
    for (let i = 0; i < 5; i++) {
      await trigger.click();
      await expect(page.getByRole('listbox', { name: 'Workspaces' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox', { name: 'Workspaces' })).toBeHidden();
    }
    expect(errors).toEqual([]);
  });
});
