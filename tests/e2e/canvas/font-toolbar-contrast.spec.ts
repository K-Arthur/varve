import { writeFile } from 'node:fs/promises';
import { expect, type Locator, test } from '@playwright/test';
import { contrastRatio, relativeLuminance } from '../../../packages/shared/src/contrast';
import { navigateToEditor } from '../shared';

async function buttonContrast(button: Locator) {
  const colors = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Missing color conversion canvas');
    const rgb = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    return { foreground: rgb(style.color), background: rgb(style.backgroundColor) };
  });
  const luminance = (rgba: number[]) => relativeLuminance(rgba[0]!, rgba[1]!, rgba[2]!);
  return {
    ...colors,
    ratio: contrastRatio(luminance(colors.foreground), luminance(colors.background)),
  };
}

for (const theme of ['light', 'dark', 'high-contrast']) {
  test(`pressed toolbar buttons remain readable in ${theme}`, async ({ page }, testInfo) => {
    await navigateToEditor(page);
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    const canvas = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
    if (!canvas) throw new Error('Canvas has no bounds');
    await page.keyboard.press('t');
    await page.mouse.click(canvas.x + 120, canvas.y + 160);
    await page.keyboard.insertText('Readable formatting controls');
    const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });
    const bold = toolbar.getByRole('button', { name: 'Bold', exact: true });
    await bold.click();
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    for (const state of ['pressed', 'hovered']) {
      if (state === 'hovered') await bold.hover();
      else await page.mouse.move(10, 10);
      const measured = await buttonContrast(bold);
      await writeFile(
        testInfo.outputPath(`${theme}-${state}-contrast.json`),
        JSON.stringify(measured, null, 2),
      );
      await testInfo.attach(`${theme}-${state}-contrast`, {
        body: JSON.stringify(measured, null, 2),
        contentType: 'application/json',
      });
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${state}.png`) });
      expect(measured.foreground[3]).toBe(255);
      expect(measured.background[3]).toBe(255);
      expect(measured.ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
}
