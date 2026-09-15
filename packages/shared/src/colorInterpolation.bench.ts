import { bench, describe } from 'vitest';
import {
  expandGradientStops,
  type GradientStopInput,
  sampleGradientColor,
} from './colorInterpolation';

function stops(count: number): GradientStopInput[] {
  return Array.from({ length: count }, (_, index) => ({
    position: index / Math.max(1, count - 1),
    color: {
      space: 'rgb' as const,
      r: (index * 47) % 256,
      g: (index * 89) % 256,
      b: (index * 131) % 256,
      a: 255,
    },
  }));
}

const twoStops = stops(2);
const twentyStops = stops(20);
const hundredStops = stops(100);

describe('gradient interpolation benchmarks', () => {
  bench('sample 2-stop OKLab gradient', () => {
    sampleGradientColor(twoStops, 0.37, 'oklab');
  });

  bench('expand 20-stop OKLCH ramp', () => {
    expandGradientStops(twentyStops, 'oklch', 16);
  });

  bench('expand 100-stop OKLab ramp', () => {
    expandGradientStops(hundredStops, 'oklab', 16);
  });

  bench('sample 100-stop OKLCH gradient at 1,000 positions', () => {
    for (let i = 0; i < 1000; i += 1) {
      sampleGradientColor(hundredStops, i / 999, 'oklch');
    }
  });
});
