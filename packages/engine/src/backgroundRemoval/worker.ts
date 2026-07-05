/**
 * Web Worker for ONNX model inference.
 * Runs background removal in a separate thread so the main thread
 * stays responsive during processing.
 */

import type { BackgroundRemovalResult } from './types';

interface WorkerCommand {
  type: 'infer';
  imageData: ImageData;
  modelPath: string;
  modelId: 'u2netp' | 'birefnet-general-lite';
}

interface WorkerResponse {
  type: 'result';
  result: BackgroundRemovalResult;
}

interface WorkerError {
  type: 'error';
  message: string;
}

self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
  const { imageData, modelPath, modelId } = e.data;

  try {
    const ort = await import('onnxruntime-web');
    const session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['webgl', 'wasm'],
    });

    const inputSize = modelId === 'u2netp' ? 320 : 1024;

    const resizedCanvas = new OffscreenCanvas(inputSize, inputSize);
    const resizedCtx = resizedCanvas.getContext('2d')!;

    const imageBitmap = await createImageBitmap(imageData);
    resizedCtx.drawImage(imageBitmap, 0, 0, inputSize, inputSize);
    const resizedData = resizedCtx.getImageData(0, 0, inputSize, inputSize);

    const { data, width, height } = resizedData;
    const floatData = new Float32Array(width * height * 3);
    for (let i = 0; i < data.length / 4; i++) {
      floatData[i] = data[i * 4] / 255;
      floatData[width * height + i] = data[i * 4 + 1] / 255;
      floatData[width * height * 2 + i] = data[i * 4 + 2] / 255;
    }

    const inputName = session.inputNames[0];
    const feeds: Record<string, unknown> = {};
    feeds[inputName] = new ort.Tensor('float32', floatData, [1, 3, inputSize, inputSize]);

    const results = await session.run(feeds);
    const outputName = session.outputNames[0];
    const outputData = results[outputName].data as Float32Array;

    const dims = results[outputName].dims;
    const maskW = dims[3];
    const maskH = dims[2];
    const mask = new Uint8Array(maskW * maskH);
    for (let i = 0; i < outputData.length; i++) {
      mask[i] = outputData[i] > 0.5 ? 255 : 0;
    }

    const maskCanvas = new OffscreenCanvas(imageData.width, imageData.height);
    const maskCtx = maskCanvas.getContext('2d')!;
    const maskImageData = maskCtx.createImageData(maskW, maskH);
    for (let i = 0; i < mask.length; i++) {
      maskImageData.data[i * 4] = mask[i];
      maskImageData.data[i * 4 + 1] = mask[i];
      maskImageData.data[i * 4 + 2] = mask[i];
      maskImageData.data[i * 4 + 3] = 255;
    }
    maskCtx.putImageData(maskImageData, 0, 0);

    const finalCanvas = new OffscreenCanvas(imageData.width, imageData.height);
    const finalCtx = finalCanvas.getContext('2d')!;
    finalCtx.drawImage(maskCanvas, 0, 0, imageData.width, imageData.height);

    const finalBlob = await finalCanvas.convertToBlob({ type: 'image/png' });
    const buffer = await finalBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const maskDataUrl = 'data:image/png;base64,' + btoa(binary);

    const response: WorkerResponse = {
      type: 'result',
      result: {
        maskDataUrl,
        confidence: 0.85,
        method: modelId === 'u2netp' ? 'quick' : 'ai-balanced',
        processingTimeMs: 0,
        width: imageData.width,
        height: imageData.height,
      },
    };
    self.postMessage(response);
  } catch (err) {
    const error: WorkerError = { type: 'error', message: (err as Error).message };
    self.postMessage(error);
  }
};
