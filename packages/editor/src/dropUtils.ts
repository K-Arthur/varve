import type { Shape } from '@varve/engine';
import {
  type Document,
  isContainer,
  type NodeId,
  reparentNode,
  type SceneNode,
  nodeWorldBounds as sceneNodeWorldBounds,
  textNodeLocalBounds,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { applyAffine, transformRect, tryInvertAffine } from '@varve/shared';
import {
  isNodeEffectivelyLocked,
  nodeWorldBounds,
  nodeWorldTransform,
  rebaseWorldTransformToParent,
} from './scene/world';

export interface PasteDestination {
  /** Explicit selected frame/group, or null for the active workspace root. */
  targetId: NodeId | null;
  /** World-space center used for viewport/import placement. */
  center: { x: number; y: number };
  kind: 'selected-container' | 'viewport';
}

/**
 * Resolve the one unambiguous container destination for ordinary Paste.
 *
 * A frame/group is an explicit destination only when it is the sole selected
 * eligible container. Ambiguous multi-selection deliberately falls back to
 * the captured viewport center instead of silently choosing the first item.
 */
export function resolvePasteDestination(
  doc: Document,
  selection: readonly NodeId[],
  viewportCenter: { x: number; y: number },
): PasteDestination {
  const containers = selection.filter((id) => {
    const node = doc.nodes[id];
    return Boolean(
      node &&
        isContainer(node) &&
        !isNodeEffectivelyLocked(doc, id) &&
        node.visible !== false &&
        tryInvertAffine(nodeWorldTransform(doc, id)) !== null,
    );
  });
  const targetId = containers.length === 1 ? containers[0]! : null;
  if (!targetId) return { targetId: null, center: viewportCenter, kind: 'viewport' };

  const target = doc.nodes[targetId];
  if (target?.kind === 'frame') {
    const transform = nodeWorldTransform(doc, targetId);
    const [x, y] = applyAffine(transform, [target.w / 2, target.h / 2]);
    return { targetId, center: { x, y }, kind: 'selected-container' };
  }
  const bounds = nodeWorldBounds(doc, targetId);
  if (bounds) {
    return {
      targetId,
      center: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
      kind: 'selected-container',
    };
  }

  // Empty groups have no visual bounds. Their world origin is the only
  // stable container-local placement anchor; this still keeps the paste
  // inside the selected hierarchy without inventing a size for the group.
  const transform = nodeWorldTransform(doc, targetId);
  return {
    targetId,
    center: { x: transform[4] ?? 0, y: transform[5] ?? 0 },
    kind: 'selected-container',
  };
}

/** Translate a world transform without changing its rotation, scale, or skew. */
export function translateWorldTransform(world: Affine, dx: number, dy: number): Affine {
  return [world[0], world[1], world[2], world[3], (world[4] ?? 0) + dx, (world[5] ?? 0) + dy];
}

/** Validate a serialized six-number affine before it can affect placement. */
export function isFiniteAffine(value: unknown): value is Affine {
  return (
    Array.isArray(value) &&
    value.length === 6 &&
    value.every((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
  );
}

/** Return the center of a world-space bounds rectangle. */
export function rectCenter(bounds: { x: number; y: number; w: number; h: number }): {
  x: number;
  y: number;
} {
  return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
}

/** Union visible geometry bounds for a set of already-inserted roots. */
export function unionNodeWorldBounds(
  doc: Document,
  ids: readonly NodeId[],
): { x: number; y: number; w: number; h: number } | null {
  let union: { x: number; y: number; w: number; h: number } | null = null;
  for (const id of ids) {
    const bounds = nodeWorldBounds(doc, id);
    if (!bounds) continue;
    if (!union) {
      union = { ...bounds };
      continue;
    }
    const minX = Math.min(union.x, bounds.x);
    const minY = Math.min(union.y, bounds.y);
    const maxX = Math.max(union.x + union.w, bounds.x + bounds.w);
    const maxY = Math.max(union.y + union.h, bounds.y + bounds.h);
    union = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return union;
}

/**
 * Compute a clipboard fragment's visual bounds from its serialized roots.
 * When anchors exist, each root's own transform is replaced by identity for
 * the geometry pass because the anchor already maps that root into world
 * space. This preserves spacing for roots copied from different parents.
 */
export function clipboardFragmentWorldBounds(
  doc: Document,
  rootIds: readonly NodeId[],
  worldAnchors: Readonly<Record<string, Affine>>,
): { x: number; y: number; w: number; h: number } | null {
  const sourceDoc = { ...doc, rootChildren: [...rootIds] };
  let union: { x: number; y: number; w: number; h: number } | null = null;
  for (const rootId of rootIds) {
    const sourceRoot = doc.nodes[rootId];
    if (!sourceRoot) continue;
    const anchor = worldAnchors[rootId];
    let bounds: { x: number; y: number; w: number; h: number } | null = null;
    if (isFiniteAffine(anchor)) {
      const geometryDoc = {
        ...sourceDoc,
        nodes: {
          ...sourceDoc.nodes,
          [rootId]: {
            ...sourceRoot,
            transform: [1, 0, 0, 1, 0, 0] as Affine,
            rotation: 0,
          },
        },
      };
      const localBounds = sceneNodeWorldBounds(geometryDoc, rootId);
      bounds = localBounds ? transformRect(anchor, localBounds) : null;
      if (!bounds) {
        bounds = { x: anchor[4] ?? 0, y: anchor[5] ?? 0, w: 0, h: 0 };
      }
    } else {
      bounds = sceneNodeWorldBounds(sourceDoc, rootId);
    }
    if (!bounds) continue;
    if (!union) {
      union = { ...bounds };
      continue;
    }
    const minX = Math.min(union.x, bounds.x);
    const minY = Math.min(union.y, bounds.y);
    const maxX = Math.max(union.x + union.w, bounds.x + bounds.w);
    const maxY = Math.max(union.y + union.h, bounds.y + bounds.h);
    union = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return union;
}

/** Apply a desired world transform while adopting a pasted root's parent. */
export function rebasePastedRoot(
  doc: Document,
  rootId: NodeId,
  targetParentId: NodeId | null,
  desiredWorld: Affine,
): Document {
  const root = doc.nodes[rootId];
  if (!root) return doc;
  if (!targetParentId) {
    return { ...doc, nodes: { ...doc.nodes, [rootId]: { ...root, transform: desiredWorld } } };
  }
  const parent = doc.nodes[targetParentId];
  if (!parent || !isContainer(parent)) return doc;
  const local = rebaseWorldTransformToParent(nodeWorldTransform(doc, targetParentId), desiredWorld);
  return local ? reparentNode(doc, rootId, targetParentId, parent.children.length, local) : doc;
}

/** Center one already-inserted root at a placed-world point, then reparent it. */
export function placePastedRootAtWorldCenter(
  doc: Document,
  rootId: NodeId,
  targetParentId: NodeId | null,
  center: { x: number; y: number },
): Document {
  const bounds = nodeWorldBounds(doc, rootId);
  if (!bounds) return doc;
  const currentCenter = rectCenter(bounds);
  const currentWorld = nodeWorldTransform(doc, rootId);
  return rebasePastedRoot(
    doc,
    rootId,
    targetParentId,
    translateWorldTransform(currentWorld, center.x - currentCenter.x, center.y - currentCenter.y),
  );
}

/**
 * Return true only when a drag actually leaves a surface. Browsers dispatch
 * dragleave while moving between descendants as well; clearing a preview for
 * those internal transitions makes file and mask targets flicker or vanish.
 */
export function isDragLeaveOutside(surface: Element, relatedTarget: EventTarget | null): boolean {
  return !(relatedTarget instanceof Node && surface.contains(relatedTarget));
}

export function isPointInsideRect(
  point: { x: number; y: number },
  rect: Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>,
): boolean {
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

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
    const bounds = textNodeLocalBounds(node);
    return { x: tx, y: ty, w: bounds.w, h: bounds.h };
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
