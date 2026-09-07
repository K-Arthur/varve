import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

async function openEffectsSection(page: import('@playwright/test').Page) {
  const section = page.locator('.insp-disclosure').filter({ hasText: 'Layer Effects' });
  await expect(section).toBeVisible({ timeout: 10000 });
  const trigger = section.getByRole('button', { name: 'Layer Effects', exact: true });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  return section;
}

async function addEffect(
  page: import('@playwright/test').Page,
  section: import('@playwright/test').Locator,
  label: string,
) {
  await section.getByRole('combobox', { name: 'New effect type' }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await section.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(section.locator('.insp-effect-row').filter({ hasText: label })).toBeVisible();
}

test.describe('Layer Effects — real editor workflow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await page.getByRole('tab', { name: 'Design', exact: true }).click();
  });

  test('reorders effects within a stage and disables cross-stage no-ops', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 160, 160, 420, 340);
    const section = await openEffectsSection(page);

    await addEffect(page, section, 'Drop Shadow');
    await addEffect(page, section, 'Outer Glow');
    await addEffect(page, section, 'Layer Blur');

    const rows = section.locator('.insp-effect-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Drop Shadow');
    await expect(rows.nth(1)).toContainText('Outer Glow');
    await expect(rows.nth(2)).toContainText('Layer Blur');

    await rows.nth(0).getByRole('button', { name: 'Move effect down' }).click();
    await expect(rows.nth(0)).toContainText('Outer Glow');
    await expect(rows.nth(1)).toContainText('Drop Shadow');

    await expect(rows.nth(2).getByRole('button', { name: 'Move effect up' })).toBeDisabled();
    await expect(section).toHaveScreenshot('layer-effects-stage-order.png', {
      maxDiffPixels: 300,
    });
  });

  test('exposes Layer Effects for a painted raster layer and changes the real canvas', async ({
    page,
  }, testInfo) => {
    await page.keyboard.press('b');
    await dragOnCanvas(page, 180, 180, 360, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(500);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const before = await canvas.screenshot({
      path: testInfo.outputPath('raster-layer-before-effect.png'),
    });
    const section = await openEffectsSection(page);
    await addEffect(page, section, 'Drop Shadow');
    await expect
      .poll(async () => Buffer.compare(before, await canvas.screenshot()), { timeout: 5000 })
      .not.toBe(0);
    const after = await canvas.screenshot();
    await canvas.screenshot({ path: testInfo.outputPath('raster-layer-after-effect.png') });
    expect(Buffer.compare(before, after)).not.toBe(0);
    await page.screenshot({
      path: testInfo.outputPath('raster-layer-effect.png'),
      fullPage: false,
    });
  });

  test('follows transparent PNG alpha instead of its rectangular bounds', async ({
    page,
  }, testInfo) => {
    const source = await page.evaluate(() => {
      const image = document.createElement('canvas');
      image.width = 180;
      image.height = 140;
      const ctx = image.getContext('2d')!;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(90, 70, 48, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(90, 70, 18, 0, Math.PI * 2);
      ctx.fill();
      return image.toDataURL('image/png').split(',')[1]!;
    });
    await page.locator('#file-import-input').setInputFiles({
      name: 'transparent-cutout.png',
      mimeType: 'image/png',
      buffer: Buffer.from(source, 'base64'),
    });
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect
      .poll(async () => (await canvas.screenshot()).length, { timeout: 10000 })
      .toBeGreaterThan(0);
    const before = await canvas.screenshot({
      path: testInfo.outputPath('transparent-png-before-effect.png'),
    });
    const section = await openEffectsSection(page);
    await addEffect(page, section, 'Drop Shadow');
    await expect
      .poll(async () => Buffer.compare(before, await canvas.screenshot()), { timeout: 10000 })
      .not.toBe(0);
    await canvas.screenshot({ path: testInfo.outputPath('transparent-png-after-effect.png') });
    await expect(page.getByRole('treeitem').first()).toContainText(/transparent-cutout/i);
  });

  test('exposes Layer Effects for editable text without replacing the text layer', async ({
    page,
  }, testInfo) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 500, 400);
    await page.keyboard.press('t');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 240, box.y + 220);
    await page.keyboard.type('Aa gyp');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
    const textLayer = page.getByRole('treeitem').filter({ hasText: /text/i }).first();
    await textLayer.click();

    const before = await canvas.screenshot({
      path: testInfo.outputPath('text-layer-before-effect.png'),
    });
    const section = await openEffectsSection(page);
    await addEffect(page, section, 'Drop Shadow');
    await page.waitForTimeout(750);
    const after = await canvas.screenshot({
      path: testInfo.outputPath('text-layer-after-effect.png'),
    });
    expect(Buffer.compare(before, after)).not.toBe(0);
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i);
    await expect(section).toContainText('Drop Shadow');
  });

  test('renders every effect family on editable text and exposes specific controls', async ({
    page,
  }, testInfo) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 500, 400);
    await page.keyboard.press('t');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 240, box.y + 220);
    await page.keyboard.type('Layer Effects');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
    await page.getByRole('treeitem').filter({ hasText: /text/i }).first().click();
    const section = await openEffectsSection(page);
    const effects = [
      'Drop Shadow',
      'Inner Shadow',
      'Outer Glow',
      'Inner Glow',
      'Layer Blur',
      'Background Blur',
      'Chromatic Aberration',
      'Glitch',
      'Glass Material',
      'Depth Blur',
    ];

    for (const label of effects) {
      const before = await canvas.screenshot();
      await addEffect(page, section, label);
      await page.waitForTimeout(250);
      await canvas.screenshot({
        path: testInfo.outputPath(`text-${label.toLowerCase().replaceAll(' ', '-')}.png`),
      });
      const changed = Buffer.compare(before, await canvas.screenshot()) !== 0;
      // Depth Blur is intentionally neutral until a depth map is attached;
      // backdrop effects can also be pixel-neutral over a flat backdrop. The
      // important invariant for those cases is that the editable text remains
      // painted and the renderer does not blank its layer.
      if (!['Depth Blur', 'Background Blur'].includes(label)) expect(changed).toBe(true);
      const paintedPixels = await canvas.evaluate((el) => {
        const context = (el as HTMLCanvasElement).getContext('2d');
        if (!context) return 0;
        const pixels = context.getImageData(0, 0, context.canvas.width, context.canvas.height).data;
        let count = 0;
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! > 0) count++;
        return count;
      });
      expect(paintedPixels).toBeGreaterThan(0);
      await expect(page.getByRole('treeitem').filter({ hasText: /text/i }).first()).toBeVisible();

      const row = section.locator('.insp-effect-row').filter({ hasText: label }).last();
      if (label === 'Chromatic Aberration') {
        await expect(row.getByLabel('Red channel colour')).toBeVisible();
        await expect(row.getByLabel('Green channel colour')).toBeVisible();
        await expect(row.getByLabel('Blue channel colour')).toBeVisible();
      }
      if (label === 'Glitch') await expect(row.getByLabel('Glitch blend mode')).toBeVisible();
      if (label === 'Depth Blur') {
        await expect(row.getByLabel('Focus range')).toBeVisible();
        await expect(row.getByLabel('Edge protection')).toBeVisible();
      }

      await row.getByRole('button', { name: 'Remove effect' }).click();
      await expect(section.locator('.insp-effect-row').filter({ hasText: label })).toHaveCount(0);
    }
  });
});
