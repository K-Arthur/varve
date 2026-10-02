import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function inspectControl(control: Locator) {
  return control.evaluate((element) => {
    const style = getComputedStyle(element);
    const luminance = (color: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Color conversion canvas unavailable');
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
      const linear = channels.map((value) => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
    };
    const a = luminance(style.color);
    const b = luminance(style.backgroundColor);
    return {
      color: style.color,
      background: style.backgroundColor,
      colorScheme: style.colorScheme,
      contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      rect: element.getBoundingClientRect().toJSON(),
    };
  });
}

async function chooseTheme(page: Page, theme: string) {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /Settings/ }).click();
  const settings = page.locator('dialog.varve-dialog--settings[open]');
  await settings.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Theme', exact: true }).click();
  const label = theme === 'high-contrast' ? 'High Contrast' : theme === 'dark' ? 'Dark' : 'Light';
  await page.getByRole('option', { name: label, exact: true }).click();
  await settings.getByRole('button', { name: /close/i }).first().click();
}

for (const theme of ['light', 'dark', 'high-contrast']) {
  for (const width of [1440, 320]) {
    test(`text creation defaults remain readable in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 740 });
      await navigateToEditor(page);
      await chooseTheme(page, theme);
      await page.setViewportSize({ width, height: 740 });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.keyboard.press('t');
      const popover = page.locator('.tool-options__popover');
      await expect(popover).toBeVisible();
      const writing = popover.getByRole('combobox', { name: 'Writing mode', exact: true });
      const orientation = popover.getByRole('combobox', {
        name: 'Character orientation',
        exact: true,
      });
      for (const control of [writing, orientation]) {
        await expect(control).toBeInViewport({ ratio: 1 });
        const metrics = await inspectControl(control);
        expect(metrics.contrast, JSON.stringify(metrics)).toBeGreaterThanOrEqual(4.5);
        expect(metrics.colorScheme).toBe(theme === 'light' ? 'light' : 'dark');
      }
      const overflow = await popover.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await writing.focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(writing).toHaveValue('vertical-rl');
      await orientation.selectOption('upright');
      await expect(orientation).toHaveValue('upright');
      await page.screenshot({
        path: testInfo.outputPath(`text-options-menu-${theme}-${width}.png`),
      });
      await page.keyboard.press('Escape');
      await expect(popover).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`text-options-${theme}-${width}.png`) });
      if (width === 320 && theme === 'dark') {
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
        });
        await expect(writing).toBeInViewport({ ratio: 1 });
        await expect(orientation).toBeInViewport({ ratio: 1 });
        const enlargedOverflow = await popover.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        );
        expect(enlargedOverflow).toBeLessThanOrEqual(1);
        await page.screenshot({ path: testInfo.outputPath('text-options-dark-320-enlarged.png') });
      }
    });
  }
}
