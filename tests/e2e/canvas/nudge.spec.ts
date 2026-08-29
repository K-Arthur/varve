/**
 * Nudge transaction resilience E2E tests.
 *
 * Covers: single-arrow nudge, Shift-modified large nudge, key-repeat
 * behavior, modifier changes mid-gesture, window blur handling, undo
 * coalescing of multi-nudge gestures, multi-selection movement, and
 * hierarchy stability when nudging into a frame.
 */
import { expect, test } from '@playwright/test';
import { mod } from '../helpers/menu-helpers';
import { dragOnCanvas, navigateToEditor, seedLayers } from '../shared';

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

/** FNV-1a over every fourth pixel of the authoritative content canvas. */
async function surfaceHash(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const surface = element as HTMLCanvasElement;
    const context = surface.getContext('2d');
    if (!context) throw new Error('canvas 2d context unavailable');
    const data = context.getImageData(0, 0, surface.width, surface.height).data;
    let hash = 2166136261;
    for (let index = 0; index < data.length; index += 16) {
      const r = data[index] ?? 0;
      const g = data[index + 1] ?? 0;
      const b = data[index + 2] ?? 0;
      hash = Math.imul(hash ^ r, 16777619);
      hash = Math.imul(hash ^ g, 16777619);
      hash = Math.imul(hash ^ b, 16777619);
    }
    return hash;
  });
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
    // The perf query exposes forceFullRedraw so a nudge can be checked
    // against an authoritative renderer replay in the multi-selection test.
    await navigateToEditor(page, '/?perf=1');
  });

  test('arrow key nudges a selected node', async ({ page }) => {
    await createRect(page);
    const before = await getSelectedPosition(page);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);

    const after = await getSelectedPosition(page);
    expect(after.x - before.x).toBe(1);
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

    expect(singleDelta).toBe(1);
    expect(shiftDelta).toBe(10);
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

  test('nudges every selected root equally without changing their hierarchy', async ({
    page,
  }, testInfo) => {
    await seedLayers(page, 2);
    await page.keyboard.press('v');

    const shapes = page.locator('[role="treeitem"][data-layer-type="shape"]');
    await expect(shapes).toHaveCount(2);
    const first = shapes.nth(0);
    const second = shapes.nth(1);

    await first.click();
    const firstBefore = await getSelectedPosition(page);
    await second.click();
    const secondBefore = await getSelectedPosition(page);

    // Select through the real Layers UI, then return keyboard ownership to
    // the canvas. The rows verify both independent roots are selected.
    await first.click();
    await second.click({ modifiers: ['Control'] });
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(second).toHaveAttribute('aria-selected', 'true');

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.focus();
    const pageScrollBefore = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    const beforeHash = await surfaceHash(page);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const liveHash = await surfaceHash(page);
    expect(liveHash, 'the rendered selected objects must move').not.toBe(beforeHash);
    const screenshot = await canvas.screenshot();
    await testInfo.attach('multi-selection-nudge', { body: screenshot, contentType: 'image/png' });

    // The same camera must produce the same pixels after an authoritative
    // full redraw; this catches stale surface reuse after a batched movement.
    await page.evaluate(() => {
      (
        window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } }
      ).__varvePerf?.forceFullRedraw?.();
    });
    await page.waitForTimeout(700);
    expect(await surfaceHash(page), 'batched nudge surface must equal a full redraw').toBe(
      liveHash,
    );
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(
      pageScrollBefore,
    );

    // Inspect each object separately. Every selected root must receive the
    // same document-space delta, retaining their relative world spacing.
    await first.click();
    const firstAfter = await getSelectedPosition(page);
    await second.click();
    const secondAfter = await getSelectedPosition(page);
    expect(firstAfter.x - firstBefore.x).toBe(1);
    expect(firstAfter.y).toBe(firstBefore.y);
    expect(secondAfter.x - secondBefore.x).toBe(1);
    expect(secondAfter.y).toBe(secondBefore.y);
    expect(secondAfter.x - firstAfter.x).toBe(secondBefore.x - firstBefore.x);
    expect(secondAfter.y - firstAfter.y).toBe(secondBefore.y - firstBefore.y);
  });

  test('nudging into a frame never auto-reparents the selected node', async ({ page }) => {
    // Create a frame
    await page.keyboard.press('f');
    await dragOnCanvas(page, 100, 100, 500, 450);
    await page.waitForTimeout(100);

    // Create a shape outside the frame
    await page.keyboard.press('r');
    await dragOnCanvas(page, 520, 200, 540, 220);
    await page.waitForTimeout(100);

    // Select the shape
    await page.keyboard.press('v');
    const rectItem = page.locator('[role="treeitem"][data-layer-type="shape"]').last();
    await rectItem.click();
    const beforePosition = await getSelectedPosition(page);
    await page.waitForTimeout(100);
    const beforeLevel = await rectItem.getAttribute('aria-level');
    expect(beforeLevel, 'the shape starts at the document root').not.toBeNull();

    // Move the full shape inside the frame. Keyboard nudging translates
    // its existing transform; it must not reuse drag-drop auto-reparenting.
    await page.locator('canvas.editor-canvas__content-layer').focus();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Shift+ArrowLeft');
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(200);
    const afterPosition = await getSelectedPosition(page);
    expect(afterPosition.x - beforePosition.x).toBe(-50);
    expect(afterPosition.y).toBe(beforePosition.y);

    // `aria-level` reflects the hierarchy relationship in the Layers tree.
    // It must remain a sibling even when the rendered shape now overlaps
    // the frame's interior.
    const afterLevel = await rectItem.getAttribute('aria-level');
    expect(afterLevel).toBe(beforeLevel);
    await expect(page.locator('.layers-panel')).toBeVisible();
  });
});
