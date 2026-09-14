import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createRangeRaster } from '@varve/shared';
import { parseUltraHdrJpeg } from '../../../packages/engine/src/hdr/gainMap';
import { encodeOpenExr } from '../../../packages/engine/src/hdr/openExr';
import { navigateToEditor } from '../shared';

const PHOTO_FIXTURE = path.resolve('tests/e2e/fixtures/photo-fixture.jpg');
const REVIEW_DIR = path.resolve('reports/ui-review/photo-raw-hdr');

function hasMagick(): boolean {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sceneLinearExr(): Uint8Array {
  const width = 64;
  const height = 48;
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const u = x / (width - 1);
      const v = y / (height - 1);
      // A smooth base with a highlight ramp reaching 8x reference white.
      const base = 0.02 + u * 0.35 + v * 0.1;
      const highlight = u > 0.55 ? ((u - 0.55) / 0.45) ** 1.5 : 0;
      pixels[index] = base * 0.85 + highlight * 6;
      pixels[index + 1] = base + highlight * 7;
      pixels[index + 2] = base * 1.15 + highlight * 8;
      pixels[index + 3] = 1;
    }
  }
  const raster = createRangeRaster(
    {
      width,
      height,
      stride: width * 4,
      channelLayout: 'rgba',
      sampleType: 'float32',
      encoding: {
        model: 'rgb',
        primaries: 'srgb',
        transfer: 'linear',
        bitDepth: 'float32',
        alphaMode: 'straight',
        provenance: 'named',
      },
      reference: 'scene-linear',
      referenceWhite: 1,
      alphaMode: 'straight',
      provenance: 'hdr-radiance',
    },
    pixels,
  );
  return encodeOpenExr(raster, { precision: 'float32' });
}

async function dismissRecovery(page: import('@playwright/test').Page): Promise<void> {
  const recovery = page.locator('dialog.recovery-dialog[open]');
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if ((await recovery.count()) > 0) {
      await recovery.locator('.recovery-dialog__close').click({ force: true, timeout: 5000 });
    }
    await page.waitForTimeout(500);
  }
}

test.describe('HDR gain map export', () => {
  test('prepares, verifies, and independently decodes an Ultra HDR JPEG', async ({
    page,
  }, testInfo) => {
    test.skip(!existsSync(PHOTO_FIXTURE), `missing ${PHOTO_FIXTURE}`);
    test.setTimeout(240000);
    mkdirSync(REVIEW_DIR, { recursive: true });
    const exrPath = testInfo.outputPath('scene-linear.exr');
    await writeFile(exrPath, sceneLinearExr());

    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await dismissRecovery(page);
    await page.locator('#file-import-input').setInputFiles(PHOTO_FIXTURE);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('tab', { name: 'Adjustments', exact: true }).click();
    const trigger = inspector.getByRole('button', { name: 'Image Tuning', exact: true });
    await expect(trigger).toBeVisible();
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();

    const hdrSection = page.locator('.photo-source-section').nth(1);
    await hdrSection.locator('input[type="file"][accept=".exr,.EXR"]').setInputFiles(exrPath);
    await expect(hdrSection.getByTestId('hdr-source-status')).toHaveText('Range master', {
      timeout: 60000,
    });
    await expect(hdrSection).toContainText('float32 · scene-linear');
    await hdrSection
      .getByRole('button', { name: 'Apply SDR output transform', exact: true })
      .click();
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      'HDR output transform updated',
    );

    const gainMap = hdrSection.getByTestId('gain-map-export');
    await expect(gainMap).toBeVisible();
    await expect(gainMap).toContainText('The base is never regenerated from the master');
    await gainMap.getByRole('button', { name: 'Prepare gain map JPEG', exact: true }).click();
    const verification = gainMap.getByTestId('gain-map-verification');
    await expect(verification).toBeVisible({ timeout: 90000 });
    const verificationText = await verification.innerText();
    const maxStopsMatch = verificationText.match(/max ([\d.]+) stops/);
    const p95StopsMatch = verificationText.match(/p95 ([\d.]+) stops/);
    expect(maxStopsMatch).not.toBeNull();
    expect(p95StopsMatch).not.toBeNull();
    const maxStops = Number(maxStopsMatch![1]);
    const p95Stops = Number(p95StopsMatch![1]);
    // The 8-bit map bounds quantization to ~0.01 stops; JPEG ringing at the
    // highlight-ramp edge raises the worst sample. p95 is the honest number.
    expect(p95Stops).toBeLessThan(0.05);
    expect(maxStops).toBeLessThan(0.15);
    const deltaMatch = verificationText.match(/JPEG byte delta (\d+)/);
    expect(deltaMatch).not.toBeNull();
    expect(Number(deltaMatch![1])).toBeLessThanOrEqual(24);
    await expect(gainMap).toContainText('headroom');
    await gainMap.scrollIntoViewIfNeeded();
    await page.locator('.editor__inspector-panel').screenshot({
      path: path.join(REVIEW_DIR, '08-gain-map-export.png'),
    });

    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await gainMap.getByRole('link', { name: 'Download Ultra HDR gain map JPEG' }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const bytes = new Uint8Array(await readFile(downloadPath!));
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    const parsed = parseUltraHdrJpeg(bytes);
    expect(parsed.metadataSource).toBe('iso');
    expect(parsed.baseWidth).toBe(64);
    expect(parsed.baseHeight).toBe(48);
    expect(parsed.gainMapWidth).toBe(16);
    expect(parsed.gainMapHeight).toBe(12);
    expect(parsed.metadata).not.toBeNull();
    expect(parsed.containerItems?.map((item) => item.semantic)).toEqual(['Primary', 'GainMap']);

    if (hasMagick()) {
      const savedPath = testInfo.outputPath('varve-ultrahdr.jpg');
      await download.saveAs(savedPath);
      const identify = execFileSync('magick', ['identify', '-format', '%m %wx%h', savedPath], {
        encoding: 'utf8',
      }).trim();
      expect(identify).toBe('JPEG 64x48');
      // The gain map secondary image must decode independently as well.
      const gainPath = testInfo.outputPath('gain-map-secondary.jpg');
      await writeFile(gainPath, parsed.gainMapJpeg!);
      const gainIdentify = execFileSync('magick', ['identify', '-format', '%m %wx%h', gainPath], {
        encoding: 'utf8',
      }).trim();
      expect(gainIdentify).toBe('JPEG 16x12');
    }

    // Changing the output transform without applying must block a rebuild so
    // the exported base can never silently drift from the reviewed rendition.
    const outputExposure = hdrSection.getByRole('slider', { name: 'Output exposure', exact: true });
    await outputExposure.fill('1');
    await expect(
      gainMap.getByRole('button', { name: 'Prepare gain map JPEG', exact: true }),
    ).toBeDisabled();
    await expect(gainMap).toContainText('Apply the SDR output transform first');
    await page.locator('.editor__inspector-panel').screenshot({
      path: path.join(REVIEW_DIR, '09-gain-map-stale-guard.png'),
    });
    await testInfo.attach('gain-map-verification', {
      body: verificationText,
      contentType: 'text/plain',
    });
  });
});
