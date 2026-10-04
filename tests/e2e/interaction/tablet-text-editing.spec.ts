/** Tablet text authoring and native-edit-surface regression. */
import { expect, test } from '@playwright/test';
import { readEditorState } from '../helpers/tabletControls';
import { navigateToEditor } from '../shared';

test.describe('tablet text editing', () => {
  test.use({ hasTouch: true, viewport: { width: 820, height: 1180 } });

  test('touch creates editable text, accepts typing, and commits it to the document', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('tablet content canvas has no bounds');

    const toolbar = page.getByTestId('toolbar');
    await toolbar.getByRole('button', { name: 'Text', exact: true }).first().tap();
    await page.touchscreen.tap(canvasBox.x + 180, canvasBox.y + 180);

    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await expect(editor).toBeFocused();
    await expect(editor).toHaveAttribute('inputmode', 'text');
    await page.keyboard.insertText('Tablet text entry');
    await expect(editor).toHaveValue('Tablet text entry');

    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await expect
      .poll(async () => {
        const serialized = (await readEditorState(page)).serialized;
        const document = JSON.parse(serialized) as {
          nodes?: Record<string, { kind?: string; text?: string }>;
        };
        return Object.values(document.nodes ?? {}).some(
          (node) => node.kind === 'text' && node.text === 'Tablet text entry',
        );
      })
      .toBe(true);
  });
});
