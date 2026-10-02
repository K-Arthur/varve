import { expect, test } from '@playwright/test';
import { captureProducerScreenshot } from '../../../scripts/screenshots/producer-capture.mjs';
import { navigateToEditor } from '../shared';

test('performance guidance fits dark settings at 200% text size', async ({ page }, testInfo) => {
  await navigateToEditor(page);
  await page.setViewportSize({ width: 820, height: 720 });
  await page.evaluate(() => {
    const file = [...document.querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === 'File',
    );
    (file as HTMLElement | undefined)?.click();
  });
  await page.getByRole('menuitem', { name: /Settings/ }).click();

  const settings = page.locator('dialog.varve-dialog--settings[open]');
  await settings.getByRole('tab', { name: 'Appearance', exact: true }).click();
  const theme = settings.getByRole('combobox', { name: 'Theme' });
  await theme.click();
  await page.getByRole('option', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await settings.getByRole('tab', { name: 'Performance', exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('font-size', '200%', 'important');
  });
  const guidance = settings.getByText(/Warm refinement targets are 500\s*ms for ordinary work/i);
  await expect(guidance).toBeVisible();
  await settings.getByRole('combobox', { name: 'Interactive preview quality' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus-visible').first()).toBeVisible();

  const overflow = await settings.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await settings.locator('.settings-dialog__content').evaluate((element) => {
    element.scrollTop = 0;
  });
  const budget = settings.getByRole('combobox', { name: 'Memory / cache budget' });
  await expect(budget).toContainText(/Balanced/i);
  const budgetWidth = await budget.evaluate((element) => element.getBoundingClientRect().width);
  expect(budgetWidth).toBeGreaterThan(250);
  await page.screenshot({
    path: testInfo.outputPath('performance-settings-dark-narrow-200-percent.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.removeProperty('font-size');
  });
  await settings.locator('.settings-dialog__content').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await captureProducerScreenshot(page, testInfo, 'performance-settings-dark.png', {
    target: settings,
  });

  await settings.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Theme' }).click();
  await page.getByRole('option', { name: 'Light', exact: true }).click();
  await settings.getByRole('tab', { name: 'Performance', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await settings.locator('.settings-dialog__content').evaluate((element) => {
    element.scrollTop = 0;
  });
  await settings.screenshot({
    path: testInfo.outputPath('performance-settings-light.png'),
    animations: 'disabled',
  });

  await settings.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Theme' }).click();
  await page.getByRole('option', { name: 'High Contrast', exact: true }).click();
  await settings.getByRole('tab', { name: 'Performance', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
  await expect(guidance).toBeVisible();
  await settings.locator('.settings-dialog__content').evaluate((element) => {
    element.scrollTop = 0;
  });
  await settings.screenshot({
    path: testInfo.outputPath('performance-settings-high-contrast.png'),
    animations: 'disabled',
  });
});
