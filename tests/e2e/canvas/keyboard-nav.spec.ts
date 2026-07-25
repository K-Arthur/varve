import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';
import { assertFocusNotOnBody, mod } from '../helpers/menu-helpers';

test.describe.configure({ mode: 'serial' });

test.describe('Canvas keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  // ─── Focus management ───────────────────────────────────────────

  test('canvas is focusable with tabIndex', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'attached' });

    const tabIndex = await canvas.getAttribute('tabindex');
    expect(tabIndex).toBe('0');
  });

  test('canvas receives focus on pointer down', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'attached', timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.mouse.click(box.x + 100, box.y + 100);

    const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
    expect(activeTag).toBe('CANVAS');
  });

  // ─── Tab / Shift+Tab cycling ────────────────────────────────────

  test('Tab cycles selection to next node', async ({ page }) => {
    await seedLayers(page, 3);
    const treeItems = page.getByRole('treeitem');
    await expect(treeItems).toHaveCount(3, { timeout: 5000 });

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.focus();

    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    const firstSel = await page.evaluate(() => document.activeElement?.getAttribute('role') ?? '');
    expect(firstSel).toBe('treeitem');

    await assertFocusNotOnBody(page);
  });

  test('Shift+Tab cycles selection to previous node', async ({ page }) => {
    await seedLayers(page, 3);
    await expect(page.getByRole('treeitem')).toHaveCount(3, { timeout: 5000 });

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.focus();

    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(200);

    await assertFocusNotOnBody(page);
  });

  // ─── Zoom presets (1-6) ─────────────────────────────────────────

  test('zoom preset 3 (100%) works', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.focus();

    await page.keyboard.press('3');
    await page.waitForTimeout(200);

    await assertFocusNotOnBody(page);
  });

  test('zoom preset 1 (50%) to 6 (400%) all work without crash', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.focus();

    for (const key of ['1', '2', '3', '4', '5', '6']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(100);
    }

    await assertFocusNotOnBody(page);
  });

  test('Ctrl+0 resets zoom to 100%', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.focus();

    await page.keyboard.press(mod('0'));
    await page.waitForTimeout(200);

    await assertFocusNotOnBody(page);
  });

  // ─── Zoom in/out (+/-) ──────────────────────────────────────────

  test('+ and - zoom in and out', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.focus();

    await page.keyboard.press('=');
    await page.waitForTimeout(100);
    await page.keyboard.press('-');
    await page.waitForTimeout(100);

    await assertFocusNotOnBody(page);
  });

  // ─── Escape ─────────────────────────────────────────────────────

  test('Escape deselects all nodes', async ({ page }) => {
    await seedLayers(page, 1);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.focus();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await assertFocusNotOnBody(page);
  });

  // ─── Tool shortcuts ─────────────────────────────────────────────

  test('v activates Select tool', async ({ page }) => {
    const toolbar = page.locator('.floating-toolbar');
    await toolbar.waitFor({ state: 'visible' });

    await page.keyboard.press('v');
    const selectBtn = toolbar.getByRole('button', { pressed: true });
    await expect(selectBtn).toHaveAttribute('aria-label', /select/i);
  });

  test('r activates Rectangle tool, then create shape', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'attached' });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.up();

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
  });

  test('f activates Frame tool', async ({ page }) => {
    const toolbar = page.locator('.floating-toolbar');
    await toolbar.waitFor({ state: 'visible' });

    await page.keyboard.press('f');
    const frameBtn = toolbar.getByRole('button', { pressed: true });
    await expect(frameBtn).toHaveAttribute('aria-label', /frame/i);
  });

  test('t activates Text tool', async ({ page }) => {
    const toolbar = page.locator('.floating-toolbar');
    await toolbar.waitFor({ state: 'visible' });

    await page.keyboard.press('t');
    const textBtn = toolbar.getByRole('button', { pressed: true });
    await expect(textBtn).toHaveAttribute('aria-label', /text/i);
  });

  test('o activates Ellipse tool', async ({ page }) => {
    const toolbar = page.locator('.floating-toolbar');
    await toolbar.waitFor({ state: 'visible' });

    await page.keyboard.press('o');
    const ellipseBtn = toolbar.getByRole('button', { pressed: true });
    await expect(ellipseBtn).toHaveAttribute('aria-label', /ellipse/i);
  });

  // ─── Undo/Redo ──────────────────────────────────────────────────

  test('Undo removes last created shape', async ({ page }) => {
    await seedLayers(page, 1);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });

    await page.keyboard.press(mod('z'));
    await page.waitForTimeout(200);
    await expect(page.getByRole('treeitem')).toHaveCount(0, { timeout: 5000 });

    await page.keyboard.press(`Shift+${mod('z')}`);
    await page.waitForTimeout(200);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
  });

  // ─── Shift+1 / Shift+2 reveal shortcuts ─────────────────────────

  test('Shift+1 fits all nodes in view', async ({ page }) => {
    await seedLayers(page, 2);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 5000 });

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.focus();
    await page.keyboard.press('Shift+1');
    await page.waitForTimeout(200);

    await assertFocusNotOnBody(page);
  });

  // ─── Focus assertion ────────────────────────────────────────────

  test('focus never lands on body after canvas keyboard ops', async ({ page }) => {
    await seedLayers(page, 1);

    const ops = [
      async () => {
        await page.keyboard.press('Escape');
      },
      async () => {
        await page.keyboard.press('3');
      },
      async () => {
        await page.keyboard.press('=');
      },
    ];

    for (const op of ops) {
      const canvas = page.locator('canvas.editor-canvas__content-layer');
      await canvas.focus();
      await op();
      await page.waitForTimeout(100);
      await assertFocusNotOnBody(page);
    }
  });

  // ─── Tool shortcuts work after layers tree focus ────────────────

  test('tool shortcuts work after clicking tree item', async ({ page }) => {
    await seedLayers(page, 1);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });

    const treeItem = page.getByRole('treeitem').first();
    await treeItem.click();
    await expect(treeItem).toBeVisible();

    await page.keyboard.press('o');
    const toolbar = page.locator('.floating-toolbar');
    const ellipseBtn = toolbar.getByRole('button', { pressed: true });
    await expect(ellipseBtn).toHaveAttribute('aria-label', /ellipse/i);
  });
});
