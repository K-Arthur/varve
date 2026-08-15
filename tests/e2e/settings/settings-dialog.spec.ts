import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Regression coverage for a CSS-cascade bug: `dialog:not([open]) { display:
 * none }` is a UA-origin rule that any author `display` declaration
 * overrides regardless of selector specificity. A `.varve-dialog--settings
 * { display: flex }` rule (no [open] qualifier) made the closed Settings
 * dialog stay visibly rendered as an empty header-only shell. jsdom's
 * minimal CSS engine can't compute this cascade, so it's only catchable in
 * a real browser — see AGENTS.md's "write a Playwright E2E test" rule for
 * render/layout bugs.
 */
test.describe('Settings dialog', () => {
  test('stays hidden while closed', async ({ page }) => {
    await navigateToEditor(page);

    const settingsDialog = page.locator('dialog.varve-dialog--settings');
    await expect(settingsDialog).toHaveCount(1);
    await expect(settingsDialog).not.toHaveAttribute('open');
    await expect(settingsDialog).toBeHidden();

    // The regression specifically produced a non-null bounding box for a
    // closed dialog (an empty header-only shell positioned on screen).
    const box = await settingsDialog.boundingBox();
    expect(box).toBeNull();
  });

  test('renders full nav and content when opened, at the intended width', async ({ page }) => {
    await navigateToEditor(page);

    // The web Menubar's DOM structure churns under concurrent development,
    // so click by text content directly rather than relying on a specific
    // ARIA role/name that may not match this build.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
        (e) => e.textContent?.trim() === 'File' && e.children.length === 0,
      );
      (el as HTMLElement | undefined)?.click();
    });
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
        (e) =>
          e.textContent?.trim().toLowerCase().startsWith('settings') && e.children.length === 0,
      );
      (el as HTMLElement | undefined)?.click();
    });

    const settingsDialog = page.locator('dialog.varve-dialog--settings');
    await expect(settingsDialog).toHaveAttribute('open', '', { timeout: 10000 });

    // Two real regressions this guards against: (1) width stuck at the base
    // .varve-dialog's 32rem because a same-specificity cascade tie with
    // components.css was decided by load order, not intent; (2) an
    // auto-height flex column inside <dialog> collapsing to near-zero
    // height on WebKitGTK (this app's actual Linux renderer) even though
    // Chromium sized it fine from content — a definite `height` removes
    // that cross-engine ambiguity.
    const box = await settingsDialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(600);
    expect(box!.height).toBeGreaterThan(300);

    const nav = settingsDialog.locator('.settings-dialog__nav');
    const tabCount = await nav.locator('.settings-dialog__tab').count();
    expect(tabCount).toBeGreaterThanOrEqual(6);

    const content = settingsDialog.locator('.settings-dialog__content');
    await expect(content.locator('.settings-section')).toBeVisible();
  });

  test('opens native-dialog dropdowns and applies settings immediately', async ({ page }) => {
    await navigateToEditor(page);
    await page.evaluate(() => {
      const file = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === 'File',
      );
      (file as HTMLElement | undefined)?.click();
    });
    await page.getByRole('menuitem', { name: /Settings/ }).click();

    const settingsDialog = page.locator('dialog.varve-dialog--settings[open]');
    await settingsDialog.getByRole('tab', { name: 'Export', exact: true }).click();
    const format = settingsDialog.getByRole('combobox', { name: 'Default format' });
    await format.click();
    const listbox = page.getByRole('listbox', { name: 'Default format' });
    await expect(listbox).toBeVisible();
    await expect(listbox.locator('..').locator('..')).toBeAttached();
    await listbox.getByRole('option', { name: 'SVG', exact: true }).click();
    await expect(format).toContainText('SVG');

    await settingsDialog.getByRole('tab', { name: 'Appearance', exact: true }).click();
    const theme = settingsDialog.getByRole('combobox', { name: 'Theme' });
    await theme.click();
    await page
      .getByRole('listbox', { name: 'Theme' })
      .getByRole('option', { name: 'Dark' })
      .click();
    await expect(theme).toContainText('Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.screenshot({
      path: test.info().outputPath('settings-dropdowns.png'),
      fullPage: true,
    });
  });
});
