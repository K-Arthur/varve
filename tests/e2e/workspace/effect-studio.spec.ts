import { captureProducerScreenshot } from '../../../scripts/screenshots/producer-capture.mjs';
/**
 * Curated Effect Studio dialog.
 *
 * Covers the streamlined primary inspector, controlled in-app dialog launch,
 * and direct numeric treatment tuning against the live editor selection.
 */

import { Buffer } from 'node:buffer';
import { expect, type Page, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';
import { dragOnCanvas } from '../shared';

async function ensureEffectStudioLauncher(page: Page) {
  const launcher = page.getByTestId('open-effect-studio');
  if (await launcher.isVisible().catch(() => false)) return;

  // Raster selections expose Image Tuning under Adjustments, but Effect Studio
  // stays in the Design/Appearance surface. Try both contextual inspector tabs
  // so this helper does not assume the same launch surface for every node kind.
  for (const label of ['Design', 'Adjustments']) {
    const tab = page.getByRole('tab', { name: label, exact: true });
    if (!(await tab.isVisible().catch(() => false))) continue;
    await tab.click();
    if (await launcher.isVisible().catch(() => false)) return;
  }
  await expect(launcher).toBeVisible({ timeout: 30_000 });
}

async function expectStudioSectionBelowQuickNav(page: Page, sectionId: string) {
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const body = document.querySelector('.effect-studio-dialog .varve-dialog__body');
        const nav = document.querySelector('.effect-studio__quick-nav');
        const section = document.getElementById(id);
        if (!body || !nav || !section) return false;
        const navBounds = nav.getBoundingClientRect();
        const bodyBounds = body.getBoundingClientRect();
        const sectionBounds = section.getBoundingClientRect();
        return sectionBounds.top >= navBounds.bottom && sectionBounds.top < bodyBounds.bottom;
      }, sectionId),
    )
    .toBe(true);
}

async function delay2xEncoding(page: Page, delayMs: number) {
  await page.evaluate((delay) => {
    const testWindow = window as Window & { __effectStudioAbortCount?: number };
    testWindow.__effectStudioAbortCount = 0;
    const abortPrototype = AbortController.prototype;
    const originalAbort = abortPrototype.abort;
    abortPrototype.abort = function (reason?: unknown) {
      testWindow.__effectStudioAbortCount = (testWindow.__effectStudioAbortCount ?? 0) + 1;
      return originalAbort.call(this, reason);
    };

    if (typeof OffscreenCanvas !== 'undefined') {
      const prototype = OffscreenCanvas.prototype;
      const originalEncode = prototype.convertToBlob;
      prototype.convertToBlob = function (options?: ImageEncodeOptions) {
        if (Math.max(this.width, this.height) >= 1000) {
          return new Promise<Blob>((resolve, reject) => {
            window.setTimeout(() => {
              originalEncode.call(this, options).then(resolve, reject);
            }, delay);
          });
        }
        return originalEncode.call(this, options);
      };
    }
  }, delayMs);
}

async function fail2xEncoding(page: Page) {
  await page.evaluate(() => {
    const testWindow = window as Window & { __effectStudioEncodeFailureCount?: number };
    testWindow.__effectStudioEncodeFailureCount = 0;
    if (typeof OffscreenCanvas !== 'undefined') {
      const prototype = OffscreenCanvas.prototype;
      const originalEncode = prototype.convertToBlob;
      prototype.convertToBlob = function (options?: ImageEncodeOptions) {
        if (Math.max(this.width, this.height) >= 1000) {
          testWindow.__effectStudioEncodeFailureCount =
            (testWindow.__effectStudioEncodeFailureCount ?? 0) + 1;
          return Promise.reject(new Error('Injected 2x encoder failure'));
        }
        return originalEncode.call(this, options);
      };
    }
    const prototype = HTMLCanvasElement.prototype;
    const originalEncode = prototype.toBlob;
    prototype.toBlob = function (callback, type, quality) {
      if (Math.max(this.width, this.height) >= 1000) {
        testWindow.__effectStudioEncodeFailureCount =
          (testWindow.__effectStudioEncodeFailureCount ?? 0) + 1;
        callback(null);
        return;
      }
      originalEncode.call(this, callback, type, quality);
    };
  });
}

async function createSelectedRectangle(page: Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('r');
  await dragOnCanvas(page, 140, 140, 360, 300);
  await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 30_000 });
  await ensureEffectStudioLauncher(page);
}

