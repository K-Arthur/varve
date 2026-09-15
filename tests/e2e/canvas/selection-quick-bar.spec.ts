/**
 * Selection quick bar — appears for image/path/multi, not for plain rects, and
 * stays reachable at the canvas edges.
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Selection quick bar', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('shows remove-background for an imported image', async ({ page }) => {
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    const bar = page.getByTestId('selection-quick-bar');
    await expect(bar).toBeVisible({ timeout: 5000 });
    // Scope to the bar — inspector also has a "Remove background" control.
    await expect(bar.getByRole('button', { name: /remove background/i })).toBeVisible();
    await expect(bar.getByRole('button', { name: /^crop$/i })).toBeVisible();
  });

  test('shows edit-nodes for a pencil path', async ({ page }) => {
    // Pencil drag is more reliable in headless than pen multi-click + Enter
    await page.keyboard.press('Shift+KeyP');
    await dragOnCanvas(page, 120, 120, 380, 260);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.keyboard.press('v');
    await page.getByRole('treeitem').first().click();
    const bar = page.getByTestId('selection-quick-bar');
    await expect(bar).toBeVisible({ timeout: 5000 });
    await expect(bar.getByRole('button', { name: /edit nodes/i })).toBeVisible();
  });

  test('does not show for a plain rectangle', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    await expect(page.getByTestId('selection-quick-bar')).toHaveCount(0);
  });

  /**
   * Regression: the bar is centred on the selection with `translateX(-50%)` and
   * the canvas is `overflow: hidden`. With the selection at the canvas's left
   * edge the bar's leading actions (Crop first) were rendered outside the
   * clipping canvas box — present in the DOM, but not clickable, which silently
   * blocked the image-crop workflow. The bar now clamps into the canvas box and
   * yields to the floating tool palette's band instead of landing under it.
   */
  test('keeps the Crop action clickable when the selection is at the left edge', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/fixtures/bg-removal-corpus/human.jpg'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();

    // Anchor the node at the canvas origin: its screen bounds then start at the
    // canvas's left edge, which is where the bar used to be clipped.
    const xField = page.getByRole('spinbutton', { name: 'X (px)', exact: true });
    await xField.fill('0');
    await xField.press('Enter');
    const yField = page.getByRole('spinbutton', { name: 'Y (px)', exact: true });
    await yField.fill('0');
    await yField.press('Enter');
    await page.waitForTimeout(300);

    const bar = page.getByTestId('selection-quick-bar');
    const cropButton = bar.getByRole('button', { name: /^crop$/i });
    await expect(cropButton).toBeVisible({ timeout: 5000 });

    // The bar and the Crop button must lie inside the canvas box (the clipping
    // ancestor), not merely inside the document, and clear of the palette.
    const geometry = await page.evaluate(() => {
      const rect = (el: Element | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
      };
      const canvas = document.querySelector('.editor-canvas');
      const palette = document.querySelector('[data-testid="toolbar"].floating-toolbar');
      const quickBar = document.querySelector('[data-testid="selection-quick-bar"]');
      const button = document.querySelector(
        '[role="toolbar"][aria-label="Selection actions"] button[aria-label="Crop"]',
      );
      return {
        canvas: rect(canvas),
        palette: rect(palette),
        quickBar: rect(quickBar),
        button: rect(button),
      };
    });
    expect(geometry.canvas).not.toBeNull();
    expect(geometry.quickBar).not.toBeNull();
    expect(geometry.button).not.toBeNull();
    if (!geometry.canvas || !geometry.quickBar || !geometry.button) return;

    expect(geometry.quickBar.left).toBeGreaterThanOrEqual(geometry.canvas.left - 1);
    expect(geometry.quickBar.right).toBeLessThanOrEqual(geometry.canvas.right + 1);
    expect(geometry.button.width).toBeGreaterThan(0);
    expect(geometry.button.left).toBeGreaterThanOrEqual(geometry.canvas.left - 1);
    expect(geometry.button.right).toBeLessThanOrEqual(geometry.canvas.right + 1);

    // ...and the bar must not sit underneath the tool palette, which holds a
    // higher z-level and would swallow the click.
    if (geometry.palette) {
      const overlapsPalette =
        geometry.quickBar.left < geometry.palette.right &&
        geometry.quickBar.right > geometry.palette.left &&
        geometry.quickBar.top < geometry.palette.bottom &&
        geometry.quickBar.bottom > geometry.palette.top;
      expect(overlapsPalette, 'quick bar must not overlap the tool palette').toBe(false);
    }

    // The workflow this blocked: entering crop mode from the quick bar.
    await cropButton.click();
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });
  });
});
