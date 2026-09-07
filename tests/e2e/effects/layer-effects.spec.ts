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
    await addEffect(page, section, 'Layer Blur');
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

  test('exposes Layer Effects for editable text without replacing the text layer', async ({
    page,
  }) => {
    await page.keyboard.press('t');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 240, box.y + 220);
    await page.keyboard.type('Aa gyp');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const section = await openEffectsSection(page);
    await addEffect(page, section, 'Inner Shadow');
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i);
    await expect(section).toContainText('Inner Shadow');
  });
});
