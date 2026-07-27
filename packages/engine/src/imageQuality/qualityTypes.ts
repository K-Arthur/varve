export type QualityCategory =
  | 'photographic'
  | 'illustration'
  | 'ui-text'
  | 'pixel-art'
  | 'transparency'
  | 'synthetic-diagnostic';

export type AlphaMode = 'opaque' | 'binary' | 'partial';

export interface QualityRegion {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QualityThresholds {
  minPsnr?: number;
  minSsim?: number;
  maxColorDifference?: number;
  maxAlphaDifference?: number;
  maxTileBoundaryDifference?: number;
  exactDimensions?: boolean;
  palettePreservation?: boolean;
  noNanPixels?: boolean;
}

export interface QualityFixture {
  id: string;
  category: QualityCategory;
  inputPath: string;
  referencePath?: string;
  licenceId: string;
  alphaMode: AlphaMode;
  colourSpace: string;
  expectedScale: number;
  recommendedModes: string[];
  forbiddenModes?: string[];
  cropRegions?: QualityRegion[];
  thresholds?: QualityThresholds;
  degradationRecipe?: string;
  sourceUri?: string;
}

export interface QualityFixtureManifest {
  schemaVersion: string;
  generated: string;
  fixtures: QualityFixture[];
}

export interface QualityMetricResult {
  fixtureId: string;
  algorithm: string;
  scale: number;
  psnr: number | null;
  ssim: number | null;
  msSim: number | null;
  colorDifference: number | null;
  alphaDifference: number | null;
  tileBoundaryDifference: number | null;
  dimensionsMatch: boolean;
  hasNanPixels: boolean;
  palettePreserved: boolean | null;
  timingMs: number;
  regions: Record<
    string,
    {
      psnr: number | null;
      ssim: number | null;
    }
  >;
  error?: string;
}

export interface QualityReport {
  timestamp: string;
  engineVersion: string;
  results: QualityMetricResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
  };
}
