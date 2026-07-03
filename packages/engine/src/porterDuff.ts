/**
 * Software Porter-Duff compositing operators.
 *
 * Research basis: W3C Compositing and Blending Level 1 §9 (Porter Duff
 * operators). Canvas2D `globalCompositeOperation` provides hardware-
 * accelerated implementations; this module provides the same math in
 * pure JS for OffscreenCanvas contexts where GCO coverage is incomplete
 * or for pixel-accurate software rendering pipelines.
 *
 * Each operator is defined by its Fa and Fb coefficients:
 *   co = as × Fa × Cs + ab × Fb × Cb
 *   ao = as × Fa + ab × Fb
 *
 * Where Cs and Cb are non-premultiplied [r,g,b] in [0, 1], and as, ab
 * are alpha in [0, 1]. Result co, ao is non-premultiplied.
 *
 * Porter-Duff operators (12 total):
 *   clear, copy, source-over, destination-over, source-in, destination-in,
 *   source-out, destination-out, source-atop, destination-atop, xor, lighter
 */

export type PorterDuffOp =
  | 'clear'
  | 'copy'
  | 'source-over'
  | 'destination-over'
  | 'source-in'
  | 'destination-in'
  | 'source-out'
  | 'destination-out'
  | 'source-atop'
  | 'destination-atop'
  | 'xor'
  | 'lighter';

interface PorterDuffCoeffs {
  Fa: number;
  Fb: number;
}

/**
 * Compute Fa and Fb coefficients for any Porter-Duff operator,
 * given source and backdrop alpha values.
 *
 * Per W3C Compositing and Blending Level 1 §9.1:
 *   clear:           Fa = 0,           Fb = 0
 *   copy:            Fa = 1,           Fb = 0
 *   source-over:     Fa = 1,           Fb = 1 - as
 *   destination-over: Fa = 1 - ab,     Fb = 1
 *   source-in:       Fa = ab,          Fb = 0
 *   destination-in:  Fa = 0,           Fb = as
 *   source-out:      Fa = 1 - ab,      Fb = 0
 *   destination-out: Fa = 0,           Fb = 1 - as
 *   source-atop:     Fa = ab,          Fb = 1 - as
 *   destination-atop: Fa = 1 - ab,     Fb = as
 *   xor:             Fa = 1 - ab,      Fb = 1 - as
 *   lighter:         Fa = 1,           Fb = 1
 */
function porterDuffCoeffs(op: PorterDuffOp, as: number, ab: number): PorterDuffCoeffs {
  switch (op) {
    case 'clear':
      return { Fa: 0, Fb: 0 };
    case 'copy':
      return { Fa: 1, Fb: 0 };
    case 'source-over':
      return { Fa: 1, Fb: 1 - as };
    case 'destination-over':
      return { Fa: 1 - ab, Fb: 1 };
    case 'source-in':
      return { Fa: ab, Fb: 0 };
    case 'destination-in':
      return { Fa: 0, Fb: as };
    case 'source-out':
      return { Fa: 1 - ab, Fb: 0 };
    case 'destination-out':
      return { Fa: 0, Fb: 1 - as };
    case 'source-atop':
      return { Fa: ab, Fb: 1 - as };
    case 'destination-atop':
      return { Fa: 1 - ab, Fb: as };
    case 'xor':
      return { Fa: 1 - ab, Fb: 1 - as };
    case 'lighter':
      return { Fa: 1, Fb: 1 };
  }
}

/**
 * Composite a single pixel pair using the given Porter-Duff operator.
 *
 * @param backdrop  Non-premultiplied [r, g, b, a] in [0, 1].
 * @param source    Non-premultiplied [r, g, b, a] in [0, 1].
 * @param operator  Porter-Duff operator.
 * @returns         Non-premultiplied [r, g, b, a] in [0, 1].
 */
export function compositePixels(
  backdrop: readonly [number, number, number, number],
  source: readonly [number, number, number, number],
  operator: PorterDuffOp,
): [number, number, number, number] {
  const [br, bg, bb, ba] = backdrop;
  const [sr, sg, sb, sa] = source;

  const { Fa, Fb } = porterDuffCoeffs(operator, sa, ba);

  const ao = sa * Fa + ba * Fb;
  if (ao === 0) return [0, 0, 0, 0];

  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  return [
    clamp((sa * Fa * sr + ba * Fb * br) / ao),
    clamp((sa * Fa * sg + ba * Fb * bg) / ao),
    clamp((sa * Fa * sb + ba * Fb * bb) / ao),
    clamp(ao),
  ];
}

/**
 * Composite a full ImageData buffer using a Porter-Duff operator.
 *
 * @param backdrop  Backdrop ImageData (modified in-place).
 * @param source    Source ImageData (unchanged).
 * @param operator  Porter-Duff operator.
 * @returns         New ImageData with the composited result.
 */
export function porterDuffCompositing(
  backdrop: ImageData,
  source: ImageData,
  operator: PorterDuffOp,
): ImageData {
  const w = Math.min(backdrop.width, source.width);
  const h = Math.min(backdrop.height, source.height);
  const result = new ImageData(w, h);
  const bd: Uint8ClampedArray = backdrop.data;
  const sd: Uint8ClampedArray = source.data;
  const rd: Uint8ClampedArray = result.data;

  for (let i = 0; i < w * h; i++) {
    const offset = i * 4;

    const br = bd[offset]! / 255;
    const bg = bd[offset + 1]! / 255;
    const bb = bd[offset + 2]! / 255;
    const ba = bd[offset + 3]! / 255;
    const sr = sd[offset]! / 255;
    const sg = sd[offset + 1]! / 255;
    const sb = sd[offset + 2]! / 255;
    const sa = sd[offset + 3]! / 255;

    const [mr, mg, mb, ma] = compositePixels([br, bg, bb, ba], [sr, sg, sb, sa], operator);

    rd[offset] = Math.round(Math.max(0, Math.min(255, mr * 255)));
    rd[offset + 1] = Math.round(Math.max(0, Math.min(255, mg * 255)));
    rd[offset + 2] = Math.round(Math.max(0, Math.min(255, mb * 255)));
    rd[offset + 3] = Math.round(Math.max(0, Math.min(255, ma * 255)));
  }

  return result;
}

/** Map Porter-Duff operator to Canvas2D globalCompositeOperation string. */
export function mapPorterDuffOp(op: PorterDuffOp): string {
  switch (op) {
    case 'clear':
      return 'clear';
    case 'copy':
      return 'copy';
    case 'source-over':
      return 'source-over';
    case 'destination-over':
      return 'destination-over';
    case 'source-in':
      return 'source-in';
    case 'destination-in':
      return 'destination-in';
    case 'source-out':
      return 'source-out';
    case 'destination-out':
      return 'destination-out';
    case 'source-atop':
      return 'source-atop';
    case 'destination-atop':
      return 'destination-atop';
    case 'xor':
      return 'xor';
    case 'lighter':
      return 'lighter';
  }
}
