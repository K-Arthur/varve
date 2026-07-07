import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ImportService } from './service';

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
});
