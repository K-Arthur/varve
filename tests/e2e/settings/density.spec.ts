/**
 * Interface density / UI font size — real-browser preference lifecycle.
 *
 * Covers the prompt's scenario "Change density during layer navigation":
 * a deep, scrolled, selected tree keeps selection, scroll context and usable
 * geometry across a Default Pro / Compact Pro switch; the preference is
 * application state (no document dirty, no undo entry), persists across
 * reload with a no-flash pre-paint contract, and the previously-dead
 * "UI font size" control becomes a live preference through the same
 * application path.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function openSettings(page: Page) {
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
      (e) => e.textContent?.trim() === 'File' && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
      (e) => e.textContent?.trim().toLowerCase().startsWith('settings') && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await expect(page.locator('dialog.varve-dialog--settings')).toHaveAttribute('open', '', {
    timeout: 10000,
  });
}

async function closeSettings(page: Page) {
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('dialog.varve-dialog--settings')).not.toHaveAttribute('open');
}

async function chooseDensity(page: Page, mode: 'Default Pro' | 'Compact Pro') {
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page
    .locator('dialog.varve-dialog--settings')
    .getByRole('combobox', { name: 'Interface density' })
    .click();
  await page.getByRole('option', { name: mode, exact: true }).click();
}

async function saveStatusLabel(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector('.save-status')?.textContent?.trim() ?? '(missing)',
  );
}

test('a density change is application state: it never dirties the document or enters undo', async ({
  page,
}) => {
  await navigateToEditor(page);

  // Fresh document, no artwork edits yet.
  await openSettings(page);
  await chooseDensity(page, 'Compact Pro');
  await closeSettings(page);

  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  expect(await saveStatusLabel(page)).toBe('Not saved');

  // The last undoable action must not be the density switch: Undo stays
  // inert (no layer rows exist to be restored), proving no history entry.
  await page.keyboard.press('Control+z');
  await expect(page.locator('.layers-row')).toHaveCount(0);
});

test('switching density with a scrolled tree preserves selection and row geometry', async ({
  page,
}) => {
  await navigateToEditor(page);

  // Ten drawn shapes give the tree enough depth to scroll in its 160px+ floor.
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('r');
    await page.mouse.move(500 + (i % 5) * 24, 260 + Math.floor(i / 5) * 40);
    await page.mouse.down();
    await page.mouse.move(540 + (i % 5) * 24, 280 + Math.floor(i / 5) * 40, { steps: 2 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
  }
  const rows = page.locator('.layers-row');
  await expect(rows.nth(9)).toBeVisible();

  // Select a mid-list row, then scroll the tree so the selection sits at the
  // bottom edge of the viewport — the switch must not strand it.
  await rows.nth(4).click();
  await expect(rows.nth(4)).toHaveClass(/--selected/);
  await page
    .locator('.layers-panel__tree')
    .evaluate((el) => el.scrollTo({ top: el.scrollHeight / 2 }));
  const tree = page.locator('.layers-panel__tree');

  const defaultRowHeight = await rows.nth(0).evaluate((el) => el.getBoundingClientRect().height);
  const defaultSpacer = await tree.evaluate((el) => el.scrollHeight);

  await openSettings(page);
  await chooseDensity(page, 'Compact Pro');
  await closeSettings(page);

  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect
    .poll(async () =>
      rows.nth(0).evaluate((el) => Number.parseFloat(getComputedStyle(el).minHeight)),
    )
    .toBe(28);

  // Rows are shorter, the spacer shrank with them, and the selected row is
  // still the selected row.
  const compactRowHeight = await rows.nth(0).evaluate((el) => el.getBoundingClientRect().height);
  expect(compactRowHeight).toBeLessThan(defaultRowHeight);
  const compactSpacer = await tree.evaluate((el) => el.scrollHeight);
  expect(compactSpacer).toBeLessThan(defaultSpacer);
  await expect(rows.nth(4)).toHaveClass(/--selected/);
});

test('density persists across reload and the pre-paint contract avoids a flash of default', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const raw = localStorage.getItem('varve-editor-settings');
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.appearance = { ...(parsed.appearance ?? {}), uiDensity: 'compact' };
    localStorage.setItem('varve-editor-settings', JSON.stringify(parsed));
  });
  await page.reload();
  // Applied by the inline pre-paint script before the module runtime boots.
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');

  await navigateToEditor(page);
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');

  // Draw one shape so the row contract is measurable.
  await page.keyboard.press('r');
  await page.mouse.move(600, 300);
  await page.mouse.down();
  await page.mouse.move(700, 340, { steps: 2 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await expect(page.locator('.layers-row').nth(0)).toBeVisible();
  await expect
    .poll(async () =>
      page
        .locator('.layers-row')
        .nth(0)
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).minHeight)),
    )
    .toBe(28);
});

test('unknown persisted density and font size normalize to the defaults', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const raw = localStorage.getItem('varve-editor-settings');
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.appearance = { ...(parsed.appearance ?? {}), uiDensity: 'cozy', fontSizeUI: 'huge' };
    localStorage.setItem('varve-editor-settings', JSON.stringify(parsed));
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable');
  await expect(page.locator('html')).toHaveJSProperty('style.fontSize', '');
});

test('UI font size is a live preference and Reset restores both defaults', async ({ page }) => {
  await navigateToEditor(page);

  // One shape so a layer row exists as the stable probe element.
  await page.keyboard.press('r');
  await page.mouse.move(600, 300);
  await page.mouse.down();
  await page.mouse.move(700, 340, { steps: 2 });
  await page.mouse.up();
  const rowName = page.locator('.layers-row__name').first();
  await expect(rowName).toBeVisible();
  const mediumSize = await rowName.evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).fontSize),
  );

  await openSettings(page);
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page
    .locator('dialog.varve-dialog--settings')
    .getByRole('combobox', { name: 'UI font size' })
    .click();
  await page.getByRole('option', { name: 'Large', exact: true }).click();
  await closeSettings(page);

  // Rem-based typography roles scale with the root override.
  await expect
    .poll(async () => rowName.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize)))
    .toBeGreaterThan(mediumSize);
  await expect(page.locator('html')).toHaveJSProperty('style.fontSize', '18px');

  await openSettings(page);
  await page
    .locator('dialog.varve-dialog--settings')
    .getByRole('button', { name: /reset to defaults/i })
    .click();
  await closeSettings(page);

  await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable');
  await expect(page.locator('html')).toHaveJSProperty('style.fontSize', '');
  await expect
    .poll(async () => rowName.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize)))
    .toBe(mediumSize);
});
