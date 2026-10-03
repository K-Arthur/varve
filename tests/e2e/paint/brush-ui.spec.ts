import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const requireFromEngine = createRequire(join(process.cwd(), 'packages', 'engine', 'package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } };
};

/**
 * Exercises the paint UI in the running app.
 *
 * Component tests in jsdom prove the Brush Browser's markup and behaviour;
 * they cannot show whether it renders legibly inside the real editor chrome,
 * whether thumbnails actually rasterise, or whether a stroke reaches the
 * canvas. That is what this covers, with screenshots to be looked at.
 */

const VIEWPORT = { width: 1440, height: 900 };

function importedBrushPreset(id: string, name: string) {
  // The importer fills omitted optional fields from the canonical default.
  // Keeping this fixture local avoids pulling the native/worker scene graph
  // into Playwright's Node-side test loader.
  return { id, name, shape: 'circle', radius: 10 };
}

async function switchToPhotoWorkspace(page: import('@playwright/test').Page): Promise<void> {
  const photo = page.locator('.workspace-dock__item[aria-label="Photo workspace"]');
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
    const paintOption = page.getByRole('menuitemradio', { name: /^Paint$/i });
    if (await paintOption.isVisible().catch(() => false)) {
      await paintOption.click();
    } else {
      await page.getByRole('menuitem', { name: 'Raster', exact: true }).click();
      await page.getByRole('menuitemradio', { name: /^Paint$/i }).click();
    }
  } else {
    await paint.click();
  }
  return toolbar;
}

async function activateSmudge(page: import('@playwright/test').Page) {
  const toolbar = page.locator('[data-testid="toolbar"]');
  const smudge = toolbar.locator('[data-tool="smudge"]');
  if (await smudge.isVisible().catch(() => false)) {
    await smudge.click();
  } else {
    // The shortcut remains the stable route when a narrow toolbar moves the
    // tool into overflow. This also exercises the real command registry.
    await page.keyboard.press('u');
  }
  await expect(toolbar.locator('[data-tool="smudge"][aria-pressed="true"]')).toBeVisible({
    timeout: 10000,
  });
  return toolbar;
}

async function openToolOptions(page: import('@playwright/test').Page) {
  const trigger = page.getByRole('button', { name: 'Tool options' });
  await expect(trigger).toBeVisible({ timeout: 30000 });
  // Activating a paint tool opens the options popover on its own, so this has
  // to be idempotent — clicking unconditionally would close it.
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  return page.locator('.tool-options__popover');
}

async function contentCanvasHash(page: import('@playwright/test').Page): Promise<string> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((canvas) => {
    const contentCanvas = canvas as HTMLCanvasElement;
    const context = contentCanvas.getContext('2d');
    if (!context) throw new Error('content canvas 2D context unavailable');
    const pixels = context.getImageData(0, 0, contentCanvas.width, contentCanvas.height).data;
    let hash = 2166136261;
    for (const pixel of pixels) {
      hash ^= pixel;
      hash = Math.imul(hash, 16777619);
    }
    return `${contentCanvas.width}x${contentCanvas.height}:${hash >>> 0}`;
  });
}

async function contentPixelAtScreenPoint(
  page: import('@playwright/test').Page,
  point: { x: number; y: number },
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element, screenPoint) => {
    const canvas = element as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(
        canvas.width - 1,
        Math.floor((screenPoint.x - rect.left) * (canvas.width / rect.width)),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        canvas.height - 1,
        Math.floor((screenPoint.y - rect.top) * (canvas.height / rect.height)),
      ),
    );
    const pixel = canvas.getContext('2d')?.getImageData(x, y, 1, 1).data;
    if (!pixel) throw new Error('content canvas pixel is unavailable');
    return { r: pixel[0]!, g: pixel[1]!, b: pixel[2]!, a: pixel[3]! };
  }, point);
}

