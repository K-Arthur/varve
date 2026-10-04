/**
 * Tablet regression: the text-color picker is a rich floating surface, not a
 * canvas tool panel. Keep it bounded by the visible browser viewport so a
 * short canvas region cannot squeeze away its controls.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('tablet text color picker', () => {
  test.use({ hasTouch: true, viewport: { width: 820, height: 520 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('strata-clean-shutdown', 'true');
        localStorage.removeItem('varve:crash-loop');
        localStorage.setItem(
          'varve-editor-settings',
          JSON.stringify({ appearance: { layoutPreference: 'tablet' } }),
        );
      } catch {
        // Storage unavailable: the editor's in-memory fallback still applies.
      }
    });
  });

  test('keeps text color controls reachable in a compact tablet viewport', async ({ page }) => {
    await navigateToEditor(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible();
    const canvasBounds = await canvas.boundingBox();
    if (!canvasBounds) throw new Error('editor canvas has no bounds');

    // Place the text near the bottom edge so the quick toolbar and its popup
    // open in the smallest part of the tablet canvas.
    await page.keyboard.press('t');
    await page.mouse.click(
      canvasBounds.x + Math.min(80, canvasBounds.width / 4),
      canvasBounds.y + canvasBounds.height - 80,
    );
    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeFocused();
    await page.keyboard.insertText('Tablet color controls');

    const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole('button', { name: 'Text color' }).click();

    const dialog = page.getByRole('dialog', { name: 'Text color picker', exact: true });
    await expect(dialog).toBeVisible();
    const viewport = await page.evaluate(() => {
      const visual = window.visualViewport;
      return {
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
        right: (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth),
        bottom: (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight),
      };
    });

    const dialogBounds = await dialog.boundingBox();
    if (!dialogBounds) throw new Error('text color picker has no bounds');
    const swatchBounds = await toolbar.getByRole('button', { name: 'Text color' }).boundingBox();
    if (!swatchBounds) throw new Error('text color trigger has no bounds');
    // The canvas boundary ends above this trigger. The rich picker may extend
    // beyond that workspace region, but must use the remaining visible screen
    // rather than inheriting the canvas's much smaller height cap.
    expect(dialogBounds.height).toBeGreaterThan(swatchBounds.y - canvasBounds.y - 8);
    expect(dialogBounds.x).toBeGreaterThanOrEqual(viewport.left - 1);
    expect(dialogBounds.y).toBeGreaterThanOrEqual(viewport.top - 1);
    expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(viewport.right + 1);
    expect(dialogBounds.y + dialogBounds.height).toBeLessThanOrEqual(viewport.bottom + 1);

    // Check a real pointer-edit surface and a lower field, scrolling the
    // popover when needed. Both remain usable rather than being cut off by the
    // canvas region or the viewport edge.
    const colorArea = dialog.getByRole('slider', { name: 'Color' });
    await expect(colorArea).toBeVisible();
    const areaBounds = await colorArea.boundingBox();
    if (!areaBounds) throw new Error('color area has no bounds');
    expect(areaBounds.y).toBeGreaterThanOrEqual(viewport.top - 1);
    expect(areaBounds.y + areaBounds.height).toBeLessThanOrEqual(viewport.bottom + 1);
    await colorArea.click({ position: { x: 24, y: 24 } });

    const hexField = dialog.getByRole('textbox', { name: 'Hex color' });
    await hexField.scrollIntoViewIfNeeded();
    await expect(hexField).toBeInViewport();
    await hexField.fill('#6B35C8');
    await hexField.press('Enter');
    await expect(dialog.locator('.color-picker__preview-pair')).toBeVisible();
  });
});
