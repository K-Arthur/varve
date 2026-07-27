import { upscaleImageData } from '../imageEnhancement';
import { type PixelArtAlgorithm, scalePixelArt } from '../pixelArtScaling';
import {
  computeAlphaDifference,
  computeColorDifference,
  computeMultiScaleSsim,
  computePalettePreservation,
  computePsnr,
  computeSsim,
  computeTileBoundaryDifference,
  extractRegion,
  hasNanPixels,
} from './metrics';
import type { QualityFixture, QualityMetricResult, QualityReport } from './qualityTypes';

export interface EvaluationOptions {
  algorithms: Array<{
    name: string;
    type: 'cpu' | 'pixel-art' | 'ai';
    scale: number;
    pixelArtAlgo?: PixelArtAlgorithm;
  }>;
  reportPartial?: boolean;
}

export async function evaluateFixture(
  fixture: QualityFixture,
  options: EvaluationOptions,
): Promise<QualityMetricResult[]> {
  const results: QualityMetricResult[] = [];

  for (const algo of options.algorithms) {
    const start = performance.now();
    const result: QualityMetricResult = {
      fixtureId: fixture.id,
      algorithm: algo.name,
      scale: algo.scale,
      psnr: null,
      ssim: null,
      msSim: null,
      colorDifference: null,
      alphaDifference: null,
      tileBoundaryDifference: null,
      dimensionsMatch: false,
      hasNanPixels: false,
      palettePreserved: null,
      timingMs: 0,
      regions: {},
    };

    try {
      const input = await loadFixtureImage(fixture.inputPath);
      if (!input) {
        result.error = 'Failed to load fixture';
        results.push(result);
        continue;
      }

      let output: ImageData;

      if (algo.type === 'pixel-art') {
        output = scalePixelArt(input, { algorithm: algo.pixelArtAlgo ?? 'epx', scale: algo.scale });
      } else if (algo.type === 'cpu') {
        const method = algo.name.includes('nearest')
          ? 'nearest'
          : algo.name.includes('bilinear')
            ? 'bilinear'
            : algo.name.includes('bicubic')
              ? 'bicubic'
              : algo.name.includes('lanczos')
                ? 'lanczos3'
                : 'bilinear';
        output = upscaleImageData(input, { method, scale: algo.scale });
      } else {
        result.error = 'AI evaluation requires real model; skipped';
        results.push(result);
        continue;
      }

      result.timingMs = performance.now() - start;
      result.hasNanPixels = hasNanPixels(output);

      const expectedW = Math.round(input.width * algo.scale);
      const expectedH = Math.round(input.height * algo.scale);
      result.dimensionsMatch = output.width === expectedW && output.height === expectedH;

      if (fixture.referencePath && fixture.referencePath !== fixture.inputPath) {
        const reference = await loadFixtureImage(fixture.referencePath);
        if (reference && reference.width === output.width && reference.height === output.height) {
          result.psnr = computePsnr(reference, output);
          result.ssim = computeSsim(reference, output);
          result.msSim = computeMultiScaleSsim(reference, output);
          result.colorDifference = computeColorDifference(reference, output);
          result.alphaDifference = computeAlphaDifference(reference, output);

          if (fixture.cropRegions) {
            for (const region of fixture.cropRegions) {
              const refRegion = extractRegion(reference, region);
              const outRegion = extractRegion(output, region);
              result.regions[region.label] = {
                psnr: computePsnr(refRegion, outRegion),
                ssim: computeSsim(refRegion, outRegion),
              };
            }
          }
        }
      }

      result.tileBoundaryDifference = computeTileBoundaryDifference(output, 64);

      if (fixture.thresholds?.palettePreservation) {
        const input2 = await loadFixtureImage(fixture.inputPath);
        if (input2) {
          result.palettePreserved = computePalettePreservation(input2, output);
        }
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : 'Unknown error';
    }

    results.push(result);
  }

  return results;
}

async function loadFixtureImage(path: string): Promise<ImageData | null> {
  if (path.startsWith('synthetic:')) {
    const { generateSyntheticFixtureImage } = await import('./corpusManifest');
    return generateSyntheticFixtureImage(path);
  }
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return null;
  }
  try {
    const img = new Image();
    const loadPromise = new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
    });
    img.src = path;
    if (img.complete) {
      return imageToImageData(img);
    }
    const loaded = await loadPromise;
    return imageToImageData(loaded);
  } catch {
    return null;
  }
}

function imageToImageData(img: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function generateReport(results: QualityMetricResult[]): QualityReport {
  const passed = results.filter((r) => !r.error && r.dimensionsMatch);
  const failed = results.filter((r) => !r.error && !r.dimensionsMatch);
  const errors = results.filter((r) => r.error);

  return {
    timestamp: new Date().toISOString(),
    engineVersion: '1.0',
    results,
    summary: {
      total: results.length,
      passed: passed.length,
      failed: failed.length,
      errors: errors.length,
    },
  };
}
