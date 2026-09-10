import { clampImageToMaxDimension } from '../inference/imageTensor';
import { getInferenceWorkerHost } from '../inference/inferenceWorkerHost';
import { decodeDdColorOutput } from '../inference/models/ddcolor';
import { combineLabToImageData } from './colorSpace';
import { harmonize as harmonizeFn } from './harmonize';
import { selectiveRecolor } from './recolor';
import { resolveRuntime } from './runtimeResolver';
import { analyzeImageData } from './taskClassifier';
import { colorTransferLab } from './transfer';
import type {
  ColorizationPipeline,
  ColorizationRequest,
  ColorizationResult,
  ImageStats,
  QualityMode,
  RuntimeResolution,
} from './types';

const DEFAULT_TIMEOUT = 180_000;

export function paletteColorize(
  imageData: ImageData,
  palette: readonly string[],
  adherence: number,
): ImageData {
  const { data, width, height } = imageData;
  const out = new ImageData(width, height);
  const outData = out.data;
  const pixelCount = width * height;

  const paletteColors = palette.map((hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  });

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    const l = 0.299 * data[idx]! + 0.587 * data[idx + 1]! + 0.114 * data[idx + 2]!;

    let bestDist = Infinity;
    let bestR = data[idx]!;
    let bestG = data[idx + 1]!;
    let bestB = data[idx + 2]!;

    for (const pc of paletteColors) {
      const dr = data[idx]! - pc.r;
      const dg = data[idx + 1]! - pc.g;
      const db = data[idx + 2]! - pc.b;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestR = pc.r;
        bestG = pc.g;
        bestB = pc.b;
      }
    }

    const finalL = 0.299 * bestR + 0.587 * bestG + 0.114 * bestB;
    const lumScale = finalL > 0 ? l / finalL : 1;
    const t = adherence;

    outData[idx] = Math.round(
      data[idx]! * (1 - t) + Math.min(255, Math.max(0, bestR * lumScale)) * t,
    );
    outData[idx + 1] = Math.round(
      data[idx + 1]! * (1 - t) + Math.min(255, Math.max(0, bestG * lumScale)) * t,
    );
    outData[idx + 2] = Math.round(
      data[idx + 2]! * (1 - t) + Math.min(255, Math.max(0, bestB * lumScale)) * t,
    );
    outData[idx + 3] = data[idx + 3]!;
  }

  return out;
}

export const colorizationPipeline: ColorizationPipeline = {
  resolveRuntime(
    workflow: string,
    qualityMode: QualityMode,
    stats: ImageStats,
    installedModels: string[],
  ): RuntimeResolution {
    return resolveRuntime(workflow, qualityMode, stats, installedModels);
  },

  async execute(request: ColorizationRequest): Promise<ColorizationResult> {
    return dispatchColorize(request);
  },
};

export async function dispatchColorize(request: ColorizationRequest): Promise<ColorizationResult> {
  const { params, imageData, referenceData, maskData, maskWidth, maskHeight, signal, onProgress } =
    request;
  const startTime = performance.now();
  const workflow = params.workflow;

  if (signal?.aborted) throw new Error('Colorization cancelled');

  onProgress?.({ phase: 'preprocessing', percent: 0, elapsedMs: 0 });

  if (workflow === 'reference-transfer' && referenceData) {
    onProgress?.({ phase: 'inference', percent: 30, elapsedMs: performance.now() - startTime });
    const result = colorTransferLab(
      imageData,
      referenceData,
      params.luminancePreservation ?? 1,
      params.chromaStrength ?? 1,
    );
    onProgress?.({ phase: 'complete', percent: 100, elapsedMs: performance.now() - startTime });
    return {
      imageData: result,
      sourceNodeId: params.sourceNodeId,
      sourceRevision: params.sourceRevision,
      workflow,
      modelUsed: null,
      provider: 'classical',
      elapsedMs: performance.now() - startTime,
    };
  }

  if (workflow === 'selective-recolor' && maskData && maskWidth && maskHeight) {
    onProgress?.({ phase: 'inference', percent: 30, elapsedMs: performance.now() - startTime });
    const result = selectiveRecolor(
      imageData,
      maskData,
      maskWidth,
      maskHeight,
      params.targetHue ?? 0,
      params.saturationScale ?? 1,
      params.luminancePreservation ?? 1,
    );
    onProgress?.({ phase: 'complete', percent: 100, elapsedMs: performance.now() - startTime });
    return {
      imageData: result,
      sourceNodeId: params.sourceNodeId,
      sourceRevision: params.sourceRevision,
      workflow,
      modelUsed: null,
      provider: 'classical',
      elapsedMs: performance.now() - startTime,
    };
  }

  if (workflow === 'harmonize' && referenceData) {
    onProgress?.({ phase: 'inference', percent: 30, elapsedMs: performance.now() - startTime });
    const result = harmonizeFn(
      imageData,
      referenceData,
      params.chromaStrength ?? 0.5,
      params.neutralProtection ?? true,
    );
    onProgress?.({ phase: 'complete', percent: 100, elapsedMs: performance.now() - startTime });
    return {
      imageData: result,
      sourceNodeId: params.sourceNodeId,
      sourceRevision: params.sourceRevision,
      workflow,
      modelUsed: null,
      provider: 'classical',
      elapsedMs: performance.now() - startTime,
    };
  }

  if (workflow === 'palette-colorize' && params.palette && params.palette.length >= 2) {
    onProgress?.({ phase: 'inference', percent: 30, elapsedMs: performance.now() - startTime });
    const result = paletteColorize(imageData, params.palette, params.adherence ?? 0.5);
    onProgress?.({ phase: 'complete', percent: 100, elapsedMs: performance.now() - startTime });
    return {
      imageData: result,
      sourceNodeId: params.sourceNodeId,
      sourceRevision: params.sourceRevision,
      workflow,
      modelUsed: null,
      provider: 'classical',
      elapsedMs: performance.now() - startTime,
    };
  }

  return runDdColorInference(request, startTime);
}

