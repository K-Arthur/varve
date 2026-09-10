import type { FontSemanticRecord } from '@varve/engine/font';

export type FontPreviewStatus = 'ready' | 'loading' | 'fallback' | 'unavailable';

export interface FontPreviewResult {
  status: FontPreviewStatus;
  message?: string;
  face?: FontFace;
}

const PREVIEW_SAMPLE = 'Hamburgefonstiv 0123456789';

function cssFamily(family: string): string {
  return family.replaceAll('"', '\\"');
}

function isLoaded(descriptor: string, sample: string, faces: readonly FontFace[]): boolean {
  return (
    faces.length > 0 ||
    (typeof document.fonts.check === 'function' && document.fonts.check(descriptor, sample))
  );
}

/**
 * Load one catalog family into the current document for inspection only.
 *
 * This deliberately does not register the face in FontRegistry, persist its
 * bytes, or mark the catalog family installed. `Install font` owns those
 * durable actions; this loader only makes the selected specimen truthful.
 */
export async function loadFontPreview(record: FontSemanticRecord): Promise<FontPreviewResult> {
  if (typeof document === 'undefined' || !document.fonts) {
    return { status: 'unavailable', message: 'Font previews require a browser font-loading API.' };
  }

  const family = cssFamily(record.familyName);
  const descriptor = `400 16px "${family}"`;

  if (record.installed) {
    try {
      const faces = await document.fonts.load(descriptor, PREVIEW_SAMPLE);
      const ready = isLoaded(descriptor, PREVIEW_SAMPLE, faces);
      return ready
        ? { status: 'ready' }
        : { status: 'fallback', message: 'The installed face is not ready in this window.' };
    } catch {
      return {
        status: 'fallback',
        message: 'The installed face could not be loaded in this window.',
      };
    }
  }

  // Catalog browsing is deliberately network-free. A catalog record is only
  // previewable after its exact bytes have been explicitly installed by the
  // user; the download manager owns all remote fetches and integrity checks.
  return {
    status: 'unavailable',
    message: 'Install this font to preview its exact face locally.',
  };
}

export function removeFontPreview(face: FontFace | undefined): void {
  if (!face || typeof document === 'undefined' || !document.fonts) return;
  document.fonts.delete(face);
}
