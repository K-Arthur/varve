/**
 * Photoshop `.grd` parse CPU baseline — modern descriptor and legacy family
 * across representative gradient counts, including a stop-heavy file.
 *
 * Purpose: regression signal for parser cost so importing a large preset
 * collection never blocks the UI thread for interactive work. The absolute
 * numbers vary by machine; assertions are order-of-magnitude guards only, and
 * the JSON blob (`GRD_PARSE_BENCH`) is the reference record for the docs.
 *
 * Run standalone: npx vitest run packages/import/src/gradient/grd-parse.bench.test.ts
 */
import { describe, expect, it } from 'vitest';
import { parsePhotoshopGrd } from './photoshopGrd';
import { buildLegacyGrd, buildModernGrd } from './testFixtures';

function ramp(
  stopCount: number,
): { position: number; color: readonly [number, number, number, number] }[] {
  const stops = [];
  for (let i = 0; i < stopCount; i += 1) {
    stops.push({
      position: stopCount === 1 ? 0 : i / (stopCount - 1),
      color: [(i * 17) % 256, (i * 41) % 256, (i * 7) % 256, 255] as const,
    });
  }
  return stops;
}

function named(spec: { name: string; colorStops: ReturnType<typeof ramp> }) {
  return {
    ...spec,
    colorStops: spec.colorStops as {
      position: number;
      color: readonly [number, number, number, number];
    }[],
  };
}

function time(fn: () => void, iterations = 5): number {
  let best = Infinity;
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe('.grd parse CPU baseline', () => {
  it('records modern descriptor parse cost across gradient counts', () => {
    const timings: Record<string, number> = {};
    for (const count of [1, 12, 100] as const) {
      const bytes = buildModernGrd(
        Array.from({ length: count }, (_, i) =>
          named({ name: `Gradient ${i}`, colorStops: ramp(5) }),
        ),
      );
      timings[`modern-${count}`] = time(() => {
        const result = parsePhotoshopGrd(bytes);
        expect(result.gradients).toHaveLength(count);
      });
    }
    const stopHeavy = buildModernGrd([named({ name: 'Stop heavy', colorStops: ramp(128) })]);
    timings['modern-128stops'] = time(() => {
      const result = parsePhotoshopGrd(stopHeavy);
      expect(result.gradients[0]!.colorStops).toHaveLength(128);
    });
    for (const elapsed of Object.values(timings)) expect(elapsed).toBeLessThan(250);
    console.info(`GRD_PARSE_BENCH ${JSON.stringify(timings)}`);
  }, 30_000);

  it('records legacy family parse cost', () => {
    const timings: Record<string, number> = {};
    for (const version of [1, 2] as const) {
      const bytes = buildLegacyGrd(
        Array.from({ length: 12 }, (_, i) => named({ name: `Legacy ${i}`, colorStops: ramp(4) })),
        version,
      );
      timings[`legacy-v${version}`] = time(() => {
        const result = parsePhotoshopGrd(bytes);
        expect(result.gradients).toHaveLength(12);
      });
    }
    for (const elapsed of Object.values(timings)) expect(elapsed).toBeLessThan(250);
    console.info(`GRD_PARSE_BENCH ${JSON.stringify(timings)}`);
  }, 30_000);
});
