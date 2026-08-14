import type { Platform } from '@varve/platform';
import type { ExportJob } from '@varve/scene';
import { unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import {
  createBufferedExportArchive,
  createExportFolderSaveFile,
  createExportSaveFile,
  extensionForExport,
} from './exportSaveAdapter';

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

  it('refuses to derive an extension from a trailing dot', () => {
    // `Logo.` must not produce `"."` as an extension.
    expect(extensionForExport('Logo.', 'application/octet-stream')).toBe('.bin');
  });

  it('derives the extension from the filename only as a last resort', () => {
    expect(extensionForExport('Logo.svg', 'application/octet-stream')).toBe('.svg');
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

  it('delivers a browser batch as one ZIP with safe unique entry names', async () => {
    const saveBinaryFile = vi.fn<Platform['saveBinaryFile']>(async () => 'Design-exports.zip');
    const platform = { kind: 'web', saveBinaryFile } as unknown as Platform;
    const archive = createBufferedExportArchive(platform);

    await archive.saveFile(
      '../Logo.svg',
      new TextEncoder().encode('<svg />'),
      'image/svg+xml',
      job('svg'),
    );
    await archive.saveFile(
      'Logo.svg',
      new TextEncoder().encode('<svg id="two" />'),
      'image/svg+xml',
      job('svg'),
    );
    const saved = await archive.flush('Design-exports');

    expect(saved).toBe('Design-exports.zip');
    expect(archive.fileCount()).toBe(2);
    expect(saveBinaryFile).toHaveBeenCalledOnce();
    const [fileName, bytes, mimeType, extension] = saveBinaryFile.mock.calls[0]!;
    expect(fileName).toBe('Design-exports.zip');
    expect(bytes.byteLength).toBeGreaterThan(20);
    expect(Object.keys(unzipSync(bytes))).toEqual(['Logo.svg', 'Logo-2.svg']);
    expect(mimeType).toBe('application/zip');
    expect(extension).toBe('.zip');
  });

  it('does not create an empty archive after a fully failed batch', async () => {
    const saveBinaryFile = vi.fn<Platform['saveBinaryFile']>();
    const platform = { kind: 'web', saveBinaryFile } as unknown as Platform;
    const archive = createBufferedExportArchive(platform);

    expect(await archive.flush('empty')).toBeNull();
    expect(saveBinaryFile).not.toHaveBeenCalled();
  });

  it('writes desktop batch entries beneath one chosen folder', async () => {
    const writeBinaryFileToFolder = vi.fn<Platform['writeBinaryFileToFolder']>(
      async () => '/exports/Logo.svg',
    );
    const platform = { kind: 'tauri', writeBinaryFileToFolder } as unknown as Platform;
    const saveFile = createExportFolderSaveFile(platform, '/exports');

    const saved = await saveFile(
      '../Logo.svg',
      new TextEncoder().encode('<svg />'),
      'image/svg+xml',
      job('svg'),
    );

    expect(saved).toBe('/exports/Logo.svg');
    expect(writeBinaryFileToFolder).toHaveBeenCalledOnce();
    const [folder, relativePath, bytes] = writeBinaryFileToFolder.mock.calls[0]!;
    expect(folder).toBe('/exports');
    expect(relativePath).toBe('Logo.svg');
    expect(ArrayBuffer.isView(bytes)).toBe(true);
  });
});
