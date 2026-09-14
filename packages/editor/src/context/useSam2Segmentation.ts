import type { AreaSelection, WorkerInferResult } from '@varve/engine';
import {
  assessImageInferenceResources,
  cachedImageDims,
  decodeSam2DecoderOutput,
  EmbeddingCache,
  getImageCache,
  getInferenceWorkerHost,
  getModelById,
  getModelLoader,
  getNativeGenerativeModelStatus,
  getRuntimeCapabilitiesSync,
} from '@varve/engine';
import { type Document, imageShapeSrc, type NodeId } from '@varve/scene';
import { useCallback, useEffect, useRef } from 'react';
import { commitRasterMask } from '../backgroundRemoval/commitRasterMask';
import type { CanvasAnnouncer } from '../canvas/CanvasAnnouncer';
import { setCollapsed } from '../components/Inspector/sectionState';
import { prepareImageMaskMapper } from '../tools/imageMaskCoordinates';
import { normalizeSam2Prompts } from '../tools/sam2PromptCoordinates';
import { areaSelectionFromMaskCoverage } from '../tools/selectionMask';
import { fingerprintImageData } from './imageFingerprint';
import type { EditorState, ObjectSelectionSession } from './types';

type WorkerTensor = { data: Float32Array; dims: number[] };
const SAM2_SOFT_DEADLINE_MS = 15_000;

export interface Sam2SegmentationAPI {
  applySam2Segmentation: (params: {
    nodeId: NodeId;
    prompts: {
      points?: Array<{ x: number; y: number; label: 0 | 1 }>;
      box?: { x1: number; y1: number; x2: number; y2: number };
    };
    signal?: AbortSignal;
    operation: 'preview' | 'mask' | 'selection';
    candidateIndex?: number;
  }) => Promise<{ mask: Uint8Array; width: number; height: number; confidence: number } | null>;
  cancelSam2Segmentation: () => void;
  selectSam2Candidate: (index: number) => void;
}

