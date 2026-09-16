/**
 * Everyday photo-correction journey (independent verification).
 *
 * Required proof for the photo pipeline: import, tone correction, bypass,
 * reset, undo/redo, save/reopen, and a matching export whose pixels carry the
 * committed edit. The spec drives the real Image Tuning controls and the real
 * export dialog; it never seeds document state directly.
 *
 * Independent of the retouch suite: this covers correction only.
 */
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const PHOTO_FIXTURE = path.resolve('tests/e2e/fixtures/photo-fixture.jpg');
const REVIEW_DIR = path.resolve('reports/ui-review/photo-correction');

async function dismissRecovery(page: import('@playwright/test').Page): Promise<void> {
  const recovery = page.locator('dialog.recovery-dialog[open]');
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if ((await recovery.count()) > 0) {
      await recovery.locator('.recovery-dialog__close').click({ force: true, timeout: 5000 });
    }
    await page.waitForTimeout(300);
  }
}

async function importPhoto(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#file-import-input').setInputFiles(PHOTO_FIXTURE);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
  const fitButton = page.getByRole('button', { name: 'Fit selection to viewport' });
  if (await fitButton.isVisible({ timeout: 1000 }).catch(() => false)) await fitButton.click();
  await page.waitForTimeout(500);
}

async function openImageTuning(page: import('@playwright/test').Page): Promise<void> {
  const inspector = page.locator('.editor__inspector-panel');
  await inspector.getByRole('tab', { name: 'Adjustments', exact: true }).click();
  const tuning = inspector.getByRole('button', { name: 'Image Tuning', exact: true });
  await expect(tuning).toBeVisible();
  if ((await tuning.getAttribute('aria-expanded')) !== 'true') await tuning.click();
}

async function authoritativeCanvasPixelHash(
  page: import('@playwright/test').Page,
): Promise<string> {
  await page.evaluate(async () => {
    const perf = (window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } })
      .__varvePerf;
    perf?.forceFullRedraw?.();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  let previous = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.waitForTimeout(attempt === 0 ? 500 : 250);
    const current = await page
      .locator('canvas.editor-canvas__content-layer')
      .evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('content canvas has no 2D context');
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        for (const value of pixels) {
          hash ^= value;
          hash = Math.imul(hash, 16777619);
        }
        return `${pixels.length}:${hash >>> 0}`;
      });
    if (current === previous) return current;
    previous = current;
  }
  return previous;
}

async function selectExportTab(page: import('@playwright/test').Page): Promise<void> {
  const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
    hasText: /^export$/i,
  });
  if (await exportTab.isVisible({ timeout: 1000 }).catch(() => false)) {
    await exportTab.click();
    return;
  }
  await page.getByRole('button', { name: /^More inspector tabs/ }).click();
  await page
    .getByRole('menu', { name: 'More inspector tabs' })
    .getByRole('menuitem', { name: 'Export', exact: true })
    .click();
}

async function exportPngBuffer(page: import('@playwright/test').Page): Promise<Buffer> {
  await selectExportTab(page);
  await page.getByRole('radio', { name: 'PNG', exact: true }).first().click();
  const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
  await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const download = await downloadPromise;
  const target = path.join(REVIEW_DIR, `export-${Date.now()}.png`);
  await download.saveAs(target);
  return readFile(target);
}

async function pngPixelHash(
  page: import('@playwright/test').Page,
  buffer: Buffer,
): Promise<{ width: number; height: number; hash: string }> {
  return page.evaluate(
    async (dataUrl) => {
      const blob = await (await fetch(dataUrl)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('offscreen canvas has no 2D context');
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let hash = 2166136261;
      for (const value of pixels) {
        hash ^= value;
        hash = Math.imul(hash, 16777619);
      }
      return {
        width: bitmap.width,
        height: bitmap.height,
        hash: `${pixels.length}:${hash >>> 0}`,
      };
    },
    `data:image/png;base64,${buffer.toString('base64')}`,
  );
}

async function serializedDocument(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    interface EditorApi {
      serializeDocument: () => string;
    }
    function editorFrom(value: unknown): EditorApi | null {
      if (typeof value !== 'object' || value === null) return null;
      const record = value as Record<string, unknown>;
      const props = record.memoizedProps;
      if (typeof props === 'object' && props !== null) {
        const candidate = (props as Record<string, unknown>).value;
        if (
          typeof candidate === 'object' &&
          candidate !== null &&
          typeof (candidate as Record<string, unknown>).serializeDocument === 'function'
        ) {
          return candidate as unknown as EditorApi;
        }
      }
      return editorFrom(record.child) ?? editorFrom(record.sibling);
    }
    const root = document.getElementById('root');
    if (!root) throw new Error('editor root is missing');
    const fiberKey = Object.keys(root).find(
      (key) => key.startsWith('__reactContainer$') || key.startsWith('__reactFiber$'),
    );
    if (!fiberKey) throw new Error('editor React fiber is missing');
    const editor = editorFrom((root as unknown as Record<string, unknown>)[fiberKey]);
    if (!editor) throw new Error('editor context is missing');
    return editor.serializeDocument();
  });
}