async function createSelectedVectorPath(page: Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('content canvas is not laid out for the Pen tool');

  await page.keyboard.press('p');
  await page.mouse.click(box.x + 150, box.y + 150);
  await page.waitForTimeout(350);
  await page.mouse.click(box.x + 310, box.y + 170);
  await page.waitForTimeout(350);
  await page.mouse.click(box.x + 240, box.y + 300);
  await page.keyboard.press('Enter');

  const pathRow = page.getByRole('treeitem').first();
  await expect(pathRow).toContainText(/path|vector shape/i, { timeout: 30_000 });
  await pathRow.click();
  await ensureEffectStudioLauncher(page);
}

async function importSelectedWideImage(page: Page) {
  const source = await page.evaluate(() => {
    const image = document.createElement('canvas');
    image.width = 640;
    image.height = 360;
    const context = image.getContext('2d');
    if (!context) throw new Error('Could not create the image fixture canvas');
    context.fillStyle = '#172033';
    context.fillRect(0, 0, image.width, image.height);
    context.fillStyle = '#e33b52';
    context.fillRect(0, 0, 160, image.height);
    context.fillStyle = '#39d0c6';
    context.fillRect(image.width - 160, 0, 160, image.height);
    context.fillStyle = '#ffffff';
    context.fillRect(280, 24, 80, 48);
    context.fillStyle = '#f5c451';
    context.fillRect(280, image.height - 72, 80, 48);
    return image.toDataURL('image/png').split(',')[1]!;
  });

  await page.locator('#file-import-input').setInputFiles({
    name: 'effect-studio-fit-regression.png',
    mimeType: 'image/png',
    buffer: Buffer.from(source, 'base64'),
  });
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });
  await page.getByRole('treeitem').first().click();
  await ensureEffectStudioLauncher(page);
}

async function switchToPhotoWorkspace(page: Page) {
  await page.keyboard.press('Control+Shift+4');
  await expect(page.getByRole('radio', { name: /^Photo workspace$/ })).toBeChecked();
}

