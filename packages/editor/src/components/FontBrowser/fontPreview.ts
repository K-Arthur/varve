import type { FontSemanticRecord } from '@varve/engine/font';
import { getFontsourceCatalog } from '@varve/engine/font';

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

function previewWeight(record: FontSemanticRecord): number {
  return record.weights.includes(400) ? 400 : (record.weights[0] ?? 400);
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

  if (record.providerId !== 'fontsource') {
    return { status: 'unavailable', message: 'No preview artifact is available for this family.' };
  }
  if (typeof FontFace === 'undefined') {
    return { status: 'unavailable', message: 'This browser cannot load a temporary font preview.' };
  }

  let loadedFace: FontFace | undefined;
  try {
    const artifact = getFontsourceCatalog().resolve({
      familyId: record.familyId,
      style: record.styles.includes('normal') ? 'normal' : (record.styles[0] ?? 'normal'),
      ...(record.variable ? { variable: true } : { weight: previewWeight(record) }),
    });
    const face = new FontFace(record.familyName, `url("${artifact.url}")`, {
      style: artifact.style,
      weight: artifact.variable ? '100 900' : String(artifact.weight ?? previewWeight(record)),
    });
    loadedFace = await face.load();
    document.fonts.add(loadedFace);
    const faces = await document.fonts.load(descriptor, PREVIEW_SAMPLE);
    const ready = isLoaded(descriptor, PREVIEW_SAMPLE, faces);
    if (!ready) {
      document.fonts.delete(loadedFace);
      return { status: 'fallback', message: 'The preview artifact loaded but was not selectable.' };
    }
    return { status: 'ready', face: loadedFace };
  } catch {
    if (loadedFace) document.fonts.delete(loadedFace);
    return {
      status: 'fallback',
      message: 'The exact preview could not be loaded. Install the family to try again.',
    };
  }
}

export function removeFontPreview(face: FontFace | undefined): void {
  if (!face || typeof document === 'undefined' || !document.fonts) return;
  document.fonts.delete(face);
}
