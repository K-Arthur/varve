import { getInferenceWorkerHost } from '../inference/inferenceWorkerHost';
import { postprocessScunet } from '../inference/models/scunet';
import type { DenoiseProvider, DenoiseTileRequest, DenoiseTileResult } from './types';

export const workerDenoiseProvider: DenoiseProvider = {
  id: 'worker-scunet',

  isAvailable(): boolean {
    return true;
  },

  async denoise(request: DenoiseTileRequest, signal?: AbortSignal): Promise<DenoiseTileResult> {
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
    // SCUNet's file is named for its variant, and once downloaded it lives as
    // an IndexedDB blob URL. The hardcoded path pointed at a file that never
    // exists. Its weights also sit in a sibling `.onnx.data` the runtime must
    // be told about explicitly.
    const { getModelLoader } = await import('../backgroundRemoval/modelLoader');
    const loader = getModelLoader(signal);
    const resolvedPath = await loader.getModelPath(modelId, signal);
    if (!resolvedPath) {
      throw new Error(
        'Denoise model not downloaded. Use the Download button in the AI Denoise panel first.',
      );
    }
    const externalData = (await loader.getModelExternalData(modelId, signal)) ?? undefined;

    const host = getInferenceWorkerHost();
    const result = await host.infer(
      {
        type: 'infer',
        modelType: 'scunet',
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
      throw new Error('SCUNet worker inference produced no output tensor');
    }
    const output = result.outputs[outputKey] as { data: Float32Array; dims: number[] };
    const outH = output.dims[2] ?? height;
    const outW = output.dims[3] ?? width;

    const imageData = postprocessScunet(
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
