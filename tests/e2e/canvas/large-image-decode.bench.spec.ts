import { expect, test } from '@playwright/test';

/**
 * Large-image decode measurement (raster architecture §35/§87/§88-C).
 *
 * Generates synthetic high-frequency JPEG/PNG photographs in the browser
 * (12 / 24 / 48 MP), then measures:
 *   - encoded bytes
 *   - full-resolution decode latency (HTMLImageElement.decode)
 *   - downscaled decode latency (createImageBitmap with resizeWidth on the
 *     same encoded bytes — the candidate preview representation)
 *   - decoded memory estimate for each representation
 *
 * The numbers decide whether a viewport-sufficient preview decode is
 * justified before any implementation. Not a pass/fail gate: it prints a
 * report (and asserts only that the harness itself works).
 */

test('measure full vs preview decode for large photographs', async ({ page }) => {
  const results = await page.evaluate(async () => {
    interface Sample {
      label: string;
      width: number;
      height: number;
      encodedBytes: number;
      fullDecodeMs: number;
      previewDecodeMs: number;
      speedup: number;
      fullPixels: number;
      previewPixels: number;
      previewMemoryFraction: number;
      scaledDecodeMs?: number;
      scaledSpeedup?: number;
    }

    function noiseImage(
      width: number,
      height: number,
      kind: 'jpeg' | 'png',
    ): Promise<{ blob: Blob; dataUrl: string }> {
      return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('2d context unavailable'));
          return;
        }
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#d64545');
        gradient.addColorStop(0.5, '#45d645');
        gradient.addColorStop(1, '#4545d6');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = imageData.data;
        for (let i = 0; i < pixels.length; i += 4) {
          const noise = (Math.random() * 48 - 24) | 0;
          pixels[i] = Math.max(0, Math.min(255, pixels[i] + noise));
          pixels[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + noise));
          pixels[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + noise));
        }
        ctx.putImageData(imageData, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('toBlob failed'));
              return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve({ blob, dataUrl: String(reader.result) });
            reader.onerror = () => reject(new Error('FileReader failed'));
            reader.readAsDataURL(blob);
          },
          kind === 'jpeg' ? 'image/jpeg' : 'image/png',
          kind === 'jpeg' ? 0.92 : undefined,
        );
      });
    }

    function decodeFull(dataUrl: string): Promise<number> {
      return new Promise((resolve, reject) => {
        const img = new Image();
        const start = performance.now();
        img.onload = () => resolve(performance.now() - start);
        img.onerror = () => reject(new Error('full decode failed'));
        img.src = dataUrl;
      });
    }

    function decodePreview(
      blob: Blob,
      maxDim: number,
    ): Promise<{ ms: number; w: number; h: number }> {
      return new Promise((resolve, reject) => {
        const start = performance.now();
        createImageBitmap(blob, { resizeWidth: maxDim, resizeQuality: 'high' })
          .then((bitmap) => {
            const ms = performance.now() - start;
            const out = { ms, w: bitmap.width, h: bitmap.height };
            bitmap.close();
            resolve(out);
          })
          .catch((err) => reject(new Error(`preview decode failed: ${String(err)}`)));
      });
    }

    async function decodeScaled(
      blob: Blob,
      maxDim: number,
    ): Promise<{ ms: number; w: number; h: number } | null> {
      if (typeof ImageDecoder === 'undefined') return null;
      try {
        const start = performance.now();
        const decoder = new ImageDecoder({ data: blob, type: blob.type });
        await decoder.tracks.ready;
        const frame = await decoder.decode({
          desiredWidth: maxDim,
          desiredHeight: maxDim,
        });
        const ms = performance.now() - start;
        const out = { ms, w: frame.image.width, h: frame.image.height };
        frame.image.close();
        decoder.close();
        return out;
      } catch {
        return null;
      }
    }

    const corpus = [
      { label: '12MP', width: 4000, height: 3000 },
      { label: '24MP', width: 6000, height: 4000 },
      { label: '48MP', width: 8000, height: 6000 },
    ];
    const samples: Sample[] = [];
    for (const entry of corpus) {
      for (const kind of ['jpeg', 'png'] as const) {
        const { blob, dataUrl } = await noiseImage(entry.width, entry.height, kind);
        const fullMs = await decodeFull(dataUrl);
        const preview = await decodePreview(blob, 2048);
        const scaled = await decodeScaled(blob, 2048);
        samples.push({
          label: `${entry.label} ${kind}`,
          width: entry.width,
          height: entry.height,
          encodedBytes: blob.size,
          fullDecodeMs: fullMs,
          previewDecodeMs: preview.ms,
          speedup: fullMs / preview.ms,
          fullPixels: entry.width * entry.height,
          previewPixels: preview.w * preview.h,
          previewMemoryFraction: (preview.w * preview.h) / (entry.width * entry.height),
          ...(scaled ? { scaledDecodeMs: scaled.ms, scaledSpeedup: fullMs / scaled.ms } : {}),
        });
      }
    }
    return samples;
  });

  expect(results).toHaveLength(6);
  for (const sample of results) {
    expect(sample.fullDecodeMs).toBeGreaterThan(0);
    expect(sample.previewDecodeMs).toBeGreaterThan(0);
    expect(sample.previewPixels).toBeLessThan(sample.fullPixels);
  }

  // eslint-disable-next-line no-console
  console.log(
    [
      'large-image decode measurement',
      'label            bytes      fullMs  prevMs  speedup  prevMemFrac  scaledMs  scaledSpeedup',
      ...results.map(
        (s) =>
          `${s.label.padEnd(15)} ${String(s.encodedBytes).padStart(9)} ${String(s.fullDecodeMs.toFixed(1)).padStart(7)} ${String(s.previewDecodeMs.toFixed(1)).padStart(7)} ${String(s.speedup.toFixed(1)).padStart(7)} ${String(s.previewMemoryFraction.toFixed(3)).padStart(11)} ${String((s.scaledDecodeMs ?? -1).toFixed(1)).padStart(9)} ${String((s.scaledSpeedup ?? -1).toFixed(1)).padStart(14)}`,
      ),
    ].join('\n'),
  );
});
