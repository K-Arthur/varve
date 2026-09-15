import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('long text remains editable through the inspector and quick toolbar', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);
  await page.keyboard.press('t');
  const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
  if (!box) throw new Error('Canvas has no bounds');
  await page.mouse.click(box.x + 160, box.y + 180);
  const editor = page.getByRole('textbox', { name: /editing text/i });
  await expect(editor).toBeFocused();
  const text = 'A'.repeat(5000);
  await page.keyboard.insertText(text);
  // This real pointer action previously stalled while the inspector rebuilt
  // glyph labels and closed dropdown options for the entire paragraph.
  await page.getByRole('button', { name: 'Select', exact: true }).click({ timeout: 10000 });
  await expect(editor).toBeHidden();
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await page.mouse.dblclick(box.x + 180, box.y + 188);
  await expect(editor).toHaveValue(text);
  const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });
  await toolbar.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(editor).toHaveValue(text);
  await page.screenshot({ path: testInfo.outputPath('long-text-toolbar.png') });
  const editingSurfaceOutsideCanvas = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.editor-canvas__content-layer');
    const surface = document.querySelector('[data-text-edit-surface]');
    if (!canvas || !surface) throw new Error('Missing editing surface');
    const canvasBounds = canvas.getBoundingClientRect();
    const textBounds = surface.getBoundingClientRect();
    return document.elementFromPoint(canvasBounds.right + 8, textBounds.top + 8) === surface;
  });
  expect(editingSurfaceOutsideCanvas).toBe(false);
});
