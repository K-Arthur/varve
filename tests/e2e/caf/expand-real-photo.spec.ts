import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const PHOTO_PATH = path.resolve(__dirname, '..', 'fixtures', 'real-life-landscape.jpg');
const requireFromEngine = createRequire(
  path.resolve(process.cwd(), 'packages/engine/package.json'),
);
const { PNG } = requireFromEngine('pngjs') as {
  PNG: {
    sync: {
      read(input: Buffer): { width: number; height: number; data: Buffer };
    };
  };
};

async function dropPhotoAndSelect(page: import('@playwright/test').Page): Promise<string> {
  const bytes = readFileSync(PHOTO_PATH).toString('base64');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('content canvas is not visible');
  const before = await page.getByRole('treeitem').count();

  await page.evaluate(
    ({ x, y, encoded }) => {
      const binary = atob(encoded);
      const data = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        data[index] = binary.charCodeAt(index);
      }
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], 'real-life-landscape.jpg', { type: 'image/jpeg' }));
      const target = document.querySelector('canvas.editor-canvas__content-layer');
      if (!target) throw new Error('content canvas is missing');
      target.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer: transfer,
        }),
      );
      target.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer: transfer,
        }),
      );
    },
    { x: box.x + 160, y: box.y + 160, encoded: bytes },
  );

  await expect
    .poll(() => page.getByRole('treeitem').count(), { timeout: 60_000 })
    .toBeGreaterThan(before);
  await page.mouse.click(box.x + 180, box.y + 180);
  await page.waitForTimeout(300);

  const nodeId = await page.evaluate(() => {
    const root = document.querySelector('#root > *') as any;
    const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) throw new Error('editor fiber is missing');
    const seen = new Set<any>();
    let found: string | null = null;
    (function walk(fiber: any): void {
      if (!fiber || seen.has(fiber) || found) return;
      seen.add(fiber);
      let hook = fiber.memoizedState;
      while (hook) {
        if (hook.queue) {
          const state = hook.queue.lastRenderedState;
          if (state?.document?.nodes) {
            for (const id of Object.keys(state.document.nodes).reverse()) {
              const node = state.document.nodes[id];
              if (
                node?.kind === 'shape' &&
                node.fills?.some((fill: any) => fill.type === 'image')
              ) {
                found = id;
                return;
              }
            }
          }
        }
        hook = hook.next;
      }
      for (const child of [fiber.child, fiber.sibling]) walk(child);
    })(root[fiberKey]);
    return found;
  });
  if (!nodeId) throw new Error('image node was not created');
  return nodeId;
}

async function readDocument(page: import('@playwright/test').Page): Promise<any> {
  return page.evaluate(() => {
    const root = document.querySelector('#root > *') as any;
    const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) throw new Error('editor fiber is missing');
    const seen = new Set<any>();
    let documentState: any = null;
    (function walk(fiber: any): void {
      if (!fiber || seen.has(fiber) || documentState) return;
      seen.add(fiber);
      let hook = fiber.memoizedState;
      while (hook) {
        if (hook.queue) {
          const state = hook.queue.lastRenderedState;
          if (state?.document?.nodes) {
            documentState = state.document;
            return;
          }
        }
        hook = hook.next;
      }
      for (const child of [fiber.child, fiber.sibling]) walk(child);
    })(root[fiberKey]);
    if (!documentState) throw new Error('document state is unavailable');
    return documentState;
  });
}

async function openGenerativeEdit(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('tab', { name: 'Adjustments', exact: true }).click();
  const section = page.getByRole('button', { name: 'Generative Edit', exact: true });
  await expect(section).toBeVisible({ timeout: 10_000 });
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
  await page.getByRole('button', { name: 'Open Generative Edit dialog' }).click();
}

