/**
 * Worker restoration provider — generic WASM/WebGPU ONNX inference for any
 * registered model type (scunet, nafnet). Model post-processing (channel
 * order, padding, alpha, strength) is dispatched by model id so the
 * runtime itself stays task-agnostic.
 */

import { getInferenceWorkerHost } from '../inference/inferenceWorkerHost';
import { postprocessNafnet } from '../inference/models/nafnet';
import { postprocessScunet } from '../inference/models/scunet';
import type {
  RestorationTileProvider,
  RestorationTileRequest,
  RestorationTileResult,
} from './types';
import { workerModelTypeForModel } from './types';

function postprocessByModel(
  modelId: string,
  output: Float32Array,
  outW: number,
  outH: number,
  targetWidth: number,
  targetHeight: number,
  alphaData: Uint8ClampedArray | null,
  strength: number,
  originalData: Uint8ClampedArray,
): ImageData {
  if (modelId === 'scunet') {
    return postprocessScunet(
      output,
      outW,
      outH,
      targetWidth,
      targetHeight,
      alphaData,
      strength,
      originalData,
    );
  }
  return postprocessNafnet(
    output,
    outW,
    outH,
    targetWidth,
    targetHeight,
    alphaData,
    strength,
    originalData,
  );
}

export const workerRestorationProvider: RestorationTileProvider = {
  id: 'worker-restoration',

  isAvailable(): boolean {
    return true;
  },

  async restore(
    request: RestorationTileRequest,
    signal?: AbortSignal,
  ): Promise<RestorationTileResult> {
    const {
      tensor,
      width,
      height,
      targetWidth,
      targetHeight,
      originalData,
      alphaData,
      strength,
      modelId,
    } = request;
    const start = performance.now();

    // Resolve through the loader rather than assuming `/models/<id>.onnx`:
    // model files are named for their variants and live as IndexedDB blob
    // URLs once downloaded. Weights kept in a sibling `.onnx.data` must be
    // handed to the runtime explicitly.
    const { getModelLoader } = await import('../backgroundRemoval/modelLoader');
    const loader = getModelLoader(signal);
    const resolvedPath = await loader.getModelPath(modelId, signal);
    if (!resolvedPath) {
      throw new Error(
        'Restoration model not downloaded. Use the Download button in the Enhance dialog first.',
      );
    }
    const externalData = (await loader.getModelExternalData(modelId, signal)) ?? undefined;

    const host = getInferenceWorkerHost();
    const result = await host.infer(
      {
        type: 'infer',
        modelType: workerModelTypeForModel(modelId) as 'scunet' | 'nafnet',
        modelPath: resolvedPath,
        externalData,
        modelId,
        tensors: {
          image: { data: tensor, dims: [1, 3, height, width] },
        },
        targetWidth,
        targetHeight,
        reuseSession: true,
      },
      { signal, timeoutMs: 300_000 },
    );

    const elapsed = performance.now() - start;
    const provider = (result.outputs.executionProvider as string) ?? 'wasm';

    const outputKey = Object.keys(result.outputs).find(
      (k) =>
        k !== 'executionProvider' &&
        k !== 'originalWidth' &&
        k !== 'originalHeight' &&
        k !== 'paddedWidth' &&
        k !== 'paddedHeight' &&
        k !== 'letterbox',
    );
    if (!outputKey) {
      throw new Error('Worker inference produced no output tensor');
    }
    const output = result.outputs[outputKey] as { data: Float32Array; dims: number[] };
    const outH = output.dims[2] ?? height;
    const outW = output.dims[3] ?? width;

    const imageData = postprocessByModel(
      modelId,
      output.data,
      outW,
      outH,
      targetWidth,
      targetHeight,
      alphaData,
      strength,
      originalData,
    );

    return { imageData, executionProvider: provider, processingTimeMs: elapsed };
  },
};
