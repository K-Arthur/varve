import type { Shape } from '@varve/engine';
import type { SceneNode } from '@varve/scene';

/**
 * Collect all files from a DataTransfer, recursively enumerating folders
 * via the File System Entry API.
 */
export async function collectFilesFromDataTransfer(
  dt: DataTransfer,
): Promise<{ name: string; data: Uint8Array | string }[]> {
  const files: { name: string; data: Uint8Array | string }[] = [];

  const items = dt.items;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    if (item.kind === 'file') {
      const entry = item.webkitGetAsEntry();
      if (entry) {
        if (entry.isDirectory) {
          await collectDirectory(entry as FileSystemDirectoryEntry, files);
        } else {
          await collectFile(entry as FileSystemFileEntry, files);
        }
      } else {
        const file = item.getAsFile();
        if (file) {
          const data = await readFileAsBuffer(file);
          files.push({ name: file.name, data });
        }
      }
    }
  }

  return files;
}

async function collectDirectory(
  dir: FileSystemDirectoryEntry,
  result: { name: string; data: Uint8Array | string }[],
): Promise<void> {
  const reader = dir.createReader();
  const entries = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve));
  for (const entry of entries) {
    if (entry.isDirectory) {
      await collectDirectory(entry as FileSystemDirectoryEntry, result);
    } else {
      await collectFile(entry as FileSystemFileEntry, result);
    }
  }
}

async function collectFile(
  fileEntry: FileSystemFileEntry,
  result: { name: string; data: Uint8Array | string }[],
): Promise<void> {
  const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
  let data: Uint8Array | string;
  if (file.name.endsWith('.svg')) {
    data = await file.text();
  } else {
    data = await readFileAsBuffer(file);
  }
  result.push({ name: file.name, data });
}

function readFileAsBuffer(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Compute approximate local bounds for a scene node.
 */
function shapeBounds(s: Shape): { x: number; y: number; w: number; h: number } | null {
  switch (s.kind) {
    case 'rect':
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    case 'ellipse':
      return { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
    case 'circle':
      return { x: s.cx - s.r, y: s.cy - s.r, w: s.r * 2, h: s.r * 2 };
    case 'line':
      return { x: Math.min(s.from[0], s.to[0]), y: Math.min(s.from[1], s.to[1]), w: 1, h: 1 };
    case 'arrow':
      return { x: Math.min(s.from[0], s.to[0]), y: Math.min(s.from[1], s.to[1]), w: 1, h: 1 };
    case 'polygon':
      return { x: s.cx - s.radius, y: s.cy - s.radius, w: s.radius * 2, h: s.radius * 2 };
    case 'star':
      return {
        x: s.cx - s.outerRadius,
        y: s.cy - s.outerRadius,
        w: s.outerRadius * 2,
        h: s.outerRadius * 2,
      };
    case 'table':
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    case 'path':
      return null; // approximated differently
  }
}

function nodeLocalBoundsSimple(
  node: SceneNode,
): { x: number; y: number; w: number; h: number } | null {
  const tx = node.transform[4] ?? 0;
  const ty = node.transform[5] ?? 0;

  if (node.kind === 'text') {
    const fSize = node.fontSize ?? 16;
    return { x: tx, y: ty, w: (node.text?.length ?? 1) * fSize * 0.6, h: fSize * 1.4 };
  }
  if (node.kind === 'shape') {
    const s = node.shape as Shape;
    const sb = shapeBounds(s);
    if (!sb) return { x: tx, y: ty, w: 100, h: 100 };
    return { x: tx + sb.x, y: ty + sb.y, w: sb.w, h: sb.h };
  }
  if (node.kind === 'frame') {
    return { x: tx, y: ty, w: node.w, h: node.h };
  }
  if (node.kind === 'group') {
    return { x: tx, y: ty, w: 100, h: 100 };
  }
  return null;
}

/**
 * Apply a drop position to a node by offsetting its transform so the
 * node's center lands at the given world position.
 *
 * If `position` is undefined, returns the node unchanged.
 */
export function applyDropPosition(node: SceneNode, position?: { x: number; y: number }): SceneNode {
  if (!position) return node;
  const bounds = nodeLocalBoundsSimple(node);
  if (!bounds) return node;
  const nodeCenterX = bounds.x + bounds.w / 2;
  const nodeCenterY = bounds.y + bounds.h / 2;
  const offsetX = position.x - nodeCenterX;
  const offsetY = position.y - nodeCenterY;
  return {
    ...node,
    transform: [
      node.transform[0],
      node.transform[1],
      node.transform[2],
      node.transform[3],
      (node.transform[4] ?? 0) + offsetX,
      (node.transform[5] ?? 0) + offsetY,
    ] as SceneNode['transform'],
  } as SceneNode;
}

// ── File validation ───────────────────────────────────────────────────────

const SUPPORTED_IMPORT_EXTENSIONS = new Set([
  'svg',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'tiff',
  'tif',
  'pdf',
  'psd',
  'psb',
  'ai',
  'eps',
  'epsf',
  'avif',
  'sketch',
  'fig',
]);

const WARN_SIZE_BYTES = 50 * 1024 * 1024;
const REJECT_SIZE_BYTES = 200 * 1024 * 1024;
const WARN_FILE_COUNT = 50;
const REJECT_FILE_COUNT = 500;

export interface FileValidationResult {
  accepted: { name: string; data: Uint8Array | string }[];
  rejected: { name: string; reason: string }[];
  warnings: string[];
}

export function validateFiles(
  files: { name: string; data: Uint8Array | string }[],
): FileValidationResult {
  const accepted: { name: string; data: Uint8Array | string }[] = [];
  const rejected: { name: string; reason: string }[] = [];
  const warnings: string[] = [];

  if (files.length > REJECT_FILE_COUNT) {
    rejected.push({
      name: `${files.length} files`,
      reason: `Too many files (${files.length}). Maximum ${REJECT_FILE_COUNT} at a time.`,
    });
    return { accepted, rejected, warnings };
  }

  if (files.length > WARN_FILE_COUNT) {
    warnings.push(`Importing ${files.length} files — this may take a moment.`);
  }

  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const sizeBytes =
      typeof file.data === 'string' ? new TextEncoder().encode(file.data).length : file.data.length;

    if (!SUPPORTED_IMPORT_EXTENSIONS.has(ext)) {
      rejected.push({
        name: file.name,
        reason: `Unsupported format: .${ext}`,
      });
      continue;
    }

    if (sizeBytes > REJECT_SIZE_BYTES) {
      rejected.push({
        name: file.name,
        reason: `File too large (${(sizeBytes / 1024 / 1024).toFixed(1)} MB). Maximum ${REJECT_SIZE_BYTES / 1024 / 1024} MB.`,
      });
      continue;
    }

    if (sizeBytes > WARN_SIZE_BYTES) {
      warnings.push(`${file.name} is large (${(sizeBytes / 1024 / 1024).toFixed(1)} MB).`);
    }

    if (sizeBytes < 4) {
      rejected.push({
        name: file.name,
        reason: 'File is empty or too small to contain valid content.',
      });
      continue;
    }

    accepted.push(file);
  }

  return { accepted, rejected, warnings };
}

export function isSupportedFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_IMPORT_EXTENSIONS.has(ext);
}
