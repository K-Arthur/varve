import { describe, expect, it } from 'vitest';
import { BLOOM_KERNEL } from './kernels/bloom';
import {
  type EffectDispatchRequest,
  type EffectPass,
  formatShaderDiagnostics,
  planEffectPasses,
  snapshotEffectDispatchRequest,
} from './runner';

function pass(overrides: Partial<EffectPass> = {}): EffectPass {
  return {
    entry: 'main',
    params: new Float32Array(),
    textures: ['out', 'src'],
    sampler: 'nearest',
    workgroup: [8, 8, 1],
    ...overrides,
  };
}

describe('GPU effect pass planner', () => {
  it('uses the producer dimensions for a lower-resolution intermediate', () => {
    const planned = planEffectPasses(
      [
        pass({
          textures: ['half', 'src'],
          size: { width: 24, height: 16 },
        }),
        pass({
          textures: ['out', 'half', 'src'],
          size: { width: 48, height: 32 },
        }),
      ],
      { width: 48, height: 32 },
    );

    expect(planned[1]?.inputs).toEqual([
      { name: 'half', width: 24, height: 16 },
      { name: 'src', width: 48, height: 32 },
    ]);
  });

  it('rejects forward references and same-pass read/write feedback', () => {
    expect(() =>
      planEffectPasses([pass({ textures: ['out', 'future'] })], { width: 8, height: 8 }),
    ).toThrow(/before it is produced/);
    expect(() =>
      planEffectPasses([pass({ textures: ['out', 'out'] })], { width: 8, height: 8 }),
    ).toThrow(/reads and writes/);
  });

  it('allocates Bloom pyramid producers at their declared resolutions', () => {
    const request: EffectDispatchRequest = {
      effect: 'bloom',
      width: 48,
      height: 32,
      quality: 'normal',
      params: { intensity: 1, streakEnabled: true, streakIntensity: 0.5 },
    };
    const surface = { width: request.width, height: request.height };
    const planned = planEffectPasses(BLOOM_KERNEL.buildPasses(request, surface), surface);
    expect(planned.map(({ pass, width, height }) => [pass.textures[0], width, height])).toEqual([
      ['b1', 48, 32],
      ['b2', 24, 16],
      ['b3', 12, 8],
      ['c2', 24, 16],
      ['b2', 24, 16],
      ['c3', 12, 8],
      ['b3', 12, 8],
      ['bloomStreak', 12, 8],
      ['out', 48, 32],
    ]);
    expect(planned.at(-1)?.inputs).toEqual([
      { name: 'b2', width: 24, height: 16 },
      { name: 'bloomStreak', width: 12, height: 8 },
      { name: 'src', width: 48, height: 32 },
    ]);
  });

  it('snapshots nested parameters before a queued request runs', () => {
    const request: EffectDispatchRequest = {
      effect: 'rgbSplit',
      width: 8,
      height: 8,
      quality: 'normal',
      coordSpace: { scale: 2, originX: 1, originY: 2, regionX: 3, regionY: 4 },
      params: { seed: 7, tint: [10, 20, 30] },
    };
    const snapshot = snapshotEffectDispatchRequest(request);
    (request.params.tint as number[])[0] = 240;
    if (request.coordSpace) request.coordSpace.scale = 9;
    expect(snapshot.params.tint).toEqual([10, 20, 30]);
    expect(snapshot.coordSpace?.scale).toBe(2);
  });
});

describe('shader diagnostics', () => {
  it('keeps severity and source locations in the surfaced message', () => {
    expect(
      formatShaderDiagnostics([
        { type: 'error', lineNum: 7, linePos: 3, message: 'unknown identifier' },
        { type: 'warning', message: 'unused parameter' },
      ]),
    ).toBe('error:7:3: unknown identifier\nwarning: unused parameter');
  });
});
