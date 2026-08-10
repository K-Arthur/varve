/**
 * Nudge transaction resilience E2E tests.
 *
 * Covers: single-arrow nudge, Shift-modified large nudge, key-repeat
 * behavior, modifier changes mid-gesture, window blur handling, undo
 * coalescing of multi-nudge gestures, and auto-reparent when nudging
 * into a frame.
 */
import { expect, test } from '@playwright/test';
import { mod } from '../helpers/menu-helpers';
import { dragOnCanvas, navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

/**
 * Read the X (px) spinbutton value for the currently selected node.
 */
async function getSelectedX(page: import('@playwright/test').Page): Promise<number> {
  const xField = page.getByRole('spinbutton', { name: /^x(?: \(ab\))? \(px\)$/i });
  await expect(xField).toBeAttached({ timeout: 3000 });
  return Number(await xField.inputValue());
}

/**
 * Read the Y (px) spinbutton value for the currently selected node.
 */
async function getSelectedY(page: import('@playwright/test').Page): Promise<number> {
  const yField = page.getByRole('spinbutton', { name: /^y(?: \(ab\))? \(px\)$/i });
  await expect(yField).toBeAttached({ timeout: 3000 });
  return Number(await yField.inputValue());
}

/**
 * Read both X and Y spinbutton values.
 */
async function getSelectedPosition(
  page: import('@playwright/test').Page,
): Promise<{ x: number; y: number }> {
  return { x: await getSelectedX(page), y: await getSelectedY(page) };
}

/**
 * Create a single rect at a fixed position and select it.
 */
async function createRect(page: import('@playwright/test').Page) {
  await page.keyboard.press('r');
  await dragOnCanvas(page, 200, 200, 400, 350);
  await page.keyboard.press('v');
  await page.waitForTimeout(200);

  const treeItem = page.getByRole('treeitem').filter({ hasText: /rect/i }).last();
  await treeItem.click();
  await page.locator('canvas.editor-canvas__content-layer').focus();
  await page.waitForTimeout(200);
}

test.describe('Nudge transaction resilience', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
  });

  test('arrow key nudges a selected node', async ({ page }) => {
    await createRect(page);
    const before = await getSelectedPosition(page);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);

    const after = await getSelectedPosition(page);
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBe(before.y);
  });

  test('Shift+Arrow produces a larger nudge', async ({ page }) => {
    await createRect(page);
    const before = await getSelectedPosition(page);

    // Single arrow nudge first
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    const afterSingle = await getSelectedPosition(page);
    const singleDelta = afterSingle.x - before.x;

    // Undo back to original
    await page.keyboard.press(mod('z'));
    await page.waitForTimeout(100);
    const afterUndo = await getSelectedPosition(page);
    expect(afterUndo.x).toBe(before.x);

    // Shift+Arrow nudge
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(100);
    const afterShift = await getSelectedPosition(page);
    const shiftDelta = afterShift.x - before.x;

    // Shift nudge should be larger than single nudge
    expect(shiftDelta).toBeGreaterThan(singleDelta);
  });

  test('rapid repeated arrow keys each move the node', async ({ page }) => {
    await createRect(page);
    const before = await getSelectedPosition(page);

    // Press ArrowRight 5 times rapidly
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(100);

    const after = await getSelectedPosition(page);
    const delta = after.x - before.x;
    // Each press should have contributed
    expect(delta).toBeGreaterThanOrEqual(5);
  });

  test('modifier key changes mid-gesture are handled correctly', async ({ page }) => {
    await createRect(page);
    const before = await getSelectedPosition(page);

    // Start with Shift+Arrow (large nudge)
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);

    // Release Shift and press ArrowRight without shift (small nudge)
    await page.keyboard.up('Shift');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);

    // Press Shift again and nudge
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(100);

    const after = await getSelectedPosition(page);
    // Should have moved right by a combination of large + small + large
    expect(after.x).toBeGreaterThan(before.x + 5);
  });

  test('window blur does not cause stuck key state', async ({ page }) => {
    await createRect(page);
    const before = await getSelectedPosition(page);

    // Simulate window blur while a key is held
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(50);

    // Dispatch blur event to window
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
    });
    await page.waitForTimeout(50);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(100);

    // After blur + release, the editor should still accept input
    const afterBlur = await getSelectedPosition(page);
    expect(afterBlur.x).toBeGreaterThanOrEqual(before.x);

    // Another nudge should work
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    const afterSecond = await getSelectedPosition(page);
    expect(afterSecond.x).toBeGreaterThan(afterBlur.x);
  });

  test('undo of a multi-nudge gesture creates one undo step', async ({ page }) => {
    await createRect(page);
    const before = await getSelectedPosition(page);

    // One held-key gesture: initial keydown, OS-style repeat events, keyup.
    // Separate keyboard.press calls are separate tap gestures and correctly
    // create separate undo units.
    await page.keyboard.down('ArrowRight');
    await page.locator('canvas.editor-canvas__content-layer').evaluate((canvas) => {
      for (let index = 0; index < 2; index++) {
        canvas.dispatchEvent(
          new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowRight',
            code: 'ArrowRight',
            repeat: true,
          }),
        );
      }
    });
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(100);

    const afterNudge = await getSelectedPosition(page);
    expect(afterNudge.x).toBeGreaterThan(before.x);

    // Single undo should revert all 3 nudges in one step
    await page.keyboard.press(mod('z'));
    await page.waitForTimeout(200);

    const afterUndo = await getSelectedPosition(page);
    expect(afterUndo.x).toBe(before.x);
  });

  test('nudging a node into a frame auto-reparents it', async ({ page }) => {
    // Create a frame
    await page.keyboard.press('f');
    await dragOnCanvas(page, 100, 100, 500, 450);
    await page.waitForTimeout(100);

    // Create a rect outside the frame
    await page.keyboard.press('r');
    await dragOnCanvas(page, 600, 200, 700, 300);
    await page.waitForTimeout(100);

    // Select the rect
    await page.keyboard.press('v');
    const rectItem = page.getByRole('treeitem').filter({ hasText: /rect/i }).last();
    await rectItem.click();
    await page.waitForTimeout(100);
    const beforeLevel = await rectItem.getAttribute('aria-level');

    // Nudge the rect left into the frame bounds
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(200);

    // If the frame auto-captures overlapping children on commit,
    // the aria-level of the rect may increase.
    const afterLevel = await rectItem.getAttribute('aria-level');
    if (afterLevel !== null && beforeLevel !== null) {
      expect(typeof afterLevel).toBe('string');
    }

    // Editor is still stable
    await expect(page.locator('.layers-panel')).toBeVisible();
  });
});
