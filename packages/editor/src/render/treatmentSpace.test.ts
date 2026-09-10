import { describe, expect, it } from 'vitest';
import {
  documentTreatmentSpaceForCapture,
  objectTreatmentSpaceForCapture,
  pixelToDocumentFromCapture,
} from './treatmentSpace';

function mapPoint(
  matrix: readonly [number, number, number, number, number, number],
  x: number,
  y: number,
): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

describe('Image Treatment coordinate mapping', () => {
  it('maps a cropped capture pixel through the inverse camera into document space', () => {
    const pixelToDocument = pixelToDocumentFromCapture(
      { a: 2, b: 0, c: 0, d: 2, e: 100, f: 200 },
      10,
      20,
    );

    expect(pixelToDocument).toEqual([0.5, 0, 0, 0.5, -45, -90]);
    expect(mapPoint(pixelToDocument!, 90, 100)).toEqual([0, -40]);
  });

  it('derives stable raster density and document bounds for a captured adjustment scope', () => {
    const treatment = documentTreatmentSpaceForCapture([0.5, 0, 0, 0.5, 5, 10], {
      x: 20,
      y: 30,
      width: 400,
      height: 300,
    });

    expect(treatment).toEqual({
      pixelToTreatment: [0.5, 0, 0, 0.5, 5, 10],
      bounds: { x: 20, y: 30, width: 400, height: 300 },
      pixelsPerUnit: 2,
    });
  });

  it('maps a rotated/scaled object capture into object-local space', () => {
    const treatment = objectTreatmentSpaceForCapture(
      [0.5, 0, 0, 0.5, 5, 10],
      [2, 0, 0, 2, 20, 30],
      { x: 0, y: 0, width: 120, height: 80 },
    );

    expect(treatment?.pixelsPerUnit).toBe(4);
    expect(treatment?.bounds).toEqual({ x: 0, y: 0, width: 120, height: 80 });
    expect(mapPoint(treatment!.pixelToTreatment!, 30, 40)).toEqual([0, 0]);
  });

  it('declines singular transforms and invalid semantic bounds', () => {
    expect(pixelToDocumentFromCapture({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }, 0, 0)).toBe(
      undefined,
    );
    expect(
      documentTreatmentSpaceForCapture([1, 0, 0, 1, 0, 0], {
        x: 0,
        y: 0,
        width: 0,
        height: 10,
      }),
    ).toBe(undefined);
  });
});
