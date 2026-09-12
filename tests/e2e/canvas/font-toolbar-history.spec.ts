import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('a quick toolbar change undoes separately from the preceding typing', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);
  const canvas = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
  if (!canvas) throw new Error('Canvas has no bounds');
  await page.keyboard.press('t');
  await page.mouse.click(canvas.x + 160, canvas.y + 180);
  const editor = page.getByRole('textbox', { name: /editing text/i });
  await expect(editor).toBeFocused();
  const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });
  const bold = toolbar.getByRole('button', { name: 'Bold', exact: true });
  await expect(bold).toBeVisible();
  const button = await bold.boundingBox();
  if (!button) throw new Error('Bold button has no bounds');
  // Hold the typing idle timer while real pointer input reaches the toolbar.
  // Machine speed must not decide whether typing joins the formatting edit.
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.keyboard.insertText('Independent typography history');
  await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
  await page.clock.runFor(32);
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+z');
  await page.clock.runFor(32);
  await expect(editor).toHaveValue('Independent typography history');
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  // Resume RAF before captures so async worker/font replies can paint.
  await page.clock.resume();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.screenshot({ path: testInfo.outputPath('toolbar-after-format-undo.png') });
  await page.keyboard.press('Control+Shift+z');
  await expect(editor).toHaveValue('Independent typography history');
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({ path: testInfo.outputPath('toolbar-after-format-redo.png') });
});
