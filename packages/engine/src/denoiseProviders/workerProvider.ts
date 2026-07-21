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

    const host = getInferenceWorkerHost();
    const result = await host.infer(
      {
        type: 'infer',
        modelType: 'scunet',
        modelPath: `/models/${modelId}.onnx`,
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
