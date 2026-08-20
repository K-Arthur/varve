import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildPngWithoutIccp } from './metadata/__fixtures__';
import { ImportService } from './service';

/**
 * A structurally complete minimal PNG (signature + IHDR + IDAT + IEND) with
 * the given width/height. The bare 24-byte header used previously fails the
 * content-level APNG probe (truncated chunk), which is correct behaviour for
 * a corrupt container.
 */
function pngHeader(width = 1, height = 1): Uint8Array {
  const png = buildPngWithoutIccp();
  const out = png.slice();
  const view = new DataView(out.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return out;
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
  it('classifies an undecodable native .fig as unsupported without import artifacts', async () => {
    const report = await ImportService.importFiles([
      {
        name: 'broken.fig',
        bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        source: 'file-picker',
      },
    ]);

    expect(report.files[0]).toMatchObject({
      status: 'unsupported',
      nodeCount: 0,
      artifacts: [{ nodeIds: [] }],
    });
    expect(report.failureCount).toBe(1);
    expect(report.unsupportedCount).toBe(1);
    expect(report.files[0]?.warnings.map((item) => item.message).join('\n')).toMatch(
      /could not be decoded safely/i,
    );
  });

  it('registers Figma JSON in the service and reports parser-level degradation', async () => {
    const json = JSON.stringify({
      name: 'Figma service fixture',
      document: {
        type: 'DOCUMENT',
        children: [
          {
            id: 'page:1',
            type: 'CANVAS',
            name: 'Page 1',
            children: [
              {
                id: 'frame:1',
                type: 'FRAME',
                name: 'Card',
                absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 80 },
                children: [],
              },
              {
                id: 'boolean:1',
                type: 'BOOLEAN_OPERATION',
                name: 'Union',
                booleanOperation: 'UNION',
                children: [],
              },
            ],
          },
        ],
      },
    });

    const report = await ImportService.importFiles([
      { name: 'design.fig.json', text: json, source: 'file-picker' },
    ]);

    expect(report.files[0]?.format).toBe('figma');
    expect(report.files[0]?.status).toBe('partial');
    expect(report.files[0]?.unsupportedFeatures.map((feature) => feature.feature)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Boolean operation/i)]),
    );
    expect(report.files[0]?.artifacts).toHaveLength(1);
  });

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
