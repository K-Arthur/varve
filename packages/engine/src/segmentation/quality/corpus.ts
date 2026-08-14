/**
 * License-safe object-selection evaluation corpus.
 *
 * Every fixture is generated from code — no third-party photographs — so the
 * corpus can live in the repository and run in CI. The categories map to the
 * segmentation cases that matter for editor use (mission §62):
 *
 *   circle-plain         product-on-plain-background analog
 *   fuzzy-edge           fur/hair analog (stochastic edge)
 *   thin-geometry        bicycle spokes / thin typography analog
 *   overlapping          overlapping subjects; the prompt disambiguates
 *   tiny-object          small subject in a large frame
 *   touches-edge         subject clipped by the image boundary
 *   low-contrast         subtle foreground/background difference
 *   soft-alpha           translucent/glass analog; oracle is the core region
 *   multiple-similar     several similar objects; the prompt must disambiguate
 *   foliage-like         many small separated regions forming one subject
 *
 * Each fixture records source-image prompt coordinates and a binary oracle
 * mask in source pixels. The oracle is what the *metric* compares against;
 * it is deliberately NOT what a promptable model is expected to produce
 * exactly (real photography is worse), so the release gate uses tolerances.
 */

export interface SegmentationCorpusFixture {
  id: string;
  category: string;
  width: number;
  height: number;
  image: ImageData;
  prompts: {
    points: Array<{ x: number; y: number; label: 1 | 0 }>;
    box?: { x1: number; y1: number; x2: number; y2: number };
  };
  /** Binary oracle mask in source pixels (1 = subject). */
  oracleMask: Uint8Array;
  note: string;
}

type PaintFn = (set: (x: number, y: number) => void, w: number, h: number) => void;

function makeFixture(
  id: string,
  category: string,
  width: number,
  height: number,
  paint: PaintFn,
  prompts: SegmentationCorpusFixture['prompts'],
  note: string,
): SegmentationCorpusFixture {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const oracleMask = new Uint8Array(width * height);
  paint(
    (x, y) => {
      const i = y * width + x;
      pixels[i * 4] = 255;
      pixels[i * 4 + 1] = 255;
      pixels[i * 4 + 2] = 255;
      pixels[i * 4 + 3] = 255;
      oracleMask[i] = 1;
    },
    width,
    height,
  );
  return {
    id,
    category,
    width,
    height,
    image: new ImageData(pixels, width, height),
    prompts,
    oracleMask,
    note,
  };
}

function fillCircle(
  cx: number,
  cy: number,
  radius: number,
  out: (x: number, y: number) => void,
  w: number,
  h: number,
): void {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(w - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(h - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) out(x, y);
    }
  }
}

function fillRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: (x: number, y: number) => void,
  w: number,
  h: number,
): void {
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) out(x, y);
  }
}

