/**
 * Shared colorization contracts — task classification, quality modes, params,
 * results, and runtime resolver interface. Consumed by both the engine
 * inference layer and the editor UI. Kept free of React and DOM types so it
 * can be imported from workers, the engine, or the editor.
 *
 * Research basis:
 *   - DDColor (Kang et al., ICCV 2023): photo-realistic colorization via
 *     dual decoders (color-token + multi-scale). Apache-2.0.
 *   - DeOldify (Jantic, 2019): ResNet-UNet NoGAN colorization. MIT.
 *   - Reinhard et al. (2001): color transfer in LAB space — deterministic,
 *     predictable, preferred for design-tool reference transfer.
 */

export type ColorizationWorkflow =
  | 'photo-colorize'
  | 'lineart-colorize'
  | 'palette-colorize'
  | 'reference-transfer'
  | 'selective-recolor'
  | 'harmonize';

export type QualityMode = 'automatic' | 'fast' | 'balanced' | 'quality';

export type SourceKind = 'photo' | 'lineart' | 'illustration' | 'already-colored';

export interface ImageStats {
  meanLuminance: number;
  saturationStd: number;
  fractionNearNeutral: number;
  fractionLowSaturation: number;
  edgeDensity: number;
  width: number;
  height: number;
}

export interface TaskClassification {
  sourceKind: SourceKind;
  recommendedWorkflow: ColorizationWorkflow;
  confidence: number;
}

export interface ColorizationModelConfig {
  modelId: string;
  inputSize: number;
  outputChannels: 2;
  preferredProvider: 'cpu' | 'gpu' | 'any';
}

export interface RuntimeResolution {
  modelId: string;
  maxDimension: number;
  provider: 'wasm' | 'cuda' | 'rocm' | 'directml' | 'coreml' | 'cpu';
  tiled: boolean;
  tileSize: number;
  tileOverlap: number;
}

export interface ColorizationParams {
  workflow: ColorizationWorkflow;
  qualityMode: QualityMode;
  sourceNodeId: string;
  sourceRevision: number;
  targetHue?: number;
  saturationScale?: number;
  chromaStrength?: number;
  luminancePreservation: number;
  skinProtection: boolean;
  neutralProtection: boolean;
  referenceNodeId?: string;
  palette?: readonly string[];
  maskNodeId?: string;
  adherence?: number;
}

export interface ColorizationProgress {
  phase: 'preprocessing' | 'downloading' | 'inference' | 'postprocessing' | 'complete';
  percent: number;
  elapsedMs: number;
}

export interface ColorizationResult {
  imageData: ImageData;
  sourceNodeId: string;
  sourceRevision: number;
  workflow: ColorizationWorkflow;
  modelUsed: string | null;
  provider: string;
  elapsedMs: number;
}

export type ColorizationProgressCallback = (progress: ColorizationProgress) => void;

export interface ColorizationRequest {
  params: ColorizationParams;
  imageData: ImageData;
  referenceData?: ImageData;
  maskData?: Uint8Array;
  maskWidth?: number;
  maskHeight?: number;
  signal?: AbortSignal;
  onProgress?: ColorizationProgressCallback;
}

export interface ColorizationPipeline {
  resolveRuntime(
    workflow: ColorizationWorkflow,
    qualityMode: QualityMode,
    imageStats: ImageStats,
    installedModels: string[],
  ): RuntimeResolution;
  execute(request: ColorizationRequest): Promise<ColorizationResult>;
}
