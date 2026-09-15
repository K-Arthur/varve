/**
 * Stable coordinate mappings for Image Treatment filter rasters.
 *
 * A filter raster is often a cropped or viewport-sized temporary canvas.
 * This adapter maps its pixels back into either document coordinates or an
 * object's local coordinates so visual treatments do not inherit temporary
 * surface dimensions, camera position, zoom, or rotation.
 */

import type { ImageTreatmentSpace } from '@varve/engine';
import { type Affine, multiplyAffine, tryInvertAffine } from '@varve/shared';

export interface TreatmentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraAffine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

function determinant(matrix: Affine): number {
  return matrix[0] * matrix[3] - matrix[1] * matrix[2];
}

function isUsableBounds(bounds: TreatmentBounds): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

/** Map a capture-local pixel to a document-space point. */
export function pixelToDocumentFromCapture(
  camera: CameraAffine,
  regionX: number,
  regionY: number,
): Affine | undefined {
  const inverseCamera = tryInvertAffine([
    camera.a,
    camera.b,
    camera.c,
    camera.d,
    camera.e,
    camera.f,
  ]);
  if (!inverseCamera) return undefined;
  return multiplyAffine(inverseCamera, [1, 0, 0, 1, regionX, regionY]);
}

/** Create document-anchored treatment metadata for a capture raster. */
export function documentTreatmentSpaceForCapture(
  pixelToDocument: Affine,
  bounds: TreatmentBounds,
): ImageTreatmentSpace | undefined {
  const pixelToDocumentDeterminant = Math.abs(determinant(pixelToDocument));
  if (
    !isUsableBounds(bounds) ||
    !Number.isFinite(pixelToDocumentDeterminant) ||
    pixelToDocumentDeterminant <= 1e-10
  ) {
    return undefined;
  }
  return {
    pixelToTreatment: pixelToDocument,
    bounds,
    pixelsPerUnit: 1 / Math.sqrt(pixelToDocumentDeterminant),
  };
}

/** Create object-local treatment metadata for a capture raster. */
export function objectTreatmentSpaceForCapture(
  pixelToDocument: Affine,
  objectToDocument: Affine,
  bounds: TreatmentBounds,
): ImageTreatmentSpace | undefined {
  const inverseObject = tryInvertAffine(objectToDocument);
  const pixelToDocumentDeterminant = Math.abs(determinant(pixelToDocument));
  if (
    !inverseObject ||
    !isUsableBounds(bounds) ||
    !Number.isFinite(pixelToDocumentDeterminant) ||
    pixelToDocumentDeterminant <= 1e-10
  ) {
    return undefined;
  }
  const objectToPixelsDeterminant =
    Math.abs(determinant(objectToDocument)) / pixelToDocumentDeterminant;
  return {
    pixelToTreatment: multiplyAffine(inverseObject, pixelToDocument),
    bounds,
    pixelsPerUnit: Math.max(0.01, Math.sqrt(objectToPixelsDeterminant)),
  };
}
