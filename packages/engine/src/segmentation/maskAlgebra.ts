/** Pure mask operations shared by Object Selection and downstream consumers. */

export type MaskCombineMode = 'replace' | 'add' | 'subtract' | 'intersect';

export interface AlphaMask {
  data: Uint8Array;
  width: number;
  height: number;
}

function assertSameSize(a: AlphaMask, b: AlphaMask): void {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
    throw new Error('Mask dimensions must match');
  }
}

/** Combine coverage without mutating either input. */
export function combineAlphaMasks(
  base: AlphaMask | null,
  incoming: AlphaMask,
  mode: MaskCombineMode = 'replace',
): AlphaMask {
  if (!base || mode === 'replace') {
    return { data: incoming.data.slice(), width: incoming.width, height: incoming.height };
  }
  assertSameSize(base, incoming);
  const data = new Uint8Array(incoming.data.length);
  for (let i = 0; i < data.length; i += 1) {
    const a = base.data[i]!;
    const b = incoming.data[i]!;
    data[i] =
      mode === 'add'
        ? Math.max(a, b)
        : mode === 'subtract'
          ? Math.round((a * (255 - b)) / 255)
          : Math.min(a, b);
  }
  return { data, width: base.width, height: base.height };
}

export function invertAlphaMask(mask: AlphaMask): AlphaMask {
  const data = mask.data.slice();
  for (let i = 0; i < data.length; i += 1) data[i] = 255 - data[i]!;
  return { data, width: mask.width, height: mask.height };
}
