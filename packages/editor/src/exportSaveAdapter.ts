/**
 * Export save adapter — bridges ExportService bytes to the active platform.
 *
 * Research basis: MDN File System Access API and Clipboard/File APIs favor
 * binary Blob/Uint8Array flows over text/data-URL round trips for large assets.
 */

import type { Platform } from '@strata/platform';
import type { ExportFormat, ExportJob } from '@strata/scene';
import { sanitizeSegment } from '@strata/scene/export';
import { zipSync } from 'fflate';
import type { ExportRunContext } from './exportService';

const FORMAT_EXTENSIONS: Partial<Record<ExportFormat, string>> = {
  avif: '.avif',
  flutter: '.dart',
  jpg: '.jpg',
  'pdf-screen': '.pdf',
  'pdf-x1a': '.pdf',
  'pdf-x4': '.pdf',
  png: '.png',
  'react-cssmodules': '.tsx',
  'react-tailwind': '.tsx',
  svg: '.svg',
  'svg-component': '.svg',
  swiftui: '.swift',
  webp: '.webp',
};

const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/avif': '.avif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'text/tsx': '.tsx',
  'text/x-dart': '.dart',
  'text/x-swift': '.swift',
};

export function extensionForExport(fileName: string, mimeType: string, job?: ExportJob): string {
  const fromFormat = job ? FORMAT_EXTENSIONS[job.format] : undefined;
  if (fromFormat) return fromFormat;

  const fromMime = MIME_EXTENSIONS[mimeType];
  if (fromMime) return fromMime;

  const dot = fileName.lastIndexOf('.');
  if (dot > -1 && dot < fileName.length - 1) return fileName.slice(dot);

  return '.bin';
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function downloadBytes(fileName: string, bytes: Uint8Array, mimeType: string): string | null {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return null;

  const blob = new Blob([bytesToArrayBuffer(bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return fileName;
}

export async function saveExportBytes(
  platform: Platform | undefined,
  fileName: string,
  bytes: Uint8Array,
  mimeType: string,
  extension: string,
): Promise<string | null> {
  if (platform?.kind === 'tauri' || platform?.kind === 'web') {
    return await platform.saveBinaryFile(fileName, bytes, mimeType, extension);
  }

  return downloadBytes(fileName, bytes, mimeType);
}

export function createExportSaveFile(platform?: Platform): ExportRunContext['saveFile'] {
  return async (fileName, bytes, mimeType, job) => {
    return await saveExportBytes(
      platform,
      fileName,
      bytes,
      mimeType,
      extensionForExport(fileName, mimeType, job),
    );
  };
}

export interface BufferedExportArchive {
  saveFile: NonNullable<ExportRunContext['saveFile']>;
  fileCount: () => number;
  flush: (archiveName: string) => Promise<string | null>;
}

function safeArchiveEntryPath(fileName: string): string {
  const segments = fileName
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .map((segment) => sanitizeSegment(segment, { keepDots: true }).trim())
    .filter(Boolean);
  return segments.join('/') || 'export.bin';
}

/**
 * Buffer a browser batch and deliver it as one ZIP. This prevents a batch from
 * opening one picker or uncontrolled download per output. Only successful
 * rendered files reach the archive because ExportService calls the sink after
 * rendering each output.
 */
export function createBufferedExportArchive(platform?: Platform): BufferedExportArchive {
  const files: Record<string, Uint8Array> = {};
  let count = 0;

  return {
    saveFile: async (fileName, bytes) => {
      let entry = safeArchiveEntryPath(fileName);
      if (files[entry]) {
        const dot = entry.lastIndexOf('.');
        const stem = dot > 0 ? entry.slice(0, dot) : entry;
        const extension = dot > 0 ? entry.slice(dot) : '';
        let suffix = 2;
        while (files[`${stem}-${suffix}${extension}`]) suffix += 1;
        entry = `${stem}-${suffix}${extension}`;
      }
      files[entry] = bytes;
      count += 1;
      return entry;
    },
    fileCount: () => count,
    flush: async (archiveName) => {
      if (count === 0) return null;
      const fileName = archiveName.toLowerCase().endsWith('.zip')
        ? archiveName
        : `${archiveName}.zip`;
      return await saveExportBytes(
        platform,
        fileName,
        zipSync(files, { level: 6 }),
        'application/zip',
        '.zip',
      );
    },
  };
}
