/**
 * Input normalization microbenchmarks.
 *
 * The first case is the pre-fix identity key (pointer ID, time, and position)
 * reconstructed from the former implementation. It is a comparison control,
 * not a correctness path: it intentionally demonstrates why the dynamics-aware
 * key costs a little more while retaining pressure/button changes.
 *
 * Run with:
 *   pnpm exec vitest bench --run packages/editor/src/tools/__benchmarks__/inputNormalizer.bench.ts
 */

import { bench, describe } from 'vitest';
import { canonicalizeInputEvents, type NormalizedInputEvent } from '../inputNormalizer';

function makeSamples(count: number): NormalizedInputEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    clientX: 100 + (index % 64),
    clientY: 200 + Math.floor(index / 64),
    pressure: index % 5 === 0 ? 0.2 : 0.8,
    tiltX: index % 7 === 0 ? 12 : 0,
    tiltY: index % 11 === 0 ? -8 : 0,
    twist: index % 13 === 0 ? 45 : -1,
    tangentialPressure: 0,
    width: 1,
    height: 1,
    pointerType: 'pen',
    rawPointerType: 'pen',
    button: index % 17 === 0 ? 5 : 0,
    buttons: index % 17 === 0 ? 32 : 1,
    altitudeAngle: Math.PI / 2,
    azimuthAngle: 0,
    isPredicted: index % 29 === 0,
    time: index,
    isEraser: index % 17 === 0,
    isPrimary: true,
    pointerId: 1,
  }));
}

function asWasCanonicalize(events: readonly NormalizedInputEvent[]): NormalizedInputEvent[] {
  const confirmed = events.filter((event) => !event.isPredicted).sort((a, b) => a.time - b.time);
  const predicted = events.filter((event) => event.isPredicted).sort((a, b) => a.time - b.time);
  const seen = new Set<string>();
  const result: NormalizedInputEvent[] = [];
  for (const event of [...confirmed, ...predicted]) {
    const key = `${event.pointerId}:${event.time}:${event.clientX}:${event.clientY}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }
  return result;
}

describe('input canonicalization performance', () => {
  for (const count of [64, 256, 1024]) {
    const samples = makeSamples(count);
    bench(`as-was identity key (${count} samples)`, () => {
      asWasCanonicalize(samples);
    });
    bench(`dynamics-aware key (${count} samples)`, () => {
      canonicalizeInputEvents(samples);
    });
  }
});