test('everyday photo correction: bypass, reset, undo, save/reopen, matching export', async ({
  page,
}) => {
  test.setTimeout(600000);
  // Fail fast on a missing control instead of consuming the whole test budget.
  page.setDefaultTimeout(45000);
  mkdirSync(REVIEW_DIR, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page, '/?perf=1');
  await dismissRecovery(page);

  const documentName = page.locator('.editor-menubar__doc-name-text');
  await documentName.click();
  const documentNameInput = page.getByRole('textbox', { name: 'Document name', exact: true });
  await documentNameInput.fill('Correction journey fixture');
  await documentNameInput.press('Enter');

  await importPhoto(page);
  await openImageTuning(page);

  const inspector = page.locator('.editor__inspector-panel');
  const exposureControl = inspector.locator(
    '.image-tuning__control[data-image-treatment="exposure"]',
  );
  const exposureValue = exposureControl.getByRole('spinbutton');

  const baseline = await authoritativeCanvasPixelHash(page);
  await page.screenshot({ path: path.join(REVIEW_DIR, '01-baseline.png') });

  // A full stop of exposure is a real tonal edit, not a display tweak.
  await exposureValue.fill('1');
  await exposureValue.press('Enter');
  await expect
    .poll(async () => authoritativeCanvasPixelHash(page), {
      timeout: 20000,
      message: 'exposure should change the rendered photograph',
    })
    .not.toBe(baseline);
  const edited = await authoritativeCanvasPixelHash(page);
  const editedExport = await pngPixelHash(page, await exportPngBuffer(page));
  expect(editedExport.width).toBeGreaterThan(0);
  expect(editedExport.height).toBeGreaterThan(0);
  await page.screenshot({ path: path.join(REVIEW_DIR, '02-exposure-plus-one.png') });
  // Exporting leaves the inspector on the Export tab; reopen the tuner before
  // touching its controls again.
  await openImageTuning(page);

  // Reset returns to the exact baseline, not a near miss.
  await exposureControl.getByRole('button', { name: 'Reset Exposure' }).click();
  await expect
    .poll(async () => authoritativeCanvasPixelHash(page), { timeout: 20000 })
    .toBe(baseline);
  const originalExport = await pngPixelHash(page, await exportPngBuffer(page));
  expect(originalExport.hash).not.toBe(editedExport.hash);
  expect(originalExport.width).toBe(editedExport.width);
  expect(originalExport.height).toBe(editedExport.height);
  await openImageTuning(page);

  // Edit, undo, redo: the correction is one history entry. The global undo
  // shortcut deliberately ignores events from typing widgets, so focus has to
  // leave the numeric field first.
  await exposureValue.fill('1');
  await exposureValue.press('Enter');
  await expect
    .poll(async () => authoritativeCanvasPixelHash(page), { timeout: 20000 })
    .toBe(edited);
  await exposureValue.blur();
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => authoritativeCanvasPixelHash(page), { timeout: 20000 })
    .toBe(baseline);
  await page.keyboard.press('Control+Shift+z');
  await expect
    .poll(async () => authoritativeCanvasPixelHash(page), { timeout: 20000 })
    .toBe(edited);

  // Bypass keeps the value but removes the result; re-enabling restores it.
  await exposureControl.getByRole('button', { name: 'Disable Exposure' }).click();
  await expect
    .poll(async () => authoritativeCanvasPixelHash(page), { timeout: 20000 })
    .toBe(baseline);
  await exposureControl.getByRole('button', { name: 'Enable Exposure' }).click();
  await expect
    .poll(async () => authoritativeCanvasPixelHash(page), { timeout: 20000 })
    .toBe(edited);
  await page.screenshot({ path: path.join(REVIEW_DIR, '03-bypass-restored.png') });

  // Save, reload, reopen: the persisted edit must still export identically.
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 60000 });
  const savedDocument = await serializedDocument(page);
  expect(savedDocument).toContain('"kind":"exposure"');
  expect(savedDocument).toContain('"value":1');

  await page.reload({ timeout: 180000, waitUntil: 'commit' });
  await dismissRecovery(page);
  await page.locator('.varve-home').waitFor({ timeout: 45000 });
  const savedCard = page.getByRole('gridcell', { name: /Correction journey fixture/ });
  await expect(savedCard).toBeVisible({ timeout: 30000 });
  await savedCard.dblclick({ timeout: 30000 });
  await page.locator('.layers-panel').waitFor({ timeout: 60000 });
  await dismissRecovery(page);
  // Export is selection-scoped; a reopened document starts with nothing
  // selected, so select the image layer first.
  await page.locator('.layers-panel__tree [role="treeitem"]').first().click();
  await page.screenshot({ path: path.join(REVIEW_DIR, '04-reopened.png') });
  const reopenedExport = await pngPixelHash(page, await exportPngBuffer(page));
  expect(reopenedExport.hash).toBe(editedExport.hash);
  expect(reopenedExport.width).toBe(editedExport.width);
  expect(reopenedExport.height).toBe(editedExport.height);
  const reopenedDocument = await serializedDocument(page);
  expect(reopenedDocument).toContain('"kind":"exposure"');
});
