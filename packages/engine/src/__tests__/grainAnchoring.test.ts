import { describe, expect, it } from 'vitest';
import {
  type GrainSampleParams,
  grainTextureCoords,
  isProceduralGrain,
  resolveGrainDetailed,
  sampleGrainPlane,
} from '../grainSampler';
import { type GrainPlane, GrainTextureCache, samplePlane } from '../grainTexture';

function params(overrides: Partial<GrainSampleParams> = {}): GrainSampleParams {
  return {
    scale: 1,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    contrast: 1,
    invert: false,
    anchor: 'layer',
    strokeT: 0,
    ...overrides,
  };
}

/** 4x4 plane whose value encodes its texel index. */
function gradientPlane(): GrainPlane {
  const data = new Uint8Array(16);
  for (let i = 0; i < 16; i++) data[i] = i * 16;
  return { width: 4, height: 4, data };
}

describe('grain anchoring', () => {
  it('keeps layer-anchored grain fixed to layer pixels', () => {
    // The same layer pixel maps to the same texel regardless of which dab or
    // stroke position painted it — this is what stops grain crawling on pan.
    const a = grainTextureCoords(100, 50, params({ anchor: 'layer', dabX: 10, dabY: 10 }));
    const b = grainTextureCoords(
      100,
      50,
      params({ anchor: 'layer', dabX: 900, dabY: 900, strokeDistance: 400 }),
    );
    expect(a).toEqual(b);
  });

  it('moves brush-anchored grain with the dab', () => {
    const first = grainTextureCoords(110, 50, params({ anchor: 'brush', dabX: 100, dabY: 50 }));
    const second = grainTextureCoords(210, 50, params({ anchor: 'brush', dabX: 200, dabY: 50 }));
    // Same offset within the dab → same texel, so each stamp looks alike.
    expect(first).toEqual(second);
  });

  it('slides stroke-anchored grain along the stroke', () => {
    const start = grainTextureCoords(100, 0, params({ anchor: 'stroke', strokeDistance: 0 }));
    const later = grainTextureCoords(100, 0, params({ anchor: 'stroke', strokeDistance: 40 }));
    expect(later.u).toBeCloseTo(start.u - 40, 9);
  });

  it('applies scale and rotation about the anchor origin', () => {
    const scaled = grainTextureCoords(20, 0, params({ scale: 4 }));
    expect(scaled.u).toBeCloseTo(5, 9);
    const rotated = grainTextureCoords(10, 0, params({ rotation: Math.PI / 2 }));
    expect(rotated.u).toBeCloseTo(0, 9);
    expect(rotated.v).toBeCloseTo(10, 9);
  });

  it('rotates with stroke direction only when asked', () => {
    const fixed = grainTextureCoords(10, 0, params({ direction: Math.PI / 2 }));
    const following = grainTextureCoords(
      10,
      0,
      params({ direction: Math.PI / 2, followDirection: true }),
    );
    expect(fixed.u).toBeCloseTo(10, 9);
    expect(following.v).toBeCloseTo(10, 9);
  });
});

describe('grain plane sampling', () => {
  it('wraps negative coordinates instead of mirroring across the origin', () => {
    const plane = gradientPlane();
    // A floored modulo maps -1 to the last texel; `%` would map it to 0.
    expect(samplePlane(plane, -1, 0)).toBeCloseTo(samplePlane(plane, 3, 0), 9);
    expect(samplePlane(plane, -4, 0)).toBeCloseTo(samplePlane(plane, 0, 0), 9);
  });

  it('supports clamp and mirror edge modes', () => {
    const plane = gradientPlane();
    expect(samplePlane(plane, 99, 0, 'clamp')).toBeCloseTo(samplePlane(plane, 3, 0), 9);
    expect(samplePlane(plane, 4, 0, 'mirror')).toBeCloseTo(samplePlane(plane, 3, 0), 9);
  });

  it('produces stable values for the same layer pixel', () => {
    const plane = gradientPlane();
    const p = params({ anchor: 'layer' });
    expect(sampleGrainPlane(plane, 7, 3, p)).toBe(sampleGrainPlane(plane, 7, 3, p));
  });
});

describe('missing grain resources', () => {
  it('reports a missing texture instead of substituting another one', () => {
    const result = resolveGrainDetailed('not-loaded.png', 0, 0, params());
    expect(result.missing).toBe(true);
    // Unmodulated coverage — visibly "no grain", never a different texture.
    expect(result.value).toBe(1);
  });

  it('treats an absent or procedural id as procedural', () => {
    expect(isProceduralGrain(undefined)).toBe(true);
    expect(isProceduralGrain('procedural')).toBe(true);
    expect(isProceduralGrain('paper.png')).toBe(false);
    expect(resolveGrainDetailed(undefined, 3, 4, params()).missing).toBe(false);
  });
});

describe('grain texture cache', () => {
  it('evicts least-recently-used planes to stay inside its budget', () => {
    const cache = new GrainTextureCache(32);
    cache.putPlane('a', { width: 4, height: 4, data: new Uint8Array(16) });
    cache.putPlane('b', { width: 4, height: 4, data: new Uint8Array(16) });
    cache.get('a'); // touch 'a' so 'b' becomes the oldest
    cache.putPlane('c', { width: 4, height: 4, data: new Uint8Array(16) });

    expect(cache.decodedBytes).toBeLessThanOrEqual(32);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('replaces an entry without double-counting its bytes', () => {
    const cache = new GrainTextureCache(1024);
    cache.putPlane('a', { width: 4, height: 4, data: new Uint8Array(16) });
    cache.putPlane('a', { width: 4, height: 4, data: new Uint8Array(16) });
    expect(cache.size).toBe(1);
    expect(cache.decodedBytes).toBe(16);
  });

  it('releases everything on clear', () => {
    const cache = new GrainTextureCache();
    cache.putPlane('a', { width: 2, height: 2, data: new Uint8Array(4) });
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.decodedBytes).toBe(0);
  });
});
