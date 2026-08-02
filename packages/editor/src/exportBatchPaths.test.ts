import type { ExportJob } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { applyExportBatchPaths } from './exportBatchPaths';

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    presetId: 'preset-random-id',
    nodeId: 'node-1',
    nodeName: 'Brand Logo',
    format: 'png',
    fileName: 'old-name.png',
    scale: { type: 'factor', value: 2 },
    suffix: '@2x',
    dimensions: { w: 200, h: 100 },
    estimatedSize: 1024,
    status: 'pending',
    ...overrides,
  };
}

describe('applyExportBatchPaths', () => {
  it('uses the real suffix and template instead of leaking preset ids', () => {
    const [resolved] = applyExportBatchPaths([job()], '{name}{suffix}.{ext}', 'flat');
    expect(resolved?.fileName).toBe('Brand Logo@2x.png');
    expect(resolved?.fileName).not.toContain('preset-random-id');
  });

  it('organizes by format or node using safe relative paths', () => {
    expect(applyExportBatchPaths([job()], '{name}.{ext}', 'by-preset')[0]?.fileName).toBe(
      'png/Brand Logo.png',
    );
    expect(applyExportBatchPaths([job()], '{name}.{ext}', 'by-node')[0]?.fileName).toBe(
      'Brand Logo/Brand Logo.png',
    );
  });

  it('renames colliding outputs deterministically', () => {
    const resolved = applyExportBatchPaths(
      [job(), job({ nodeId: 'node-2', presetId: 'preset-2' })],
      '{name}.{ext}',
      'flat',
    );
    expect(resolved.map((item) => item.fileName)).toEqual(['Brand Logo.png', 'Brand Logo-2.png']);
  });
});