/** Deterministic pseudo-random generator so fixture edges are reproducible. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function fixtureCirclePlain(): SegmentationCorpusFixture {
  const w = 128;
  const h = 128;
  return makeFixture(
    'circle-plain',
    'plain-background',
    w,
    h,
    (out, width, height) => fillCircle(64, 64, 40, out, width, height),
    { points: [{ x: 64, y: 64, label: 1 }] },
    'Product-on-plain analog: a single object fully inside the frame.',
  );
}

function fixtureFuzzyEdge(): SegmentationCorpusFixture {
  const w = 128;
  const h = 128;
  const rng = makeRng(42);
  return makeFixture(
    'fuzzy-edge',
    'hair-fur',
    w,
    h,
    (out, width, height) => {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x - 64;
          const dy = y - 64;
          const d = Math.sqrt(dx * dx + dy * dy);
          const jitter = (rng() - 0.5) * 6;
          if (d + jitter < 38) out(x, y);
        }
      }
    },
    { points: [{ x: 64, y: 64, label: 1 }], box: { x1: 16, y1: 16, x2: 112, y2: 112 } },
    'Hair/fur analog: the oracle boundary is stochastic, so no promptable model is expected to match it exactly.',
  );
}

function fixtureThinGeometry(): SegmentationCorpusFixture {
  const w = 128;
  const h = 128;
  return makeFixture(
    'thin-geometry',
    'thin-geometry',
    w,
    h,
    (out, width, height) => {
      fillCircle(64, 64, 36, out, width, height);
      fillCircle(64, 64, 20, out, width, height);
      for (let a = 0; a < 8; a++) {
        const angle = (a * Math.PI) / 4;
        const x0 = Math.round(64 + Math.cos(angle) * 20);
        const y0 = Math.round(64 + Math.sin(angle) * 20);
        const x1 = Math.round(64 + Math.cos(angle) * 36);
        const y1 = Math.round(64 + Math.sin(angle) * 36);
        for (let t = 0; t <= 1; t += 0.01) {
          const px = Math.round(x0 + (x1 - x0) * t);
          const py = Math.round(y0 + (y1 - y0) * t);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) out(px + dx, py + dy);
          }
        }
      }
    },
    { points: [{ x: 64, y: 64, label: 1 }] },
    'Bicycle-spoke / thin-typography analog: a ring with 1px spokes.',
  );
}

function fixtureOverlapping(): SegmentationCorpusFixture {
  const w = 128;
  const h = 128;
  const paintLeft = (out: (x: number, y: number) => void, width: number, height: number) =>
    fillCircle(48, 64, 32, out, width, height);
  const paintRight = (out: (x: number, y: number) => void, width: number, height: number) =>
    fillCircle(80, 64, 32, out, width, height);
  const image = makeFixture(
    'overlapping',
    'overlapping',
    w,
    h,
    (out, width, height) => {
      paintLeft(out, width, height);
      paintRight(out, width, height);
    },
    { points: [{ x: 40, y: 64, label: 1 }] },
    '',
  );
  // Oracle = only the left circle, so the prompt must disambiguate the union.
  const left = makeFixture('overlapping-left', 'overlapping', w, h, paintLeft, { points: [] }, '');
  const oracleMask = left.oracleMask;
  return { ...image, prompts: { points: [{ x: 40, y: 64, label: 1 }] }, oracleMask };
}

function fixtureTinyObject(): SegmentationCorpusFixture {
  const w = 128;
  const h = 128;
  return makeFixture(
    'tiny-object',
    'tiny-object',
    w,
    h,
    (out, width, height) => fillRect(58, 58, 70, 70, out, width, height),
    { points: [{ x: 64, y: 64, label: 1 }] },
    'Tiny subject: 12px square in a 128px frame.',
  );
}

function fixtureTouchesEdge(): SegmentationCorpusFixture {
  const w = 128;
  const h = 128;
  return makeFixture(
    'touches-edge',
    'touches-edge',
    w,
    h,
    (out, width, height) => {
      fillCircle(0, 64, 44, out, width, height);
      fillCircle(64, 128, 40, out, width, height);
    },
    { points: [{ x: 10, y: 64, label: 1 }] },
    'Subject clipped by two image edges; the visible part must be selected.',
  );
}

function fixtureLowContrast(): SegmentationCorpusFixture {
  const w = 128;
  const h = 128;
  const rng = makeRng(7);
  const pixels = new Uint8ClampedArray(w * h * 4);
  const oracleMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const inSubject = (x - 64) ** 2 + (y - 64) ** 2 < 40 ** 2;
      const value = inSubject ? 118 + rng() * 8 : 108 + rng() * 8;
      pixels[i * 4] = value;
      pixels[i * 4 + 1] = value;
      pixels[i * 4 + 2] = value;
      pixels[i * 4 + 3] = 255;
      if (inSubject) oracleMask[i] = 1;
    }
  }
  return {
    id: 'low-contrast',
    category: 'low-contrast',
    width: w,
    height: h,
    image: new ImageData(pixels, w, h),
    prompts: { points: [{ x: 64, y: 64, label: 1 }] },
    oracleMask,
    note: 'Only 8 gray levels separate subject and background — color is nearly useless; geometry must carry the answer.',
  };
}

function fixtureSoftAlpha(): SegmentationCorpusFixture {
  const w = 128;
  const h = 128;
  const pixels = new Uint8ClampedArray(w * h * 4);
  const oracleMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = Math.sqrt((x - 64) ** 2 + (y - 64) ** 2);
      const alpha = d < 30 ? 255 : d < 42 ? Math.round(255 * (1 - (d - 30) / 12)) : 0;
      pixels[i * 4] = 255;
      pixels[i * 4 + 1] = 255;
      pixels[i * 4 + 2] = 255;
      pixels[i * 4 + 3] = alpha;
      if (d < 34) oracleMask[i] = 1;
    }
  }
  return {
    id: 'soft-alpha',
    category: 'glass-translucency',
    width: w,
    height: h,
    image: new ImageData(pixels, w, h),
    prompts: { points: [{ x: 64, y: 64, label: 1 }] },
    oracleMask,
    note: 'Glass/translucency analog: a feathered alpha ramp. The oracle is the opaque core; a segmentation model and a matting model legitimately differ here.',
  };
}

function fixtureMultipleSimilar(): SegmentationCorpusFixture {
  const w = 128;
  const h = 128;
  const left = makeFixture(
    'left',
    'multiple-similar',
    w,
    h,
    (out, width, height) => fillCircle(32, 64, 24, out, width, height),
    { points: [{ x: 32, y: 64, label: 1 }] },
    'Left circle mask, composed into the multiple-similar scene.',
  );
  const middle = makeFixture(
    'middle',
    'multiple-similar',
    w,
    h,
    (out, width, height) => fillCircle(64, 64, 24, out, width, height),
    { points: [{ x: 64, y: 64, label: 1 }] },
    'Middle circle mask — the oracle subject of the multiple-similar scene.',
  );
  const right = makeFixture(
    'right',
    'multiple-similar',
    w,
    h,
    (out, width, height) => fillCircle(96, 64, 24, out, width, height),
    { points: [{ x: 96, y: 64, label: 1 }] },
    'Right circle mask, composed into the multiple-similar scene.',
  );
  const pixels = new Uint8ClampedArray(w * h * 4);
  const oracleMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (left.oracleMask[i] || middle.oracleMask[i] || right.oracleMask[i]) {
        pixels[i * 4] = 255;
        pixels[i * 4 + 1] = 255;
        pixels[i * 4 + 2] = 255;
        pixels[i * 4 + 3] = 255;
      }
      if (middle.oracleMask[i]) oracleMask[i] = 1;
    }
  }
  return {
    id: 'multiple-similar',
    category: 'multiple-similar',
    width: w,
    height: h,
    image: new ImageData(pixels, w, h),
    prompts: { points: [{ x: 64, y: 64, label: 1 }] },
    oracleMask,
    note: 'Three identical circles; the oracle is only the middle one. Tests prompt disambiguation, not arbitrary auto-mask ranking.',
  };
}

function fixtureFoliage(): SegmentationCorpusFixture {
  const w = 128;
  const h = 128;
  const rng = makeRng(99);
  const blobs: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i < 40; i++) {
    blobs.push({ x: 50 + rng() * 28, y: 50 + rng() * 28, r: 1.5 + rng() * 3 });
  }
  return makeFixture(
    'foliage-like',
    'foliage',
    w,
    h,
    (out, width, height) => {
      for (const b of blobs) fillCircle(b.x, b.y, b.r, out, width, height);
    },
    { points: [{ x: 64, y: 64, label: 1 }], box: { x1: 30, y1: 30, x2: 98, y2: 98 } },
    'Foliage analog: many small disconnected regions that together form one subject.',
  );
}

export const SEGMENTATION_CORPUS: SegmentationCorpusFixture[] = [
  fixtureCirclePlain(),
  fixtureFuzzyEdge(),
  fixtureThinGeometry(),
  fixtureOverlapping(),
  fixtureTinyObject(),
  fixtureTouchesEdge(),
  fixtureLowContrast(),
  fixtureSoftAlpha(),
  fixtureMultipleSimilar(),
  fixtureFoliage(),
];
