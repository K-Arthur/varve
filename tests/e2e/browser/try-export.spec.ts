/**
 * Browser demo export acceptance against a built /try artifact.
 *
 * Export correctness cannot be proven by "a file downloaded": the file must
 * contain the rendered content. This spec reads the downloaded bytes back into
 * a browser canvas and measures pixel variation, and it checks the SVG export
 * for the actual shape geometry.
 *
 * Run with the same environment as try-pwa.spec.ts:
 *   VARVE_DEMO_DIST_URL=http://127.0.0.1:1492 \
 *     pnpm exec playwright test tests/e2e/browser/try-export.spec.ts \
 *       --project=chromium --workers=1 --reporter=line
 */
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

const DEMO_DIST_URL = process.env.VARVE_DEMO_DIST_URL?.replace(/\/+$/, '');

async function gotoDemo(page: Page): Promise<void> {
  await page.goto(`${DEMO_DIST_URL}/try/`, { timeout: 120000, waitUntil: 'domcontentloaded' });
  await page.locator('[data-varve-editor-ready="true"]').waitFor({ timeout: 120000 });
}

async function openExportTab(page: Page, nodeName: string): Promise<void> {
  await page.getByRole('treeitem').filter({ hasText: nodeName }).first().click();
  await page.getByRole('tab', { name: 'Export' }).click();
  // The suggested quick format differs by node type; wait for whichever
  // export action is offered before switching formats deliberately.
  await page.getByRole('button', { name: /Download (PNG|SVG|JPEG|WebP)/ }).waitFor({
    timeout: 30000,
  });
}

async function downloadWithFormat(
  page: Page,
  formatLabel: 'PNG' | 'SVG' | 'JPEG' | 'WebP',
  savePath: string,
): Promise<void> {
  await page.getByRole('button', { name: formatLabel, exact: true }).first().click();
  const downloadButton = page.getByRole('button', {
    name: new RegExp(`Download ${formatLabel}`, 'i'),
  });
  await downloadButton.waitFor({ timeout: 30000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await downloadButton.click();
  const download = await downloadPromise;
  await download.saveAs(savePath);
}

interface PixelSpread {
  width: number;
  height: number;
  min: number;
  max: number;
}

/** Decode downloaded image bytes in the page and return the red-channel spread. */
async function decodeRedSpread(
  page: Page,
  bytes: Buffer,
  mime: string,
): Promise<PixelSpread | null> {
  return page.evaluate(
    async ({ base64, type }: { base64: string; type: string }) => {
      // The demo CSP is connect-src 'self' blob:, so a data: fetch is blocked;
      // decode the base64 directly into a Blob instead.
      const binary = atob(base64);
      const decoded = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) decoded[i] = binary.charCodeAt(i);
      const blob = new Blob([decoded], { type });
      const bitmap = await createImageBitmap(blob);
      const width = bitmap.width;
      const height = bitmap.height;
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, width, height).data;
      let min = 255;
      let max = 0;
      for (let i = 0; i < data.length; i += 4) {
        const red = data[i] ?? 0;
        if (red < min) min = red;
        if (red > max) max = red;
      }
      bitmap.close();
      return { width, height, min, max };
    },
    { base64: bytes.toString('base64'), type: mime },
  );
}

test.describe('browser demo export acceptance (built artifact)', () => {
  test.describe.configure({ timeout: 300000 });
  // The Inspector's Export tab requires the full desktop layout; the default
  // Playwright viewport hides the right panel.
  test.use({ viewport: { width: 1440, height: 900 } });
  test.skip(!DEMO_DIST_URL, 'set VARVE_DEMO_DIST_URL to a served production /try build');
  test.skip(({ browserName }) => browserName !== 'chromium', 'canvas decoding: chromium');

  test('SVG export contains the rendered shape geometry', async ({ page }) => {
    await gotoDemo(page);
    await openExportTab(page, 'Sun');

    const svgPath = '/tmp/varve-e2e-export-sun.svg';
    await downloadWithFormat(page, 'SVG', svgPath);
    const svg = readFileSync(svgPath, 'utf8');

    expect(svg).toContain('<svg');
    expect(svg).toContain('<circle');
    expect(svg).toContain('rgba(57,208,198');
    expect(svg).not.toMatch(/<g[^>]*>\s*<\/g>/);
  });

  test('JPEG export of a shape contains real rendered pixels', async ({ page }) => {
    await gotoDemo(page);
    await openExportTab(page, 'Sun');

    const jpegPath = '/tmp/varve-e2e-export-sun.jpg';
    await downloadWithFormat(page, 'JPEG', jpegPath);
    const bytes = readFileSync(jpegPath);
    // JPEG magic bytes: every exported file must be a real encoded image.
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);

    const stats = await decodeRedSpread(page, bytes, 'image/jpeg');
    expect(stats).not.toBeNull();
    expect(stats!.width).toBeGreaterThan(0);
    expect(stats!.height).toBeGreaterThan(0);
    // The teal circle on white: a flat/blank export would have zero spread.
    expect(stats!.max - stats!.min).toBeGreaterThan(20);

    await test.info().attach('export-jpeg-stats.json', {
      body: JSON.stringify(stats, null, 2),
      contentType: 'application/json',
    });
  });

  test('frame export contains the poster content, not an empty artboard', async ({ page }) => {
    await gotoDemo(page);
    await openExportTab(page, 'Poster');

    const pngPath = '/tmp/varve-e2e-export-poster.png';
    await downloadWithFormat(page, 'PNG', pngPath);
    const bytes = readFileSync(pngPath);

    const stats = await decodeRedSpread(page, bytes, 'image/png');
    expect(stats).not.toBeNull();
    // The poster is 1200x800 at 1x; the export must cover the whole frame.
    expect(stats!.width).toBe(1200);
    expect(stats!.height).toBe(800);
    // Teal, pink, gold and ink text over white: a blank frame would be 1.0/1.0.
    expect(stats!.max - stats!.min).toBeGreaterThan(20);

    await test.info().attach('export-frame-stats.json', {
      body: JSON.stringify(stats, null, 2),
      contentType: 'application/json',
    });
  });
});
