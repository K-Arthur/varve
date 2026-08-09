import { describe, expect, it } from 'vitest';
import {
  decayRateFromFrameRetention,
  frameDisplacementToVelocity,
  integrateVelocity,
  navigationFrameDeltaMs,
  REFERENCE_FRAME_MS,
  stepDecayedMotion,
} from '../navigationPhysics';

function simulate(refreshHz: number, durationMs: number) {
  const frameMs = 1000 / refreshHz;
  const decayRate = decayRateFromFrameRetention(0.95);
  let elapsed = 0;
  let position = 0;
  let velocity = { x: 600, y: 0 };
  while (elapsed < durationMs - 1e-9) {
    const dt = Math.min(frameMs, durationMs - elapsed);
    const step = stepDecayedMotion(velocity, dt, decayRate, 0);
    position += step.delta.x;
    velocity = step.velocity;
    elapsed += dt;
  }
  return { position, velocity: velocity.x };
}

describe('navigation physics', () => {
  it('preserves decay and travel across refresh rates', () => {
    const at30 = simulate(30, 1000);
    const at60 = simulate(60, 1000);
    const at144 = simulate(144, 1000);

    expect(at30.position).toBeCloseTo(at60.position, 10);
    expect(at144.position).toBeCloseTo(at60.position, 10);
    expect(at30.velocity).toBeCloseTo(at60.velocity, 10);
    expect(at144.velocity).toBeCloseTo(at60.velocity, 10);
  });

  it('keeps the reference-frame conversion compatible with 60 Hz tuning', () => {
    const velocity = frameDisplacementToVelocity(8);
    expect(integrateVelocity({ x: velocity, y: 0 }, REFERENCE_FRAME_MS).x).toBeCloseTo(8, 10);
  });

  it('clamps long or invalid frame gaps', () => {
    expect(navigationFrameDeltaMs(100, 180)).toBe(50);
    expect(navigationFrameDeltaMs(100, 90)).toBeCloseTo(REFERENCE_FRAME_MS, 10);
    expect(navigationFrameDeltaMs(null, 5000)).toBeCloseTo(REFERENCE_FRAME_MS, 10);
  });

  it('stops only when both axes fall below the speed threshold', () => {
    const moving = stepDecayedMotion({ x: 100, y: 1 }, 16, 4, 10);
    expect(moving.stopped).toBe(false);
    const stopped = stepDecayedMotion({ x: 1, y: 1 }, 16, 4, 10);
    expect(stopped).toEqual({
      delta: expect.any(Object),
      velocity: { x: 0, y: 0 },
      stopped: true,
    });
  });
});