export function useSam2Segmentation(
  state: EditorState,
  stateRef: React.MutableRefObject<EditorState>,
  setState: React.Dispatch<React.SetStateAction<EditorState>>,
  updateDoc: (fn: (doc: Document) => Document) => void,
  announcerRef: React.MutableRefObject<CanvasAnnouncer | null>,
  enabled = true,
  setAreaSelection?: (selection: AreaSelection | null) => void,
): Sam2SegmentationAPI {
  const abortRef = useRef<AbortController | null>(null);
  const softDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const embeddingCacheRef = useRef<EmbeddingCache<{
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
    sourceFingerprint: string;
  }> | null>(null);
  if (enabled && !embeddingCacheRef.current) {
    embeddingCacheRef.current = new EmbeddingCache<{
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
      sourceFingerprint: string;
    }>({
      maxEntries: 2,
      maxBytes: 512 * 1024 * 1024,
      estimateBytes: (entry) =>
        Object.values(entry.embeddings).reduce(
          (total, tensor) => total + tensor.data.byteLength,
          0,
        ),
    });
  }

  const writeTransientSession = useCallback(
    (session: ObjectSelectionSession | null, extra: Partial<EditorState> = {}): void => {
      stateRef.current = {
        ...stateRef.current,
        ...extra,
        objectSelectionSession: session,
      };
      setState((prev) => ({ ...prev, ...extra, objectSelectionSession: session }));
    },
    [setState, stateRef],
  );

  const cancelSam2Segmentation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (softDeadlineRef.current !== null) {
      clearTimeout(softDeadlineRef.current);
      softDeadlineRef.current = null;
    }
    generationRef.current += 1;
    writeTransientSession(null, { maskPreviewMode: 'none' });
  }, [writeTransientSession]);

  const selectSam2Candidate = useCallback(
    (index: number) => {
      const session = stateRef.current.objectSelectionSession;
      const candidate = session?.candidates[index];
      if (!session || !candidate) return;
      writeTransientSession({
        ...session,
        selectedCandidate: index,
        confidence: candidate.confidence,
      });
    },
    [stateRef, writeTransientSession],
  );

  useEffect(() => {
    const session = stateRef.current.objectSelectionSession;
    if (!session) return;
    const selected = state.selection;
    if (
      (session.documentId && session.documentId !== state.document.id) ||
      selected.length !== 1 ||
      selected[0] !== session.nodeId ||
      (session.sourceLocator &&
        currentNodeSource(state.document.nodes[session.nodeId]) !== session.sourceLocator)
    ) {
      cancelSam2Segmentation();
    }
  }, [cancelSam2Segmentation, state.document, state.document.id, state.selection, stateRef]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      if (softDeadlineRef.current !== null) {
        clearTimeout(softDeadlineRef.current);
        softDeadlineRef.current = null;
      }
      generationRef.current += 1;
    };
  }, []);

  const applySam2Segmentation = useCallback(
    async ({
      nodeId,
      prompts,
      signal: externalSignal,
      operation,
      candidateIndex,
    }: {
      nodeId: NodeId;
      prompts: {
        points?: Array<{ x: number; y: number; label: 0 | 1 }>;
        box?: { x1: number; y1: number; x2: number; y2: number };
      };
      signal?: AbortSignal;
      operation: 'preview' | 'mask' | 'selection';
      candidateIndex?: number;
    }): Promise<{ mask: Uint8Array; width: number; height: number; confidence: number } | null> => {
      if (!enabled) {
        announcerRef.current?.announce('Subject selection is available in the main editor window.');
        return null;
      }
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

      // Refuse a pixel-selection output before any model work when the editor
      // surface has no area-selection setter. Otherwise a full encode/decode
      // would run only to fail at the final conversion step.
      if (operation === 'selection' && !setAreaSelection) {
        announcerRef.current?.announce(
          'Pixel selection output is unavailable in this editor surface.',
        );
        return null;
      }

      const previousSession = stateRef.current.objectSelectionSession;
      const sameSessionTarget =
        previousSession?.nodeId === nodeId &&
        (!previousSession.documentId || previousSession.documentId === currentDoc.id) &&
        (!previousSession.sourceLocator || previousSession.sourceLocator === src);

      // Applying a visible candidate must be a commit, not a second model
      // run. This makes Apply/Enter and Use as selection deterministic and
      // keeps the exact mask the user inspected as the committed output.
      const isCommitOperation = operation === 'mask' || operation === 'selection';
      if (
        isCommitOperation &&
        sameSessionTarget &&
        previousSession.status === 'ready' &&
        previousSession.sourceFingerprint &&
        previousSession.width > 0 &&
        previousSession.height > 0
      ) {
        const selectedCandidate = candidateIndex ?? previousSession.selectedCandidate;
        const candidate = previousSession.candidates[selectedCandidate];
        if (candidate) {
          const freshSource = await readImageSourceIdentity(src);
          if (generation !== generationRef.current || externalSignal?.aborted) return null;
          if (
            !freshSource ||
            freshSource.width !== previousSession.width ||
            freshSource.height !== previousSession.height ||
            freshSource.fingerprint !== previousSession.sourceFingerprint
          ) {
            const live = stateRef.current.objectSelectionSession;
            if (generation === generationRef.current && live?.nodeId === nodeId) {
              writeTransientSession({
                ...live,
                width: 0,
                height: 0,
                candidates: [],
                status: 'error',
                error: {
                  code: 'source_changed',
                  message:
                    'The image changed after the preview. Create a new preview before applying it.',
                  retryable: true,
                },
              });
            }
            announcerRef.current?.announce(
              'The image changed after the preview. Create a new preview before applying it.',
            );
            return null;
          }
          if (countMaskCoverage(candidate.mask) === 0) {
            const live = stateRef.current.objectSelectionSession;
            if (generation === generationRef.current && live?.nodeId === nodeId) {
              writeTransientSession({
                ...live,
                status: 'error',
                error: {
                  code: 'empty_result',
                  message:
                    'The reviewed candidate contains no pixels. Adjust or remove prompts and create a new preview.',
                  retryable: true,
                },
              });
            }
            announcerRef.current?.announce(
              'The reviewed candidate contains no pixels. Adjust the prompts and try again.',
            );
            return null;
          }
          abortRef.current?.abort();
          abortRef.current = null;
          generationRef.current += 1;
          if (softDeadlineRef.current !== null) {
            clearTimeout(softDeadlineRef.current);
            softDeadlineRef.current = null;
          }

          if (operation === 'selection') {
            const areaSelection = areaSelectionFromMaskCoverage(
              currentDoc,
              nodeId,
              candidate.mask,
              previousSession.width,
              previousSession.height,
              'source-image-pixels',
            );
            if (!areaSelection || !setAreaSelection) {
              announcerRef.current?.announce(
                'The subject mask could not be converted into a pixel selection.',
              );
              return null;
            }
            setAreaSelection(areaSelection);
            writeTransientSession(null, { maskPreviewMode: 'none' });
            announcerRef.current?.announce(
              `Selected subject (${scoreNoun(previousSession.confidenceSource)} ${Math.round(candidate.confidence * 100)}%)`,
            );
            return {
              mask: candidate.mask,
              width: previousSession.width,
              height: previousSession.height,
              confidence: candidate.confidence,
            };
          }

          const maskDataUrl = await maskToDataUrl(
            candidate.mask,
            previousSession.width,
            previousSession.height,
          );
          let committed = false;
          updateDoc((doc) => {
            const liveNode = doc.nodes[nodeId];
            if (doc.id !== currentDoc.id || liveNode !== node) return doc;
            const updated = commitRasterMask(doc, nodeId, {
              dataUrl: maskDataUrl,
              width: previousSession.width,
              height: previousSession.height,
              method: 'ai-quality',
              modelId: previousSession.modelId || 'sam2-hiera-tiny',
              confidence: candidate.confidence,
              generatedAt: Date.now(),
              sourceLocator: src,
            });
            committed = updated !== doc;
            return updated;
          });
          if (committed) {
            // The committed confidence and method are rendered in the
            // Background Removal disclosure. Reveal it when Object Selection
            // applies a mask so the result is immediately reviewable from
            // every entry point (toolbar, inspector, or keyboard).
            writeTransientSession(null, {
              maskPreviewMode: 'none',
              sectionVisibility: setCollapsed(
                stateRef.current.sectionVisibility,
                'background-removal',
                false,
              ),
            });
            announcerRef.current?.announce(
              `Selection applied as a mask (${scoreNoun(previousSession.confidenceSource)} ${Math.round(candidate.confidence * 100)}%)`,
            );
            return {
              mask: candidate.mask,
              width: previousSession.width,
              height: previousSession.height,
              confidence: candidate.confidence,
            };
          }
          return null;
        }
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

      const promptSession: ObjectSelectionSession = {
        ...(sameSessionTarget ? previousSession : null),
        nodeId,
        documentId: currentDoc.id,
        width: 0,
        height: 0,
        candidates: [],
        selectedCandidate: sameSessionTarget ? (previousSession?.selectedCandidate ?? 0) : 0,
        points: prompts.points ?? [],
        box: prompts.box ?? null,
        draftPoint: null,
        draftBox: null,
        confidence: sameSessionTarget ? (previousSession?.confidence ?? 0) : 0,
        status: 'preparing',
        modelId: sameSessionTarget
          ? (previousSession?.modelId ?? 'sam2-hiera-tiny')
          : 'sam2-hiera-tiny',
        sourceLocator: src,
        sourceFingerprint: undefined,
        startedAt: Date.now(),
        slow: false,
        stageTimingsMs: {},
        error: undefined,
      };
      const markFailure = (failure: {
        code: string;
        message: string;
        retryable: boolean;
      }): void => {
        // A superseded request may fail after a newer prompt has already
        // published its own session. Never turn that newer session into an
        // error or announce a stale failure.
        if (generation !== generationRef.current) return;
        if (softDeadlineRef.current !== null) {
          clearTimeout(softDeadlineRef.current);
          softDeadlineRef.current = null;
        }
        const live = stateRef.current.objectSelectionSession;
        if (live?.nodeId === nodeId && stateRef.current.document.id === currentDoc.id) {
          writeTransientSession({ ...live, status: 'error', error: failure });
        }
        announcerRef.current?.announce(failure.message);
      };
      writeTransientSession(promptSession, { maskPreviewMode: 'overlay' });
      announcerRef.current?.announce('Preparing object selection…');
      softDeadlineRef.current = setTimeout(() => {
        const live = stateRef.current.objectSelectionSession;
        if (
          live?.nodeId === nodeId &&
          stateRef.current.document.id === currentDoc.id &&
          live.status !== 'ready' &&
          live.status !== 'error'
        ) {
          writeTransientSession({ ...live, slow: true });
          announcerRef.current?.announce('Object selection is taking longer than expected.');
        }
      }, SAM2_SOFT_DEADLINE_MS);

      let img: HTMLImageElement | ImageBitmap | null = null;
      try {
        // A locator is not a content identity. Evict it before reading so a
        // document asset replaced behind the same handle cannot be hashed or
        // embedded from stale decoded pixels.
        getImageCache().evict(src);
        img = await getImageCache().load(src);
      } catch {
        markFailure({
          code: 'image_load_failed',
          message:
            'Could not load the image pixels. Check the file or its permissions and try again.',
          retryable: true,
        });
        return null;
      }

      if (!img) {
        markFailure({
          code: 'image_load_failed',
          message:
            'Could not load the image pixels. Check the file or its permissions and try again.',
          retryable: true,
        });
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

      if (
        !Number.isSafeInteger(naturalW) ||
        !Number.isSafeInteger(naturalH) ||
        naturalW <= 0 ||
        naturalH <= 0
      ) {
        markFailure({
          code: 'image_pixels_unavailable',
          message: 'The image has invalid dimensions and cannot be used for object selection.',
          retryable: true,
        });
        return null;
      }

      const encoderId = 'sam2-hiera-tiny-encoder';
      const decoderId = 'sam2-hiera-tiny-decoder';
      const encoderPeakBytes = getModelById(encoderId)?.peakMemoryBytes ?? 700_000_000;
      const runtime = getRuntimeCapabilitiesSync();
      let safePeakBytes = runtime.wasmSafePeakBytes;
      if (runtime.isTauri) {
        // Tauri WebViews commonly omit navigator.deviceMemory. Reuse the
        // desktop process' cgroup/OS snapshot when it is available so a
        // capable ARM or x86 desktop is not mistaken for a 2 GB browser.
        const nativeResources = await getNativeGenerativeModelStatus();
        if (
          nativeResources.memoryAvailableBytes != null &&
          nativeResources.memoryAvailableBytes > 0
        ) {
          safePeakBytes = nativeResources.memoryAvailableBytes;
        }
      }
      const resourceAssessment = assessImageInferenceResources({
        width: naturalW,
        height: naturalH,
        modelPeakBytes: encoderPeakBytes,
        runtime: { wasmSafePeakBytes: safePeakBytes },
        operation: 'Object Selection',
      });
      if (combinedSignal.aborted) return null;
      if (!resourceAssessment.allowed) {
        markFailure({
          code: 'out_of_memory',
          message:
            resourceAssessment.reason ?? 'Object Selection needs more memory on this device.',
          retryable: false,
        });
        return null;
      }

      // Do not allocate a full-resolution canvas or ImageData until the
      // model-plus-source working set has passed the runtime's safe budget.
      writeCurrentSam2Stage(stateRef, setState, nodeId, 'encoding');

      let imageData: ImageData;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = naturalW;
        canvas.height = naturalH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context unavailable');
        ctx.drawImage(img, 0, 0, naturalW, naturalH);
        imageData = ctx.getImageData(0, 0, naturalW, naturalH);
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        const allocationFailure = /memory|allocation|too large|invalid state/i.test(raw);
        markFailure({
          code: allocationFailure ? 'out_of_memory' : 'image_pixels_unavailable',
          message: allocationFailure
            ? 'Object Selection could not allocate a safe working buffer for this image. Use the brush or Fast cutout path, or work on a smaller image.'
            : 'The image pixels could not be read. Check the file permissions and try again.',
          retryable: true,
        });
        return null;
      }

      if (combinedSignal.aborted) return null;

      const sourceFingerprint = await fingerprintImageData(imageData);
      if (combinedSignal.aborted) return null;

      const imageMapper = prepareImageMaskMapper({
        document: currentDoc,
        node,
        sourceWidth: naturalW,
        sourceHeight: naturalH,
      });
      if (!imageMapper) {
        markFailure({
          code: 'placement_invalid',
          message:
            'The image placement is not valid for object selection. Reset the image bounds and try again.',
          retryable: true,
        });
        return null;
      }
      const normPrompts = normalizeSam2Prompts(prompts, imageMapper, naturalW, naturalH);

      const loader = getModelLoader();
      let resolvedEncoderPath: string | null;
      let resolvedDecoderPath: string | null;
      try {
        resolvedEncoderPath = await loader.getModelPath(encoderId, combinedSignal);
        resolvedDecoderPath = await loader.getModelPath(decoderId, combinedSignal);
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        if (isCancellationError(raw)) return null;
        markFailure(mapSegmentationFailure(raw));
        return null;
      }

      if (!resolvedEncoderPath || !resolvedDecoderPath) {
        markFailure({
          code: 'model_not_installed',
          message:
            'Object selection needs a one-time model download. Install it from Settings > Offline Models, then try again.',
          retryable: true,
        });
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
          sourceFingerprint,
          encoderId,
          'preprocess-v1',
        ]
          .map((part) => encodeURIComponent(String(part)))
          .join('|');
        const embeddingCache = embeddingCacheRef.current;
        if (!embeddingCache) return null;
        let cached = embeddingCache.get(cacheKey);
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
            {
              signal: combinedSignal,
              reservationBytes: resourceAssessment.estimatedPeakBytes,
            },
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
            sourceFingerprint,
          };
          embeddingCache.set(cacheKey, cached);
        }

        if (generation !== generationRef.current || combinedSignal.aborted) return null;

        const liveNode = stateRef.current.document.nodes[nodeId];
        if (
          stateRef.current.document.id !== currentDoc.id ||
          stateRef.current.selection.length !== 1 ||
          stateRef.current.selection[0] !== nodeId ||
          liveNode !== node
        ) {
          return null;
        }

        writeCurrentSam2Stage(stateRef, setState, nodeId, 'decoding');
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
          {
            signal: combinedSignal,
            reservationBytes: resourceAssessment.estimatedPeakBytes,
          },
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

        const selectedCandidate = Math.max(
          0,
          Math.min(decoded.masks.length - 1, candidateIndex ?? decoded.selectedIndex),
        );
        const bestMask = decoded.masks[selectedCandidate]!;
        const selectedConfidence = bestMask.iouScore;
        const maskResult = {
          mask: bestMask.mask,
          width: naturalW,
          height: naturalH,
          confidence: selectedConfidence,
        };
        const coveragePixels = countMaskCoverage(bestMask.mask);

        switch (operation) {
          case 'preview':
            writeTransientSession(
              {
                ...promptSession,
                nodeId,
                width: naturalW,
                height: naturalH,
                candidates: decoded.masks.map((candidate) => ({
                  mask: candidate.mask,
                  confidence: candidate.iouScore,
                })),
                selectedCandidate,
                points: prompts.points ?? [],
                box: prompts.box ?? null,
                draftPoint: null,
                draftBox: null,
                confidence: selectedConfidence,
                confidenceSource: decoded.confidenceSource,
                status: 'ready' as const,
                modelId: 'sam2-hiera-tiny',
                executionProvider: decOutputs.executionProvider,
                sourceLocator: src,
                sourceFingerprint,
                startedAt: promptSession.startedAt,
                slow: false,
                stageTimingsMs: {
                  ...promptSession.stageTimingsMs,
                  ready: promptSession.startedAt ? Date.now() - promptSession.startedAt : undefined,
                },
                error: undefined,
              },
              { maskPreviewMode: 'overlay' },
            );
            announcerRef.current?.announce(
              coveragePixels === 0
                ? `No pixels were selected for these prompts (${scoreNoun(decoded.confidenceSource)} ${Math.round(selectedConfidence * 100)}%). Adjust the prompts and try again.`
                : `Subject preview ready (${scoreNoun(decoded.confidenceSource)} ${Math.round(selectedConfidence * 100)}%). Press Enter to apply as a mask, Escape to cancel.`,
            );
            return maskResult;

          case 'mask': {
            if (coveragePixels === 0) {
              markFailure({
                code: 'empty_result',
                message:
                  'The model did not find any pixels for these prompts. Adjust the prompts and create a new preview.',
                retryable: true,
              });
              return null;
            }
            const liveBeforeCommit = stateRef.current.document.nodes[nodeId];
            if (
              stateRef.current.document.id !== currentDoc.id ||
              stateRef.current.selection.length !== 1 ||
              stateRef.current.selection[0] !== nodeId ||
              liveBeforeCommit !== node
            ) {
              return null;
            }
            const freshSource = await readImageSourceIdentity(src);
            if (
              !freshSource ||
              freshSource.width !== naturalW ||
              freshSource.height !== naturalH ||
              freshSource.fingerprint !== sourceFingerprint
            ) {
              markFailure({
                code: 'source_changed',
                message: 'The image changed while processing. Create a new preview and try again.',
                retryable: true,
              });
              return null;
            }
            const maskDataUrl = await maskToDataUrl(bestMask.mask, naturalW, naturalH);
            let committed = false;
            updateDoc((doc) => {
              const liveNode = doc.nodes[nodeId];
              if (doc.id !== currentDoc.id || liveNode !== node) return doc;
              const updated = commitRasterMask(doc, nodeId, {
                dataUrl: maskDataUrl,
                width: naturalW,
                height: naturalH,
                method: 'ai-quality',
                modelId: 'sam2-hiera-tiny',
                confidence: selectedConfidence,
                generatedAt: Date.now(),
                sourceLocator: src,
              });
              committed = updated !== doc;
              return updated;
            });
            if (committed) {
              writeTransientSession(null, { maskPreviewMode: 'none' });
              announcerRef.current?.announce(
                `Selection applied as a mask (${scoreNoun(decoded.confidenceSource)} ${Math.round(selectedConfidence * 100)}%)`,
              );
            }
            return maskResult;
          }

          case 'selection': {
            if (coveragePixels === 0) {
              markFailure({
                code: 'empty_result',
                message:
                  'The model did not find any pixels for these prompts. Adjust the prompts and create a new preview.',
                retryable: true,
              });
              return null;
            }
            if (!setAreaSelection) {
              markFailure({
                code: 'selection_output_unavailable',
                message: 'Pixel selection output is unavailable in this editor surface.',
                retryable: false,
              });
              return null;
            }
            const areaSelection = areaSelectionFromMaskCoverage(
              currentDoc,
              nodeId,
              bestMask.mask,
              naturalW,
              naturalH,
              'source-image-pixels',
            );
            if (!areaSelection) {
              markFailure({
                code: 'selection_output_unavailable',
                message: 'The subject mask could not be converted into a pixel selection.',
                retryable: true,
              });
              return null;
            }
            setAreaSelection(areaSelection);
            writeTransientSession(null, { maskPreviewMode: 'none' });
            announcerRef.current?.announce(
              `Selected subject (${scoreNoun(decoded.confidenceSource)} ${Math.round(selectedConfidence * 100)}%)`,
            );
            return maskResult;
          }
        }
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        if (isCancellationError(raw)) return null;
        const failure = mapSegmentationFailure(raw);
        markFailure(failure);
        return null;
      } finally {
        if (generation === generationRef.current) {
          abortRef.current = null;
          if (softDeadlineRef.current !== null) {
            clearTimeout(softDeadlineRef.current);
            softDeadlineRef.current = null;
          }
        }
      }

      return null;
    },
    [enabled, stateRef, setState, updateDoc, announcerRef, setAreaSelection, writeTransientSession],
  );

  return { applySam2Segmentation, cancelSam2Segmentation, selectSam2Candidate };
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