test.describe('paint UI in the running app', () => {
  test('brush browser renders, searches and filters', async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
    await switchToPhotoWorkspace(page);
    await activatePaint(page);

    const popover = await openToolOptions(page);
    await expect(popover).toBeVisible();

    const browser = popover.locator('.brush-browser');
    await expect(browser).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: testInfo.outputPath('brush-browser.png'), fullPage: false });

    // Every brush is a named button, so it is reachable without sight.
    const roundBrush = browser.getByRole('button', { name: 'Round', exact: true });
    await expect(roundBrush).toBeVisible();

    // Thumbnails must actually rasterise, not stay as placeholders.
    const previews = browser.locator('.brush-browser__preview img');
    await expect(previews.first()).toBeVisible({ timeout: 30000 });
    const src = await previews.first().getAttribute('src');
    expect(src ?? '', consoleErrors.filter((e) => e.includes('[brush]')).join('\n')).toContain(
      'data:image/png',
    );

    // The illustration starting points are classified by what they do, not
    // the default `smudgeStrength` value shared by every preset. Scroll the
    // production brush grid so Soft Shade's real preview is visible too.
    await browser.locator('.brush-browser__filters').getByText('Paint', { exact: true }).click();
    await expect(browser.getByRole('radio', { name: 'Paint' })).toBeChecked();
    await expect(browser.getByRole('button', { name: 'Airbrush', exact: true })).toBeVisible();
    const softShade = browser.getByRole('button', { name: 'Soft Shade', exact: true });
    await softShade.scrollIntoViewIfNeeded();
    await expect(softShade).toBeVisible();
    await expect(softShade.locator('.brush-browser__preview img')).toHaveAttribute(
      'src',
      /^data:image\/png/,
    );
    await page.screenshot({ path: testInfo.outputPath('brush-browser-paint-presets.png') });

    // Search narrows the list.
    await browser.getByLabel('Search brushes').fill('airbrush');
    await expect(browser.getByRole('button', { name: 'Airbrush', exact: true })).toBeVisible();
    await expect(browser.getByRole('button', { name: 'Round', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('brush-browser-search.png') });

    // An empty result explains itself rather than showing a blank grid.
    await browser.getByLabel('Search brushes').fill('zzzznotabrush');
    await expect(browser.getByText(/No brushes match/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('brush-browser-empty.png') });
  });

  test('large brush libraries scroll inside the brush grid', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
    await switchToPhotoWorkspace(page);
    await activatePaint(page);

    const popover = await openToolOptions(page);
    const browser = popover.locator('.brush-browser');
    await expect(browser).toBeVisible({ timeout: 30000 });

    // Use the real import path so this covers the same persisted-library
    // shape users get when they install a substantial brush pack.
    const presets = Array.from({ length: 120 }, (_, index) =>
      importedBrushPreset(
        `scroll-test-${index}`,
        `Library Brush ${String(index).padStart(3, '0')}`,
      ),
    );
    const file = popover.locator('input[type="file"]');
    await file.setInputFiles({
      name: 'large-library.varvebrush',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({ format: 'varve-brush', version: 1, presets, resources: [] }),
      ),
    });

    await expect(popover.getByText('Imported 120 brushes.')).toBeVisible({ timeout: 30000 });
    const grid = browser.locator('.brush-browser__grid');
    await expect(grid).toBeVisible();
    await expect
      .poll(async () =>
        grid.evaluate((element) => ({
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        })),
      )
      .toEqual(expect.objectContaining({ clientHeight: expect.any(Number) }));

    const before = await grid.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    }));
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);

    await grid.hover();
    await page.mouse.wheel(0, 1200);
    await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    const lastBrush = browser.getByRole('button', { name: 'Library Brush 119', exact: true });
    await lastBrush.scrollIntoViewIfNeeded();
    await expect(lastBrush).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('brush-browser-large-scroll.png') });
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

    await browser
      .locator('.brush-browser__filters')
      .getByText('Favorites', { exact: true })
      .click();
    await expect(browser.getByRole('radio', { name: 'Favorites' })).toBeChecked();
    await expect(browser.getByRole('button', { name: 'Round', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('brush-browser-favorites.png') });

    // Editing a built-in opens the editor on a copy.
    await browser.getByRole('button', { name: 'Edit a copy of Round' }).click();
    const editor = popover.locator('.brush-editor');
    await expect(editor).toBeVisible();
    await expect(editor.getByText(/Built-in brushes cannot be changed/)).toBeVisible();
    await expect(editor.locator('.brush-editor__preview img')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('brush-editor.png') });

    // The live preview responds to a parameter change without touching the doc.
    const before = await editor.locator('.brush-editor__preview img').getAttribute('src');
    await editor
      .getByRole('button', { name: 'Brush Tip' })
      .click()
      .catch(() => {});
    await editor.getByLabel('Size').fill('60');
    await editor.getByLabel('Size').press('Enter');
    await expect(editor.getByText('Unsaved changes')).toBeVisible();
    await expect
      .poll(async () => editor.locator('.brush-editor__preview img').getAttribute('src'))
      .not.toBe(before);
    await page.screenshot({ path: testInfo.outputPath('brush-editor-edited.png') });
  });

  test('painting a stroke reaches the canvas', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
    await switchToPhotoWorkspace(page);
    await activatePaint(page);

    const surface = page.locator('.editor-canvas');
    const box = await surface.boundingBox();
    if (!box) throw new Error('editor canvas surface not found');

    // Wait for the initial blank frame before taking the oracle baseline. A
    // screenshot alone can pass while the document has only created a layer;
    // the content canvas must actually change after the stroke.
    await page.waitForTimeout(750);
    const before = await contentCanvasHash(page);

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

    await expect.poll(() => contentCanvasHash(page), { timeout: 10000 }).not.toBe(before);
    await surface.screenshot({ path: testInfo.outputPath('painted-stroke.png') });
  });

  test('a clipped shading stroke stays inside its visible raster source', async ({
    page,
  }, testInfo) => {
    test.setTimeout(600000);
    page.setDefaultTimeout(45000);
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
    await activatePaint(page);
    const designWorkspace = page.locator('.workspace-dock__item[aria-label="Design workspace"]');
    await expect(designWorkspace).toHaveAttribute('aria-checked', 'true');
    await page.locator('.editor-menubar__doc-name-text').click();
    const documentName = page.getByRole('textbox', { name: 'Document name', exact: true });
    await documentName.fill('Clipped paint regression');
    await documentName.press('Enter');
    const options = await openToolOptions(page);
    const browser = options.locator('.brush-browser');
    const opaquePaint = browser.getByRole('button', { name: 'Opaque Paint', exact: true });
    await opaquePaint.scrollIntoViewIfNeeded();
    await opaquePaint.click();
    const sourceSize = options.getByLabel('Size');
    await sourceSize.fill('100');
    await sourceSize.press('Enter');
    const sourceColor = options.getByLabel('Foreground color');
    await sourceColor.fill('#2020ff');
    await expect(sourceColor).toHaveValue('#2020ff');

    const surface = page.locator('.editor-canvas');
    const box = await surface.boundingBox();
    if (!box) throw new Error('editor canvas surface not found');
    const y = box.y + box.height * 0.5;
    const sourceStart = { x: box.x + box.width * 0.32, y };
    const sourceEnd = { x: box.x + box.width * 0.48, y };
    await page.getByRole('button', { name: 'Tool options' }).click();
    await page.waitForTimeout(500);
    const blank = await contentCanvasHash(page);
    const sourcePixel = { x: box.x + box.width * 0.4, y };
    const outsidePixel = { x: box.x + box.width * 0.66, y };
    const outsideBeforeSource = await contentPixelAtScreenPoint(page, outsidePixel);
    await page.mouse.move(sourceStart.x, sourceStart.y);
    await page.mouse.down();
    await page.mouse.move(sourceEnd.x, sourceEnd.y, { steps: 18 });
    await page.mouse.up();
    await expect.poll(() => contentCanvasHash(page), { timeout: 10000 }).not.toBe(blank);
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath('clipped-paint-source.png') });

    const sourcePixelBeforeShade = await contentPixelAtScreenPoint(page, sourcePixel);
    const outsideBeforeShade = await contentPixelAtScreenPoint(page, outsidePixel);
    expect(sourcePixelBeforeShade.a).toBeGreaterThan(200);
    expect(sourcePixelBeforeShade.b).toBeGreaterThan(sourcePixelBeforeShade.r + 80);
    expect(outsideBeforeShade).toEqual(outsideBeforeSource);

    const sourceRow = page.getByRole('treeitem').filter({ hasText: 'Brush Layer' }).first();
    await expect(sourceRow).toBeVisible();
    await sourceRow.click();
    const paintOptions = await openToolOptions(page);
    const createClippedPaintLayer = paintOptions.getByRole('button', {
      name: 'Create clipped paint layer',
    });
    await createClippedPaintLayer.click();
    // The real regression was Ctrl+Z while this nonmodal popover command still
    // owned focus, so keep that target explicit instead of relying on canvas
    // focus for the history assertions below.
    await expect(createClippedPaintLayer).toBeFocused();
    await expect(
      page.getByRole('treeitem').filter({ hasText: /Brush Layer clipped paint/ }),
    ).toBeVisible();
    await expect(page.getByRole('treeitem').filter({ hasText: 'Shading' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.screenshot({ path: testInfo.outputPath('clipped-paint-layer-created.png') });
    await page.keyboard.press('Control+z');
    await expect(
      page.getByRole('treeitem').filter({ hasText: /Brush Layer clipped paint/ }),
    ).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(
      page.getByRole('treeitem').filter({ hasText: /Brush Layer clipped paint/ }),
    ).toBeVisible();
    await page.getByRole('treeitem').filter({ hasText: 'Shading' }).click();
    const restoredPaintOptions = await openToolOptions(page);
    const foregroundColor = restoredPaintOptions.getByLabel('Foreground color');
    await foregroundColor.fill('#ff2020');
    await expect(foregroundColor).toHaveValue('#ff2020');
    await page.getByRole('button', { name: 'Tool options' }).click();

    const clippedStart = { x: box.x + box.width * 0.37, y };
    const clippedEnd = { x: box.x + box.width * 0.72, y };
    const beforeShading = await contentCanvasHash(page);
    await page.mouse.move(clippedStart.x, clippedStart.y);
    await page.mouse.down();
    await page.mouse.move(clippedEnd.x, clippedEnd.y, { steps: 36 });
    await page.mouse.up();
    await expect
      .poll(
        async () => {
          const pixel = await contentPixelAtScreenPoint(page, sourcePixel);
          return pixel.r > pixel.g + 30;
        },
        { timeout: 15000 },
      )
      .toBe(true);
    await testInfo.attach('clipped-paint-pointer-state.json', {
      body: JSON.stringify({
        beforeShading,
        afterPointer: await contentCanvasHash(page),
        inside: await contentPixelAtScreenPoint(page, sourcePixel),
        outside: await contentPixelAtScreenPoint(page, outsidePixel),
      }),
      contentType: 'application/json',
    });
    expect(await contentCanvasHash(page)).not.toBe(beforeShading);
    const insideAfter = await contentPixelAtScreenPoint(page, sourcePixel);
    const outsideAfter = await contentPixelAtScreenPoint(page, outsidePixel);
    expect(insideAfter.r).toBeGreaterThan(insideAfter.g + 30);
    expect(insideAfter.a).toBeGreaterThan(200);
    expect(outsideAfter).toEqual(outsideBeforeShade);
    await surface.screenshot({ path: testInfo.outputPath('clipped-paint-shading.png') });
    await page.screenshot({ path: testInfo.outputPath('clipped-paint-editor.png') });

    const shadedHash = await contentCanvasHash(page);
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => contentPixelAtScreenPoint(page, sourcePixel), { timeout: 15000 })
      .toMatchObject({ r: 32, g: 32, b: 255, a: 255 });
    await page.keyboard.press('Control+Shift+z');
    await expect
      .poll(
        async () => {
          const pixel = await contentPixelAtScreenPoint(page, sourcePixel);
          return pixel.r > pixel.g + 100 && pixel.r > pixel.b + 100;
        },
        { timeout: 15000 },
      )
      .toBe(true);
    expect(await contentCanvasHash(page)).toBe(shadedHash);

    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 60000 });
    await page.reload({ timeout: 180000, waitUntil: 'commit' });
    await page.locator('.varve-home').waitFor({ timeout: 45000 });
    const savedCard = page.getByRole('gridcell', { name: /Clipped paint regression/ });
    await expect(savedCard).toBeVisible({ timeout: 30000 });
    await savedCard.dblclick();
    await page.locator('.layers-panel').waitFor({ timeout: 60000 });
    await page.waitForTimeout(500);
    await expect(designWorkspace).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: testInfo.outputPath('clipped-paint-reopened.png') });
    const reopenedCanvas = page.locator('.editor-canvas');
    const reopenedBox = await reopenedCanvas.boundingBox();
    if (!reopenedBox) throw new Error('reopened editor canvas surface not found');
    const reopenedPixel = {
      x: reopenedBox.x + reopenedBox.width * 0.4,
      y: reopenedBox.y + reopenedBox.height * 0.5,
    };
    await expect
      .poll(
        async () => {
          const pixel = await contentPixelAtScreenPoint(page, reopenedPixel);
          return pixel.a === 255 && pixel.r > pixel.g + 100 && pixel.r > pixel.b + 100;
        },
        { timeout: 15000 },
      )
      .toBe(true);
    const reopenedColor = await contentPixelAtScreenPoint(page, reopenedPixel);
    expect(reopenedColor.r).toBeGreaterThan(reopenedColor.g + 100);
    expect(reopenedColor.r).toBeGreaterThan(reopenedColor.b + 100);

    await page
      .getByRole('treeitem')
      .filter({ hasText: /Brush Layer clipped paint/ })
      .first()
      .click();
    const exportTab = page.getByRole('tab', { name: 'Export', exact: true });
    if (await exportTab.isVisible().catch(() => false)) {
      await exportTab.click();
    } else {
      await page.getByRole('button', { name: /^More inspector tabs/ }).click();
      await page
        .getByRole('menu', { name: 'More inspector tabs' })
        .getByRole('menuitem', { name: 'Export', exact: true })
        .click();
    }
    await page.getByRole('radio', { name: 'PNG', exact: true }).first().click();
    const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error('clipped paint PNG export was not written');
    await download.saveAs(testInfo.outputPath('clipped-paint-export.png'));
    const pngBytes = await readFile(downloadPath);
    expect(pngBytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const exportedImage = PNG.sync.read(pngBytes);
    let exportedRedPixels = 0;
    let exportedTransparentPixels = 0;
    for (let offset = 0; offset < exportedImage.data.length; offset += 4) {
      const r = exportedImage.data[offset] ?? 0;
      const g = exportedImage.data[offset + 1] ?? 0;
      const b = exportedImage.data[offset + 2] ?? 0;
      const a = exportedImage.data[offset + 3] ?? 0;
      if (a > 200 && r > 200 && g < 80 && b < 80) exportedRedPixels++;
      if (a === 0) exportedTransparentPixels++;
    }
    expect(exportedRedPixels).toBeGreaterThan(1000);
    expect(exportedTransparentPixels).toBeGreaterThan(1000);
    await testInfo.attach('clipped-paint-transparent-export.png', {
      body: pngBytes,
      contentType: 'image/png',
    });

    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await page.evaluate((value) => localStorage.setItem('varve-theme', value), theme);
      await page.reload({ timeout: 180000, waitUntil: 'commit' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.locator('.varve-home').waitFor({ timeout: 45000 });
      await page.getByRole('gridcell', { name: /Clipped paint regression/ }).dblclick();
      await page.locator('.layers-panel').waitFor({ timeout: 60000 });
      await page.waitForTimeout(500);
      await expect(designWorkspace).toHaveAttribute('aria-checked', 'true');
      const themeCanvas = page.locator('.editor-canvas');
      const themeCanvasBox = await themeCanvas.boundingBox();
      if (!themeCanvasBox) throw new Error('themed editor canvas surface not found');
      const themePixel = {
        x: themeCanvasBox.x + themeCanvasBox.width * 0.4,
        y: themeCanvasBox.y + themeCanvasBox.height * 0.5,
      };
      await expect
        .poll(
          async () => {
            const pixel = await contentPixelAtScreenPoint(page, themePixel);
            return pixel.a === 255 && pixel.r > pixel.g + 100 && pixel.r > pixel.b + 100;
          },
          { timeout: 15000 },
        )
        .toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`clipped-paint-${theme}.png`) });
      await themeCanvas.screenshot({
        path: testInfo.outputPath(`clipped-paint-${theme}-canvas.png`),
      });
    }

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: testInfo.outputPath('clipped-paint-high-contrast-narrow.png') });
    await page.locator('.editor-canvas').screenshot({
      path: testInfo.outputPath('clipped-paint-high-contrast-narrow-canvas.png'),
    });
  });

  test('stroke-opacity brush limits one gesture and lets a later stroke build further', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
    await switchToPhotoWorkspace(page);
    await activatePaint(page);
    const popover = await openToolOptions(page);
    const browser = popover.locator('.brush-browser');
    const softShade = browser.getByRole('button', { name: 'Soft Shade', exact: true });
    await softShade.scrollIntoViewIfNeeded();
    await softShade.click();
    const optionsButton = page.getByRole('button', { name: 'Tool options' });
    if ((await optionsButton.getAttribute('aria-expanded')) === 'true') await optionsButton.click();

    const surface = page.locator('.editor-canvas');
    const box = await surface.boundingBox();
    if (!box) throw new Error('editor canvas surface not found');
    const point = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
    await page.waitForTimeout(500);
    const before = await contentPixelAtScreenPoint(page, point);

    const paintGesture = async () => {
      await page.mouse.move(point.x - 3, point.y);
      await page.mouse.down();
      for (let i = 0; i < 30; i++) {
        const side = i % 2 === 0 ? 3 : -3;
        await page.mouse.move(point.x + side, point.y + (i % 4 < 2 ? 2 : -2), { steps: 1 });
      }
      await page.mouse.up();
      await page.waitForTimeout(250);
    };

    await paintGesture();
    const once = await contentPixelAtScreenPoint(page, point);
    await page.screenshot({ path: testInfo.outputPath('stroke-opacity-first-gesture.png') });
    await paintGesture();
    const twice = await contentPixelAtScreenPoint(page, point);
    await page.screenshot({ path: testInfo.outputPath('stroke-opacity-second-gesture.png') });

    const channelDelta = (from: typeof before, to: typeof before) =>
      Math.max(
        Math.abs(from.r - to.r),
        Math.abs(from.g - to.g),
        Math.abs(from.b - to.b),
        Math.abs(from.a - to.a),
      );
    expect(channelDelta(before, once)).toBeGreaterThan(20);
    expect(channelDelta(once, twice)).toBeGreaterThan(5);
    if (before.a < 250) {
      // The page is transparent at this point: one gesture stays below the
      // 38% Soft Shade ceiling, while the next gesture builds onto it.
      expect(once.a).toBeLessThanOrEqual(100);
      expect(twice.a).toBeGreaterThan(once.a);
    } else {
      expect(once.r).toBeGreaterThan(120);
      expect(once.r).toBeLessThan(235);
      expect(twice.r).toBeLessThan(once.r);
    }
  });

  test('an explicit vector selection blocks painting into another raster layer', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
    await switchToPhotoWorkspace(page);
    const surface = page.locator('.editor-canvas');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await surface.boundingBox();
    if (!box) throw new Error('editor canvas surface not found');

    // Establish an unrelated raster fallback through the normal paint path.
    await activatePaint(page);
    const y = box.y + box.height * 0.42;
    const blank = await contentCanvasHash(page);
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.32, y + 16, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => contentCanvasHash(page), { timeout: 10000 }).not.toBe(blank);
    await page.waitForTimeout(500);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText('Brush Layer');
    await page.screenshot({ path: testInfo.outputPath('paint-layer-before-vector.png') });

    // Add and leave a vector rectangle explicitly selected above that raster.
    await page.keyboard.press('r');
    await expect(page.getByRole('treeitem').first()).toContainText('Brush Layer');
    await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.38);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.67, box.y + box.height * 0.62, { steps: 8 });
    await page.mouse.up();
    await page.screenshot({ path: testInfo.outputPath('vector-layer-after-drag.png') });
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
    const vectorRow = page.getByRole('treeitem').filter({ hasText: /rect/i });
    await expect(vectorRow).toBeVisible();
    await expect(vectorRow).toHaveAttribute('aria-selected', 'true');

    // The attempt must be refused, with no change to the already-painted
    // raster and no third layer silently created in the background.
    await activatePaint(page);
    await page.waitForTimeout(250);
    const before = await contentCanvasHash(page);
    await page.mouse.move(box.x + box.width * 0.72, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, y + 14, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator('#strata-canvas-announcer-polite')).toHaveText(
      /Create a paint layer, then select it to paint/i,
    );
    await expect.poll(() => contentCanvasHash(page)).toBe(before);
    await expect(page.getByRole('treeitem')).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('vector-selected-paint-refusal.png') });

    // Recovery is explicit: it creates and selects a new paint layer, then
    // the next pointer gesture deposits there as a separate operation.
    const options = await openToolOptions(page);
    const createPaintLayer = options.getByRole('button', { name: 'Create paint layer' });
    await expect(createPaintLayer).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('paint-layer-recovery-available.png') });
    await createPaintLayer.click();
    await expect(page.getByRole('treeitem')).toHaveCount(3);
    const paintLayer = page.getByRole('treeitem').filter({ hasText: 'Paint Layer' });
    await expect(paintLayer).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: testInfo.outputPath('paint-layer-recovery-selected.png') });
    await page.getByRole('button', { name: 'Tool options' }).click();
    await expect(page.getByRole('button', { name: 'Tool options' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    const blankPaintLayer = await contentCanvasHash(page);
    await page.mouse.move(box.x + box.width * 0.72, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, y + 14, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => contentCanvasHash(page), { timeout: 10000 }).not.toBe(blankPaintLayer);
    await expect(page.getByRole('treeitem')).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath('paint-layer-recovery-stroke.png') });
    await expect(canvas).toBeVisible();
  });

  test('smudge mode and sampling controls drive a real canvas stroke', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
    await switchToPhotoWorkspace(page);
    await activatePaint(page);

    const surface = page.locator('.editor-canvas');
    const box = await surface.boundingBox();
    if (!box) throw new Error('editor canvas surface not found');

    // Create source pigment through the normal paint tool, then switch tools.
    await page.waitForTimeout(750);
    const blank = await contentCanvasHash(page);
    const y = box.y + box.height * 0.5;
    await page.mouse.move(box.x + box.width * 0.25, y);
    await page.mouse.down();
    for (let i = 1; i <= 14; i++) {
      const t = i / 14;
      await page.mouse.move(
        box.x + box.width * (0.25 + 0.2 * t),
        y + Math.sin(t * Math.PI * 2) * box.height * 0.08,
      );
    }
    await page.mouse.up();
    await expect.poll(() => contentCanvasHash(page), { timeout: 10000 }).not.toBe(blank);
    // Paint batches may finish on the worker after pointer-up. Let the
    // authoritative frame and history callback settle before Smudge samples
    // the source layer; a layer-created frame is not proof of painted pixels.
    await page.waitForTimeout(1000);
    await surface.screenshot({ path: testInfo.outputPath('smudge-source-stroke.png') });

    await activateSmudge(page);
    const popover = await openToolOptions(page);
    await expect(popover).toBeVisible();

    const mode = popover.getByRole('combobox', { name: 'Smudge mode' });
    await expect(mode).toContainText('Pure smudge');
    await mode.click();
    await page.getByRole('option', { name: 'Fingerpaint', exact: true }).click();
    await expect(mode).toContainText('Fingerpaint');

    const mergedSampling = popover.getByRole('button', { name: 'Sample merged layers' });
    await expect(mergedSampling).toHaveAttribute('aria-pressed', 'false');
    await mergedSampling.click();
    await expect(mergedSampling).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: testInfo.outputPath('smudge-controls.png'), fullPage: false });

    const before = await contentCanvasHash(page);
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      await page.mouse.move(
        box.x + box.width * (0.3 + 0.2 * t),
        y + Math.sin(t * Math.PI) * box.height * 0.05,
      );
    }
    await page.mouse.up();

    await expect.poll(() => contentCanvasHash(page), { timeout: 10000 }).not.toBe(before);
    await surface.screenshot({ path: testInfo.outputPath('smudge-merged-stroke.png') });
  });
});