async function runDdColorInference(
  request: ColorizationRequest,
  startTime: number,
): Promise<ColorizationResult> {
  const { params, imageData, signal, onProgress } = request;
  const workflow = params.workflow;
  const stats: ImageStats = analyzeImageData(imageData);

  const resolution = resolveRuntime(workflow, params.qualityMode, stats, []);
  const maxDim = resolution.maxDimension;

  onProgress?.({ phase: 'preprocessing', percent: 10, elapsedMs: performance.now() - startTime });
  const clamped = clampImageToMaxDimension(imageData, maxDim);

  if (signal?.aborted) throw new Error('Colorization cancelled');
  onProgress?.({ phase: 'inference', percent: 30, elapsedMs: performance.now() - startTime });

  const modelPath =
    resolution.modelId === 'ddcolor-tiny' ? '/models/ddcolor-tiny.onnx' : '/models/ddcolor.onnx';

  const workerHost = getInferenceWorkerHost();
  const result = await workerHost.infer(
    {
      type: 'infer',
      modelType: 'ddcolor',
      modelPath,
      modelId: resolution.modelId,
      imageData: clamped,
      targetWidth: clamped.width,
      targetHeight: clamped.height,
      reuseSession: true,
    },
    { signal, timeoutMs: DEFAULT_TIMEOUT },
  );

  if (signal?.aborted) throw new Error('Colorization cancelled');
  onProgress?.({ phase: 'postprocessing', percent: 60, elapsedMs: performance.now() - startTime });

  const output = result.outputs.output as { data: Float32Array; dims: number[] } | undefined;
  if (!output) throw new Error('DDColor inference produced no output');

  const origW = (result.outputs.originalWidth as number) ?? clamped.width;
  const origH = (result.outputs.originalHeight as number) ?? clamped.height;
  const letterbox = result.outputs.letterbox as { offsetX: number; offsetY: number } | undefined;

  const { a, b } = decodeDdColorOutput(
    output.data,
    output.dims[3]!,
    output.dims[2]!,
    origW,
    origH,
    letterbox,
  );

  onProgress?.({ phase: 'postprocessing', percent: 80, elapsedMs: performance.now() - startTime });

  const outputImageData = combineLabToImageData(
    clamped.data,
    clamped.width,
    clamped.height,
    a,
    b,
    params.luminancePreservation ?? 1,
  );

  if (clamped.width !== imageData.width || clamped.height !== imageData.height) {
    const srcCanvas = new OffscreenCanvas(clamped.width, clamped.height);
    const srcCtx = srcCanvas.getContext('2d')!;
    srcCtx.putImageData(outputImageData, 0, 0);

    const dstCanvas = new OffscreenCanvas(imageData.width, imageData.height);
    const dstCtx = dstCanvas.getContext('2d')!;
    dstCtx.drawImage(srcCanvas, 0, 0, imageData.width, imageData.height);
    const fullResData = dstCtx.getImageData(0, 0, imageData.width, imageData.height);

    onProgress?.({ phase: 'complete', percent: 100, elapsedMs: performance.now() - startTime });
    return {
      imageData: fullResData,
      sourceNodeId: params.sourceNodeId,
      sourceRevision: params.sourceRevision,
      workflow,
      modelUsed: resolution.modelId,
      provider: resolution.provider,
      elapsedMs: performance.now() - startTime,
    };
  }

  onProgress?.({ phase: 'complete', percent: 100, elapsedMs: performance.now() - startTime });
  return {
    imageData: outputImageData,
    sourceNodeId: params.sourceNodeId,
    sourceRevision: params.sourceRevision,
    workflow,
    modelUsed: resolution.modelId,
    provider: resolution.provider,
    elapsedMs: performance.now() - startTime,
  };
}

export { harmonize } from './harmonize';
export { selectiveRecolor } from './recolor';
export { colorTransferLab } from './transfer';
