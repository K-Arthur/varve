// @vitest-environment jsdom
/**
 * Resampler performance microbenchmark — resize throughput and memory
 * behaviour across algorithms. Run: pnpm bench (filter resample).
 */
import { bench, describe } from 'vitest';
import { resampleImageData } from '../exportPipeline/resample';

function solidImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    data[o] = (i * 7) % 256;
    data[o + 1] = (i * 13) % 256;
    data[o + 2] = (i * 31) % 256;
    data[o + 3] = i % 7 === 0 ? 0 : 255;
  }
  return new ImageData(data, width, height);
}

describe('resample', () => {
  const small = solidImage(256, 256);
  const large = solidImage(2048, 2048);

  bench('256x256 -> 512x512 lanczos3', () => {
    resampleImageData(small, 512, 512, { algorithm: 'lanczos3' });
  });

  bench('256x256 -> 64x64 area', () => {
    resampleImageData(small, 64, 64, { algorithm: 'area' });
  });

  bench('2048x2048 -> 512x512 area', () => {
    resampleImageData(large, 512, 512, { algorithm: 'area' });
  });

  bench('2048x2048 -> 4096x4096 lanczos3', () => {
    resampleImageData(large, 4096, 4096, { algorithm: 'lanczos3' });
  });

  bench('2048x2048 -> 1024x1024 auto (area)', () => {
    resampleImageData(large, 1024, 1024);
  });

  bench('2048x2048 -> 2048x2048 auto (lanczos2) tiled 128', () => {
    resampleImageData(large, 1024, 1024, { tileHeight: 128 });
  });
});
