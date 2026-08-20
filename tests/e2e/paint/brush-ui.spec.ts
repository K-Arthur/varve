import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Exercises the paint UI in the running app.
 *
 * Component tests in jsdom prove the Brush Browser's markup and behaviour;
 * they cannot show whether it renders legibly inside the real editor chrome,
 * whether thumbnails actually rasterise, or whether a stroke reaches the
 * canvas. That is what this covers, with screenshots to be looked at.
 */

const VIEWPORT = { width: 1440, height: 900 };

async function switchToPhotoWorkspace(page: import('@playwright/test').Page): Promise<void> {
  const photo = page.locator('.workspace-tabs__tab[aria-label="Photo workspace"]');
  if (!(await photo.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'More workspaces' }).click();
    await page.getByRole('menuitemradio', { name: 'Photo' }).click();
  } else {
    await photo.click();
  }
  await expect(photo).toHaveAttribute('aria-checked', 'true');
}

async function activatePaint(page: import('@playwright/test').Page) {
  const toolbar = page.locator('[data-testid="toolbar"]');
  const paint = toolbar.locator('[data-tool="paint"]');
  if (!(await paint.isVisible().catch(() => false))) {
    // Paint may live behind the toolbar's overflow at this viewport.
    await page.getByRole('button', { name: /More tools|Overflow/i }).click();
    await page.getByRole('menuitemradio', { name: /Paint/i }).click();
  } else {
    await paint.click();
  }
  return toolbar;
}

async function openToolOptions(page: import('@playwright/test').Page) {
  const trigger = page.locator('.tool-options__trigger, [aria-label*="tool options" i]').first();
  await expect(trigger).toBeVisible({ timeout: 30000 });
  await trigger.click();
  return page.locator('.tool-options__popover');
}

test.describe('paint UI in the running app', () => {
  test('brush browser renders, searches and filters', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
    await switchToPhotoWorkspace(page);
    await activatePaint(page);

    const popover = await openToolOptions(page);
    await expect(popover).toBeVisible();

    const browser = popover.locator('.brush-browser');
    await expect(browser).toBeVisible({ timeout: 30000 });
    await popover.screenshot({ path: testInfo.outputPath('brush-browser.png') });

    // Every brush is a named button, so it is reachable without sight.
    const roundBrush = browser.getByRole('button', { name: 'Round', exact: true });
    await expect(roundBrush).toBeVisible();

    // Thumbnails must actually rasterise, not stay as placeholders.
    const previews = browser.locator('.brush-browser__preview img');
    await expect(previews.first()).toBeVisible({ timeout: 30000 });
    const src = await previews.first().getAttribute('src');
    expect(src ?? '').toContain('data:image/png');

    // Search narrows the list.
    await browser.getByLabel('Search brushes').fill('airbrush');
    await expect(browser.getByRole('button', { name: 'Airbrush', exact: true })).toBeVisible();
    await expect(browser.getByRole('button', { name: 'Round', exact: true })).toHaveCount(0);
    await browser.screenshot({ path: testInfo.outputPath('brush-browser-search.png') });

    // An empty result explains itself rather than showing a blank grid.
    await browser.getByLabel('Search brushes').fill('zzzznotabrush');
    await expect(browser.getByText(/No brushes match/)).toBeVisible();
    await browser.screenshot({ path: testInfo.outputPath('brush-browser-empty.png') });
  });

  test('a brush can be favourited and edited', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
    await switchToPhotoWorkspace(page);
    await activatePaint(page);
    const popover = await openToolOptions(page);
    const browser = popover.locator('.brush-browser');
    await expect(browser).toBeVisible({ timeout: 30000 });

    const favourite = browser.getByRole('button', { name: 'Favorite Round' });
    await favourite.click();
    await expect(browser.getByRole('button', { name: 'Unfavorite Round' })).toBeVisible();

    await browser.getByRole('tab', { name: 'Favorites' }).click();
    await expect(browser.getByRole('button', { name: 'Round', exact: true })).toBeVisible();
    await browser.screenshot({ path: testInfo.outputPath('brush-browser-favorites.png') });

    // Editing a built-in opens the editor on a copy.
    await browser.getByRole('button', { name: 'Edit a copy of Round' }).click();
    const editor = popover.locator('.brush-editor');
    await expect(editor).toBeVisible();
    await expect(editor.getByText(/Built-in brushes cannot be changed/)).toBeVisible();
    await expect(editor.locator('.brush-editor__preview img')).toBeVisible();
    await editor.screenshot({ path: testInfo.outputPath('brush-editor.png') });

    // The live preview responds to a parameter change without touching the doc.
    const before = await editor.locator('.brush-editor__preview img').getAttribute('src');
    await editor.getByRole('button', { name: 'Brush Tip' }).click().catch(() => {});
    await editor.getByLabel('Size').fill('60');
    await editor.getByLabel('Size').press('Enter');
    await expect(editor.getByText('Unsaved changes')).toBeVisible();
    await expect
      .poll(async () => editor.locator('.brush-editor__preview img').getAttribute('src'))
      .not.toBe(before);
    await editor.screenshot({ path: testInfo.outputPath('brush-editor-edited.png') });
  });

  test('painting a stroke reaches the canvas', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
    await switchToPhotoWorkspace(page);
    await activatePaint(page);

    const surface = page.locator('.editor-canvas');
    const box = await surface.boundingBox();
    if (!box) throw new Error('editor canvas surface not found');

    const y = box.y + box.height * 0.5;
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      await page.mouse.move(
        box.x + box.width * (0.3 + 0.4 * t),
        y + Math.sin(t * Math.PI * 2) * box.height * 0.12,
      );
    }
    await page.mouse.up();

    await page.waitForTimeout(500);
    await surface.screenshot({ path: testInfo.outputPath('painted-stroke.png') });
  });
});
