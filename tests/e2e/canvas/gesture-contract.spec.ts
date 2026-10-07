import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor, setVisibleCheckbox } from '../shared';

test.use({ viewport: { width: 1280, height: 800 } });

test('an invalid drawing gesture fails before changing the real document', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('owned canvas not available');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await expect(dragOnCanvas(page, 100, 100, box.width + 50, 200)).rejects.toThrow(
    /outside artwork bounds/,
  );
  await expect(page.getByRole('treeitem')).toHaveCount(0);
  await dragOnCanvas(page, 100, 100, 250, 200);
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('valid-canvas-gesture.png') });
});

test('a missing artwork surface cannot substitute an auxiliary canvas', async ({ page }) => {
  await navigateToEditor(page);
  await page.evaluate(() => {
    const auxiliary = document.createElement('canvas');
    auxiliary.id = 'gesture-auxiliary-canvas';
    auxiliary.width = 300;
    auxiliary.height = 300;
    auxiliary.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;';
    document.body.prepend(auxiliary);
  });
  await page.addStyleTag({
    content: 'canvas.editor-canvas__content-layer { display: none !important; }',
  });
  await expect(page.locator('#gesture-auxiliary-canvas')).toBeVisible();
  await expect(dragOnCanvas(page, 100, 100, 250, 200)).rejects.toThrow(
    /owned artwork canvas bounds/,
  );
  await expect(page.getByRole('treeitem')).toHaveCount(0);
});

test('a styled checkbox changes through its visible label in both directions', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);
  await page.keyboard.press('Control+/');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('Customize Workspace');
  await palette.getByRole('option', { name: 'Customize Workspace', exact: true }).click();
  await expect(palette).toBeHidden();
  const dialog = page.getByRole('dialog', { name: 'Customize Design workspace' });
  const history = dialog.getByRole('checkbox', { name: 'History', exact: true });
  await setVisibleCheckbox(history, true);
  await expect(page.locator('.editor__history-panel')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('visible-checkbox-enabled.png') });
  await setVisibleCheckbox(history, true);
  await setVisibleCheckbox(history, false);
  await expect(page.locator('.editor__history-panel')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('visible-checkbox-disabled.png') });
});
