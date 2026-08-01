import { bench, describe } from 'vitest';
import type { GridSnapConfig } from '../snapping';
import { snapPosition } from '../snapping';

function makeNodeBounds(count: number) {
  const bounds: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let i = 0; i < count; i++) {
    bounds.push({
      x: (i % 100) * 100 + Math.random() * 50,
      y: Math.floor(i / 100) * 100 + Math.random() * 50,
      w: 40 + Math.random() * 80,
      h: 40 + Math.random() * 80,
    });
  }
  return bounds;
}

describe('snapPosition performance', () => {
  const grid: GridSnapConfig = { spacingX: 8, spacingY: 8 };
  for (const count of [100, 1000, 5000]) {
    const candidates = makeNodeBounds(count);
    bench(`snapPosition with ${count} candidates`, () => {
      const session = { stickyX: null, stickyY: null };
      snapPosition(150, 200, 50, 50, candidates, grid, undefined, {
        zoom: 1,
        session,
        sticky: true,
      });
    });
  }
});
