// @vitest-environment node
/**
 * Boolean geometry throughput fixtures.
 *
 * These intentionally exercise the polygon kernel at the sizes seen in
 * imported SVG/Figma paths. They are measurements, not correctness gates:
 * run with `pnpm vitest bench --run --pool=forks
 * packages/scene/src/__benchmarks__/booleanGeometry.bench.ts`.
 */
import { bench, describe } from 'vitest';
import { booleanNormalized } from '../boolean/engine';
import type { Point2D } from '../boolean/region';

function regularPolygon(edges: number, radius: number, cx: number, cy: number): Point2D[] {
  return Array.from({ length: edges }, (_, index) => {
    const angle = (index / edges) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

describe('Boolean geometry kernel', () => {
  for (const edges of [16, 128, 512, 1_024]) {
    const subject = regularPolygon(edges, 200, 0, 0);
    const clip = regularPolygon(edges, 150, 35, 0);
    const operands = [subject, clip, regularPolygon(edges, 80, -35, 20)];

    bench(`union (${edges} edges × 2)`, () => {
      booleanNormalized([subject, clip], 'union');
    });

    bench(`exclude (${edges} edges × 3)`, () => {
      booleanNormalized(operands, 'exclude');
    });
  }
});
