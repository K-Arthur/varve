/**
 * Human-review capture matrix for application theme chrome.
 *
 * These are deliberately review artifacts, not self-approving snapshot
 * baselines. Set VARVE_THEME_VISUAL_QA_DIR to retain the images at a known
 * path, open them after the run, and record the visual judgment separately.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

type ThemePreference = 'system' | 'light' | 'dark' | 'high-contrast';

const outputDir =
  process.env.VARVE_THEME_VISUAL_QA_DIR ?? `test-results/theme-visual-qa-${process.pid}`;

async function seedTheme(
  page: import('@playwright/test').Page,
  preference: ThemePreference,
  colorScheme: 'light' | 'dark',
) {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await page.addInitScript((value: ThemePreference) => {
    localStorage.setItem('varve-theme', value);
  }, preference);
}

async function openAppearanceSettings(page: import('@playwright/test').Page) {
  await navigateToEditor(page);
  await page.evaluate(() => {
    const file = [...document.querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === 'File',
    );
    (file as HTMLElement | undefined)?.click();
  });
  await page.getByRole('menuitem', { name: /Settings/ }).click();
  const dialog = page.locator('dialog.varve-dialog--settings[open]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Theme' })).toBeVisible();
  return dialog;
}

for (const scenario of [
  { preference: 'light', colorScheme: 'dark' },
  { preference: 'dark', colorScheme: 'light' },
  { preference: 'high-contrast', colorScheme: 'light' },
  { preference: 'system', colorScheme: 'dark' },
] as const) {
  test(`${scenario.preference}: editor and Appearance settings`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedTheme(page, scenario.preference, scenario.colorScheme);
    const dialog = await openAppearanceSettings(page);

    const expectedTheme =
      scenario.preference === 'system' ? scenario.colorScheme : scenario.preference;
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', scenario.preference);
    await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme);
    await expect(dialog.getByRole('combobox', { name: 'Theme' })).toContainText(
      scenario.preference === 'high-contrast'
        ? 'High Contrast'
        : `${scenario.preference[0]!.toUpperCase()}${scenario.preference.slice(1)}`,
    );

    await page.screenshot({
      path: `${outputDir}/editor-settings-${scenario.preference}.png`,
      fullPage: false,
    });
  });
}

test('high-contrast: detached-window invalid-route state', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await seedTheme(page, 'high-contrast', 'light');
  await page.goto('/?surface=panel-window');

  await expect(page.getByRole('main', { name: 'Panel window unavailable' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
  await page.screenshot({
    path: `${outputDir}/auxiliary-invalid-route-high-contrast.png`,
    fullPage: false,
  });
});
