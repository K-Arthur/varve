/**
 * Style painter (copy/paste properties) acceptance: copy a shape's visual
 * properties, apply them to another shape with the keyboard, verify the
 * properties actually changed, and confirm the whole paste is one undo entry.
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

// Preserve authored geometry while keeping the complete drawing fixture visible.
test.use({ viewport: { width: 1440, height: 1000 } });

test.describe('Style painter — copy/paste properties', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('Ctrl+Shift+C / Ctrl+Shift+V copies appearance between shapes', async ({ page }) => {
    // Two rectangles of different sizes.
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 250);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 500, 300, 700, 400);
    await expect(page.getByRole('treeitem')).toHaveCount(2);

    // Give the first rect a corner radius via the current inspector surface.
    await page.getByRole('treeitem').first().click();
    const inspector = page.locator('.editor__inspector-panel');
    const cornerRadius = inspector.locator(
      '[data-section-id="corner-radius"] .insp-disclosure__trigger',
    );
    await expect(cornerRadius).toBeVisible();
    if ((await cornerRadius.getAttribute('aria-expanded')) !== 'true') {
      await cornerRadius.click();
    }
    const radiusInput = inspector.getByRole('spinbutton', { name: 'Radius (px)', exact: true });
    await expect(radiusInput).toBeVisible();
    await radiusInput.fill('24');
    await radiusInput.press('Enter');
    await expect(radiusInput).toHaveValue('24');
    // The shortcut manager intentionally ignores typing shortcuts while a
    // numeric field owns focus; return focus to the editor before copying.
    await radiusInput.blur();

    // Copy properties from the first rect, paste onto the second.
    await page.keyboard.press('Control+Shift+c');
    await expect(page.locator('#strata-canvas-announcer-polite')).toHaveText('Properties copied');
    await page.getByRole('treeitem').nth(1).click();
    await page.keyboard.press('Control+Shift+v');
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      'Properties pasted to 1 layer',
    );
    await expect(
      inspector.getByRole('spinbutton', { name: 'Radius (px)', exact: true }),
    ).toHaveValue('24');
    await expect(page.getByRole('treeitem')).toHaveCount(2);

    // One undo entry: Undo reverts the pasted style, not the shape.
    const undo = page.getByRole('button', { name: /^Undo/ });
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(page.getByRole('treeitem')).toHaveCount(2);
    // Persistent history restores the selection from the prior revision, so
    // explicitly reselect the paste target before checking that its style was
    // undone.
    await page.getByRole('treeitem').nth(1).click();
    await expect(
      inspector.getByRole('spinbutton', { name: 'Radius (px)', exact: true }),
    ).toHaveValue('0');
    await page.getByRole('button', { name: /^Redo/ }).click();
    await expect(
      inspector.getByRole('spinbutton', { name: 'Radius (px)', exact: true }),
    ).toHaveValue('24');
  });

  test('the canvas context menu exposes Copy/Paste Properties', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 250);
    await expect(page.getByRole('treeitem')).toHaveCount(1);

    const canvas = page.locator('canvas').first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + 250, box.y + 200, { button: 'right' });

    await expect(page.getByRole('menuitem', { name: 'Copy Properties' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Paste Properties' })).toBeVisible();
  });
});
