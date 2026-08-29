import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Inspector feature ownership', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('tabs use one compact row with roving focus and no duplicate overflow items', async ({
    page,
  }) => {
    const properties = page.getByRole('tab', { name: 'Properties' });
    const appearance = page.getByRole('tab', { name: 'Appearance' });

    const tabs = page.getByRole('tablist', { name: 'Inspector tabs' });
    const tabCount = await tabs.getByRole('tab').count();
    expect(tabCount).toBeGreaterThan(1);
    await expect(page.getByRole('button', { name: /more tabs/i })).toHaveCount(0);
    const tabTopEdges = await tabs
      .getByRole('tab')
      .evaluateAll((elements) =>
        elements.map((element) => Math.round(element.getBoundingClientRect().top)),
      );
    expect(new Set(tabTopEdges).size).toBe(1);

    await properties.focus();
    await page.keyboard.press('ArrowRight');
    await expect(appearance).toBeFocused();
    await expect(appearance).toHaveAttribute('aria-selected', 'true');

    await properties.click();
    await expect(page.getByRole('tab', { name: 'Document' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Canvas', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Document Color' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Canvas background' })).toBeVisible();
    await expect(page.locator('.editor-inspector')).toHaveScreenshot('document-settings.png', {
      animations: 'disabled',
    });
  });

  test('prototype authoring is discoverable without living in Properties', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.keyboard.press('r');
    await page.mouse.move(box.x + 250, box.y + 220);
    await page.mouse.down();
    await page.mouse.move(box.x + 390, box.y + 320);
    await page.mouse.up();

    await page.getByRole('tab', { name: 'Properties' }).click();
    await expect(page.getByRole('button', { name: 'Prototype Interactions' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Prototype' }).click();
    await expect(page.getByRole('button', { name: 'Prototype Interactions' })).toBeVisible();
  });

  test('a common shape stays within the contextual inspector DOM budget', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.keyboard.press('r');
    await page.mouse.move(box.x + 250, box.y + 220);
    await page.mouse.down();
    await page.mouse.move(box.x + 390, box.y + 320);
    await page.mouse.up();
    await page.getByRole('tab', { name: 'Properties' }).click();

    await expect(page.locator('.editor-inspector')).toHaveCount(1);
    const inspector = page.locator('.editor-inspector');
    for (const label of [
      /^X(?: \(AB\))? \(px\)$/,
      /^Y(?: \(AB\))? \(px\)$/,
      /^W \(px\)$/,
      /^H \(px\)$/,
    ]) {
      await expect(inspector.getByRole('spinbutton', { name: label })).toHaveCount(1);
    }
    await expect(inspector.getByRole('spinbutton', { name: 'Opacity', exact: true })).toHaveCount(
      1,
    );
    for (const label of ['Min W (px)', 'Max W (px)', 'Min H (px)', 'Max H (px)']) {
      await expect(inspector.getByRole('spinbutton', { name: label })).toHaveCount(0);
    }
    await expect(inspector.getByRole('button', { name: 'Corner Radius' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(inspector.getByRole('slider', { name: 'Corner smoothing' })).toHaveCount(0);

    const metrics = await page.locator('.editor-inspector').evaluate((element) => ({
      descendants: element.querySelectorAll('*').length,
      scrollHeight: element.scrollHeight,
      viewportHeight: element.clientHeight,
    }));

    // The contextual inspector now includes the collapsed Selection Sources
    // entry point; keep a bounded budget while allowing that shared control.
    expect(metrics.descendants).toBeLessThanOrEqual(280);
    expect(metrics.scrollHeight / metrics.viewportHeight).toBeLessThanOrEqual(1.75);
    await expect(page.getByRole('button', { name: 'Effects' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Prototype Interactions' })).toHaveCount(0);
    await expect(page.locator('.editor-inspector')).toHaveScreenshot('rectangle-properties.png', {
      animations: 'disabled',
    });
  });

  test('brush behavior opens from Tool Options instead of Properties', async ({ page }) => {
    await page.getByRole('radio', { name: 'Draw workspace' }).click();
    await page.locator('canvas.editor-canvas__content-layer').focus();
    await page.keyboard.press('b');
    const dialog = page.getByRole('dialog', { name: 'paint tool options' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Brush', exact: true })).toBeFocused();
  });

  test('responsive inspector drawer is inside the viewport when opened', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.getByRole('button', { name: 'Show inspector panel' }).click();

    const panel = page.locator('.editor__inspector-panel');
    await expect(panel).toHaveAttribute('data-visible', 'true');
    await expect
      .poll(async () => {
        const box = await panel.boundingBox();
        return box ? Math.ceil(box.x + box.width) : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(800);
  });
});
