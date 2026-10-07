import { expect, test } from '@playwright/test';

async function openNewDesign(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /^new$/i }).click();
  const dialog = page.getByRole('dialog', { name: /new design/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('varve:crash-loop'));
  await page.goto('/');
  await expect(page.locator('.varve-home')).toBeVisible();
});

test('typing over the selected suggested name preserves the complete Unicode name', async ({
  page,
}, testInfo) => {
  const dialog = await openNewDesign(page);
  const input = dialog.getByLabel('Document name');
  await expect(input).toBeFocused();
  await expect
    .poll(() =>
      input.evaluate((element: HTMLInputElement) => ({
        start: element.selectionStart,
        end: element.selectionEnd,
        length: element.value.length,
      })),
    )
    .toMatchObject({ start: 0 });
  const selection = await input.evaluate((element: HTMLInputElement) => ({
    end: element.selectionEnd,
    length: element.value.length,
  }));
  expect(selection.end).toBe(selection.length);
  await page.keyboard.type('My Свадебный Альбом');
  await expect(input).toHaveValue('My Свадебный Альбом');
  await page.screenshot({ path: testInfo.outputPath('unicode-name-dialog.png') });
  await dialog.getByRole('button', { name: 'Create design', exact: true }).click();
  await expect(page.locator('.editor-menubar__doc-name-text')).toHaveText('My Свадебный Альбом');
  await page.screenshot({ path: testInfo.outputPath('unicode-name-editor.png') });
});

test('a delayed opening animation frame cannot replace the first typed character', async ({
  page,
}, testInfo) => {
  await page.evaluate(() => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const held = new Map<number, FrameRequestCallback>();
    let id = -1;
    let delaying = true;
    window.requestAnimationFrame = (callback) => {
      if (!delaying || !document.getElementById('new-design-name')) return request(callback);
      const frame = id--;
      held.set(frame, callback);
      return frame;
    };
    window.cancelAnimationFrame = (frame) => {
      if (frame < 0) held.delete(frame);
      else cancel(frame);
    };
    Object.assign(window, {
      __varveNameFrameCount: () => held.size,
      __varveReleaseNameFrames: () => {
        delaying = false;
        const callbacks = [...held.values()];
        held.clear();
        window.requestAnimationFrame = request;
        window.cancelAnimationFrame = cancel;
        for (const callback of callbacks) callback(performance.now());
      },
    });
  });
  const dialog = await openNewDesign(page);
  const input = dialog.getByLabel('Document name');
  const heldCount = await page.evaluate(() =>
    (window as unknown as { __varveNameFrameCount: () => number }).__varveNameFrameCount(),
  );
  expect(heldCount).toBeGreaterThan(0);
  await input.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('M');
  await expect(input).toHaveValue('M');
  await page.evaluate(() =>
    (window as unknown as { __varveReleaseNameFrames: () => void }).__varveReleaseNameFrames(),
  );
  await page.keyboard.type('y Свадебный Альбом');
  await expect(input).toHaveValue('My Свадебный Альбом');
  await page.screenshot({ path: testInfo.outputPath('delayed-frame-name-dialog.png') });
  await dialog.getByRole('button', { name: 'Create design', exact: true }).click();
  await expect(page.locator('.editor-menubar__doc-name-text')).toHaveText('My Свадебный Альбом');
  await page.screenshot({ path: testInfo.outputPath('delayed-frame-name-editor.png') });
});
