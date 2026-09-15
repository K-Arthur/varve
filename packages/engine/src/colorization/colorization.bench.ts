// @vitest-environment node
/**
 * Deterministic Colorize CPU baseline.
 *
 * This intentionally measures the same bounded 256px class of work used by
 * the inspector preview. It does not stand in for DDColor model latency;
 * model benchmarks require a verified artifact and a named runtime/provider.
 * Run with:
 *   pnpm exec vitest bench --run --pool=forks packages/engine/src/colorization/colorization.bench.ts
 */
import { bench } from 'vitest';
import { paletteColorize } from './palette';
import { selectiveRecolor } from './recolor';
import { colorTransferLab } from './transfer';

function makeImage(width: number, height: number, phase: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      const wave = Math.sin((x + phase) * 0.08) * 18 + Math.cos((y - phase) * 0.05) * 14;
      data[pixel] = Math.max(0, Math.min(255, 128 + wave + x * 0.18));
      data[pixel + 1] = Math.max(0, Math.min(255, 112 + wave + y * 0.16));
      data[pixel + 2] = Math.max(0, Math.min(255, 96 + wave));
      data[pixel + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

const preview = makeImage(256, 256, 7);
const reference = makeImage(256, 256, 43);
const mask = new Uint8Array(preview.width * preview.height).fill(255);

bench('tint / selective recolor · 256px preview', () => {
  selectiveRecolor(preview, mask, preview.width, preview.height, 28, 1.15, 1, 1, 'set', 1);
});

bench('palette shaded mapping · 256px preview', () => {
  paletteColorize(preview, ['#0f4c5c', '#e36414', '#fbf5f3'], 0.75, 'shaded');
});

bench('reference transfer · 256px preview', () => {
  colorTransferLab(preview, reference, 1, 0.8, { blendStrength: 0.8 });
});
