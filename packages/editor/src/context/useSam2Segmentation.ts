import type { WorkerInferResult } from '@varve/engine';
import {
  decodeSam2DecoderOutput,
  EmbeddingCache,
  getImageCache,
  getInferenceWorkerHost,
  getModelLoader,
} from '@varve/engine';
import type { Document, NodeId } from '@varve/scene';
import { useCallback, useRef } from 'react';
import { commitRasterMask } from '../backgroundRemoval/commitRasterMask';
import type { CanvasAnnouncer } from '../canvas/CanvasAnnouncer';
import { prepareImageMaskMapper } from '../tools/imageMaskCoordinates';
import type { EditorState } from './types';

type WorkerTensor = { data: Float32Array; dims: number[] };

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
  updateDoc: (fn: (doc: Document) => Document) => void,
  announcerRef: React.MutableRefObject<CanvasAnnouncer | null>,
): Sam2SegmentationAPI {
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const embeddingCacheRef = useRef(
    new EmbeddingCache<{
      nodeId: NodeId;
      src: string;
      embeddings: Record<string, WorkerTensor>;
      // The letterbox transform the encoder's *own* preprocessing applied to
      // this image (scale-to-fit + center + pad for non-square images).
      // Prompt encoding must reuse this exact transform — see sam2.ts — so
      // it's cached alongside the embeddings it was computed from, not
      // recomputed from the image dimensions independently.
      letterbox: { offsetX: number; offsetY: number };
      naturalW: number;
      naturalH: number;
    }>({
      maxEntries: 2,
      maxBytes: 512 * 1024 * 1024,
      estimateBytes: (entry) =>
        Object.values(entry.embeddings).reduce(
          (total, tensor) => total + tensor.data.byteLength,
          0,
        ),
    }),
  );

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
      const node = currentDoc.nodes[nodeId] as import('@varve/scene').ShapeNode | undefined;

      if (node?.kind !== 'shape') {
        announcerRef.current?.announce('Select a shape node first');
        return null;
      }

      const { isImageShape, imageShapeSrc } = await import('@varve/scene');
      if (!isImageShape(node)) {
        announcerRef.current?.announce('The selected node does not have an image fill');
        return null;
      }

      const src = imageShapeSrc(node);
      if (!src) {
        announcerRef.current?.announce('Could not determine image source');
        return null;
      }

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

      announcerRef.current?.announce('Analyzing subject…');

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

      const imageMapper = prepareImageMaskMapper({
        document: currentDoc,
        node,
        sourceWidth: naturalW,
        sourceHeight: naturalH,
      });
      const normPrompts = normalizePromptsTo01(prompts, imageMapper, naturalW, naturalH);

      const encoderId = 'sam2-hiera-tiny-encoder';
      const decoderId = 'sam2-hiera-tiny-decoder';
      const loader = getModelLoader();
      const resolvedEncoderPath = await loader.getModelPath(encoderId, combinedSignal);
      const resolvedDecoderPath = await loader.getModelPath(decoderId, combinedSignal);

      if (!resolvedEncoderPath || !resolvedDecoderPath) {
        announcerRef.current?.announce(
          'Select Subject needs a one-time download — install it from Settings > AI Models before using this tool.',
        );
        return null;
      }

      try {
        const host = getInferenceWorkerHost();

        const cacheKey = [
          currentDoc.id,
          nodeId,
          src,
          naturalW,
          naturalH,
          encoderId,
          'preprocess-v1',
        ]
          .map((part) => encodeURIComponent(String(part)))
          .join('|');
        let cached = embeddingCacheRef.current.get(cacheKey);
        if (!cached) {
          if (combinedSignal.aborted) return null;

          const encResult: WorkerInferResult = await host.infer(
            {
              type: 'infer',
              modelType: 'sam2-encoder',
              modelPath: resolvedEncoderPath,
              modelId: encoderId,
              imageData,
              reuseSession: true,
            },
            { signal: combinedSignal },
          );

          if (generation !== generationRef.current || combinedSignal.aborted) return null;

          const encOutputs = encResult.outputs as {
            image_embed: WorkerTensor;
            high_res_feats_0: WorkerTensor;
            high_res_feats_1: WorkerTensor;
            letterbox?: { offsetX: number; offsetY: number };
          };

          cached = {
            nodeId,
            src,
            embeddings: {
              image_embed: encOutputs.image_embed,
              high_res_feats_0: encOutputs.high_res_feats_0,
              high_res_feats_1: encOutputs.high_res_feats_1,
            },
            letterbox: encOutputs.letterbox ?? { offsetX: 0, offsetY: 0 },
            naturalW,
            naturalH,
          };
          embeddingCacheRef.current.set(cacheKey, cached);
        }

        if (generation !== generationRef.current || combinedSignal.aborted) return null;

        const decResult: WorkerInferResult = await host.infer(
          {
            type: 'infer',
            modelType: 'sam2-decoder',
            modelPath: resolvedDecoderPath,
            modelId: decoderId,
            tensors: cached.embeddings,
            params: {
              points: normPrompts.points,
              box: normPrompts.box,
              letterbox: cached.letterbox,
            },
            reuseSession: true,
          },
          { signal: combinedSignal },
        );

        if (generation !== generationRef.current || combinedSignal.aborted) return null;

        const decOutputs = decResult.outputs as {
          masks: { data: Float32Array; dims: number[] };
          iou_predictions?: { data: Float32Array; dims: number[] };
          executionProvider: string;
        };

        const decoded = decodeSam2DecoderOutput(
          decOutputs.masks.data,
          decOutputs.masks.dims,
          decOutputs.iou_predictions?.data ?? null,
          decOutputs.iou_predictions?.dims ?? null,
          naturalW,
          naturalH,
        );

        if (generation !== generationRef.current || combinedSignal.aborted) return null;

        const bestMask = decoded.masks[decoded.selectedIndex]!;
        const maskResult = {
          mask: bestMask.mask,
          width: naturalW,
          height: naturalH,
          confidence: decoded.confidence,
        };

        switch (operation) {
          case 'preview':
            setState((prev) => ({
              ...prev,
              maskPreviewMode: 'overlay' as const,
            }));
            announcerRef.current?.announce(
              `Subject preview ready (${Math.round(decoded.confidence * 100)}% confidence). Press Enter to apply, Escape to cancel.`,
            );
            return maskResult;

          case 'mask': {
            const maskDataUrl = await maskToDataUrl(bestMask.mask, naturalW, naturalH);
            let committed = false;
            updateDoc((doc) => {
              const updated = commitRasterMask(doc, nodeId, {
                dataUrl: maskDataUrl,
                width: naturalW,
                height: naturalH,
                method: 'ai-quality',
                modelId: 'sam2-hiera-tiny',
                confidence: decoded.confidence,
                generatedAt: Date.now(),
                sourceLocator: src,
              });
              committed = updated !== doc;
              return updated;
            });
            if (committed) {
              announcerRef.current?.announce(
                `Selection applied as a mask (${Math.round(decoded.confidence * 100)}% confidence)`,
              );
            }
            return maskResult;
          }

          case 'selection':
            setState((prev) => ({
              ...prev,
              selection: [nodeId],
              maskPreviewMode: 'overlay' as const,
            }));
            announcerRef.current?.announce(
              `Selected subject (${Math.round(decoded.confidence * 100)}% confidence)`,
            );
            return maskResult;

          case 'layer': {
            const maskDataUrlLayer = await maskToDataUrl(bestMask.mask, naturalW, naturalH);
            updateDoc((doc) =>
              commitRasterMask(doc, nodeId, {
                dataUrl: maskDataUrlLayer,
                width: naturalW,
                height: naturalH,
                method: 'ai-quality',
                modelId: 'sam2-hiera-tiny',
                confidence: decoded.confidence,
                generatedAt: Date.now(),
                sourceLocator: src,
              }),
            );
            setState((prev) => ({ ...prev, selection: [nodeId] }));
            announcerRef.current?.announce(
              `Selection created as a new mask layer (${Math.round(decoded.confidence * 100)}% confidence)`,
            );
            return maskResult;
          }
        }
      } catch (e) {
        if ((e as Error).message === 'cancelled') return null;
        announcerRef.current?.announce(`Subject selection failed: ${(e as Error).message}`);
        return null;
      } finally {
        if (generation === generationRef.current) {
          abortRef.current = null;
        }
      }

      return null;
    },
    [stateRef, setState, updateDoc, announcerRef],
  );

  return { applySam2Segmentation, cancelSam2Segmentation };
}

