import type { WorkerInferResult } from '@strata/engine';
import {
  decodeSam2Mask,
  encodeSam2Prompts,
  getImageCache,
  getInferenceWorkerHost,
} from '@strata/engine';
import type { NodeId } from '@strata/scene';
import { useCallback, useRef } from 'react';
import { commitRasterMask } from '../backgroundRemoval/commitRasterMask';
import type { CanvasAnnouncer } from '../canvas/CanvasAnnouncer';
import type { EditorState } from './types';

export interface Sam2SegmentationAPI {
  applySam2Segmentation: (params: {
    nodeId: NodeId;
    prompts: {
      points?: Array<{ x: number; y: number; label: 0 | 1 }>;
      box?: { x1: number; y1: number; x2: number; y2: number };
    };
    signal?: AbortSignal;
    operation: 'preview' | 'mask' | 'selection' | 'layer';
  }) => Promise<{ mask: Uint8Array; width: number; height: number; confidence: number } | null>;
  cancelSam2Segmentation: () => void;
}

export function useSam2Segmentation(
  _state: EditorState,
  stateRef: React.MutableRefObject<EditorState>,
  setState: React.Dispatch<React.SetStateAction<EditorState>>,
  announcerRef: React.MutableRefObject<CanvasAnnouncer | null>,
): Sam2SegmentationAPI {
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  const cancelSam2Segmentation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    generationRef.current += 1;
  }, []);

  const applySam2Segmentation = useCallback(
    async ({
      nodeId,
      prompts,
      signal: externalSignal,
      operation,
    }: {
      nodeId: NodeId;
      prompts: {
        points?: Array<{ x: number; y: number; label: 0 | 1 }>;
        box?: { x1: number; y1: number; x2: number; y2: number };
      };
      signal?: AbortSignal;
      operation: 'preview' | 'mask' | 'selection' | 'layer';
    }): Promise<{ mask: Uint8Array; width: number; height: number; confidence: number } | null> => {
      const generation = ++generationRef.current;
      const currentDoc = stateRef.current.document;
      const node = currentDoc.nodes[nodeId] as import('@strata/scene').ShapeNode | undefined;

      if (node?.kind !== 'shape') {
        announcerRef.current?.announce('Select a shape node first');
        return null;
      }

      const { isImageShape, imageShapeSrc } = await import('@strata/scene');
      if (!isImageShape(node)) {
        announcerRef.current?.announce('The selected node does not have an image fill');
        return null;
      }

      const src = imageShapeSrc(node);
      if (!src) {
        announcerRef.current?.announce('Could not determine image source');
        return null;
      }

      // Abort any in-flight SAM2 request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const combinedSignal = externalSignal
        ? combineAbortSignals(controller.signal, externalSignal)
        : controller.signal;

      if (combinedSignal.aborted) {
        announcerRef.current?.announce('Segmentation cancelled');
        return null;
      }

      announcerRef.current?.announce('Running SAM2 segmentation...');

      // Load source image and extract pixel data at natural resolution
      let img: HTMLImageElement | ImageBitmap | null = null;
      try {
        img = await getImageCache().load(src);
      } catch {
        announcerRef.current?.announce(
          'Could not load image: the image source may be cross-origin or unavailable',
        );
        return null;
      }

      if (!img) {
        announcerRef.current?.announce('Could not load image');
        return null;
      }

      if (combinedSignal.aborted) return null;

      const naturalW =
        typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement
          ? img.naturalWidth || img.width
          : img.width;
      const naturalH =
        typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement
          ? img.naturalHeight || img.height
          : img.height;

      const canvas = document.createElement('canvas');
      canvas.width = naturalW;
      canvas.height = naturalH;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, naturalW, naturalH);

      let imageData: ImageData;
      try {
        imageData = ctx.getImageData(0, 0, naturalW, naturalH);
      } catch {
        announcerRef.current?.announce(
          'Could not read image pixels: the image source may be cross-origin (CORS blocked)',
        );
        return null;
      }

      if (combinedSignal.aborted) return null;

      // Encode prompts (normalized 0-1 coords) and dispatch inference
      const encoded = encodeSam2Prompts(prompts, naturalW, naturalH);
      const modelPath = `/models/sam2-hiera-tiny.onnx`;

      try {
        const host = getInferenceWorkerHost();
        const result: WorkerInferResult = await host.infer(
          {
            type: 'infer',
            modelType: 'sam2',
            modelPath,
            modelId: 'sam2-hiera-tiny',
            imageData,
            params: {
              pointCoords: encoded.pointCoords,
              pointLabels: encoded.pointLabels,
              boxCoords: encoded.boxCoords,
              hasBox: encoded.hasBox,
            },
            reuseSession: true,
          },
          { signal: combinedSignal },
        );

        // Stale check after inference returns
        if (generation !== generationRef.current || combinedSignal.aborted) {
          return null;
        }

        const outputs = result.outputs as {
          data: Float32Array;
          dims: number[];
          executionProvider: string;
          inputWidth: number;
          inputHeight: number;
        };

        // SAM2 outputs a low-res mask; dims layout is [1, 1, H, W]
        const rawH = outputs.dims[2] ?? outputs.dims[1] ?? 256;
        const rawW = outputs.dims[3] ?? outputs.dims[2] ?? 256;

        const { mask, confidence } = decodeSam2Mask(
          outputs.data,
          rawW,
          rawH,
          naturalW,
          naturalH,
          0.0,
        );

        // Stale check after mask decode
        if (generation !== generationRef.current || combinedSignal.aborted) {
          return null;
        }

        const maskResult = {
          mask,
          width: naturalW,
          height: naturalH,
          confidence,
        };

        switch (operation) {
          case 'preview': {
            setState((prev) => ({
              ...prev,
              maskPreviewMode: 'overlay' as const,
            }));
            announcerRef.current?.announce(
              `SAM2 segmentation preview ready (${Math.round(confidence * 100)}% confidence)`,
            );
            return maskResult;
          }

          case 'mask': {
            const maskDataUrl = await maskToDataUrl(mask, naturalW, naturalH);
            const updated = commitRasterMask(currentDoc, nodeId, {
              dataUrl: maskDataUrl,
              width: naturalW,
              height: naturalH,
              method: 'ai-quality',
              modelId: 'sam2-hiera-tiny',
              confidence,
              generatedAt: Date.now(),
              sourceLocator: src,
            });
            if (updated !== currentDoc) {
              setState((prev) => ({ ...prev, document: updated }));
              announcerRef.current?.announce(
                `SAM2 mask applied (${Math.round(confidence * 100)}% confidence)`,
              );
            }
            return maskResult;
          }

          case 'selection': {
            setState((prev) => ({
              ...prev,
              selection: [nodeId],
              maskPreviewMode: 'overlay' as const,
            }));
            announcerRef.current?.announce(
              `Selected node with SAM2 mask (${Math.round(confidence * 100)}% confidence)`,
            );
            return maskResult;
          }

          case 'layer': {
            const maskDataUrlLayer = await maskToDataUrl(mask, naturalW, naturalH);
            const withMask = commitRasterMask(currentDoc, nodeId, {
              dataUrl: maskDataUrlLayer,
              width: naturalW,
              height: naturalH,
              method: 'ai-quality',
              modelId: 'sam2-hiera-tiny',
              confidence,
              generatedAt: Date.now(),
              sourceLocator: src,
            });
            setState((prev) => ({
              ...prev,
              document: withMask,
              selection: [nodeId],
            }));
            announcerRef.current?.announce(
              `SAM2 layer created (${Math.round(confidence * 100)}% confidence)`,
            );
            return maskResult;
          }
        }
      } catch (e) {
        if ((e as Error).message === 'cancelled') return null;
        announcerRef.current?.announce(`SAM2 segmentation failed: ${(e as Error).message}`);
        return null;
      } finally {
        if (generation === generationRef.current) {
          abortRef.current = null;
        }
      }
    },
    [stateRef, setState, announcerRef],
  );

  return { applySam2Segmentation, cancelSam2Segmentation };
}

function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

async function maskToDataUrl(mask: Uint8Array, width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i]!;
    imageData.data[i * 4] = 255;
    imageData.data[i * 4 + 1] = 255;
    imageData.data[i * 4 + 2] = 255;
    imageData.data[i * 4 + 3] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