async function inspectGeneratedBorder(
  page: import('@playwright/test').Page,
  resultUrl: string,
  sourceWidth: number,
  sourceHeight: number,
  offsetX: number,
  offsetY: number,
): Promise<{ opaqueFraction: number; uniqueColorBuckets: number }> {
  return page.evaluate(
    async ({
      resultUrl: url,
      sourceWidth: width,
      sourceHeight: height,
      offsetX: x0,
      offsetY: y0,
    }) => {
      const imageData = await new Promise<ImageData>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('border-check canvas is unavailable'));
            return;
          }
          context.drawImage(image, 0, 0);
          resolve(context.getImageData(0, 0, canvas.width, canvas.height));
        };
        image.onerror = () => reject(new Error('border-check image decode failed'));
        image.src = url;
      });
      let borderPixels = 0;
      let opaquePixels = 0;
      const colorBuckets = new Set<number>();
      for (let y = 0; y < imageData.height; y += 1) {
        for (let x = 0; x < imageData.width; x += 1) {
          if (x >= x0 && x < x0 + width && y >= y0 && y < y0 + height) continue;
          const offset = (y * imageData.width + x) * 4;
          borderPixels += 1;
          if (imageData.data[offset + 3]! > 240) {
            opaquePixels += 1;
            colorBuckets.add(
              (imageData.data[offset]! >> 4) * 256 +
                (imageData.data[offset + 1]! >> 4) * 16 +
                (imageData.data[offset + 2]! >> 4),
            );
          }
        }
      }
      return {
        opaqueFraction: borderPixels === 0 ? 0 : opaquePixels / borderPixels,
        uniqueColorBuckets: colorBuckets.size,
      };
    },
    { resultUrl, sourceWidth, sourceHeight, offsetX, offsetY },
  );
}

