/**
 * System clipboard integration for Strata node data.
 *
 * Copies nodes as `application/vnd.strata+json` (preserves structure for
 * in-app paste) and `text/plain` (fallback for paste-into-text-editor).
 * Reads clipboard in a single pass for Strata JSON, SVG text, and images.
 *
 * Research basis: Clipboard API (W3C), custom MIME types for structured data.
 */
import type { SceneNode } from '@strata/scene';

const STRATA_MIME = 'application/vnd.strata+json';

export interface ClipboardData {
  nodes: SceneNode[];
}

export interface ClipboardImportItem {
  data: string | Uint8Array;
  mimeType: string;
  name: string;
}

export interface UnifiedClipboardResult {
  strataData: ClipboardData | null;
  importItems: ClipboardImportItem[];
}

export async function writeClipboard(nodes: SceneNode[]): Promise<boolean> {
  try {
    const data: ClipboardData = { nodes };
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: STRATA_MIME });
    const textBlob = new Blob([nodes.map((n) => n.name).join('\n')], { type: 'text/plain' });
    await navigator.clipboard.write([
      new ClipboardItem({
        [STRATA_MIME]: blob,
        'text/plain': textBlob,
      }),
    ]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(JSON.stringify(nodes.map((n) => n.name)));
      return true;
    } catch {
      return false;
    }
  }
}

export async function readClipboard(): Promise<ClipboardData | null> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes(STRATA_MIME)) {
        const blob = await item.getType(STRATA_MIME);
        const text = await blob.text();
        const parsed = JSON.parse(text) as ClipboardData;
        if (parsed.nodes && Array.isArray(parsed.nodes)) {
          return parsed;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Single clipboard read that returns both Strata JSON data and importable
 * items (SVG text, images) with raw data in the correct format.
 *
 * SVG is returned as raw text (not URL-encoded) so the SVG parser
 * receives valid XML. Images are returned as Uint8Array bytes so
 * importImageAsFile can process them.
 */
export async function readClipboardUnified(): Promise<UnifiedClipboardResult> {
  const result: UnifiedClipboardResult = { strataData: null, importItems: [] };
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type === STRATA_MIME) {
          const blob = await item.getType(type);
          const text = await blob.text();
          const parsed = JSON.parse(text) as ClipboardData;
          if (parsed.nodes && Array.isArray(parsed.nodes)) {
            result.strataData = parsed;
          }
        } else if (type.startsWith('image/') && type !== 'image/svg+xml') {
          const blob = await item.getType(type);
          const buffer = await blob.arrayBuffer();
          result.importItems.push({
            data: new Uint8Array(buffer),
            mimeType: type,
            name: `clipboard.${type.split('/')[1] ?? 'png'}`,
          });
        } else if (type === 'image/svg+xml' || type === 'text/svg+xml' || type === 'text/plain') {
          const blob = await item.getType(type);
          const text = await blob.text();
          if (text.trim().startsWith('<svg') || text.trim().startsWith('<?xml')) {
            result.importItems.push({
              data: text,
              mimeType: 'image/svg+xml',
              name: 'clipboard.svg',
            });
          }
        }
      }
    }
  } catch {
    // Clipboard read failed or permission denied
  }
  return result;
}
