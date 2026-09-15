/**
 * Face-aware crop ("Protect Faces") workflow E2E — real implementation.
 *
 * The YuNet face-detection model (opencv/face_detection_yunet 2023mar, MIT,
 * 233 KB) is bundled with the app at apps/desktop/public/models/, so this spec
 * runs the real pipeline end to end: the real inference worker executes the
 * real ONNX graph through onnxruntime-web, the editor decodes the stride-8/16/32
 * tensors, the crop solver repositions the crop onto the detected face, and
 * commitSourceImageCrop persists it as ImageFillData.crop.
 *
 * Face-aware crop stores a source-pixel crop while preserving the node's
 * on-canvas aspect ratio. The crop-mode window can therefore still fill the
 * frame after the operation; this spec verifies the committed source crop in
 * the inspector instead of treating the local window size as the signal.
 */

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/** Generate a no-face fixture deterministically (real model must find nothing). */
async function writeNoFaceFixture(page: import('@playwright/test').Page): Promise<string> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 200;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 0, 200, 200);
    return c.toDataURL('image/png');
  });
  const tmpFile = path.join('/tmp', `no-face-${Date.now()}.png`);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(tmpFile, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
  return tmpFile;
}

/** Import a fixture image, select it, and resize to a square. */
async function importAndSelectSquare(page: import('@playwright/test').Page, fixture: string) {
  await page.locator('#file-import-input').setInputFiles(path.resolve(fixture));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  await page.getByRole('treeitem').click();

  // Unlock the proportion link (image nodes default locked) and make the node
  // square so the face-aware solver has to choose a square source crop.
  const lock = page.locator('label.insp-proportion-lock');
  if (await lock.isVisible().catch(() => false)) {
    const locked = await lock.evaluate((el) => {
      const input = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      return input?.checked ?? false;
    });
    if (locked) await lock.click();
  }
  const w = page.getByRole('spinbutton', { name: 'W (px)' });
  await w.fill('300');
  await w.press('Enter');
  const h = page.getByRole('spinbutton', { name: 'H (px)' });
  await h.fill('300');
  await h.press('Enter');
  await page.waitForTimeout(200);
}

/** Enter crop mode via the selection quick bar (avoids canvas-keyboard focus). */
async function enterCropMode(page: import('@playwright/test').Page) {
  const quickBar = page.getByRole('toolbar', { name: 'Selection actions' });
  const cropButton = quickBar.getByRole('button', { name: /^crop$/i });
  await cropButton.click();
  await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });
}

async function openProtectFacesControls(page: import('@playwright/test').Page) {
  await enterCropMode(page);
  await page.getByRole('button', { name: 'Tool options' }).click();
  const trigger = page.getByRole('button', { name: 'Protect Faces', exact: true });
  await expect(trigger).toBeVisible({ timeout: 5000 });
  if ((await trigger.getAttribute('aria-expanded')) === 'false') {
    await trigger.click();
  }
  const action = page.getByRole('button', {
    name: /detect faces and reposition the crop to keep them in frame/i,
  });
  await expect(action).toBeVisible({ timeout: 5000 });
  return action;
}

/**
 * Analyze faces, wait for the reviewed result, then apply it. Analysis alone
 * must never change the document: the review step is where the crop commits.
 */
async function analyzeAndApplyProtectFaces(page: import('@playwright/test').Page) {
  const analyze = await openProtectFacesControls(page);
  await analyze.click();
  const apply = page.getByRole('button', { name: /apply crop/i });
  await expect(apply).toBeVisible({ timeout: 120000 });
  await apply.click();
}

test.describe('Face-aware crop — Protect Faces', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('runs real YuNet inference and commits a source crop', async ({ page }) => {
    test.setTimeout(240000);
    await importAndSelectSquare(page, 'tests/fixtures/bg-removal-corpus/human.jpg');

    // Trigger the face-aware crop through the tool options popover: analyze,
    // review, then apply.
    await analyzeAndApplyProtectFaces(page);

    // No error alert (a face was detected and a crop was committed).
    const errorAlert = page.locator('.insp-hint--error[role="alert"]');
    await expect(errorAlert).toHaveCount(0, { timeout: 30000 });

    // The source crop is visible in the image-fill inspector after leaving
    // crop mode. Its dimensions prove that the operation committed a
    // non-trivial source crop even though the frame itself remains square.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const cropDims = page.locator('.insp-image-fill__crop-dims');
    await expect(cropDims).toBeVisible({ timeout: 5000 });
    await expect(cropDims).toHaveText(/320x3\d\d px/);
  });

  test('shows "No faces detected" when the real model finds no faces', async ({ page }) => {
    test.setTimeout(240000);
    const noFaceFixture = await writeNoFaceFixture(page);
    try {
      await importAndSelectSquare(page, noFaceFixture);

      const action = await openProtectFacesControls(page);
      await action.click();

      const errorAlert = page.locator('.insp-hint--error[role="alert"]');
      await expect(errorAlert).toBeVisible({ timeout: 30000 });
      await expect(errorAlert).toContainText(/no faces detected/i);
    } finally {
      const { unlinkSync } = await import('node:fs');
      try {
        unlinkSync(noFaceFixture);
      } catch {
        // already gone
      }
    }
  });

  /**
   * The checked-in facade photograph has three faces 11-15 px wide. A single
   * whole-image letterbox into the model's fixed 640 input loses all three
   * (upstream OpenCV agrees: 0 detections on the same letterboxed pixels), so
   * this is the case the bounded native-scale window tier exists for. Before
   * that tier the UI reported "No faces detected" here.
   */
  test('recovers small faces on a large image via the native-scale window tier', async ({
    page,
  }) => {
    test.setTimeout(300000);
    await importAndSelectSquare(page, 'tests/e2e/fixtures/real-life-smithsonian.jpg');

    // Large imports are centred on the canvas and keep their top-left when
    // resized, which can leave the node (and its selection quick bar) outside
    // the visible viewport. Fit the selection so the quick bar is reachable.
    await page.getByRole('button', { name: 'Fit selection to viewport' }).click();
    await page.waitForTimeout(300);

    await analyzeAndApplyProtectFaces(page);

    const errorAlert = page.locator('.insp-hint--error[role="alert"]');
    await expect(errorAlert).toHaveCount(0, { timeout: 120000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const cropDims = page.locator('.insp-image-fill__crop-dims');
    await expect(cropDims).toBeVisible({ timeout: 5000 });
  });
});