function currentNodeSource(node: import('@varve/scene').SceneNode | undefined): string {
  return node?.kind === 'shape' ? imageShapeSrc(node) : '';
}

async function readImageSourceIdentity(
  src: string,
): Promise<{ width: number; height: number; fingerprint: string } | null> {
  if (typeof document === 'undefined') return null;
  try {
    const cache = getImageCache();
    cache.evict(src);
    const image = await cache.load(src);
    const { width, height } = cachedImageDims(image);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    return { width, height, fingerprint: await fingerprintImageData(imageData) };
  } catch {
    return null;
  }
}

/**
 * Map backend/worker failures to user-facing messages (error taxonomy in
 * the object-selection docs). Never leak raw tensor/backtrace text.
 */
function writeCurrentSam2Stage(
  stateRef: React.MutableRefObject<EditorState>,
  setState: React.Dispatch<React.SetStateAction<EditorState>>,
  nodeId: NodeId,
  status: 'preparing' | 'encoding' | 'decoding',
): void {
  const current = stateRef.current.objectSelectionSession;
  if (!current || current.nodeId !== nodeId) return;
  const elapsed = current.startedAt ? Math.max(0, Date.now() - current.startedAt) : undefined;
  const next = {
    ...current,
    status,
    error: undefined,
    stageTimingsMs:
      elapsed === undefined
        ? current.stageTimingsMs
        : { ...current.stageTimingsMs, [status]: elapsed },
  } as ObjectSelectionSession;
  stateRef.current = { ...stateRef.current, objectSelectionSession: next };
  setState((prev) => ({ ...prev, objectSelectionSession: next }));
}

