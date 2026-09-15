import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Missing-item canvas regression', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('Shapes render after creation without Layers panel interaction', async ({ page }) => {
    // Create 5 distinct shapes using different tools
    // 1. Rectangle
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);

    // 2. Ellipse
    await page.keyboard.press('o');
    await dragOnCanvas(page, 400, 150, 600, 300);

    // 3. Frame
    await page.keyboard.press('f');
    await dragOnCanvas(page, 150, 400, 500, 600);

    // 4. Line
    await page.keyboard.press('l');
    await dragOnCanvas(page, 600, 400, 750, 550);

    // 5. Star (only accessible via the shapes sub-menu — no keyboard shortcut)
    await page.getByRole('button', { name: /shapes menu/i }).click();
    await page.getByRole('menuitem', { name: /^star$/i }).click();
    await dragOnCanvas(page, 600, 150, 750, 300);

    // Wait for all 5 tree items to appear
    await expect(page.getByRole('treeitem')).toHaveCount(5, { timeout: 10000 });

    // Give the render pipeline time to settle (async engine draw pass)
    await page.waitForTimeout(500);

    // Assert canvas has non-background pixels WITHOUT interacting with Layers
    const hasContent = await canvasHasNonBackgroundPixels(page);
    expect(hasContent).toBe(true);

    // Select each tree item through the Layers panel and verify content still renders
    for (let i = 0; i < 5; i++) {
      await page.getByRole('treeitem').nth(i).click();
      await page.waitForTimeout(200);
      const stillHasContent = await canvasHasNonBackgroundPixels(page);
      expect(stillHasContent).toBe(true);
    }
  });

  test('Rapid zoom/pan after creation does not cause missing content', async ({ page }) => {
    // Create a rectangle
    await page.keyboard.press('r');
    await dragOnCanvas(page, 200, 200, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.waitForTimeout(200);

    // Rapid zoom in (10 steps)
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Control+=');
      await page.waitForTimeout(30);
    }
    // Rapid zoom out (10 steps)
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Control+-');
      await page.waitForTimeout(30);
    }

    // Fit to view (Shift+1)
    await page.keyboard.press('Shift+1');
    await page.waitForTimeout(300);

    // Assert canvas still has content
    const hasContent = await canvasHasNonBackgroundPixels(page);
    expect(hasContent).toBe(true);

    // Assert tree item still exists
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
  });

  test('Items created after scene modification render', async ({ page }) => {
    // Create first shape
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.waitForTimeout(200);

    // Select it and nudge to reposition
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    // Create second shape (ellipse) without interacting with the Layers panel
    await page.keyboard.press('o');
    await dragOnCanvas(page, 400, 150, 600, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
    await page.waitForTimeout(300);

    // Both shapes should render on canvas
    const hasContent = await canvasHasNonBackgroundPixels(page);
    expect(hasContent).toBe(true);
  });
});

/**
 * Sample canvas pixel data to check whether any non-background content has
 * been painted.  Uses 40 evenly-spaced sample points across the canvas and
 * checks for pixels that differ from a uniform grey background.
 */
async function canvasHasNonBackgroundPixels(
  page: import('@playwright/test').Page,
): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement | null;
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    try {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const stepX = Math.max(1, Math.floor(canvas.width / 8));
      const stepY = Math.max(1, Math.floor(canvas.height / 8));
      for (let y = 0; y < canvas.height; y += stepY) {
        for (let x = 0; x < canvas.width; x += stepX) {
          const idx = (Math.floor(y) * canvas.width + Math.floor(x)) * 4;
          const r = data[idx]!;
          const g = data[idx + 1]!;
          const b = data[idx + 2]!;
          if (Math.abs(r - g) > 10 || Math.abs(g - b) > 10 || r > 30) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  });
}
