import { describe, expect, it } from 'vitest';
import {
  defaultPerspectiveQuad,
  isPerspectiveQuadValid,
  normalizeImagePerspective,
  type PerspectiveQuad,
  perspectiveQuadToEngineQuad,
} from '../imagePerspective';
import type { ImageFillData } from '../types';
import { normalizeImageFillData } from '../types';

const SQUARE: PerspectiveQuad = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('defaultPerspectiveQuad', () => {
  it('returns an axis-aligned node box', () => {
    expect(defaultPerspectiveQuad(100, 40)).toEqual([
      [0, 0],
      [100, 0],
      [100, 40],
      [0, 40],
    ]);
  });
});

describe('perspectiveQuadToEngineQuad', () => {
  it('maps scene points to engine Vec2 tuples', () => {
    const q = perspectiveQuadToEngineQuad(SQUARE);
    expect(q).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });
});

describe('isPerspectiveQuadValid', () => {
  it('accepts a convex quad', () => {
    expect(isPerspectiveQuadValid(SQUARE)).toBe(true);
    expect(
      isPerspectiveQuadValid([
        [0, 0],
        [12, 2],
        [9, 11],
        [-1, 8],
      ]),
    ).toBe(true);
  });

  it('rejects absent or wrong-length quads', () => {
    expect(isPerspectiveQuadValid(undefined)).toBe(false);
    expect(
      isPerspectiveQuadValid([SQUARE[0], SQUARE[1], SQUARE[2]] as unknown as PerspectiveQuad),
    ).toBe(false);
  });

  it('rejects non-finite coordinates', () => {
    expect(
      isPerspectiveQuadValid([
        [0, 0],
        [Number.NaN, 0],
        [10, 10],
        [0, 10],
      ]),
    ).toBe(false);
    expect(
      isPerspectiveQuadValid([
        [0, 0],
        [Number.POSITIVE_INFINITY, 0],
        [10, 10],
        [0, 10],
      ]),
    ).toBe(false);
  });

  it('rejects coincident corners', () => {
    expect(
      isPerspectiveQuadValid([
        [0, 0],
        [0, 0],
        [10, 10],
        [0, 10],
      ]),
    ).toBe(false);
  });

  it('rejects collinear / zero-area quads', () => {
    expect(
      isPerspectiveQuadValid([
        [0, 0],
        [3, 0],
        [7, 0],
        [10, 0],
      ]),
    ).toBe(false);
  });

  it('rejects self-crossing quads', () => {
    expect(
      isPerspectiveQuadValid([
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(false);
  });

  it('rejects concave quads', () => {
    expect(
      isPerspectiveQuadValid([
        [0, 0],
        [8, 0],
        [4, 4],
        [8, 8],
      ]),
    ).toBe(false);
  });
});

describe('normalizeImagePerspective', () => {
  it('keeps a valid quad', () => {
    expect(normalizeImagePerspective({ quad: SQUARE })).toEqual({ quad: SQUARE });
  });

  it('drops an invalid quad', () => {
    expect(
      normalizeImagePerspective({
        quad: [
          [0, 0],
          [10, 10],
          [10, 0],
          [0, 10],
        ],
      }),
    ).toBeUndefined();
    expect(normalizeImagePerspective(undefined)).toBeUndefined();
  });
});

describe('normalizeImageFillData — perspective', () => {
  const base: ImageFillData = {
    src: 'data:image/png;base64,AAAA',
    fit: 'fill',
    x: 0,
    y: 0,
    scale: 1,
  };

  it('preserves a valid perspective transform', () => {
    const normalized = normalizeImageFillData({
      ...base,
      perspective: { quad: defaultPerspectiveQuad(100, 100) },
    });
    expect(normalized.perspective).toEqual({ quad: defaultPerspectiveQuad(100, 100) });
  });

  it('drops an invalid perspective transform rather than rendering broken geometry', () => {
    const normalized = normalizeImageFillData({
      ...base,
      perspective: {
        quad: [
          [0, 0],
          [10, 10],
          [10, 0],
          [0, 10],
        ],
      },
    });
    expect(normalized.perspective).toBeUndefined();
  });
});
