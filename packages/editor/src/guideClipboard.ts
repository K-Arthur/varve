/**
 * Guide clipboard — copy/paste layout guides across pages and documents.
 *
 * Uses `application/vnd.strata+guides+json` alongside an in-memory fallback
 * for environments where custom MIME types are unavailable.
 */
import type { Guide } from '@varve/scene';

export const GUIDE_CLIPBOARD_MIME = 'application/vnd.strata+guides+json';

export interface GuideClipboardData {
  guides: Guide[];
}

let memoryClipboard: Guide[] | null = null;

export function setGuideClipboardMemory(guides: Guide[]): void {
  memoryClipboard = guides.map((g) => ({ ...g }));
}

export function getGuideClipboardMemory(): Guide[] | null {
  return memoryClipboard ? memoryClipboard.map((g) => ({ ...g })) : null;
}

export function serializeGuideClipboard(guides: Guide[]): string {
  const data: GuideClipboardData = { guides };
  return JSON.stringify(data);
}

export function parseGuideClipboard(text: string): Guide[] | null {
  try {
    const parsed = JSON.parse(text) as GuideClipboardData;
    if (!parsed.guides || !Array.isArray(parsed.guides)) return null;
    return parsed.guides.filter(
      (g) =>
        g &&
        typeof g.id === 'string' &&
        (g.axis === 'horizontal' || g.axis === 'vertical') &&
        typeof g.position === 'number',
    );
  } catch {
    return null;
  }
}

export async function writeGuidesToClipboard(guides: Guide[]): Promise<boolean> {
  setGuideClipboardMemory(guides);
  try {
    const json = serializeGuideClipboard(guides);
    const blob = new Blob([json], { type: GUIDE_CLIPBOARD_MIME });
    const textBlob = new Blob([guides.map((g) => `${g.axis}@${g.position}`).join('\n')], {
      type: 'text/plain',
    });
    await navigator.clipboard.write([
      new ClipboardItem({
        [GUIDE_CLIPBOARD_MIME]: blob,
        'text/plain': textBlob,
      }),
    ]);
    return true;
  } catch {
    return memoryClipboard !== null;
  }
}

export async function readGuidesFromClipboard(): Promise<Guide[] | null> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes(GUIDE_CLIPBOARD_MIME)) {
        const blob = await item.getType(GUIDE_CLIPBOARD_MIME);
        const text = await blob.text();
        const guides = parseGuideClipboard(text);
        if (guides?.length) {
          setGuideClipboardMemory(guides);
          return guides;
        }
      }
    }
  } catch {
    // Fall through to memory clipboard.
  }
  return getGuideClipboardMemory();
}
