import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ImportService } from './service';

function pngHeader(width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

function sketchZip(): Uint8Array {
  return zipSync({
    'document.json': strToU8(JSON.stringify({ _class: 'document' })),
    'pages/page.json': strToU8(
      JSON.stringify({
        _class: 'page',
        layers: [
          {
            _class: 'rectangle',
            name: 'Card',
            frame: { x: 0, y: 0, width: 120, height: 80 },
          },
        ],
      }),
    ),
  });
}

describe('ImportService', () => {
  it('returns a typed report for successful imports and unsupported files', async () => {
    const svg = '<svg width="10" height="12"><rect x="0" y="0" width="10" height="12" /></svg>';

    const report = await ImportService.importFiles([
      { name: 'mark.svg', text: svg, size: svg.length, source: 'file-picker' },
      { name: 'notes.xyz', text: 'nope', size: 4, source: 'file-picker' },
    ]);

    expect(report.totalFiles).toBe(2);
    expect(report.successCount).toBe(1);
    expect(report.failureCount).toBe(1);
    expect(report.unsupportedCount).toBe(1);
    expect(report.files[0]).toMatchObject({
      name: 'mark.svg',
      status: 'success',
      format: 'svg',
      byteCount: svg.length,
    });
    expect(report.files[0]?.artifacts[0]?.nodeIds.length).toBeGreaterThan(0);
    expect(report.files[1]).toMatchObject({
      name: 'notes.xyz',
      status: 'unsupported',
      format: 'xyz',
    });
    expect(report.files[1]?.unsupportedFeatures[0]?.code).toBe('format.unsupported');
  });

  it('honors an already-aborted signal before parsing files', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      ImportService.importFiles(
        [{ name: 'mark.svg', text: '<svg/>', size: 6, source: 'drop' }],
        {},
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports validator-detected unsupported SVG features as partial fidelity', async () => {
    const svg =
      '<svg width="10" height="10"><defs><filter id="blur"/></defs><clipPath id="c"/></svg>';

    const report = await ImportService.importFiles([
      { name: 'effects.svg', text: svg, size: svg.length, source: 'drop' },
    ]);

    expect(report.successCount).toBe(0);
    expect(report.partialCount).toBe(1);
    expect(report.files[0]?.status).toBe('partial');
    expect(report.files[0]?.unsupportedFeatures.map((f) => f.feature)).toEqual(
      expect.arrayContaining(['SVG filters', 'SVG clip paths']),
    );
    expect(report.warnings.map((w) => w.message)).toEqual(
      expect.arrayContaining(['SVG filters', 'SVG clip paths']),
    );
  });

  it('imports Sketch archives through the unified partial-fidelity report path', async () => {
    const bytes = sketchZip();

    const report = await ImportService.importFiles([
      { name: 'layout.sketch', bytes, size: bytes.byteLength, source: 'file-picker' },
    ]);

    expect(report.partialCount).toBe(1);
    expect(report.files[0]?.format).toBe('sketch');
    expect(report.files[0]?.nodeCount).toBe(1);
    expect(report.files[0]?.unsupportedFeatures.map((f) => f.feature)).toEqual(
      expect.arrayContaining(['Sketch symbols and overrides', 'Sketch shared styles']),
    );
  });

  it('rejects empty and corrupt raster files before creating document nodes', async () => {
    const report = await ImportService.importFiles([
      { name: 'empty.png', bytes: new Uint8Array(), source: 'file-picker' },
      { name: 'corrupt.jpg', bytes: new Uint8Array([1, 2, 3, 4]), source: 'clipboard' },
    ]);

    expect(report.failureCount).toBe(2);
    expect(report.files.map((file) => file.status)).toEqual(['failed', 'failed']);
    expect(report.files[0]?.error).toMatch(/empty|too small/i);
    expect(report.files[1]?.error).toMatch(/unsupported|signature/i);
    expect(report.files.every((file) => file.artifacts.length === 0)).toBe(true);
  });

  it('rejects raster dimensions whose decoded allocation exceeds the pixel budget', async () => {
    const report = await ImportService.importFiles([
      { name: 'bomb.png', bytes: pngHeader(100_000, 1_000), source: 'drop' },
    ]);

    expect(report.files[0]).toMatchObject({ status: 'failed', nodeCount: 0 });
    expect(report.files[0]?.error).toMatch(/dimension|pixel budget/i);
  });

  it('sniffs raster content independently of the filename and registers one canonical asset', async () => {
    const report = await ImportService.importFiles([
      { name: 'misleading.jpg', bytes: pngHeader(3, 2), source: 'file-picker' },
    ]);

    expect(report.files[0]?.status).toBe('success');
    const artifact = report.files[0]?.artifacts[0];
    const node = artifact?.document.nodes[artifact.nodeIds[0] ?? ''];
    const image = node?.fills?.[0]?.image;
    expect(image?.src).toMatch(/^data:image\/png;base64,/);
    expect(image?.assetId).toBeTruthy();
    expect(Object.keys(artifact?.document.assets ?? {})).toEqual([image?.assetId]);
  });
});
