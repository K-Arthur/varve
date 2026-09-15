import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('typography inspector uses readable labels and aligned controls at both panel widths', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Canvas has no bounds');
  await page.keyboard.press('t');
  await page.mouse.click(bounds.x + 160, bounds.y + 180);
  await page.keyboard.insertText('Typography controls');
  await page.keyboard.press('Escape');
  const section = page.locator('.typography-controls');
  await expect(section).toBeVisible();
  await expect(page.locator('.micro-hint')).toBeHidden({ timeout: 10000 });
  for (const theme of ['light', 'dark', 'high-contrast']) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    const splitter = page.getByRole('separator', { name: 'Resize inspector panel' });
    for (const width of ['expanded', 'minimum']) {
      await splitter.focus();
      await splitter.press(width === 'expanded' ? 'End' : 'Home');
      const family = section.getByRole('combobox', { name: 'Font family' });
      await family.scrollIntoViewIfNeeded();
      const browse = section.getByRole('button', { name: 'Browse fonts' });
      const fieldBox = await family.boundingBox();
      const browseBox = await browse.boundingBox();
      if (!fieldBox || !browseBox) throw new Error('Font fields have no bounds');
      expect(fieldBox.width).toBeGreaterThanOrEqual(160);
      expect(fieldBox.height).toBe(browseBox.height);
      expect(fieldBox.y).toBeCloseTo(browseBox.y, 0);
      const clipped = await section.locator('.insp-field__label').evaluateAll((labels) =>
        labels
          .filter((label) => /Line height|Letter spacing/.test(label.textContent ?? ''))
          .filter((label) => label.scrollWidth > label.clientWidth + 1)
          .map((label) => label.textContent),
      );
      expect(clipped).toEqual([]);
      const align = section.getByRole('radiogroup', { name: 'Text align', exact: true });
      const rows = await align
        .getByRole('radio')
        .evaluateAll(
          (buttons) =>
            new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().y))).size,
        );
      expect(rows).toBe(1);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}.png`) });
      await align.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}-alignment.png`) });
    }
  }
});
