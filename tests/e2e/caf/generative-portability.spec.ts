/**
 * Real-photo portability evidence for an accepted generative edit.
 *
 * This deliberately uses the browser's real Quick Cleanup provider rather
 * than a seeded candidate. It verifies the persisted source/mask/candidate
 * closure through save/reopen and through the actual clipboard command path.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor, switchWorkspace } from '../shared';

const PHOTO_PATH = path.resolve(__dirname, '..', 'fixtures', 'real-life-landscape.jpg');

async function selectInspectorTab(page: import('@playwright/test').Page, label: string) {
  const tab = page.getByRole('tab', { name: label, exact: true });
  if (await tab.isVisible()) {
    await tab.click();
    return;
  }

  await page.getByRole('button', { name: /^More inspector tabs/ }).click();
  await page
    .getByRole('menu', { name: 'More inspector tabs' })
    .getByRole('menuitem', { name: label, exact: true })
    .click();
}

async function readEditorDocument(page: import('@playwright/test').Page): Promise<any> {
  return page.evaluate(() => {
    const root = document.querySelector('#root > *') as any;
    if (!root) throw new Error('editor root not found');
    const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) throw new Error('editor fiber not found');
    const seen = new Set<any>();
    let documentState: any = null;
    (function walk(fiber: any): void {
      if (!fiber || seen.has(fiber) || documentState) return;
      seen.add(fiber);
      let hook = fiber.memoizedState;
      while (hook) {
        if (hook.queue) {
          const candidate = hook.queue.lastRenderedState;
          if (candidate?.document?.nodes) {
            documentState = candidate.document;
            return;
          }
        }
        hook = hook.next;
      }
      for (const child of [fiber.child, fiber.sibling]) walk(child);
    })(root[fiberKey]);
    if (!documentState) throw new Error('editor document state not found');
    return documentState;
  });
}

async function inspectRegionOverlay(
  page: import('@playwright/test').Page,
  sourceUrl: string,
  overlayUrl: string,
  frame: { x: number; y: number; width: number; height: number },
  sourceWidth: number,
  sourceHeight: number,
): Promise<{ nonTransparentPixels: number; changedPixels: number; uniqueColorBuckets: number }> {
  return page.evaluate(
    async ({ sourceUrl, overlayUrl, frame, sourceWidth, sourceHeight }) => {
      const decode = (url: string): Promise<ImageData> =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            if (!context) {
              reject(new Error('region-overlay check canvas is unavailable'));
              return;
            }
            context.drawImage(image, 0, 0);
            resolve(context.getImageData(0, 0, canvas.width, canvas.height));
          };
          image.onerror = () => reject(new Error('region-overlay image decode failed'));
          image.src = url;
        });
      const source = await decode(sourceUrl);
      const overlay = await decode(overlayUrl);
      if (overlay.width !== frame.width || overlay.height !== frame.height) {
        throw new Error(
          `Overlay dimensions ${overlay.width}x${overlay.height} do not match its ${frame.width}x${frame.height} frame`,
        );
      }
      let nonTransparentPixels = 0;
      let changedPixels = 0;
      const colors = new Set<number>();
      for (let y = 0; y < overlay.height; y += 1) {
        for (let x = 0; x < overlay.width; x += 1) {
          const overlayOffset = (y * overlay.width + x) * 4;
          if (overlay.data[overlayOffset + 3]! <= 8) continue;
          nonTransparentPixels += 1;
          colors.add(
            (overlay.data[overlayOffset]! >> 4) * 256 +
              (overlay.data[overlayOffset + 1]! >> 4) * 16 +
              (overlay.data[overlayOffset + 2]! >> 4),
          );
          const sourceX = frame.x + x;
          const sourceY = frame.y + y;
          if (
            sourceX < 0 ||
            sourceY < 0 ||
            sourceX >= sourceWidth ||
            sourceY >= sourceHeight ||
            sourceX >= source.width ||
            sourceY >= source.height
          ) {
            continue;
          }
          const sourceOffset = (sourceY * source.width + sourceX) * 4;
          const delta =
            Math.abs(overlay.data[overlayOffset]! - source.data[sourceOffset]!) +
            Math.abs(overlay.data[overlayOffset + 1]! - source.data[sourceOffset + 1]!) +
            Math.abs(overlay.data[overlayOffset + 2]! - source.data[sourceOffset + 2]!);
          if (delta >= 12) changedPixels += 1;
        }
      }
      return { nonTransparentPixels, changedPixels, uniqueColorBuckets: colors.size };
    },
    { sourceUrl, overlayUrl, frame, sourceWidth, sourceHeight },
  );
}

async function triggerCafDialog(
  page: import('@playwright/test').Page,
  nodeId: string,
): Promise<void> {
  await page.evaluate((targetId) => {
    const root = document.querySelector('#root > *') as any;
    if (!root) throw new Error('editor root not found');
    const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) throw new Error('editor fiber not found');
    const seen = new Set<any>();
    let dispatched = false;
    (function walk(fiber: any): void {
      if (!fiber || seen.has(fiber) || dispatched) return;
      seen.add(fiber);
      let hook = fiber.memoizedState;
      while (hook) {
        if (hook.queue) {
          const candidate = hook.queue.lastRenderedState;
          if (candidate?.document?.nodes) {
            hook.queue.dispatch((previous: any) => ({ ...previous, cafDialogNodeId: targetId }));
            dispatched = true;
            return;
          }
        }
        hook = hook.next;
      }
      for (const child of [fiber.child, fiber.sibling]) walk(child);
    })(root[fiberKey]);
    if (!dispatched) throw new Error('editor state dispatch was not found');
  }, nodeId);
  await page
    .locator('dialog.varve-dialog--caf[open]')
    .waitFor({ state: 'visible', timeout: 10_000 });
}

async function dropPhotoAndFindNode(page: import('@playwright/test').Page): Promise<string> {
  const encoded = readFileSync(PHOTO_PATH).toString('base64');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('content canvas is not visible');
  const before = await page.getByRole('treeitem').count();

  await page.evaluate(
    ({ x, y, encoded }) => {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'real-life-landscape.jpg', { type: 'image/jpeg' }));
      const target = document.querySelector('canvas.editor-canvas__content-layer');
      if (!target) throw new Error('content canvas is missing');
      for (const type of ['dragover', 'drop'] as const) {
        target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: transfer,
          }),
        );
      }
    },
    { x: box.x + 220, y: box.y + 180, encoded },
  );

  await expect
    .poll(() => page.getByRole('treeitem').count(), { timeout: 60_000 })
    .toBeGreaterThan(before);

  const nodeId = await page.evaluate(() => {
    const root = document.querySelector('#root > *') as any;
    const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) throw new Error('editor fiber not found');
    const seen = new Set<any>();
    let imageId: string | null = null;
    (function walk(fiber: any): void {
      if (!fiber || seen.has(fiber) || imageId) return;
      seen.add(fiber);
      let hook = fiber.memoizedState;
      while (hook) {
        if (hook.queue) {
          const candidate = hook.queue.lastRenderedState;
          if (candidate?.document?.nodes) {
            for (const id of Object.keys(candidate.document.nodes).reverse()) {
              const node = candidate.document.nodes[id];
              if (
                node?.kind === 'shape' &&
                node.fills?.some((fill: any) => fill.type === 'image')
              ) {
                imageId = id;
                return;
              }
            }
          }
        }
        hook = hook.next;
      }
      for (const child of [fiber.child, fiber.sibling]) walk(child);
    })(root[fiberKey]);
    return imageId;
  });
  if (!nodeId) throw new Error('image node was not created');
  await page.mouse.click(box.x + 240, box.y + 200);
  return nodeId;
}

async function paintMask(page: import('@playwright/test').Page): Promise<void> {
  const mask = page.locator('canvas.caf-dialog__mask-canvas');
  await mask.waitFor({ state: 'visible', timeout: 10_000 });
  const box = await mask.boundingBox();
  if (!box) throw new Error('CAF mask canvas is not visible');
  const y = box.y + box.height * 0.5;
  await page.mouse.move(box.x + box.width * 0.34, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.66, y);
  await page.mouse.up();
}

async function dismissRecoveryDialog(page: import('@playwright/test').Page): Promise<void> {
  const continueNormalStartup = page.getByRole('button', { name: /continue normal startup/i });
  if (await continueNormalStartup.isVisible({ timeout: 1500 }).catch(() => false)) {
    await continueNormalStartup.click({ timeout: 5000 });
    await page.locator('.safe-mode-screen').waitFor({ state: 'hidden', timeout: 10_000 });
    await page.waitForTimeout(250);
  }
  const dialog = page.locator('dialog.crash-dialog[open]').first();
  if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
    await dialog
      .getByRole('button', { name: /review my documents|close/i })
      .first()
      .click();
  }
}

async function readPersistedGenerativeSummary(
  page: import('@playwright/test').Page,
  nodeId: string,
): Promise<{
  found: boolean;
  generativeEditIds: string[];
  rasterMaskAssetIds: string[];
  nodeMaskIds: string[];
}> {
  return page.evaluate(async (targetNodeId) => {
    const request = indexedDB.open('varve-home');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const storeNames = Array.from(database.objectStoreNames);
    if (!storeNames.includes('fileContent')) {
      database.close();
      return { found: false, generativeEditIds: [], rasterMaskAssetIds: [], nodeMaskIds: [] };
    }
    const transaction = database.transaction('fileContent', 'readonly');
    const records = await new Promise<Array<{ json?: string }>>((resolve, reject) => {
      const getAll = transaction.objectStore('fileContent').getAll();
      getAll.onsuccess = () => resolve(getAll.result as Array<{ json?: string }>);
      getAll.onerror = () => reject(getAll.error);
    });
    database.close();
    for (const record of records) {
      if (!record.json) continue;
      try {
        const document = JSON.parse(record.json) as any;
        if (!document.nodes?.[targetNodeId]?.generativeEditId) continue;
        return {
          found: true,
          generativeEditIds: Object.keys(document.generativeEdits ?? {}),
          rasterMaskAssetIds: Object.keys(document.rasterMaskAssets ?? {}),
          nodeMaskIds: Object.values(document.nodes)
            .map((node: any) => node.mask?.rasterMask?.assetId)
            .filter(Boolean),
        };
      } catch {
        // Ignore unrelated content records.
      }
    }
    return { found: false, generativeEditIds: [], rasterMaskAssetIds: [], nodeMaskIds: [] };
  }, nodeId);
}

test.describe('accepted generative edit portability', () => {
  test.setTimeout(180_000);

  test('real-photo result survives save/reopen and clipboard copy/paste', async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are available in Chromium tests');

    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        writable: true,
        value: undefined,
      });
    });
    await navigateToEditor(page);

    const nodeId = await dropPhotoAndFindNode(page);
    await triggerCafDialog(page, nodeId);
    const dialog = page.locator('dialog.varve-dialog--caf[open]');
    await paintMask(page);
    await dialog.getByRole('button', { name: /remove && fill/i }).click();
    await expect(dialog.getByRole('button', { name: /^apply$/i })).toBeEnabled({ timeout: 30_000 });
    await dialog.screenshot({
      path: testInfo.outputPath('real-photo-before-save.png'),
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: /^apply$/i }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });

    const applied = await readEditorDocument(page);
    const appliedNode = applied.nodes[nodeId];
    const appliedEdit = applied.generativeEdits?.[appliedNode.generativeEditId];
    expect(appliedEdit?.provider.id).toBe('varve-quick-cleanup');
    expect(appliedEdit?.acceptedVariationId).toBe(appliedEdit?.variations[0]?.id);
    expect(applied.assets?.[appliedEdit.sourceSnapshotAssetId]).toBeTruthy();
    expect(applied.rasterMaskAssets?.[appliedEdit.masks.userMaskAssetId]).toBeTruthy();
    expect(applied.assets?.[appliedEdit.variations[0].assetId]).toBeTruthy();
    const sourceAsset = applied.assets?.[appliedEdit.sourceSnapshotAssetId];
    const variation = appliedEdit.variations[0];
    const overlayAsset = applied.assets?.[variation.assetId];
    expect(sourceAsset?.dataUrl).toBeTruthy();
    expect(overlayAsset?.dataUrl).toBeTruthy();
    expect(variation.assetKind).toBe('region-overlay');
    const overlayStats = await inspectRegionOverlay(
      page,
      sourceAsset.dataUrl,
      overlayAsset.dataUrl,
      variation.outputFrame,
      sourceAsset.naturalWidth,
      sourceAsset.naturalHeight,
    );
    expect(overlayStats.nonTransparentPixels).toBeGreaterThan(100);
    expect(overlayStats.changedPixels).toBeGreaterThan(100);
    expect(overlayStats.uniqueColorBuckets).toBeGreaterThan(8);

    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30_000 });
    const persisted = await readPersistedGenerativeSummary(page, nodeId);
    await testInfo.attach('persisted-generative-summary.json', {
      body: JSON.stringify(persisted, null, 2),
      contentType: 'application/json',
    });
    expect(persisted.found).toBe(true);
    expect(
      persisted.rasterMaskAssetIds,
      `Persisted document summary: ${JSON.stringify(persisted)}`,
    ).toEqual(
      expect.arrayContaining([
        appliedEdit.masks.userMaskAssetId,
        appliedEdit.masks.inferenceMaskAssetId,
        appliedEdit.masks.compositeMaskAssetId,
      ]),
    );
    await page.reload({ timeout: 120_000 });
    await dismissRecoveryDialog(page);
    await page.locator('.varve-home').waitFor({ state: 'visible', timeout: 45_000 });
    await page.locator('[role="gridcell"]').first().dblclick();
    await page.locator('.layers-panel').waitFor({ state: 'visible', timeout: 60_000 });

    const reopened = await readEditorDocument(page);
    const reopenedNode = reopened.nodes[nodeId];
    expect(reopenedNode?.generativeEditId).toBeTruthy();
    const reopenedEdit = reopened.generativeEdits?.[reopenedNode.generativeEditId];
    expect(reopenedEdit?.provider.id).toBe('varve-quick-cleanup');
    expect(reopenedEdit?.acceptedVariationId).toBe(reopenedEdit?.variations[0]?.id);
    expect(reopened.assets?.[reopenedEdit.sourceSnapshotAssetId]).toBeTruthy();
    expect(reopened.rasterMaskAssets?.[reopenedEdit.masks.userMaskAssetId]).toBeTruthy();
    expect(reopened.rasterMaskAssets?.[reopenedEdit.masks.inferenceMaskAssetId]).toBeTruthy();
    expect(reopened.rasterMaskAssets?.[reopenedEdit.masks.compositeMaskAssetId]).toBeTruthy();
    expect(reopened.assets?.[reopenedEdit.variations[0].assetId]).toBeTruthy();

    await page.getByRole('button', { name: 'Fit all to viewport' }).click();
    await page.waitForTimeout(250);
    await page.screenshot({
      path: testInfo.outputPath('real-photo-after-reopen.png'),
      animations: 'disabled',
    });

    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(/Copied 1 layer/i, {
      timeout: 15_000,
    });
    await page.keyboard.press('ControlOrMeta+v');
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 15_000 });

    const pasted = await readEditorDocument(page);
    const imageNodes = Object.values(pasted.nodes).filter(
      (candidate: any) =>
        candidate?.kind === 'shape' && candidate.fills?.some((fill: any) => fill.type === 'image'),
    ) as Array<{ id: string; generativeEditId?: string }>;
    expect(imageNodes).toHaveLength(2);
    const pastedEdits = imageNodes
      .map((candidate) =>
        candidate.generativeEditId
          ? pasted.generativeEdits?.[candidate.generativeEditId]
          : undefined,
      )
      .filter(Boolean);
    expect(pastedEdits).toHaveLength(2);
    expect(new Set(pastedEdits.map((edit: any) => edit.id)).size).toBe(2);
    for (const edit of pastedEdits as any[]) {
      expect(pasted.assets?.[edit.sourceSnapshotAssetId]).toBeTruthy();
      expect(pasted.rasterMaskAssets?.[edit.masks.userMaskAssetId]).toBeTruthy();
      expect(pasted.assets?.[edit.variations[0].assetId]).toBeTruthy();
    }

    // Export the accepted composition through the user-facing Export tab
    // before restoring it. This proves the result is not only present in the
    // serialized record but also consumable by the normal raster exporter.
    await page.locator(`.layers-row[data-node-id="${nodeId}"]`).click();
    await selectInspectorTab(page, 'Export');
    await page.getByRole('radio', { name: 'PNG', exact: true }).first().click();
    const exportDownloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
    const exportDownload = await exportDownloadPromise;
    const exportPath = await exportDownload.path();
    expect(exportPath).toBeTruthy();
    const exportedPng = readFileSync(exportPath as string);
    expect(exportedPng.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await page.screenshot({
      path: testInfo.outputPath('real-photo-exported.png'),
      animations: 'disabled',
    });

    // Restore through the Inspector command, then use the normal history
    // path to put the accepted edit back. The source asset must remain the
    // same immutable snapshot in both states.
    await switchWorkspace(page, 'Photo');
    await selectInspectorTab(page, 'Adjustments');
    const generativeSection = page.getByRole('button', {
      name: 'Generative Edit',
      exact: true,
    });
    await expect(generativeSection).toBeVisible({ timeout: 15_000 });
    if ((await generativeSection.getAttribute('aria-expanded')) !== 'true') {
      await generativeSection.click();
    }
    const restoreButton = page.getByRole('button', { name: 'Restore original image', exact: true });
    await expect(restoreButton).toBeVisible();
    await restoreButton.click();
    await expect
      .poll(async () => {
        const restored = await readEditorDocument(page);
        const restoredNode = restored.nodes[nodeId];
        return {
          editId: restoredNode?.generativeEditId ?? null,
          imageAssetId: restoredNode?.fills?.find((fill: any) => fill.type === 'image')?.image
            ?.assetId,
        };
      })
      .toEqual({ editId: null, imageAssetId: reopenedEdit.sourceSnapshotAssetId });
    await page.screenshot({
      path: testInfo.outputPath('real-photo-restored.png'),
      animations: 'disabled',
    });

    await page.keyboard.press('ControlOrMeta+z');
    await expect
      .poll(async () => (await readEditorDocument(page)).nodes[nodeId]?.generativeEditId ?? null)
      .toBe(reopenedEdit.id);
    await page.screenshot({
      path: testInfo.outputPath('real-photo-restored-undone.png'),
      animations: 'disabled',
    });

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect
      .poll(async () => (await readEditorDocument(page)).nodes[nodeId]?.generativeEditId ?? null)
      .toBeNull();
  });
});
