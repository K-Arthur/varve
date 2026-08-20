import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

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

test.describe('pixel marquee selection', () => {
  test('exposes the raster tool and commits a reverse-direction compound selection', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
    await switchToPhotoWorkspace(page);

    const toolbar = page.locator('[data-testid="toolbar"]');
    const marquee = toolbar.locator('[data-tool="marquee"]');
    await expect(marquee).toBeVisible();
    await marquee.click();
    await expect(marquee).toHaveAttribute('aria-pressed', 'true');
    await toolbar.screenshot({ path: testInfo.outputPath('marquee-toolbar.png') });

    const surface = page.locator('.editor-canvas');
    const box = await surface.boundingBox();
    if (!box) throw new Error('editor canvas surface not found');

    const start = { x: box.x + box.width * 0.72, y: box.y + box.height * 0.68 };
    const end = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.24 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2);
    await page.mouse.move(end.x, end.y);
    await page.mouse.up();

    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      'Rectangular selection',
      { timeout: 5000 },
    );

    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + box.width * 0.84, box.y + box.height * 0.82);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.67, box.y + box.height * 0.69);
    await page.mouse.up();
    await page.keyboard.up('Shift');

    await page.screenshot({ path: testInfo.outputPath('marquee-compound-selection.png') });
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      'Rectangular selection',
      { timeout: 5000 },
    );
  });
});
