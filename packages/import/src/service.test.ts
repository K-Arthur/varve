import { describe, expect, it } from 'vitest';
import { ImportService } from './service';

describe('ImportService', () => {
  it('returns a typed report for successful imports and unsupported files', async () => {
    const svg =
      '<svg width="10" height="12"><rect x="0" y="0" width="10" height="12" /></svg>';

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
});
