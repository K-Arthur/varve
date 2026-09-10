/**
 * Export hash diff — detect which nodes changed since last export.
 *
 * Uses FNV-1a hash over node geometry + text + transform data so we can
 * detect modifications without storing full snapshots.
 */

import type { Document, NodeId, SceneNode } from '@varve/scene';

/** FNV-1a 32-bit hash of a string. Returns hex string. */
function fnv1a(data: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Extract export-relevant fields from a node into a stable string key. */
function nodeExportKey(node: SceneNode): string {
  const parts: string[] = [node.id, node.name, node.visible ? '1' : '0', node.locked ? '1' : '0'];

  parts.push(node.transform.map((n) => n.toFixed(4)).join(','));

  if (node.kind === 'shape') {
    parts.push(JSON.stringify(node.shape));
    parts.push(JSON.stringify(node.fills ?? null));
    parts.push(JSON.stringify(node.strokes ?? null));
    parts.push(JSON.stringify(node.effects ?? null));
    parts.push(String(node.opacity ?? 1));
    parts.push(String(node.rotation ?? 0));
  }

  if (node.kind === 'text') {
    parts.push(node.text);
    parts.push(String(node.fontSize));
    parts.push(node.fontFamily ?? '');
    parts.push(String(node.fontWeight ?? 400));
    parts.push(node.fontStyle ?? 'normal');
    parts.push(node.textAlign ?? 'left');
    parts.push(String(node.lineHeight ?? 1.2));
    parts.push(String(node.letterSpacing ?? 0));
  }

  if (node.kind === 'frame') {
    parts.push(String(node.w));
    parts.push(String(node.h));
    parts.push(JSON.stringify(node.children));
  }

  if (node.kind === 'group') {
    parts.push(JSON.stringify(node.children));
  }

  return parts.join('|');
}

/**
 * Compute a single FNV-1a hash for the entire document's export-relevant
 * content. Stable across identical documents.
 */
export function computeDocExportHash(doc: Document): string {
  const parts: string[] = [doc.name, String(doc.canvasWidth ?? 0), String(doc.canvasHeight ?? 0)];

  for (const id of doc.rootChildren) {
    const node = doc.nodes[id];
    if (node) parts.push(nodeExportKey(node));
  }

  return fnv1a(parts.join('||'));
}

/**
 * Compute per-node hash for export-relevant fields.
 */
export function computeNodeExportHash(node: SceneNode): string {
  return fnv1a(nodeExportKey(node));
}

/**
 * Compare two hash maps and classify every node id.
 */
export function compareExportHashes(
  previous: Record<string, string>,
  current: Record<string, string>,
): { changed: string[]; added: string[]; removed: string[]; unchanged: string[] } {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  const allIds = new Set<NodeId>([...Object.keys(previous), ...Object.keys(current)]);

  for (const id of allIds) {
    const prev = previous[id];
    const curr = current[id];

    if (prev !== undefined && curr === undefined) {
      removed.push(id);
    } else if (prev === undefined && curr !== undefined) {
      added.push(id);
    } else if (prev !== curr) {
      changed.push(id);
    } else {
      unchanged.push(id);
    }
  }

  return { changed, added, removed, unchanged };
}
