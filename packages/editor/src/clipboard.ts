/**
 * System clipboard integration for Strata node data.
 *
 * Copies nodes as `application/vnd.strata+json` (preserves structure for
 * in-app paste) and `text/plain` (fallback for paste-into-text-editor).
 *
 * Research basis: Clipboard API (W3C), custom MIME types for structured data.
 */
import type { SceneNode } from '@strata/scene';

const STRATA_MIME = 'application/vnd.strata+json';

export interface ClipboardData {
  nodes: SceneNode[];
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
    // Fallback: write text only
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
