import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Cross-surface fidelity: the same slide must be identical in the audience
 * preview and in the delivered file, and the preview must show the whole slide
 * rather than cropping its edges.
 *
 * The point is not that a screenshot exists. It is that the preview raster and
 * the exported raster decode to the same pixels, that the slide keeps its
 * declared dimensions all the way to the output file, and that the preview's
 * laid-out box stays inside its container.
 */

/** Minimal PNG reader: 8-bit RGB/RGBA, no interlace (what canvas.toBlob emits). */
function decodePng(bytes: Uint8Array): { width: number; height: number; pixels: Buffer } {
  const buffer = Buffer.from(bytes);
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += 12 + length;
  }
  expect(bitDepth, 'expected 8-bit output from the capture path').toBe(8);
  // Canvas and the archive writer may emit RGB or RGBA; compare the colour
  // channels only, so encoder alpha handling cannot mask a real difference.
  expect([2, 6]).toContain(colorType);
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const decoded = Buffer.alloc(height * stride);
  let previous = Buffer.alloc(stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor]!;
    cursor += 1;
    const line = Buffer.from(raw.subarray(cursor, cursor + stride));
    cursor += stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels]! : 0;
      const b = previous[x]!;
      const c = x >= channels ? previous[x - channels]! : 0;
      switch (filter) {
        case 1:
          line[x] = (line[x]! + a) & 0xff;
          break;
        case 2:
          line[x] = (line[x]! + b) & 0xff;
          break;
        case 3:
          line[x] = (line[x]! + ((a + b) >> 1)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          line[x] = (line[x]! + predictor) & 0xff;
          break;
        }
        default:
          break;
      }
    }
    line.copy(decoded, y * stride);
    previous = line;
  }
  const pixels = channels === 3 ? decoded : Buffer.alloc(width * height * 3);
  if (channels === 4) {
    for (let i = 0, o = 0; i < decoded.length; i += 4, o += 3) {
      pixels[o] = decoded[i]!;
      pixels[o + 1] = decoded[i + 1]!;
      pixels[o + 2] = decoded[i + 2]!;
    }
  }
  return { width, height, pixels };
}

function pixelDigest(pixels: Buffer): string {
  return createHash('sha256').update(pixels).digest('hex');
}

declare global {
  interface Window {
    __varvePresentationSaves?: Array<{ name: string; bytes: number[] }>;
  }
}

