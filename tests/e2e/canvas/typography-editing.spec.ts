import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Typography editing workflow', () => {
  test('point text shows immediate input and keeps its toolbar alive', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'visible', timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas has no bounds');

    await page.keyboard.press('t');
    await page.mouse.click(box.x + 220, box.y + 180);
    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeFocused();
    await page.keyboard.insertText('Immediate typography feedback');
    await expect(editor).toHaveValue('Immediate typography feedback');
    await page.screenshot({
      path: testInfo.outputPath('point-text-active-editor.png'),
      animations: 'disabled',
      fullPage: false,
    });

    const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole('button', { name: 'Bold' }).click();
    await expect(editor).toBeVisible();

    const fontInput = toolbar.locator('.font-selector__input');
    await fontInput.click();
    await expect(toolbar.locator('.font-selector__dropdown')).toBeVisible();
    await expect(editor).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('text-toolbar-font-menu.png'),
      animations: 'disabled',
      fullPage: false,
    });

    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
  });
});
