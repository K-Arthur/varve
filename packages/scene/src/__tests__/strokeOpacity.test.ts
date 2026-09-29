import { describe, expect, it } from 'vitest';
import { createStrokeOpacityAccumulator, limitStrokeOpacityDeposit } from '../strokeOpacity';

describe('stroke opacity accumulator', () => {
  it('bounds retained coverage memory and reports when the cap is exhausted', () => {
    const accumulator = createStrokeOpacityAccumulator(64, 64);
    expect(limitStrokeOpacityDeposit(accumulator, '0:0', 0, 0.25, 0.5)).toBe(0.25);
    expect(accumulator.tiles.size).toBe(1);

    expect(limitStrokeOpacityDeposit(accumulator, '1:0', 0, 0.25, 0.5)).toBe(0.25);
    expect(accumulator.overflowed).toBe(true);
    expect(accumulator.tiles.size).toBe(1);
  });

  it('rejects invalid pixels and keeps deposits below the requested ceiling', () => {
    const accumulator = createStrokeOpacityAccumulator(16);
    expect(limitStrokeOpacityDeposit(accumulator, '0:0', -1, 0.5, 0.5)).toBe(0);
    const first = limitStrokeOpacityDeposit(accumulator, '0:0', 3, 0.5, 0.4);
    const second = limitStrokeOpacityDeposit(accumulator, '0:0', 3, 0.5, 0.4);
    const deposited = accumulator.tiles.get('0:0')?.[3] ?? 0;
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    expect(deposited).toBeLessThanOrEqual(Math.ceil(0.4 * 255));
    expect(limitStrokeOpacityDeposit(accumulator, '0:0', 3, 0.5, 0.4)).toBe(0);
  });
});