function normalizePromptsTo01(
  prompts: {
    points?: Array<{ x: number; y: number; label: 0 | 1 }>;
    box?: { x1: number; y1: number; x2: number; y2: number };
  },
  imageMapper: ReturnType<typeof prepareImageMaskMapper>,
  naturalW: number,
  naturalH: number,
): {
  points?: Array<{ x: number; y: number; label: 0 | 1 }>;
  box?: { x1: number; y1: number; x2: number; y2: number };
} {
  const result: typeof prompts = {};

  if (prompts.points) {
    result.points = prompts.points.flatMap((p) => {
      const pixel = imageMapper?.mapWorldPoint({ x: p.x, y: p.y });
      if (!pixel) return [];
      return [
        {
          x: Math.max(0, Math.min(1, pixel.x / naturalW)),
          y: Math.max(0, Math.min(1, pixel.y / naturalH)),
          label: p.label,
        },
      ];
    });
  }

  if (prompts.box) {
    const first = imageMapper?.mapWorldPoint({ x: prompts.box.x1, y: prompts.box.y1 });
    const second = imageMapper?.mapWorldPoint({ x: prompts.box.x2, y: prompts.box.y2 });
    if (first && second) {
      result.box = {
        x1: Math.max(0, Math.min(1, Math.min(first.x, second.x) / naturalW)),
        y1: Math.max(0, Math.min(1, Math.min(first.y, second.y) / naturalH)),
        x2: Math.max(0, Math.min(1, Math.max(first.x, second.x) / naturalW)),
        y2: Math.max(0, Math.min(1, Math.max(first.y, second.y) / naturalH)),
      };
    }
  }

  return result;
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
