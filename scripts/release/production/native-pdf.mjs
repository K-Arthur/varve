import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// Render the actual file, rather than accepting a valid header and page object.
// The bounded fixture contains one embedded checker image, exported at 1x.
export async function assertNativePdfArtwork(bytes, sourcePng) {
  assert.ok(bytes.length < 2 * 1024 * 1024, 'qualification PDF is bounded to 2 MB');
  const importRequire = createRequire(join(process.cwd(), 'packages/import/package.json'));
  const { getDocument } = await import(importRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
  const engineRequire = createRequire(join(process.cwd(), 'packages/engine/package.json'));
  const { PNG } = engineRequire('pngjs');
  const source = PNG.sync.read(sourcePng);
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false });
  let surface;
  try {
    const document = await loading.promise;
    assert.equal(document.numPages, 1, 'actual PDF has one selected-artwork page');
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    assert.deepEqual([viewport.width, viewport.height], [104, 80], 'actual PDF page dimensions');
    surface = document.canvasFactory.create(viewport.width, viewport.height);
    await page.render({ canvasContext: surface.context, viewport }).promise;
    for (const nx of [0.25, 0.75])
      for (const ny of [0.25, 0.75]) {
        const pixel = surface.context.getImageData(
          Math.floor(nx * viewport.width),
          Math.floor(ny * viewport.height),
          1,
          1,
        ).data;
        const offset =
          (Math.floor(ny * source.height) * source.width + Math.floor(nx * source.width)) * 4;
        assert.deepEqual(
          Buffer.from(pixel),
          source.data.subarray(offset, offset + 4),
          'rendered PDF must preserve the embedded artwork pixels and placement',
        );
      }
    return surface.canvas.toBuffer('image/png');
  } finally {
    if (surface) {
      surface.canvas.width = 0;
      surface.canvas.height = 0;
    }
    await loading.destroy();
  }
}