test.describe('real photographic Expand workflow', () => {
  test.setTimeout(240_000);

  test('generates, reviews, applies, and retains a bounded expansion', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    const nodeId = await dropPhotoAndSelect(page);
    const before = await readDocument(page);
    await openGenerativeEdit(page);

    const dialog = page.locator('dialog.varve-dialog--caf[open]');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('tab', { name: 'Expand' }).click();
    await expect(dialog.locator('#caf-dialog-prompt')).toBeDisabled();
    await dialog.locator('#caf-expand-aspect-ratio').selectOption('16:9');
    await dialog.locator('#caf-expand-anchor').selectOption('top-left');
    await expect(dialog.getByRole('button', { name: 'Set ratio', exact: true })).toBeEnabled({
      timeout: 15_000,
    });
    await dialog.getByRole('button', { name: 'Set ratio', exact: true }).click();
    await expect(dialog.locator('#caf-expand-right')).toHaveValue('544');
    await expect(dialog.locator('#caf-expand-bottom')).toHaveValue('0');
    await dialog.locator('#caf-expand-top').fill('24');
    await dialog.locator('#caf-expand-right').fill('16');
    await dialog.locator('#caf-expand-bottom').fill('24');
    await dialog.locator('#caf-expand-left').fill('16');

    const generate = dialog.locator('button.varve-btn--secondary').filter({ hasText: /^expand$/i });
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect(dialog.getByRole('button', { name: /^apply$/i })).toBeEnabled({
      timeout: 180_000,
    });

    const evidenceDir = process.env.VARVE_E2E_OUTPUT_DIR
      ? path.resolve(process.env.VARVE_E2E_OUTPUT_DIR)
      : testInfo.outputDir;
    await mkdir(evidenceDir, { recursive: true });
    await dialog.screenshot({
      path: path.join(evidenceDir, 'real-landscape-expand-result.png'),
      animations: 'disabled',
    });

    const preview = dialog.locator('img.caf-dialog__preview-canvas--visible');
    await expect(preview).toBeVisible();
    const previewSize = await preview.evaluate((element) => {
      const image = element as HTMLImageElement;
      return { width: image.naturalWidth, height: image.naturalHeight };
    });
    expect(previewSize.width).toBeGreaterThan(1632);
    expect(previewSize.height).toBeGreaterThan(1224);

    await dialog.getByRole('button', { name: /^apply$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });

    const after = await readDocument(page);
    const record = Object.values(after.generativeEdits ?? {}).find(
      (edit: any) => edit.sourceNodeId === nodeId && edit.mode === 'expand',
    ) as any;
    expect(record).toBeTruthy();
    expect(record.outputFrame).toMatchObject({
      x: -16,
      y: -24,
      width: 1664,
      height: 1272,
      sourceWidth: 1632,
      sourceHeight: 1224,
    });
    expect(record.variations[0].assetKind).toBe('full-output');

    const node = after.nodes[nodeId];
    const image = node.fills.find((fill: any) => fill.type === 'image').image;
    expect(image).toMatchObject({ imageWidth: 1664, imageHeight: 1272 });
    expect(node.shape).toMatchObject({ w: 1664, h: 1272 });
    expect(before.nodes[nodeId].id).toBe(node.id);

    const acceptedVariation = record.variations.find(
      (variation: any) => variation.id === record.acceptedVariationId,
    );
    expect(acceptedVariation).toBeTruthy();
    const sourceAsset = after.assets[record.sourceSnapshotAssetId];
    const resultAsset = after.assets[acceptedVariation.assetId];
    expect(sourceAsset?.dataUrl).toBeTruthy();
    expect(resultAsset?.dataUrl).toBeTruthy();
    const preservedPixels = await page.evaluate(
      async ({ sourceUrl, resultUrl, sourceWidth, sourceHeight, offsetX, offsetY }) => {
        const decode = (url: string): Promise<ImageData> =>
          new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = image.naturalWidth;
              canvas.height = image.naturalHeight;
              const context = canvas.getContext('2d');
              if (!context) {
                reject(new Error('pixel-check canvas is unavailable'));
                return;
              }
              context.drawImage(image, 0, 0);
              resolve(context.getImageData(0, 0, canvas.width, canvas.height));
            };
            image.onerror = () => reject(new Error('pixel-check image decode failed'));
            image.src = url;
          });
        const source = await decode(sourceUrl);
        const result = await decode(resultUrl);
        let mismatched = 0;
        let maxDelta = 0;
        for (let y = 0; y < sourceHeight; y += 1) {
          for (let x = 0; x < sourceWidth; x += 1) {
            const sourceOffset = (y * source.width + x) * 4;
            const resultOffset = ((y + offsetY) * result.width + x + offsetX) * 4;
            for (let channel = 0; channel < 4; channel += 1) {
              const delta = Math.abs(
                source.data[sourceOffset + channel]! - result.data[resultOffset + channel]!,
              );
              maxDelta = Math.max(maxDelta, delta);
              if (delta !== 0) mismatched += 1;
            }
          }
        }
        return { mismatched, maxDelta };
      },
      {
        sourceUrl: sourceAsset.dataUrl,
        resultUrl: resultAsset.dataUrl,
        sourceWidth: 1632,
        sourceHeight: 1224,
        offsetX: 16,
        offsetY: 24,
      },
    );
    expect(preservedPixels).toEqual({ mismatched: 0, maxDelta: 0 });
    const generatedBorder = await inspectGeneratedBorder(
      page,
      resultAsset.dataUrl,
      1632,
      1224,
      16,
      24,
    );
    expect(generatedBorder.opaqueFraction).toBeGreaterThan(0.9);
    expect(generatedBorder.uniqueColorBuckets).toBeGreaterThan(8);

    // Export the reviewed candidate and inspect the file with an independent
    // decoder. This catches the failure mode where the review surface looks
    // correct but export uses stale bounds or a different raster.
    const inspectorTabs = page.getByRole('tablist', { name: 'Inspector tabs' });
    const exportTab = inspectorTabs.getByRole('tab', { name: 'Export', exact: true });
    if (await exportTab.isVisible().catch(() => false)) {
      await exportTab.click();
    } else {
      // Narrow inspector layouts keep lower-priority tabs behind More. Use
      // that same user-visible route instead of assuming Export is always in
      // the tab row after the expansion changes the document bounds.
      const moreTabs = page.getByRole('button', { name: /more inspector tabs/i });
      await expect(moreTabs).toBeVisible();
      await moreTabs.click();
      await page
        .getByRole('menu', { name: 'More inspector tabs' })
        .getByRole('menuitem', { name: 'Export', exact: true })
        .click();
    }
    await page
      .locator('.spec-export__group')
      .first()
      .getByRole('button', { name: 'PNG', exact: true })
      .click();
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const exportedPath = path.join(evidenceDir, 'real-landscape-expand-export.png');
    await download.saveAs(exportedPath);
    const exported = PNG.sync.read(readFileSync(exportedPath));
    const acceptedBytes = Buffer.from(resultAsset.dataUrl.split(',')[1] ?? '', 'base64');
    const accepted = PNG.sync.read(acceptedBytes);
    expect(exported.width).toBe(1664);
    expect(exported.height).toBe(1272);
    expect(accepted.width).toBe(exported.width);
    expect(accepted.height).toBe(exported.height);
    let protectedMaxDelta = 0;
    for (let y = 0; y < 1224; y += 1) {
      for (let x = 0; x < 1632; x += 1) {
        const offset = (y + 24) * exported.width * 4 + (x + 16) * 4;
        const acceptedOffset = (y + 24) * accepted.width * 4 + (x + 16) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          protectedMaxDelta = Math.max(
            protectedMaxDelta,
            Math.abs(exported.data[offset + channel]! - accepted.data[acceptedOffset + channel]!),
          );
        }
      }
    }
    // Both paths are lossless PNG at 1x. A one-code tolerance allows a
    // browser compositor's final colour conversion without hiding a stale or
    // resampled protected region.
    expect(protectedMaxDelta).toBeLessThanOrEqual(1);

    // The accepted expansion is one document transaction. Undo/redo must
    // restore the saved scene data, not rerun the stochastic/model job.
    // The shared history surface labels a fresh transaction "Edit" while
    // the empty-stack state is "Undo"; both are the same toolbar command.
    const undoButton = page.getByRole('button', { name: /^(Undo|Edit)$/ });
    await expect(undoButton).toBeEnabled({ timeout: 15_000 });
    await undoButton.click();
    await expect
      .poll(async () => {
        const document = await readDocument(page);
        const undoneNode = document.nodes[nodeId];
        return {
          width: undoneNode?.shape?.w,
          height: undoneNode?.shape?.h,
          generativeEditId: undoneNode?.generativeEditId ?? null,
        };
      })
      .toEqual({ width: 1632, height: 1224, generativeEditId: null });
    // The shared history control exposes the next action label after Undo
    // (currently the accepted edit name) rather than always saying Redo.
    const redoButton = page.getByRole('button', { name: /^(Redo|Edit)$/ });
    await expect(redoButton).toBeEnabled({ timeout: 15_000 });
    await redoButton.click();
    await expect
      .poll(async () => {
        const document = await readDocument(page);
        const redoneNode = document.nodes[nodeId];
        return {
          width: redoneNode?.shape?.w,
          height: redoneNode?.shape?.h,
          generativeEditId: redoneNode?.generativeEditId ?? null,
        };
      })
      .toEqual({ width: 1664, height: 1272, generativeEditId: expect.any(String) });

    await page.getByRole('tab', { name: 'Adjustments', exact: true }).click();
    const section = page.getByRole('button', { name: 'Generative Edit', exact: true });
    await expect(section).toBeVisible({ timeout: 10_000 });
    if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
    await page.getByRole('button', { name: 'Open Generative Edit dialog' }).click();
    const reopened = page.locator('dialog.varve-dialog--caf[open]');
    await expect(reopened).toBeVisible();
    await expect(reopened.getByRole('tab', { name: 'Expand' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const reopenedPreview = reopened.locator('img.caf-dialog__preview-canvas--visible');
    await expect(reopenedPreview).toBeVisible();
    // The review surface is intentionally capped to a bounded preview raster;
    // assert the accepted output frame through the persisted expansion
    // controls rather than mistaking preview dimensions for source pixels.
    await expect(reopenedPreview).toHaveAttribute('alt', 'Fill result');
    await expect(reopened.getByRole('spinbutton', { name: 'Output width' })).toHaveValue('1664');
    await expect(reopened.getByRole('spinbutton', { name: 'Output height' })).toHaveValue('1272');
    await expect(reopened.getByText(/Output 1696 x 1320 px/)).toHaveCount(0);
    await reopened.getByRole('button', { name: /^cancel$/i }).click();
    await expect(reopened).not.toBeVisible();

    await page.getByRole('button', { name: 'Restore original image' }).click();
    const restored = await readDocument(page);
    expect(restored.nodes[nodeId].shape).toMatchObject({ w: 1632, h: 1224 });
    expect(restored.nodes[nodeId].generativeEditId).toBeFalsy();
    expect(restored.nodes[nodeId].transform).toEqual(before.nodes[nodeId].transform);
  });
});
