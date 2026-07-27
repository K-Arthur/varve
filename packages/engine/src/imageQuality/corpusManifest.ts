import {
  createAlphaRamp,
  createCheckerboard,
  createCheckerboardWithAlpha,
  createColorPatches,
  createGradient,
  createSinglePixelLines,
  createSlantedEdge,
  createTileBoundaryProbe,
  createTransparentSubject,
} from './fixtureGenerators';
import type { QualityFixture, QualityFixtureManifest } from './qualityTypes';

export function getSyntheticFixtures(): QualityFixture[] {
  return [
    {
      id: 'synth-checkerboard-64',
      category: 'synthetic-diagnostic',
      inputPath: 'synthetic:checkerboard-64',
      referencePath: 'synthetic:checkerboard-64',
      licenceId: 'strata-internal',
      alphaMode: 'opaque',
      colourSpace: 'sRGB',
      expectedScale: 2,
      recommendedModes: ['nearest', 'bilinear', 'bicubic', 'lanczos3'],
      thresholds: {
        exactDimensions: true,
        noNanPixels: true,
      },
      degradationRecipe: 'none',
    },
    {
      id: 'synth-slanted-edge-128',
      category: 'synthetic-diagnostic',
      inputPath: 'synthetic:slanted-edge-128',
      referencePath: 'synthetic:slanted-edge-128',
      licenceId: 'strata-internal',
      alphaMode: 'opaque',
      colourSpace: 'sRGB',
      expectedScale: 2,
      recommendedModes: ['bilinear', 'bicubic', 'lanczos3'],
      thresholds: {
        exactDimensions: true,
        noNanPixels: true,
      },
      degradationRecipe: 'none',
    },
    {
      id: 'synth-gradient-64',
      category: 'synthetic-diagnostic',
      inputPath: 'synthetic:gradient-64',
      referencePath: 'synthetic:gradient-64',
      licenceId: 'strata-internal',
      alphaMode: 'opaque',
      colourSpace: 'sRGB',
      expectedScale: 2,
      recommendedModes: ['bilinear', 'bicubic', 'lanczos3'],
      thresholds: {
        exactDimensions: true,
        noNanPixels: true,
      },
      degradationRecipe: 'none',
    },
    {
      id: 'synth-single-pixel-lines-64',
      category: 'synthetic-diagnostic',
      inputPath: 'synthetic:single-pixel-lines-64',
      referencePath: 'synthetic:single-pixel-lines-64',
      licenceId: 'strata-internal',
      alphaMode: 'opaque',
      colourSpace: 'sRGB',
      expectedScale: 4,
      recommendedModes: ['pixel-art'],
      thresholds: {
        exactDimensions: true,
        noNanPixels: true,
      },
      degradationRecipe: 'none',
    },
    {
      id: 'synth-alpha-ramp-32',
      category: 'transparency',
      inputPath: 'synthetic:alpha-ramp-32',
      referencePath: 'synthetic:alpha-ramp-32',
      licenceId: 'strata-internal',
      alphaMode: 'partial',
      colourSpace: 'sRGB',
      expectedScale: 2,
      recommendedModes: ['bilinear', 'bicubic', 'lanczos3', 'nearest'],
      thresholds: {
        exactDimensions: true,
        noNanPixels: true,
        maxAlphaDifference: 5,
      },
      degradationRecipe: 'none',
    },
    {
      id: 'synth-color-patches-128',
      category: 'synthetic-diagnostic',
      inputPath: 'synthetic:color-patches-128',
      referencePath: 'synthetic:color-patches-128',
      licenceId: 'strata-internal',
      alphaMode: 'opaque',
      colourSpace: 'sRGB',
      expectedScale: 2,
      recommendedModes: ['nearest', 'bilinear', 'bicubic', 'lanczos3'],
      thresholds: {
        exactDimensions: true,
        noNanPixels: true,
      },
      degradationRecipe: 'none',
    },
    {
      id: 'synth-tile-boundary-256',
      category: 'synthetic-diagnostic',
      inputPath: 'synthetic:tile-boundary-256',
      referencePath: 'synthetic:tile-boundary-256',
      licenceId: 'strata-internal',
      alphaMode: 'opaque',
      colourSpace: 'sRGB',
      expectedScale: 2,
      recommendedModes: ['bilinear', 'bicubic', 'lanczos3'],
      thresholds: {
        exactDimensions: true,
        noNanPixels: true,
        maxTileBoundaryDifference: 10,
      },
      degradationRecipe: 'none',
    },
    {
      id: 'synth-transparent-subject-64',
      category: 'transparency',
      inputPath: 'synthetic:transparent-subject-64',
      referencePath: 'synthetic:transparent-subject-64',
      licenceId: 'strata-internal',
      alphaMode: 'partial',
      colourSpace: 'sRGB',
      expectedScale: 2,
      recommendedModes: ['bilinear', 'bicubic', 'lanczos3'],
      thresholds: {
        exactDimensions: true,
        noNanPixels: true,
      },
      degradationRecipe: 'none',
    },
    {
      id: 'synth-checkerboard-alpha-32',
      category: 'transparency',
      inputPath: 'synthetic:checkerboard-alpha-32',
      referencePath: 'synthetic:checkerboard-alpha-32',
      licenceId: 'strata-internal',
      alphaMode: 'binary',
      colourSpace: 'sRGB',
      expectedScale: 2,
      recommendedModes: ['nearest', 'bilinear', 'bicubic', 'lanczos3'],
      thresholds: {
        exactDimensions: true,
        noNanPixels: true,
        maxAlphaDifference: 0,
      },
      degradationRecipe: 'none',
    },
  ];
}

export function generateSyntheticFixtureImage(fixtureId: string): ImageData | null {
  const match = fixtureId.match(/^synthetic:([\w-]+)-(\d+)$/);
  if (!match) return null;
  const name = match[1];
  const size = parseInt(match[2]!, 10);
  switch (name) {
    case 'checkerboard':
      return createCheckerboard(size, size, Math.max(4, size / 8));
    case 'slanted-edge':
      return createSlantedEdge(size, Math.max(size / 2, 16));
    case 'gradient':
      return createGradient(size, size);
    case 'single-pixel-lines':
      return createSinglePixelLines(size, size);
    case 'alpha-ramp':
      return createAlphaRamp(size, size);
    case 'color-patches':
      return createColorPatches(size, size);
    case 'tile-boundary':
      return createTileBoundaryProbe(size, size, 64);
    case 'transparent-subject':
      return createTransparentSubject(size, size);
    case 'checkerboard-alpha':
      return createCheckerboardWithAlpha(size, size);
    default:
      return null;
  }
}

export const QUALITY_MANIFEST: QualityFixtureManifest = {
  schemaVersion: '1.0',
  generated: new Date().toISOString(),
  fixtures: getSyntheticFixtures(),
};
