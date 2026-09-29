import type { Engine } from '@varve/engine';
import type { Document, PresentationSlideEntry } from '@varve/scene';
import { exportNodeAsRaster } from '../SpecPanel/export';
import type { PresentationRasterPage } from './presentationFormats';

export interface CapturedPresentationFrame {
  blob: Blob;
  warnings: string[];
}

/** One frame-local export path shared by thumbnails, audience preview, and delivery. */
export async function capturePresentationFrame(
  document: Document,
  entry: PresentationSlideEntry,
  engine: Engine,
  signal: AbortSignal,
  scale = 1,
): Promise<CapturedPresentationFrame> {
  if (signal.aborted) throw new DOMException('Presentation capture cancelled', 'AbortError');
  const frame = document.nodes[entry.frameId];
  if (frame?.kind !== 'frame' || frame.frameRole === 'exportRegion') {
    throw new Error(
      `Slide “${entry.title}” has no valid frame artwork. Repair its frame reference.`,
    );
  }
  const result = await exportNodeAsRaster(frame, document, engine, {
    format: 'image/png',
    scale,
    transparency: true,
    signal,
    frameLocal: true,
  });
  if (result.resourceFailures.length > 0) {
    throw new Error(
      `Slide “${entry.title}” could not render ${result.resourceFailures.length} image resource(s). Repair or reimport those assets, then try again.`,
    );
  }
  return { blob: result.blob, warnings: result.warnings };
}

export async function decodePresentationFrame(blob: Blob): Promise<PresentationRasterPage> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('This runtime cannot decode slide images for presentation export.');
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create a pixel buffer for presentation output.');
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, pixels: new Uint8Array(image.data) };
  } finally {
    bitmap.close();
  }
}
