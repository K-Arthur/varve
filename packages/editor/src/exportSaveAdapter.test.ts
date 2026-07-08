import type { Platform } from '@strata/platform';
import type { ExportJob } from '@strata/scene';
import { describe, expect, it, vi } from 'vitest';
import { createExportSaveFile, extensionForExport } from './exportSaveAdapter';

function job(format: ExportJob['format'], fileName = 'Layer.export'): ExportJob {
  return {
    presetId: 'preset-1',
    nodeId: 'node-1',
    nodeName: 'Layer',
    format,
    fileName,
    dimensions: { w: 100, h: 80 },
    estimatedSize: 1024,
    status: 'pending',
  };
}

function platformWithSave(saveBinaryFile: Platform['saveBinaryFile']): Platform {
  return {
    kind: 'tauri',
    saveBinaryFile,
  } as unknown as Platform;
}

describe('export save adapter', () => {
  it('derives SVG extension from the export job instead of MIME fallback', () => {
    expect(extensionForExport('Logo.bin', 'application/octet-stream', job('svg'))).toBe('.svg');
  });

  it('saves through the active binary-aware platform with the derived extension', async () => {
    const saveBinaryFile = vi.fn<Platform['saveBinaryFile']>(async () => '/tmp/Logo.svg');
    const saveFile = createExportSaveFile(platformWithSave(saveBinaryFile));

    const saved = await saveFile?.(
      'Logo.svg',
      new TextEncoder().encode('<svg />'),
      'image/svg+xml',
      job('svg', 'Logo.svg'),
    );

    expect(saved).toBe('/tmp/Logo.svg');
    expect(saveBinaryFile).toHaveBeenCalledOnce();
    const [fileName, bytes, mimeType, extension] = saveBinaryFile.mock.calls[0]!;
    expect(fileName).toBe('Logo.svg');
    expect(ArrayBuffer.isView(bytes)).toBe(true);
    expect(bytes.byteLength).toBe(7);
    expect(mimeType).toBe('image/svg+xml');
    expect(extension).toBe('.svg');
  });
});
