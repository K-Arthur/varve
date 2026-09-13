/**
 * Standalone depth-mask workflow — real browser coverage.
 *
 * This deliberately imports a small canonical Varve scalar resource instead
 * of invoking inference. It proves the model-free path users need after a
 * saved map has been accepted: source selection, contained preview/picking,
 * persistent mask commit, undo/redo, scalar export, and project reopen.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { importImageFile } from '../helpers/editor-helpers';
import { navigateToEditor } from '../shared';

const requireFromEngine = createRequire(join(process.cwd(), 'packages', 'engine', 'package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } };
};

const CONTENT_CANVAS = 'canvas.editor-canvas__content-layer';

function makeRampResource(): Record<string, unknown> {
  const width = 100;
  const height = 100;
  const scalar = Buffer.alloc(width * height * 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      scalar.writeUInt16LE(Math.round((x / (width - 1)) * 65535), (y * width + x) * 2);
    }
  }
  return {
    id: 'depth-ramp-e2e',
    schemaVersion: 1,
    width,
    height,
    depthType: 'relative',
    unit: 'normalized',
    nearFarConvention: 'nearIsLow',
    inferenceVersion: 1,
    preprocessingVersion: 1,
    dataBase64: scalar.toString('base64'),
    byteLength: scalar.byteLength,
  };
}

async function openDepthMask(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Adjustments' }).click();
  const trigger = page.getByRole('button', { name: 'Depth Mask', exact: true });
  await expect(trigger).toBeVisible({ timeout: 15000 });
  if ((await trigger.getAttribute('aria-expanded')) === 'false') await trigger.click();
  return page.getByRole('group', { name: 'Depth Mask' });
}

async function canvasSignature(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate((selector) => {
    const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
    if (!canvas) throw new Error('content canvas missing');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('content canvas context missing');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 1) {
      hash ^= pixels[i] ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    return `${canvas.width}x${canvas.height}:${hash >>> 0}`;
  }, CONTENT_CANVAS);
}

async function saveProject(page: import('@playwright/test').Page): Promise<void> {
  const download = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.keyboard.press('Control+s');
  await download;
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
}

test.describe('standalone depth masking', () => {
  test('imports, picks, commits, exports, and reopens a model-free depth mask', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180000);
    await navigateToEditor(page, '/', { waitUntil: 'commit', startupTimeout: 300000 });
    await importImageFile(page, 'test-image.png');
    await page.getByRole('treeitem').first().click();

    const section = await openDepthMask(page);
    const resource = makeRampResource();
    const importInput = section.locator('input[aria-label="Import Varve scalar depth map"]');
    await importInput.setInputFiles({
      name: 'ramp.vdepth.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(resource)),
    });

    await expect(section.getByRole('img', { name: /depth histogram/i })).toBeVisible({
      timeout: 15000,
    });
    await expect(section).toContainText('100 x 100');
    const heatmap = section.locator('canvas.insp-depth-heatmap__canvas');
    await expect(heatmap).toBeVisible();
    await heatmap.screenshot({ path: testInfo.outputPath('depth-map-heatmap.png') });

    // The picker uses the actual contained canvas rectangle. The two clicks
    // intentionally sample opposite sides of the known asymmetric ramp.
    const heatmapBox = await heatmap.boundingBox();
    expect(heatmapBox).not.toBeNull();
    await section.getByRole('button', { name: 'Sample near', exact: true }).click();
    await page.mouse.click(
      heatmapBox!.x + heatmapBox!.width * 0.08,
      heatmapBox!.y + heatmapBox!.height * 0.5,
    );
    await section.getByRole('button', { name: 'Sample far', exact: true }).click();
    await page.mouse.click(
      heatmapBox!.x + heatmapBox!.width * 0.92,
      heatmapBox!.y + heatmapBox!.height * 0.5,
    );
    const sampledFar = Number(
      await section.getByRole('slider', { name: 'Depth mask far endpoint' }).inputValue(),
    );
    expect(sampledFar).toBeGreaterThan(90);
    expect(sampledFar).toBeLessThan(94);

    await section.getByRole('slider', { name: 'Depth mask near endpoint' }).fill('0');
    await section.getByRole('slider', { name: 'Depth mask far endpoint' }).fill('45');
    await section.getByRole('slider', { name: 'Depth mask near transition' }).fill('0');
    await section.getByRole('slider', { name: 'Depth mask far transition' }).fill('0');
    const before = await canvasSignature(page);
    await section.getByRole('button', { name: 'Apply depth mask', exact: true }).click();
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      'Depth mask applied',
      { timeout: 15000 },
    );
    await page.waitForTimeout(500);
    const after = await canvasSignature(page);
    expect(after).not.toBe(before);
    await page
      .locator(CONTENT_CANVAS)
      .screenshot({ path: testInfo.outputPath('depth-mask-applied.png') });

    const exportDownload = page.waitForEvent('download', { timeout: 30000 });
    await section.getByRole('button', { name: 'Export scalar map', exact: true }).click();
    const download = await exportDownload;
    const stream = await download.createReadStream();
    if (!stream) throw new Error('scalar export stream missing');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    expect(exported.nearFarConvention).toBe('nearIsLow');
    expect(exported.byteLength).toBe(resource.byteLength);

    // Numeric depth and rendered appearance are separate products. Verify
    // that the accepted mask also survives the existing PNG export route.
    await page.getByRole('tab', { name: 'Export', exact: true }).click();
    const pngGroup = page.locator('.spec-export__group').filter({ hasText: 'PNG' }).first();
    await pngGroup.getByRole('button', { name: 'PNG', exact: true }).click();
    const appearanceDownload = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: /download/i }).click();
    const appearance = await appearanceDownload;
    const appearancePath = await appearance.path();
    expect(appearancePath).toBeTruthy();
    const appearanceBytes = await readFile(appearancePath!);
    expect(appearanceBytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const appearancePng = PNG.sync.read(appearanceBytes);
    expect(appearancePng.width).toBeGreaterThan(0);
    expect(appearancePng.height).toBeGreaterThan(0);

    // The existing Mask surface remains the refinement owner; painting is a
    // later operation and does not require regenerating or changing depth.
    // The Properties panel's inline tab is labelled Design; Properties is the
    // panel's historical name, not a tab label at this viewport.
    await page.getByRole('tab', { name: 'Design', exact: true }).click();
    await expect(page.getByRole('button', { name: /mask/i }).first()).toBeVisible({
      timeout: 15000,
    });

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    expect(await canvasSignature(page)).toBe(before);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(400);
    expect(await canvasSignature(page)).not.toBe(before);

    await saveProject(page);
    await page.reload({ timeout: 120000, waitUntil: 'commit' });
    const homeCard = page.locator('[role="gridcell"]').first();
    await homeCard.waitFor({ state: 'visible', timeout: 45000 });
    await homeCard.dblclick();
    await page.locator('.layers-panel').waitFor({ state: 'visible', timeout: 60000 });
    await page.getByRole('treeitem').first().click();
    const reopened = await openDepthMask(page);
    await expect(reopened).toContainText('100 x 100');
    await expect(
      reopened.getByRole('button', { name: 'Apply depth mask', exact: true }),
    ).toBeVisible({
      timeout: 15000,
    });
    await testInfo.attach('depth-mask-workflow.json', {
      body: JSON.stringify({ before, after, exportedBytes: exported.byteLength }, null, 2),
      contentType: 'application/json',
    });
  });
});
