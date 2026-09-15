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
    await page.getByRole('menuitemradio', { name: /Paint/i }).click();
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

    await browser.getByRole('tab', { name: 'Favorites' }).click();
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
