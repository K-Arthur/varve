import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Frame and text placement', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('drag-created area text preserves its box and editor position', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await page.keyboard.press('t');
    await dragOnCanvas(page, 160, 60, 380, 180);

    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeFocused();
    const editorBox = await editor.boundingBox();
    if (!editorBox) throw new Error('text editor not found');
    expect(Math.abs(editorBox.x - (canvasBox.x + 160))).toBeLessThanOrEqual(1);
    expect(Math.abs(editorBox.y - (canvasBox.y + 60))).toBeLessThanOrEqual(1);
    expect(Math.abs(editorBox.width - 220)).toBeLessThanOrEqual(1);
    expect(editorBox.height).toBeGreaterThanOrEqual(120);

    await editor.fill('A deliberately long line of text that must wrap inside its fixed text box.');
    await page.keyboard.press('Escape');

    await expect(page.getByRole('treeitem').filter({ hasText: /text/i })).toHaveCount(1);
    // The status bar uses the multiplication sign (and some browser fonts
    // expose it as a plain x), not the old prose "by" label.
    await expect(page.locator('.selection-info-bar__dimensions')).toHaveText(/220\s*[×x]\s*120/);
  });

  test('text placed in a translated frame remains under the pointer', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await page.keyboard.press('f');
    await dragOnCanvas(page, 120, 100, 520, 420);
    await expect(page.getByRole('treeitem').filter({ hasText: /frame/i })).toHaveCount(1);

    await page.keyboard.press('t');
    await page.mouse.click(canvasBox.x + 240, canvasBox.y + 210);

    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeFocused();
    const editorBox = await editor.boundingBox();
    if (!editorBox) throw new Error('text editor not found');

    expect(Math.abs(editorBox.x - (canvasBox.x + 240))).toBeLessThanOrEqual(1);
    expect(Math.abs(editorBox.y - (canvasBox.y + 210))).toBeLessThanOrEqual(1);
    await editor.fill('Inside frame');
    await page.keyboard.press('Escape');

    await expect(page.getByRole('treeitem').filter({ hasText: /text/i })).toHaveCount(1);
  });
});
