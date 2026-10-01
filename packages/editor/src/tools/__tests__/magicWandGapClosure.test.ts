import { areaSelectionCoverageAt, areaSelectionFromColorRange } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { closeMagicWandGaps } from '../magicWandGapClosure';

const WHITE = { r: 255, g: 255, b: 255 };
const TOLERANCE = 0.02;

function lineArt(gaps: readonly number[]) {
  const width = 9;
  const height = 7;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data.set([255, 255, 255, 255], index * 4);
  }
  const black = (x: number, y: number) => data.set([0, 0, 0, 255], (y * width + x) * 4);
  for (let x = 1; x <= 7; x += 1) {
    if (!gaps.includes(x)) black(x, 1);
    black(x, 5);
  }
  for (let y = 1; y <= 5; y += 1) {
    black(1, y);
    black(7, y);
  }
  return { width, height, data };
}

function selectWhiteRegion(source: ReturnType<typeof lineArt>) {
  return areaSelectionFromColorRange(source, WHITE, {
    tolerance: TOLERANCE,
    mode: 'contiguous',
    seed: { x: 4.5, y: 3.5 },
  });
}

describe('visible-artwork Magic Wand gap closure', () => {
  it('bridges a bounded two-pixel contour gap without selecting the exterior', async () => {
    const source = lineArt([4, 5]);
    const closed = await closeMagicWandGaps(source, {
      target: WHITE,
      reach: TOLERANCE,
      radius: 1,
    });
    const selection = selectWhiteRegion(source)!;

    expect(closed).toBe('closed');
    expect(areaSelectionCoverageAt(selection, { x: 4.5, y: 3.5 })).toBe(1);
    expect(areaSelectionCoverageAt(selection, { x: 4.5, y: 0.5 })).toBe(0);
  });

  it('leaves a wider opening connected when it exceeds the configured radius', async () => {
    const source = lineArt([2, 3, 4, 5]);
    await closeMagicWandGaps(source, {
      target: WHITE,
      reach: TOLERANCE,
      radius: 1,
    });
    const selection = selectWhiteRegion(source)!;

    expect(areaSelectionCoverageAt(selection, { x: 4.5, y: 0.5 })).toBe(1);
  });

  it('preserves the source for a disabled control and yields to cancellation', async () => {
    const source = lineArt([4, 5]);
    const before = source.data.slice();
    expect(await closeMagicWandGaps(source, { target: WHITE, reach: TOLERANCE, radius: 0 })).toBe(
      'unchanged',
    );
    expect(source.data).toEqual(before);

    const controller = new AbortController();
    controller.abort();
    expect(
      await closeMagicWandGaps(source, {
        target: WHITE,
        reach: TOLERANCE,
        radius: 1,
        signal: controller.signal,
      }),
    ).toBe('cancelled');
    expect(source.data).toEqual(before);

    const height = 300;
    const width = 64;
    const largeSource = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4).fill(255),
    };
    const largeBefore = largeSource.data.slice();
    const inFlight = new AbortController();
    const pending = closeMagicWandGaps(largeSource, {
      target: WHITE,
      reach: TOLERANCE,
      radius: 1,
      signal: inFlight.signal,
    });
    setTimeout(() => inFlight.abort(), 0);
    expect(await pending).toBe('cancelled');
    expect(largeSource.data).toEqual(largeBefore);
  });
});
