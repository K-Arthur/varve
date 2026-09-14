// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  computeSaliencyMap,
  mapProposalMaskToSource,
  proposeForegroundSubjects,
  selectForegroundCenter,
} from './foregroundSelect';

function makeSolidImage(width: number, height: number, r: number, g: number, b: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = 255;
  }
  return new ImageData(data, width, height);
}

function makeTwoToneImage(
  width: number,
  height: number,
  splitX: number,
  fgR: number,
  fgG: number,
  fgB: number,
  bgR: number,
  bgG: number,
  bgB: number,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const isLeft = x < splitX;
      data[idx] = isLeft ? fgR : bgR;
      data[idx + 1] = isLeft ? fgG : bgG;
      data[idx + 2] = isLeft ? fgB : bgB;
      data[idx + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

describe('selectForegroundCenter', () => {
  it('selects foreground region based on center color', () => {
    const img = makeTwoToneImage(100, 100, 60, 255, 255, 255, 0, 0, 0);
    const result = selectForegroundCenter(img);

    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
    expect(result.mask.length).toBe(10000);

    // Center area (x=50, y=50) should be foreground (white region)
    const centerIdx = 50 * 100 + 50;
    expect(result.mask[centerIdx]).toBe(255);

    // Far left area should be foreground (white)
    expect(result.mask[5 * 100 + 5]).toBe(255);

    // Far right should be background (black)
    expect(result.mask[5 * 100 + 95]).toBe(0);
  });

  it('handles solid image (all one color)', () => {
    const img = makeSolidImage(20, 20, 128, 128, 128);
    const result = selectForegroundCenter(img);

    // Most pixels should be foreground
    const fgCount = result.mask.filter((v) => v === 255).length;
    expect(fgCount).toBeGreaterThan(300);
  });

  it('has confidence in expected range', () => {
    const img = makeTwoToneImage(50, 50, 35, 255, 255, 255, 0, 0, 0);
    const result = selectForegroundCenter(img);

    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe('proposeForegroundSubjects', () => {
  function makeSubjectOnBackground(width: number, height: number): ImageData {
    const data = new Uint8ClampedArray(width * height * 4);
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const inSubject = (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
        data[idx] = inSubject ? 220 : 235;
        data[idx + 1] = inSubject ? 40 : 240;
        data[idx + 2] = inSubject ? 40 : 245;
        data[idx + 3] = 255;
      }
    }
    return new ImageData(data, width, height);
  }

  it('proposes a centred subject on a plain background', () => {
    const result = proposeForegroundSubjects(makeSubjectOnBackground(120, 100));
    expect(result.analysisWidth).toBe(120);
    expect(result.analysisHeight).toBe(100);
    expect(result.emptyReason).toBeUndefined();
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    const best = result.candidates[0]!;
    expect(best.mask[50 * 120 + 60]).toBe(255);
    expect(best.mask[5 * 120 + 5]).toBe(0);
    expect(best.coverage).toBeGreaterThan(0.05);
    expect(best.coverage).toBeLessThan(0.3);
    expect(best.score).toBeGreaterThan(0);
    expect(best.score).toBeLessThanOrEqual(1);
  });

  it('keeps a border-touching subject and its alternative as separate proposals', () => {
    const img = makeTwoToneImage(100, 100, 60, 255, 255, 255, 0, 0, 0);
    const result = proposeForegroundSubjects(img);
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    const masks = result.candidates.map((candidate) => candidate.mask);
    expect(masks.some((mask) => mask[50 * 100 + 10] === 255)).toBe(true);
    expect(masks.some((mask) => mask[50 * 100 + 90] === 255)).toBe(true);
  });

  it('exposes an explicit all-foreground union before individual regions', () => {
    const img = makeTwoToneImage(100, 100, 60, 255, 255, 255, 0, 0, 0);
    const result = proposeForegroundSubjects(img);
    const all = result.candidates[0]!;
    expect(all.label).toBe('All foreground');
    expect(all.mask[50 * 100 + 10]).toBe(255);
    expect(all.mask[50 * 100 + 90]).toBe(255);
    expect(
      result.candidates.slice(1).every((candidate) => candidate.label !== 'All foreground'),
    ).toBe(true);
    expect(
      result.candidates.slice(1).some((candidate) => candidate.mask[50 * 100 + 10] === 0),
    ).toBe(true);
  });

  it('is deterministic for identical input', () => {
    const img = makeSubjectOnBackground(80, 80);
    const first = proposeForegroundSubjects(img);
    const second = proposeForegroundSubjects(img);
    expect(second.candidates.map((candidate) => candidate.score)).toEqual(
      first.candidates.map((candidate) => candidate.score),
    );
  });

  it('reports why an all-transparent image has no proposal', () => {
    const img = makeSolidImage(40, 40, 0, 0, 0);
    for (let index = 3; index < img.data.length; index += 4) img.data[index] = 0;
    const result = proposeForegroundSubjects(img);
    expect(result.candidates).toHaveLength(0);
    expect(result.emptyReason).toBe('all-transparent');
  });

  it('returns no-subject for a solid opaque image', () => {
    const result = proposeForegroundSubjects(makeSolidImage(40, 40, 128, 128, 128));
    expect(result.candidates).toHaveLength(0);
    expect(result.emptyReason).toBe('no-subject');
  });

  it('maps an analysis-resolution proposal back to source pixels', () => {
    const analysis = new Uint8Array(4);
    analysis[0] = 255;
    const mapped = mapProposalMaskToSource(analysis, 2, 2, 4, 4)!;
    expect(mapped.length).toBe(16);
    expect(mapped[0]).toBe(255);
    expect(mapped[5]).toBe(255);
    expect(mapped[15]).toBe(0);
  });

  it('caps analysis resolution for large images', () => {
    const result = proposeForegroundSubjects(makeSubjectOnBackground(2048, 1024), {
      analysisMaxDimension: 256,
    });
    expect(result.analysisWidth).toBe(256);
    expect(result.analysisHeight).toBe(128);
    expect(result.width).toBe(2048);
    expect(result.height).toBe(1024);
  });
});

describe('computeSaliencyMap', () => {
  it('returns saliency map with center bias', () => {
    const img = makeTwoToneImage(50, 50, 25, 0, 0, 255, 128, 128, 128);
    const saliency = computeSaliencyMap(img);

    expect(saliency.length).toBe(2500);
    // Center should have higher saliency than corners
    const centerVal = saliency[25 * 50 + 25]!;
    const cornerVal = saliency[0]!;
    expect(centerVal).toBeGreaterThanOrEqual(cornerVal);
  });
});