test.describe('presentation cross-surface fidelity', () => {
  test('preview raster, thumbnail and delivered PNG agree on the same slide', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('varve:crash-loop');
      window.__varvePresentationSaves = [];
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async ({ suggestedName }: { suggestedName?: string }) => ({
          name: suggestedName ?? 'presentation.bin',
          createWritable: async () => ({
            write: async (data: Uint8Array) => {
              window.__varvePresentationSaves?.push({
                name: suggestedName ?? 'presentation.bin',
                bytes: Array.from(data),
              });
            },
            close: async () => {},
          }),
        }),
      });
    });
    await navigateToEditor(page);
    await page.setInputFiles(
      '#file-open-input',
      resolve(process.cwd(), 'scripts/screenshots/fixtures/presentation.varve'),
    );
    await expect(page.locator('.editor-shell h1.sr-only')).toContainText('presentation.varve', {
      timeout: 30000,
    });
    await page.getByRole('tab', { name: 'Slides' }).click();

    // The navigator thumbnail is the third surface showing the same slide.
    const thumbnail = page.locator('.presentation-navigator__thumbnail img').first();
    await expect(thumbnail).toBeVisible({ timeout: 30000 });
    const thumbnailBox = await thumbnail.evaluate((element) => {
      const image = element as HTMLImageElement;
      return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
    });

    await page.getByRole('button', { name: 'Present', exact: true }).click();
    const audience = page.getByRole('dialog', { name: /audience preview/ });
    const slideImage = audience.locator('.presentation-audience__image');
    await expect(slideImage).toBeVisible({ timeout: 30000 });

    const preview = await slideImage.evaluate(async (element) => {
      const image = element as HTMLImageElement;
      const stage = image.closest('.presentation-audience__stage') as HTMLElement | null;
      const stageRect = (stage ?? image.parentElement!).getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      const stageStyle = getComputedStyle(stage ?? image.parentElement!);
      const inset = {
        top: Number.parseFloat(stageStyle.paddingTop) || 0,
        left: Number.parseFloat(stageStyle.paddingLeft) || 0,
      };
      const response = await fetch(image.src);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        bytes: Array.from(bytes),
        // The slide must fit the stage's content box, not be cropped by it.
        container: {
          top: stageRect.top + inset.top,
          left: stageRect.left + inset.left,
          right: stageRect.right - inset.left,
          bottom: stageRect.bottom - inset.top,
        },
        rect: {
          top: imageRect.top,
          left: imageRect.left,
          right: imageRect.right,
          bottom: imageRect.bottom,
        },
      };
    });

    expect(preview.naturalWidth).toBe(1280);
    expect(preview.naturalHeight).toBe(720);
    // The navigator thumbnail is a deliberately smaller raster, but it must
    // describe the same slide geometry as preview and delivery. Integer raster
    // rounding is expected (a 230px-wide thumbnail cannot be 129.375px tall).
    expect(Math.abs(thumbnailBox.naturalWidth / thumbnailBox.naturalHeight - 16 / 9)).toBeLessThan(
      0.02,
    );

    const tolerance = 1.5;
    expect(preview.rect.top).toBeGreaterThanOrEqual(preview.container.top - tolerance);
    expect(preview.rect.left).toBeGreaterThanOrEqual(preview.container.left - tolerance);
    expect(preview.rect.right).toBeLessThanOrEqual(preview.container.right + tolerance);
    expect(preview.rect.bottom).toBeLessThanOrEqual(preview.container.bottom + tolerance);
    // Containment must not be achieved by shrinking one axis independently.
    const renderedAspect =
      (preview.rect.right - preview.rect.left) / (preview.rect.bottom - preview.rect.top);
    expect(renderedAspect).toBeCloseTo(preview.naturalWidth / preview.naturalHeight, 2);

    await audience.getByRole('button', { name: 'Exit' }).click();
    await expect(audience).toBeHidden();

    await page.getByRole('button', { name: 'Export deck…' }).click();
    const exportDialog = page.getByRole('dialog', { name: /Export/ });
    await exportDialog.getByRole('button', { name: 'Export PNG sequence' }).click();
    await expect(exportDialog.getByText('File saved')).toBeVisible({ timeout: 60000 });
    const archive = await page.evaluate(() => window.__varvePresentationSaves?.at(-1));
    expect(archive?.name).toMatch(/\.zip$/i);

    const workdir = mkdtempSync(join(tmpdir(), 'varve-presentation-fidelity-'));
    const archivePath = join(workdir, 'deck.zip');
    writeFileSync(archivePath, Buffer.from(archive?.bytes ?? []));
    execFileSync('unzip', ['-o', '-q', archivePath, '-d', join(workdir, 'out')]);
    const entries = execFileSync('unzip', ['-Z1', archivePath]).toString().trim().split('\n');
    expect(entries.length).toBe(3);

    const delivered = decodePng(readFileSync(join(workdir, 'out', entries[0]!)));
    expect({ width: delivered.width, height: delivered.height }).toEqual({
      width: 1280,
      height: 720,
    });
    const previewPixels = decodePng(Uint8Array.from(preview.bytes));
    expect({ width: previewPixels.width, height: previewPixels.height }).toEqual({
      width: 1280,
      height: 720,
    });

    // Same slide, same raster: the preview is not a separate renderer.
    expect(pixelDigest(previewPixels.pixels)).toBe(pixelDigest(delivered.pixels));

    // Every delivered page keeps the deck's declared pixel size.
    for (const entry of entries) {
      const page1 = decodePng(readFileSync(join(workdir, 'out', entry)));
      expect({ width: page1.width, height: page1.height }).toEqual({ width: 1280, height: 720 });
    }
  });
});