function isCancellationError(raw: string): boolean {
  return /cancelled|canceled|abort/i.test(raw);
}

/** Count non-zero coverage pixels in a one-channel mask. */
function countMaskCoverage(mask: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]! > 0) count += 1;
  }
  return count;
}

/** Name the score by provenance; never call a predicted quality score "confidence". */
function scoreNoun(source: 'model-iou' | 'activation-heuristic' | undefined): string {
  if (source === 'model-iou') return 'model score';
  if (source === 'activation-heuristic') return 'heuristic score';
  return 'score';
}

function mapSegmentationFailure(raw: string): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (raw.includes('safe WASM memory limit')) {
    return {
      code: 'out_of_memory',
      message:
        'Object selection needs more memory than this device can safely use without GPU acceleration. Close other documents or try again on a device with more memory.',
      retryable: false,
    };
  }
  if (raw.startsWith('Worker error:') || /worker.*(failed|undefined)/i.test(raw)) {
    return {
      code: 'worker_crash',
      message: 'The AI worker could not start. Reload the document and try again.',
      retryable: true,
    };
  }
  if (/model.*(exceeds|not downloaded|not installed|missing)/i.test(raw)) {
    return {
      code: 'model_not_installed',
      message:
        'The object-selection model is missing. Install it from Settings, Offline Models, then try again.',
      retryable: true,
    };
  }
  if (raw.includes('timed out') || raw.includes('Inference timed out')) {
    return {
      code: 'inference_timeout',
      message:
        'Object selection took too long to respond. Try again; the next run can reuse the model, or use a smaller image.',
      retryable: true,
    };
  }
  return {
    code: 'unknown',
    message: 'Object selection could not complete. Check the AI model installation and try again.',
    retryable: true,
  };
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