test.describe('Effect Studio dialog', () => {
  test('keeps the inspector compact and tunes a treatment in the primary editor', async ({
    page,
  }) => {
    await navigateToCleanEditor(page);
    await createSelectedRectangle(page);

    const launcher = page.getByTestId('open-effect-studio');
    const appearance = page.locator('.insp-disclosure').filter({ has: launcher });
    await expect(appearance).toHaveScreenshot('effect-studio-launcher.png', {
      maxDiffPixels: 200,
    });
    await expect(page.locator('[data-effect-studio]')).toHaveCount(0);

    const initialPageCount = page.context().pages().length;
    await launcher.click();
    const studio = page.getByTestId('effect-studio-dialog');

    await expect(studio).toBeVisible({ timeout: 30_000 });
    expect(page.context().pages()).toHaveLength(initialPageCount);
    await expect(studio).toHaveScreenshot('effect-studio-dialog.png', { maxDiffPixels: 300 });

    await studio.getByRole('searchbox', { name: 'Search treatments' }).fill('reticulation');
    await studio.getByRole('button', { name: 'Adjust Reticulation recipe' }).click();

    const precision = studio.getByRole('spinbutton', {
      name: /Reticulation Cluster density value/,
    });
    await precision.fill('42');
    await precision.press('Enter');
    await expect(studio.getByRole('slider', { name: 'Reticulation Cluster density' })).toHaveValue(
      '42',
    );

    await studio.getByRole('button', { name: 'Preview', exact: true }).click();
    const original = studio.getByAltText('Original selected object without Object Filters');
    const effects = studio.getByAltText('Selected object with its Object Filters');
    await expect(original).toHaveAttribute('src', /^data:image\//);
    await expect(effects).toHaveAttribute('src', /^data:image\//);
    await expect(studio.getByTestId('effect-studio-preview-stage')).toHaveAttribute(
      'data-view',
      'compare',
    );
    await expect(studio.getByRole('button', { name: 'Before this edit' })).toBeEnabled();
    await expect(studio.getByRole('button', { name: 'Current candidate' })).toBeEnabled();
    expect(await original.getAttribute('src')).not.toBe(await effects.getAttribute('src'));
    await expect(studio.getByTestId('effect-studio-preview-stage')).toHaveScreenshot(
      'effect-studio-before-after.png',
      { maxDiffPixels: 200 },
    );
    const split = studio.getByRole('slider', { name: 'Before and after split' });
    await split.focus();
    await split.press('ArrowRight');
    await expect(studio.getByText('51% before')).toBeVisible();

    await studio.getByRole('button', { name: 'Keep treatment' }).click();
    await expect(studio.getByRole('button', { name: 'Reset controls' })).toBeVisible();
    await precision.fill('58');
    await precision.press('Enter');
    await expect(precision).toHaveValue('58');
    const appliedReticulationStack = studio.getByRole('list', { name: 'Applied treatments' });
    await expect(appliedReticulationStack).toContainText('Reticulation');
    await expect(appliedReticulationStack).toContainText('2 derived effects');

    await studio.getByRole('searchbox', { name: 'Search treatments' }).fill('halftone pattern');
    await studio.getByRole('button', { name: 'Apply Halftone Pattern' }).click();
    const appliedTreatments = studio.getByRole('list', { name: 'Applied treatments' });
    await expect(appliedTreatments.locator('li')).toHaveCount(2);
    await studio.getByRole('button', { name: 'Tune Halftone Pattern' }).click();
    // Opening Tune must be read-only. This guards the regression where the
    // applied Object Filter stack disappeared before a control was changed.
    await expect(appliedTreatments).toContainText('Reticulation');
    await expect(appliedTreatments).toContainText('Halftone Pattern');
    await expect(appliedTreatments.locator('li')).toHaveCount(2);
    const dotSize = studio.getByRole('slider', { name: 'Halftone Pattern Dot size' });
    await dotSize.focus();
    await dotSize.press('ArrowRight');
    await expect(dotSize).toHaveValue('3');
    await expect(appliedReticulationStack).toContainText('Halftone Pattern');
    await expect(appliedReticulationStack.locator('li')).toHaveCount(2);
    await studio.getByRole('button', { name: 'Move Halftone Pattern up' }).click();
    const namedStack = studio.getByRole('list', { name: 'Applied treatments' });
    await expect(namedStack.locator('li').first()).toContainText('Halftone Pattern');

    await studio.getByRole('button', { name: 'Close dialog' }).click();
    await expect(studio).not.toBeVisible();
  });

  test('runs an optional settled 2x check and invalidates it after tuning changes', async ({
    page,
  }) => {
    await navigateToCleanEditor(page);
    await createSelectedRectangle(page);
    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await studio.getByRole('searchbox', { name: 'Search treatments' }).fill('reticulation');
    await studio.getByRole('button', { name: 'Preview Reticulation' }).click();

    const stage = studio.getByTestId('effect-studio-preview-stage');
    const qualityCheck = studio.getByRole('button', { name: 'Check at 2x' });
    await expect(qualityCheck).toBeEnabled({ timeout: 30_000 });
    await expect(stage).toHaveAttribute('data-quality', 'live-preview');
    await qualityCheck.click();
    await expect(studio.getByText(/Checking both states at 2x/)).toBeVisible();
    await expect(studio.getByRole('button', { name: 'Keep treatment' })).toBeEnabled();
    await expect(stage).toHaveAttribute('data-quality', 'settled-2x', { timeout: 30_000 });
    await expect(studio.getByText(/Settled 2x check complete · up to 1536 x 1152/)).toBeVisible();
    const proofDimensions = await stage.locator('img').evaluateAll((images) =>
      images.map((image) => ({
        width: (image as HTMLImageElement).naturalWidth,
        height: (image as HTMLImageElement).naturalHeight,
      })),
    );
    expect(proofDimensions).toHaveLength(2);
    expect(
      proofDimensions.every(({ width, height }) => width > 768 && height > 576),
      JSON.stringify(proofDimensions),
    ).toBe(true);

    const density = studio.getByRole('spinbutton', {
      name: /Reticulation Cluster density value/,
    });
    await density.fill('42');
    await density.press('Enter');
    await expect(studio.getByText(/2x check is stale/)).toBeVisible();
    await expect(stage).toHaveAttribute('data-quality', 'live-preview');
    await expect(studio.getByRole('button', { name: 'Check at 2x' })).toBeEnabled();
  });

  test('cancels an in-flight 2x render when a treatment parameter changes', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createSelectedRectangle(page);
    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await studio.getByRole('searchbox', { name: 'Search treatments' }).fill('reticulation');
    await studio.getByRole('button', { name: 'Preview Reticulation' }).click();
    const qualityCheck = studio.getByRole('button', { name: 'Check at 2x' });
    await expect(qualityCheck).toBeEnabled({ timeout: 30_000 });
    await delay2xEncoding(page, 1500);
    const initialAbortCount = await page.evaluate(
      () =>
        (window as Window & { __effectStudioAbortCount?: number }).__effectStudioAbortCount ?? 0,
    );

    await qualityCheck.click();
    await expect(studio.getByText(/Checking both states at 2x/)).toBeVisible();
    const density = studio.getByRole('spinbutton', {
      name: /Reticulation Cluster density value/,
    });
    await density.fill('42');
    await density.press('Enter');
    await expect(studio.getByText(/2x check is stale/)).toBeVisible();
    await expect(studio.getByTestId('effect-studio-preview-stage')).toHaveAttribute(
      'data-quality',
      'live-preview',
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __effectStudioAbortCount?: number }).__effectStudioAbortCount ??
            0,
        ),
      )
      .toBeGreaterThan(initialAbortCount);
  });

  test('reports a 2x renderer failure while keeping the live preview available', async ({
    page,
  }) => {
    await navigateToCleanEditor(page);
    await createSelectedRectangle(page);
    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await studio.getByRole('searchbox', { name: 'Search treatments' }).fill('reticulation');
    await studio.getByRole('button', { name: 'Preview Reticulation' }).click();
    await expect(studio.getByRole('button', { name: 'Check at 2x' })).toBeEnabled({
      timeout: 30_000,
    });
    await fail2xEncoding(page);

    await studio.getByRole('button', { name: 'Check at 2x' }).click();
    await expect(studio.getByText(/2x check failed/)).toBeVisible({ timeout: 30_000 });
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __effectStudioEncodeFailureCount?: number })
            .__effectStudioEncodeFailureCount,
      ),
    ).toBeGreaterThan(0);
    await expect(studio.getByTestId('effect-studio-preview-stage')).toHaveAttribute(
      'data-quality',
      'live-preview',
    );
    await expect(
      studio.getByAltText('Original selected object without Object Filters'),
    ).toHaveAttribute('src', /^data:image\//);
    await expect(studio.getByRole('button', { name: 'Keep treatment' })).toBeEnabled();
  });

  test('keeps the three zones aligned across the responsive viewport matrix', async ({
    page,
  }, testInfo) => {
    await navigateToCleanEditor(page);
    await createSelectedRectangle(page);
    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await studio.getByRole('searchbox', { name: 'Search treatments' }).fill('reticulation');
    await studio.getByRole('button', { name: 'Preview Reticulation' }).click();
    const stage = studio.getByTestId('effect-studio-preview-stage');
    await expect(stage.getByRole('img').first()).toBeVisible({ timeout: 30_000 });
    const qualityCheck = studio.getByRole('button', { name: 'Check at 2x' });
    await expect(qualityCheck).toBeEnabled({ timeout: 30_000 });
    await qualityCheck.click();
    await expect(stage).toHaveAttribute('data-quality', 'settled-2x', { timeout: 30_000 });

    const viewports = [
      { width: 1440, height: 900, layout: 'wide' },
      { width: 1024, height: 768, layout: 'medium' },
      { width: 768, height: 1024, layout: 'narrow' },
      { width: 390, height: 844, layout: 'narrow' },
      { width: 320, height: 844, layout: 'narrow' },
    ] as const;

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((nextTheme) => {
        localStorage.setItem('varve-theme', nextTheme);
        document.documentElement.dataset.theme = nextTheme;
      }, theme);
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await studio.locator('.varve-dialog__body').evaluate((element) => {
          element.scrollTop = 0;
        });
        const layout = await studio.evaluate((dialog) => {
          const rect = (selector: string) => {
            const element = dialog.querySelector<HTMLElement>(selector);
            if (!element) throw new Error(`Missing layout element: ${selector}`);
            const bounds = element.getBoundingClientRect();
            return {
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
              width: bounds.width,
            };
          };
          const workspace = dialog.querySelector<HTMLElement>('.effect-studio__workspace');
          const body = dialog.querySelector<HTMLElement>('.varve-dialog__body');
          if (!workspace || !body) throw new Error('Effect Studio dialog layout is incomplete');
          const children = Array.from(workspace.children).map((element) => {
            if (element.classList.contains('effect-studio-comparison')) return 'preview';
            if (element.classList.contains('effect-studio__browser')) return 'browser';
            if (element.classList.contains('effect-studio__inspector')) return 'inspector';
            return 'other';
          });
          const previewImages = Array.from(
            dialog.querySelectorAll<HTMLImageElement>(
              '.effect-studio-comparison__image-layer > img',
            ),
          ).map((image) => {
            const bounds = image.getBoundingClientRect();
            return {
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              height: bounds.height,
            };
          });
          return {
            bodyOverflowX: body.scrollWidth - body.clientWidth,
            workspaceOverflowX: workspace.scrollWidth - workspace.clientWidth,
            bodyRight: body.getBoundingClientRect().right,
            scrollMode: getComputedStyle(body).overflowY,
            children,
            preview: rect('.effect-studio-comparison'),
            browser: rect('.effect-studio__browser'),
            inspector: rect('.effect-studio__inspector'),
            stage: rect('.effect-studio-comparison__stage'),
            previewImages,
          };
        });

        expect(layout.bodyOverflowX).toBeLessThanOrEqual(1);
        expect(layout.workspaceOverflowX).toBeLessThanOrEqual(1);
        expect(layout.scrollMode).toMatch(/auto|scroll/);
        expect(layout.children).toEqual(['preview', 'browser', 'inspector']);
        expect(layout.stage.width).toBeGreaterThan(200);
        expect(layout.stage.right).toBeLessThanOrEqual(layout.bodyRight);
        if (viewport.layout === 'wide') {
          expect(layout.preview.left).toBeLessThan(layout.browser.left);
          expect(layout.browser.left).toBeLessThan(layout.inspector.left);
          expect(layout.preview.top).toBeLessThanOrEqual(layout.inspector.top + 4);
        } else if (viewport.layout === 'medium') {
          expect(layout.preview.left).toBeLessThan(layout.browser.left);
          expect(layout.inspector.top).toBeGreaterThan(layout.preview.bottom);
          expect(layout.inspector.top).toBeGreaterThan(layout.browser.bottom);
        } else {
          expect(layout.preview.top).toBeLessThan(layout.browser.top);
          expect(layout.browser.top).toBeLessThan(layout.inspector.top);
        }
        if (layout.previewImages.length > 1) {
          const [before, after] = layout.previewImages;
          expect(Math.abs(before!.left - after!.left)).toBeLessThan(1);
          expect(Math.abs(before!.top - after!.top)).toBeLessThan(1);
          expect(Math.abs(before!.width - after!.width)).toBeLessThan(1);
          expect(Math.abs(before!.height - after!.height)).toBeLessThan(1);
        }
        await captureProducerScreenshot(
          page,
          testInfo,
          `effect-studio-${theme}-${viewport.width}x${viewport.height}.png`,
        );
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const beforeButton = studio.getByRole('button', { name: 'Before this edit' });
    await beforeButton.focus();
    let foundQualityAction = false;
    let foundGallerySearch = false;
    for (let index = 0; index < 16; index += 1) {
      const activeLabel = await page.evaluate(() => {
        const active = document.activeElement;
        return active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? '';
      });
      if (activeLabel.includes('Check') && activeLabel.includes('2x')) {
        foundQualityAction = true;
      }
      if (activeLabel === 'Search treatments') {
        foundGallerySearch = true;
        break;
      }
      await page.keyboard.press('Tab');
    }
    expect(foundQualityAction).toBe(true);
    expect(foundGallerySearch).toBe(true);
  });

  test('keeps a multi-treatment stack and its settings reachable as the modal narrows', async ({
    page,
  }, testInfo) => {
    await navigateToCleanEditor(page);
    await createSelectedRectangle(page);
    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });

    const search = studio.getByRole('searchbox', { name: 'Search treatments' });
    await search.fill('reticulation');
    await studio.getByRole('button', { name: 'Apply Reticulation' }).click();
    await search.fill('halftone pattern');
    await studio.getByRole('button', { name: 'Apply Halftone Pattern' }).click();

    const applied = studio.getByRole('list', { name: 'Applied treatments' });
    await expect(applied.locator('li')).toHaveCount(2);
    await studio.getByRole('button', { name: 'Tune Halftone Pattern' }).click();
    const dotSize = studio.getByRole('slider', { name: 'Halftone Pattern Dot size' });
    await expect(dotSize).toBeVisible();

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
      { width: 320, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const body = studio.locator('.varve-dialog__body');
      if (viewport.width <= 1024) {
        await body.evaluate((element) => {
          element.scrollTop = 0;
        });
        await page.screenshot({
          path: testInfo.outputPath(
            `effect-studio-stack-overview-${viewport.width}x${viewport.height}.png`,
          ),
          animations: 'disabled',
        });
        await studio.getByRole('button', { name: 'Stack & settings' }).click();
        await expectStudioSectionBelowQuickNav(page, 'effect-studio-treatment-settings');
      } else {
        await body.evaluate((element) => {
          element.scrollTop = 0;
        });
      }
      await expect(applied.locator('li')).toHaveCount(2);
      await expect(dotSize).toBeVisible();
      await expect(studio.getByRole('button', { name: 'Move Halftone Pattern up' })).toBeEnabled();
      await expect(studio.getByRole('button', { name: 'Remove Reticulation' })).toBeVisible();
      const geometry = await body.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowY: getComputedStyle(element).overflowY,
      }));
      expect(geometry.scrollWidth - geometry.clientWidth).toBeLessThanOrEqual(1);
      expect(geometry.overflowY).toMatch(/auto|scroll/);
      await page.screenshot({
        path: testInfo.outputPath(`effect-studio-stack-${viewport.width}x${viewport.height}.png`),
        animations: 'disabled',
      });
    }
  });

  test('keeps preview, treatments, and active settings one tap away on narrow screens', async ({
    page,
  }, testInfo) => {
    await navigateToCleanEditor(page);
    await createSelectedRectangle(page);
    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await page.setViewportSize({ width: 390, height: 844 });

    const body = studio.locator('.varve-dialog__body');
    await page.screenshot({
      path: testInfo.outputPath('effect-studio-mobile-shortcut-rail.png'),
      animations: 'disabled',
    });
    const search = studio.getByRole('searchbox', { name: 'Search treatments' });
    await search.fill('');
    expect(await studio.locator('.effect-studio__treatment-grid > li').count()).toBeGreaterThan(8);

    const firstApply = studio.getByRole('button', { name: /^Apply / }).first();
    const treatmentName = (await firstApply.getAttribute('aria-label'))
      ?.replace(/^Apply /, '')
      .trim();
    expect(treatmentName).toBeTruthy();
    await firstApply.click();
    await expect(
      studio.getByRole('list', { name: 'Applied treatments' }).locator('li'),
    ).toHaveCount(1);
    await studio.getByRole('button', { name: `Tune ${treatmentName}` }).click();
    await expect(studio.getByRole('region', { name: `${treatmentName} settings` })).toBeVisible();

    const geometry = await body.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      browserOverflowY: getComputedStyle(
        element.querySelector('.effect-studio__browser') as HTMLElement,
      ).overflowY,
    }));
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight * 2);
    expect(geometry.overflowY).toMatch(/auto|scroll/);
    expect(geometry.browserOverflowY).not.toMatch(/auto|scroll/);

    await body.evaluate((element) => {
      element.scrollTop = Math.floor(element.scrollHeight * 0.55);
    });
    const stackShortcut = studio.getByRole('button', { name: 'Stack & settings' });
    await expect(studio.locator('.effect-studio__quick-nav')).toHaveCSS('position', 'sticky');
    await expect(stackShortcut).toBeVisible();
    await stackShortcut.focus();
    await page.keyboard.press('Enter');

    const activeId = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id);
    expect(activeId).toBe('effect-studio-treatment-settings');
    await expect(studio.getByRole('region', { name: `${treatmentName} settings` })).toBeVisible();
    await expectStudioSectionBelowQuickNav(page, 'effect-studio-treatment-settings');

    const treatmentsShortcut = studio.getByRole('button', { name: 'Treatments' });
    await treatmentsShortcut.focus();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id)).toBe(
      'effect-studio-treatments',
    );
    await expectStudioSectionBelowQuickNav(page, 'effect-studio-treatments');
  });

  test('keeps primary Effect Studio actions legible in dark mode', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createSelectedRectangle(page);
    await page.evaluate(() => {
      localStorage.setItem('varve-theme', 'dark');
      document.documentElement.dataset.theme = 'dark';
    });
    await page.waitForTimeout(150);

    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await expect(studio.getByRole('searchbox', { name: 'Search treatments' })).toBeFocused();
    await expect(studio.locator('.effect-studio__inspector')).toHaveCSS('position', 'sticky');
    const apply = studio.getByRole('button', { name: /Apply / }).first();
    await expect(apply).toBeVisible();
    const colors = await apply.evaluate((button) => {
      const style = getComputedStyle(button);
      return { background: style.backgroundColor, color: style.color };
    });
    expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(colors.background).not.toBe(colors.color);
    await expect(studio).toHaveScreenshot('effect-studio-dialog-dark.png', { maxDiffPixels: 350 });
  });

  test('renders a real effect comparison for a Pen vector path', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createSelectedVectorPath(page);

    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await studio.getByRole('searchbox', { name: 'Search treatments' }).fill('reticulation');
    await studio.getByRole('button', { name: 'Adjust Reticulation recipe' }).click();
    await studio.getByRole('button', { name: 'Preview', exact: true }).click();

    const original = studio.getByAltText('Original selected object without Object Filters');
    const effects = studio.getByAltText('Selected object with its Object Filters');
    await expect(original).toHaveAttribute('src', /^data:image\//);
    await expect(effects).toHaveAttribute('src', /^data:image\//);
    expect(await original.getAttribute('src')).not.toBe(await effects.getAttribute('src'));
    await expect(studio.getByTestId('effect-studio-preview-stage')).toHaveScreenshot(
      'effect-studio-vector-path-before-after.png',
      { maxDiffPixels: 200 },
    );
  });

  test('fits imported image previews and keeps 100% distinct from Fit', async ({ page }) => {
    await navigateToCleanEditor(page);
    await importSelectedWideImage(page);

    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    const stage = studio.getByTestId('effect-studio-preview-stage');
    const image = stage.getByRole('img', {
      name: 'Original selected object without Object Filters',
    });
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => image.evaluate((element) => (element as HTMLImageElement).complete))
      .toBe(true);

    const fitGeometry = await image.evaluate((element) => {
      const image = element as HTMLImageElement;
      const stage = element.closest('[data-testid="effect-studio-preview-stage"]')!;
      const stageRect = stage.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      return {
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        stageWidth: stageRect.width,
        stageHeight: stageRect.height,
        imageWidth: imageRect.width,
        imageHeight: imageRect.height,
        transform: getComputedStyle(image).transform,
      };
    });
    expect(fitGeometry.naturalWidth).toBeGreaterThan(fitGeometry.naturalHeight);
    expect(fitGeometry.imageWidth).toBeGreaterThan(fitGeometry.stageWidth - 3);
    expect(fitGeometry.imageWidth).toBeLessThanOrEqual(fitGeometry.stageWidth + 0.5);
    expect(fitGeometry.imageHeight).toBeGreaterThan(fitGeometry.stageHeight - 3);
    expect(fitGeometry.imageHeight).toBeLessThanOrEqual(fitGeometry.stageHeight + 0.5);
    await expect(stage).toHaveScreenshot('effect-studio-image-fit.png', {
      maxDiffPixels: 100,
    });

    await studio.getByRole('button', { name: '100%', exact: true }).click();
    const nativeGeometry = await image.evaluate((element) => {
      const image = element as HTMLImageElement;
      const imageRect = image.getBoundingClientRect();
      return {
        imageWidth: imageRect.width,
        imageHeight: imageRect.height,
        transform: getComputedStyle(image).transform,
      };
    });
    expect(nativeGeometry.imageWidth).toBeGreaterThan(fitGeometry.imageWidth);
    expect(nativeGeometry.imageHeight).toBeGreaterThan(fitGeometry.imageHeight);
    await expect(stage).toHaveScreenshot('effect-studio-image-100.png', {
      maxDiffPixels: 100,
    });

    const stageBox = await stage.boundingBox();
    if (!stageBox) throw new Error('preview stage is not laid out for panning');
    await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      stageBox.x + stageBox.width / 2 + 48,
      stageBox.y + stageBox.height / 2 + 24,
    );
    await page.mouse.up();
    await expect(stage).toHaveAttribute('data-pan-x', '48');
    await expect(stage).toHaveAttribute('data-pan-y', '24');
    await studio.getByRole('button', { name: 'Center preview' }).click();
    await expect(stage).toHaveAttribute('data-pan-x', '0');
    await expect(stage).toHaveAttribute('data-pan-y', '0');
  });

  test('applies a curated treatment to a Pen vector path without flattening it', async ({
    page,
  }) => {
    await navigateToCleanEditor(page);
    await createSelectedVectorPath(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const before = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());

    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await studio.getByRole('searchbox', { name: 'Search treatments' }).fill('reticulation');
    await studio.getByRole('button', { name: 'Apply Reticulation' }).click();

    const applied = studio.getByRole('list', { name: 'Applied treatments' });
    await expect(applied).toContainText('Reticulation');
    await expect(applied).toContainText('2 derived effects');
    await expect(studio.getByText(/raster \+ vector/i)).toBeVisible();

    await page.waitForTimeout(250);
    const after = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
    expect(after).not.toBe(before);

    await studio.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.getByRole('treeitem').first()).toContainText(/path|vector shape/i);
    await expect(page.getByTestId('open-effect-studio')).toBeVisible();
  });

  test('stacks consecutive applied treatments', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createSelectedVectorPath(page);

    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });

    const search = studio.getByRole('searchbox', { name: 'Search treatments' });
    await search.fill('reticulation');
    await studio.getByRole('button', { name: 'Apply Reticulation' }).click();
    const applied = studio.getByRole('list', { name: 'Applied treatments' });
    await expect(applied.locator('li')).toHaveCount(1);
    await expect(applied).toContainText('Reticulation');

    await search.fill('halftone pattern');
    await studio.getByRole('button', { name: 'Apply Halftone Pattern' }).click();
    await expect(applied.locator('li')).toHaveCount(2);
    await expect(applied).toContainText('Reticulation');
    await expect(applied).toContainText('Halftone Pattern');
  });

  test('cancels a draft without removing the accepted stack and makes duplication explicit', async ({
    page,
  }) => {
    await navigateToCleanEditor(page);
    await createSelectedVectorPath(page);

    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    const search = studio.getByRole('searchbox', { name: 'Search treatments' });
    const applied = studio.getByRole('list', { name: 'Applied treatments' });

    await search.fill('reticulation');
    await studio.getByRole('button', { name: 'Apply Reticulation' }).click();
    await expect(applied.locator('li')).toHaveCount(1);

    await search.fill('halftone pattern');
    await studio.getByRole('button', { name: 'Preview Halftone Pattern' }).click();
    await studio.getByRole('button', { name: 'Cancel preview' }).click();
    await expect(applied.locator('li')).toHaveCount(1);
    await expect(applied).toContainText('Reticulation');
    await expect(applied).not.toContainText('Halftone Pattern');

    await search.fill('reticulation');
    await expect(studio.getByRole('button', { name: 'Add another Reticulation' })).toBeVisible();
    await studio.getByRole('button', { name: 'Add another Reticulation' }).click();
    await expect(applied.locator('li')).toHaveCount(2);
  });

  test('keeps a previewed treatment when applying a different recipe', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createSelectedVectorPath(page);

    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30_000 });
    const search = studio.getByRole('searchbox', { name: 'Search treatments' });

    await search.fill('reticulation');
    await studio.getByRole('button', { name: 'Preview Reticulation' }).click();
    await expect(studio.getByRole('button', { name: 'Keep treatment' })).toBeVisible();

    await search.fill('halftone pattern');
    await studio.getByRole('button', { name: 'Apply Halftone Pattern' }).click();
    const applied = studio.getByRole('list', { name: 'Applied treatments' });
    await expect(applied.locator('li')).toHaveCount(2);
    await expect(applied).toContainText('Reticulation');
    await expect(applied).toContainText('Halftone Pattern');
  });

  test('keeps the vector Adjustments surface compact while exposing the full Studio modal', async ({
    page,
  }) => {
    await navigateToCleanEditor(page);
    await switchToPhotoWorkspace(page);
    await createSelectedVectorPath(page);

    const initialStudio = page.getByTestId('effect-studio-dialog');
    await page.getByTestId('open-effect-studio').click();
    await expect(initialStudio).toBeVisible({ timeout: 30_000 });
    await initialStudio.getByRole('searchbox', { name: 'Search treatments' }).fill('reticulation');
    await initialStudio.getByRole('button', { name: 'Apply Reticulation' }).click();
    await expect(initialStudio.getByRole('list', { name: 'Applied treatments' })).toContainText(
      'Reticulation',
    );
    await initialStudio.getByRole('button', { name: 'Close dialog' }).click();

    const adjustmentsTab = page
      .locator('[role="tablist"] [role="tab"]')
      .filter({ hasText: /^Adjustments$/i });
    await expect(adjustmentsTab).toBeVisible();
    await adjustmentsTab.click();
    await expect(page.getByText('Image Tuning is raster-only')).not.toBeVisible();
    await expect(page.getByText('Curated editable treatments')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Effect Studio' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Object Filters', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Layer Effects', exact: true })).toBeVisible();
    await expect(page.getByText('Applied treatments: Reticulation')).toBeVisible();
    await expect(page.locator('[data-panel="inspector"]')).toHaveScreenshot(
      'effect-studio-vector-adjustments-compact.png',
      { maxDiffPixels: 300 },
    );
    await page.getByRole('button', { name: 'Object Filters', exact: true }).click();
    await expect(page.getByText('Advanced stack editor')).toBeVisible();
    await expect(page.getByText('Raw filters, order, opacity, and blending')).toBeVisible();
    await page.getByRole('button', { name: 'Open Effect Studio' }).click();
    const reopenedStudio = page.getByTestId('effect-studio-dialog');
    await expect(reopenedStudio).toBeVisible();
    await expect(reopenedStudio.getByRole('list', { name: 'Applied treatments' })).toContainText(
      'Reticulation',
    );
  });
});
