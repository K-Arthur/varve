/**
 * SCUNet denoise dispatch — bridges the inference worker to the
 * preprocess/postprocess pipeline in `models/scunet.ts`.
 *
 * The AIDenoiseSection dynamically imports this module. It was previously
 * missing (dead export in index.ts), causing runtime failures when the
 * denoise panel was opened.
 */
import { getInferenceWorkerHost } from '../inference/inferenceWorkerHost';
import {
  postprocessScunet,
  preprocessScunet,
  validateScunetInput,
} from '../inference/models/scunet';

export interface DenoiseOptions {
  strength?: number;
  modelId?: string;
}

export interface DenoiseResult {
  denoised: ImageData;
  width: number;
  height: number;
  processingTimeMs: number;
}

export async function dispatchDenoise(
  imageData: ImageData,
  options: DenoiseOptions = {},
  signal?: AbortSignal,
): Promise<DenoiseResult> {
  const validation = validateScunetInput({ imageData, strength: options.strength });
  if (validation) throw new Error(validation);

  const strength = options.strength ?? 1;
  const modelId = options.modelId ?? 'scunet';

  const startTime = performance.now();

  const { getModelLoader } = await import('../backgroundRemoval/modelLoader');
  const loader = getModelLoader();
  const modelPath = await loader.getModelPath(modelId, signal);
  if (!modelPath) {
    throw new Error('SCUNet model not available. Download it from Settings > AI Models first.');
  }

  const preprocessed = preprocessScunet(imageData);

  const host = getInferenceWorkerHost();
  const result = await host.infer(
    {
      type: 'infer',
      modelType: 'scunet',
      modelPath,
      modelId,
      imageData,
      reuseSession: true,
    },
    { signal, timeoutMs: 120_000 },
  );

  const output = result.outputs.output as { data: Float32Array; dims: number[] } | undefined;
  if (!output) throw new Error('SCUNet inference produced no output');

  const denoised = postprocessScunet(
    output.data,
    output.dims[2]!,
    output.dims[1]!,
    preprocessed.originalWidth,
    preprocessed.originalHeight,
    preprocessed.alphaData,
    strength,
    imageData.data as Uint8ClampedArray,
  );

  return {
    denoised,
    width: denoised.width,
    height: denoised.height,
    processingTimeMs: performance.now() - startTime,
  };
}
