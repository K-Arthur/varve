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
    const options = page.locator('[data-testid="marquee-options"]');
    await expect(options).toBeVisible();
    await expect(options.getByRole('button', { name: 'replace selection' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await options.getByLabel('Selection style').selectOption('fixed-ratio');
    await expect(options.getByLabel('Selection ratio')).toBeVisible();
    await options.getByLabel('Selection style').selectOption('normal');
    await options.getByLabel('Selection feather').fill('6');
    await options.getByLabel('Anti-alias selection edges').check();
    await page.screenshot({ path: testInfo.outputPath('marquee-options.png') });
    await page.getByRole('button', { name: 'Tool options' }).click();
    await expect(options).toBeHidden();

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

    await toolbar.getByRole('button', { name: 'Pixel selection menu' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Elliptical Marquee' }).click();
    const ellipse = toolbar.locator('[data-tool="ellipseMarquee"]');
    await expect(ellipse).toHaveAttribute('aria-pressed', 'true');
    await expect(options).toContainText('Elliptical marquee');

    await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.64);
    await page.mouse.up();
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      'Elliptical selection',
      { timeout: 5000 },
    );
    await page.screenshot({ path: testInfo.outputPath('ellipse-selection.png') });
  });

  test('enters Selection Paint and commits a real pointer stroke', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
    await switchToPhotoWorkspace(page);

    const toolbar = page.locator('[data-testid="toolbar"]');
    await toolbar.getByRole('button', { name: 'Pixel selection menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Selection Paint' })).toBeVisible();
    await page.keyboard.press('Escape');
    await toolbar.locator('[data-tool="marquee"]').click();
    const surface = page.locator('canvas.editor-canvas__content-layer');
    const box = await surface.boundingBox();
    if (!box) throw new Error('editor canvas content surface not found');
    await page.mouse.move(box.x + 260, box.y + 220);
    await page.mouse.down();
    await page.mouse.move(box.x + 520, box.y + 420, { steps: 6 });
    await page.mouse.up();

    const sources = page.getByTestId('selection-sources-panel');
    await expect(sources).toBeVisible();
    await expect(sources.getByRole('button', { name: 'Magic wand' })).toBeVisible();
    await sources.getByRole('button', { name: 'Paint selection' }).click();
    await expect(sources.getByRole('region', { name: 'Selection paint controls' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('selection-paint-session.png') });

    await page.mouse.move(box.x + 390, box.y + 320);
    await page.mouse.down();
    await page.mouse.move(box.x + 410, box.y + 335, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      'Selection painted',
      { timeout: 5000 },
    );
    await page.screenshot({ path: testInfo.outputPath('selection-painted-session.png') });
    await sources.getByRole('button', { name: 'Apply' }).click();
    await expect(sources.getByRole('region', { name: 'Selection paint controls' })).toBeHidden();
    await sources.getByRole('button', { name: 'Paint selection' }).click();
    await expect(sources.getByRole('region', { name: 'Selection paint controls' })).toBeVisible();
    await sources.getByRole('button', { name: 'Cancel' }).click();
    await expect(sources.getByRole('region', { name: 'Selection paint controls' })).toBeHidden();
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      'Selection paint cancelled',
      { timeout: 5000 },
    );
    await sources.getByLabel('Saved selection name').fill('Primary selection');
    await sources.getByRole('button', { name: 'Save selection' }).click();
    const savedRegion = sources.getByRole('region', { name: 'Saved area selections' });
    await expect(savedRegion).toContainText('Primary selection');
    await savedRegion.getByRole('button', { name: 'Add Primary selection' }).click();
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      'Added Primary selection',
      { timeout: 5000 },
    );
    await savedRegion.getByRole('button', { name: 'Rename Primary selection' }).click();
    const rename = savedRegion.getByRole('textbox', { name: 'Rename Primary selection' });
    await rename.fill('Renamed selection');
    await rename.press('Enter');
    await expect(savedRegion).toContainText('Renamed selection');
    await savedRegion.getByRole('button', { name: 'Duplicate Renamed selection' }).click();
    await expect(savedRegion).toContainText('Renamed selection copy');
    await savedRegion.getByRole('button', { name: 'Delete Renamed selection copy' }).click();
    await expect(savedRegion).not.toContainText('Renamed selection copy');
    await page.screenshot({ path: testInfo.outputPath('saved-selection-sources.png') });
    await page.screenshot({ path: testInfo.outputPath('selection-painted.png') });
  });
});
