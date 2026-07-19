import type { BackgroundRemovalMethod, Document, NodeId, ShapeNode } from '@strata/scene';
import { useCallback, useEffect, useRef } from 'react';
import { commitRasterMask, hasNativeRasterMask } from '../backgroundRemoval/commitRasterMask';
import {
  computeSourceFingerprint,
  SubjectIsolationService,
} from '../backgroundRemoval/SubjectIsolationService';
import type { CanvasAnnouncer } from '../canvas/CanvasAnnouncer';
import type { EditorState, MaskPreviewMode, TrimapPenMode } from './types';

export interface BackgroundRemovalAPI {
  removeBackground: (method: BackgroundRemovalMethod) => Promise<void>;
  cancelBackgroundRemoval: () => void;
  removeBackgroundWithOptions: (
    method: BackgroundRemovalMethod,
    feather: number,
    decontaminate: boolean,
  ) => Promise<void>;
  setShowOriginalBg: (nodeId: NodeId | null) => void;
  setMaskPreviewMode: (mode: MaskPreviewMode) => void;
  setRefineMaskOptions: (opts: Partial<{ brushSize: number; hardness: number }>) => void;
  setTrimapEditOptions: (
    opts: Partial<{ brushSize: number; hardness: number; penMode: TrimapPenMode }>,
  ) => void;
  setBrushSetting: <K extends keyof EditorState['brushSettings']>(
    key: K,
    value: EditorState['brushSettings'][K],
  ) => void;
  refineHairEdges: () => Promise<void>;
  startTrimapEdit: () => void;
  applyTrimapMatting: () => Promise<void>;
  confirmSubjectPicker: (keepIds: number[]) => void;
  cancelSubjectPicker: () => void;
  getTrimapData: (nodeId: NodeId) => { data: Uint8Array; width: number; height: number } | null;
  setTrimapData: (nodeId: NodeId, data: Uint8Array, width: number, height: number) => void;
}

/**
 * Decode source image at a preview resolution and return orientation-normalized
 * pixel data together with source metadata.
 */
async function decodeSource(
  src: string,
  w: number,
  h: number,
  announcerRef: React.MutableRefObject<CanvasAnnouncer | null>,
): Promise<{ imageData: ImageData; extractW: number; extractH: number } | null> {
  const { getImageCache } = await import('@strata/engine');
  const cache = getImageCache();
  let img: HTMLImageElement | ImageBitmap | null = null;
  try {
    img = await cache.load(src);
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
  const maxDim = 2048;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const extractW = Math.ceil(w * scale);
  const extractH = Math.ceil(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = extractW;
  canvas.height = extractH;
  const ctx = canvas.getContext('2d')!;
  try {
    ctx.drawImage(img, 0, 0, extractW, extractH);
  } catch {
    announcerRef.current?.announce(
      'Could not render image: the image may be cross-origin (CORS blocked)',
    );
    return null;
  }
  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, extractW, extractH);
  } catch {
    announcerRef.current?.announce(
      'Could not read image pixels: the image source may be cross-origin (CORS blocked)',
    );
    return null;
  }
  return { imageData, extractW, extractH };
}

/**
 * Warm the ImageCache for a freshly-generated mask so the next render can
 * composite it synchronously.
 */
async function warmMaskCache(
  cache: { isLoaded: (url: string) => boolean; load: (url: string) => Promise<unknown> },
  maskDataUrl?: string | null,
): Promise<void> {
  if (!maskDataUrl || cache.isLoaded(maskDataUrl)) return;
  try {
    await Promise.race([
      cache.load(maskDataUrl),
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('mask preload timeout')), 1000);
      }),
    ]);
  } catch {
    // Errors/timeouts are recorded in the cache entry; the renderer will retry.
  }
}

export function useBackgroundRemoval(
  state: EditorState,
  patch: (partial: Partial<EditorState>) => void,
  setState: React.Dispatch<React.SetStateAction<EditorState>>,
  stateRef: React.MutableRefObject<EditorState>,
  updateDoc: (fn: (doc: Document) => Document) => void,
  announcerRef: React.MutableRefObject<CanvasAnnouncer | null>,
  bgRemovalAbortRef: React.MutableRefObject<AbortController | null>,
  processingBgNodeRef: React.MutableRefObject<NodeId | null>,
  trimapStoreRef: React.MutableRefObject<
    Map<string, { data: Uint8Array; width: number; height: number }>
  >,
): BackgroundRemovalAPI {
  const serviceRef = useRef<SubjectIsolationService | null>(null);

  if (!serviceRef.current) {
    serviceRef.current = new SubjectIsolationService();
  }

  useEffect(() => {
    return () => {
      serviceRef.current?.dispose();
    };
  }, []);

  const removeBackground = useCallback(
    async (method: BackgroundRemovalMethod) => {
      const { isImageShape, imageShapeSrc, imageShapeW, imageShapeH } = await import(
        '@strata/scene'
      );
      const imageNode = state.selection
        .map((id) => state.document.nodes[id] as ShapeNode | undefined)
        .find((n) => n && isImageShape(n)) as ShapeNode | undefined;
      if (!imageNode) {
        announcerRef.current?.announce('Select an image node first');
        return;
      }
      const processingNodeId = imageNode.id;
      const src = imageShapeSrc(imageNode);
      const w = imageShapeW(imageNode);
      const h = imageShapeH(imageNode);
      announcerRef.current?.announce(`Removing background using ${method}...`);

      const decoded = await decodeSource(src, w, h, announcerRef);
      if (!decoded) return;

      const service = serviceRef.current!;
      bgRemovalAbortRef.current?.abort();
      bgRemovalAbortRef.current = new AbortController();
      processingBgNodeRef.current = processingNodeId;

      const sourceFingerprint = await computeSourceFingerprint(src, decoded.imageData);

      const request = {
        requestId: `si-${Date.now()}-${processingNodeId}`,
        documentId: state.document.id,
        documentRevision: 1,
        nodeId: processingNodeId,
        sourceFingerprint,
        sourcePixelRevision: 1,
        placementRevision: 1,
        sourceWidth: decoded.extractW,
        sourceHeight: decoded.extractH,
        imageData: decoded.imageData,
        options: { method },
      };

      try {
        const result = await service.isolate(request);

        if (service.isStale(request, stateRef.current).stale) {
          announcerRef.current?.announce(
            'Background removal completed but the image state changed',
          );
          return;
        }

        const { getImageCache } = await import('@strata/engine');
        await warmMaskCache(getImageCache(), result.maskDataUrl);
        updateDoc((d) =>
          commitRasterMask(d, processingNodeId, {
            dataUrl: result.maskDataUrl,
            width: result.maskWidth,
            height: result.maskHeight,
            method: result.provenance.method as BackgroundRemovalMethod,
            generatedAt: Date.now(),
            confidence: 0.95,
            decontaminate: true,
          }),
        );
        announcerRef.current?.announce('Background removed');
      } catch (e) {
        if ((e as Error).message === 'cancelled') return;
        announcerRef.current?.announce(`Background removal failed: ${(e as Error).message}`);
      } finally {
        if (processingBgNodeRef.current === processingNodeId) {
          bgRemovalAbortRef.current = null;
          processingBgNodeRef.current = null;
        }
      }
    },
    [state, announcerRef, bgRemovalAbortRef, processingBgNodeRef, stateRef, updateDoc],
  );

  const cancelBackgroundRemoval = useCallback(() => {
    bgRemovalAbortRef.current?.abort();
    bgRemovalAbortRef.current = null;
    processingBgNodeRef.current = null;
    serviceRef.current?.cancel();
  }, [bgRemovalAbortRef, processingBgNodeRef]);

  const removeBackgroundWithOptions = useCallback(
    async (method: BackgroundRemovalMethod, feather: number, decontaminate: boolean) => {
      const { isImageShape, imageShapeSrc, imageShapeW, imageShapeH } = await import(
        '@strata/scene'
      );
      const imageNode = state.selection
        .map((id) => state.document.nodes[id] as ShapeNode | undefined)
        .find((n) => n && isImageShape(n)) as ShapeNode | undefined;
      if (!imageNode) {
        announcerRef.current?.announce('Select an image node first');
        return;
      }
      const processingNodeId = imageNode.id;
      const src = imageShapeSrc(imageNode);
      const w = imageShapeW(imageNode);
      const h = imageShapeH(imageNode);
      announcerRef.current?.announce(`Removing background using ${method}...`);

      const decoded = await decodeSource(src, w, h, announcerRef);
      if (!decoded) return;

      const service = serviceRef.current!;
      bgRemovalAbortRef.current?.abort();
      bgRemovalAbortRef.current = new AbortController();
      processingBgNodeRef.current = processingNodeId;

      const sourceFingerprint = await computeSourceFingerprint(src, decoded.imageData);

      const request = {
        requestId: `si-${Date.now()}-${processingNodeId}`,
        documentId: state.document.id,
        documentRevision: 1,
        nodeId: processingNodeId,
        sourceFingerprint,
        sourcePixelRevision: 1,
        placementRevision: 1,
        sourceWidth: decoded.extractW,
        sourceHeight: decoded.extractH,
        imageData: decoded.imageData,
        options: { method },
      };

      try {
        const isoResult = await service.isolate(request);

        if (service.isStale(request, stateRef.current).stale) {
          announcerRef.current?.announce(
            'Background removal completed but the image state changed',
          );
          return;
        }

        const engineResult = {
          maskDataUrl: isoResult.maskDataUrl,
          confidence: 0.95,
          method: isoResult.provenance.method as 'quick' | 'ai-balanced' | 'ai-quality',
          processingTimeMs: parseInt(isoResult.provenance.runtime, 10) || 0,
          width: isoResult.maskWidth,
          height: isoResult.maskHeight,
        };

        const { finalizeMaskResult } = await import('@strata/engine');
        const finalized = await finalizeMaskResult(engineResult, { promptIfMultiple: true });

        if (finalized.needsSubjectPicker && finalized.components) {
          patch({
            subjectPickerSession: {
              nodeId: processingNodeId,
              width: finalized.width,
              height: finalized.height,
              components: finalized.components,
              keepIds: finalized.components[0] ? [finalized.components[0].id] : [],
              pendingMaskDataUrl: finalized.maskDataUrl,
              method: finalized.method as BackgroundRemovalMethod,
              confidence: finalized.confidence,
              feather,
              decontaminate,
            },
          });
          announcerRef.current?.announce('Multiple subjects detected — pick which regions to keep');
          return;
        }

        const { getImageCache } = await import('@strata/engine');
        await warmMaskCache(getImageCache(), finalized.maskDataUrl);
        updateDoc((d) =>
          commitRasterMask(d, processingNodeId, {
            dataUrl: finalized.maskDataUrl,
            width: finalized.width,
            height: finalized.height,
            method: finalized.method as BackgroundRemovalMethod,
            generatedAt: Date.now(),
            confidence: finalized.confidence,
            decontaminate,
          }),
        );
        announcerRef.current?.announce('Background removed');
      } catch (e) {
        if ((e as Error).message === 'cancelled') return;
        announcerRef.current?.announce(`Background removal failed: ${(e as Error).message}`);
      } finally {
        if (processingBgNodeRef.current === processingNodeId) {
          bgRemovalAbortRef.current = null;
          processingBgNodeRef.current = null;
        }
      }
    },
    [state, announcerRef, bgRemovalAbortRef, processingBgNodeRef, patch, stateRef, updateDoc],
  );

  const setShowOriginalBg = useCallback(
    (nodeId: NodeId | null) => {
      patch({ showOriginalBgNodeId: nodeId });
    },
    [patch],
  );

  const setMaskPreviewMode = useCallback(
    (mode: MaskPreviewMode) => {
      patch({ maskPreviewMode: mode });
    },
    [patch],
  );

  const setRefineMaskOptions = useCallback(
    (opts: Partial<{ brushSize: number; hardness: number }>) => {
      setState((s) => ({
        ...s,
        refineMaskOptions: { ...s.refineMaskOptions, ...opts },
      }));
    },
    [setState],
  );

  const setTrimapEditOptions = useCallback(
    (
      opts: Partial<{
        brushSize: number;
        hardness: number;
        penMode: TrimapPenMode;
      }>,
    ) => {
      setState((s) => ({
        ...s,
        trimapEditOptions: { ...s.trimapEditOptions, ...opts },
      }));
    },
    [setState],
  );

  const setBrushSetting = useCallback(
    <K extends keyof EditorState['brushSettings']>(
      key: K,
      value: EditorState['brushSettings'][K],
    ) => {
      setState((s) => ({
        ...s,
        brushSettings: { ...s.brushSettings, [key]: value },
      }));
    },
    [setState],
  );

  const confirmSubjectPicker = useCallback(
    (keepIds: number[]) => {
      const session = stateRef.current.subjectPickerSession;
      if (!session) return;
      void (async () => {
        const { decodeMaskDataUrl, filterMaskByComponents, getImageCache, maskArrayToDataUrl } =
          await import('@strata/engine');
        const { mask, width, height } = await decodeMaskDataUrl(session.pendingMaskDataUrl);
        const filtered = filterMaskByComponents(mask, width, height, new Set(keepIds));
        const maskDataUrl = maskArrayToDataUrl(filtered, width, height);
        await warmMaskCache(getImageCache(), maskDataUrl);
        updateDoc((d) =>
          commitRasterMask(d, session.nodeId, {
            dataUrl: maskDataUrl,
            width,
            height,
            method: session.method,
            generatedAt: Date.now(),
            confidence: session.confidence,
            decontaminate: session.decontaminate,
          }),
        );
        patch({ subjectPickerSession: null });
        announcerRef.current?.announce(`Kept ${keepIds.length} subject(s)`);
      })();
    },
    [stateRef, updateDoc, patch, announcerRef],
  );

  const cancelSubjectPicker = useCallback(() => {
    patch({ subjectPickerSession: null });
    announcerRef.current?.announce('Subject selection cancelled');
  }, [patch, announcerRef]);

  const refineHairEdges = useCallback(async () => {
    const { isImageShape, imageShapeSrc, imageShapeW, imageShapeH } = await import('@strata/scene');
    const doc = state.document;
    const imageNode = state.selection
      .map((id) => doc.nodes[id] as ShapeNode | undefined)
      .find((n) => n && isImageShape(n) && hasNativeRasterMask(doc, n.id)) as ShapeNode | undefined;
    if (!imageNode || !hasNativeRasterMask(doc, imageNode.id)) {
      announcerRef.current?.announce('Apply background removal first');
      return;
    }
    try {
      const { decodeMaskDataUrl, getImageCache, maskArrayToDataUrl, refineHairMatting } =
        await import('@strata/engine');
      const w = imageShapeW(imageNode);
      const h = imageShapeH(imageNode);
      const img = await getImageCache().load(imageShapeSrc(imageNode));
      if (!img) {
        announcerRef.current?.announce('Could not load image');
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const assetId = imageNode.mask!.rasterMask!.assetId;
      const asset = doc.rasterMaskAssets?.[assetId];
      const maskUrl = asset?.dataUrl;
      if (!maskUrl) {
        announcerRef.current?.announce('Could not resolve mask asset');
        return;
      }
      const { mask } = await decodeMaskDataUrl(maskUrl);
      const refined = refineHairMatting(imageData, mask);
      const maskDataUrl = maskArrayToDataUrl(refined, w, h);
      await warmMaskCache(getImageCache(), maskDataUrl);
      updateDoc((d) =>
        commitRasterMask(d, imageNode.id, {
          dataUrl: maskDataUrl,
          width: w,
          height: h,
        }),
      );
      announcerRef.current?.announce('Hair/fur edges refined');
    } catch (e) {
      announcerRef.current?.announce(`Edge refinement failed: ${(e as Error).message}`);
    }
  }, [state, announcerRef, updateDoc]);

  const startTrimapEdit = useCallback(() => {
    const nodeId = state.selection[0];
    if (!nodeId) {
      announcerRef.current?.announce('Select an image first');
      return;
    }
    patch({ tool: 'trimapEdit' });
    announcerRef.current?.announce(
      'Trimap edit: 1=foreground, 2=unknown, 3=background. Escape to finish.',
    );
  }, [state, announcerRef, patch]);

  const applyTrimapMatting = useCallback(async () => {
    const nodeId = state.selection[0];
    if (!nodeId) return;
    const trimapEntry = trimapStoreRef.current.get(nodeId);
    const doc = state.document;
    const node = doc.nodes[nodeId] as ShapeNode | undefined;
    if (!trimapEntry || !node || !hasNativeRasterMask(doc, nodeId)) {
      announcerRef.current?.announce('Paint a trimap first');
      return;
    }
    try {
      const { isImageShape, imageShapeSrc, imageShapeW, imageShapeH } = await import(
        '@strata/scene'
      );
      if (!isImageShape(node)) return;
      const { getImageCache, maskArrayToDataUrl, solveTrimapMatting } = await import(
        '@strata/engine'
      );
      const w = imageShapeW(node);
      const h = imageShapeH(node);
      const img = await getImageCache().load(imageShapeSrc(node));
      if (!img) {
        announcerRef.current?.announce('Could not load image');
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const matte = solveTrimapMatting(imageData, trimapEntry.data);
      const maskDataUrl = maskArrayToDataUrl(matte, w, h);
      await warmMaskCache(getImageCache(), maskDataUrl);
      updateDoc((d) =>
        commitRasterMask(d, nodeId, {
          dataUrl: maskDataUrl,
          width: w,
          height: h,
        }),
      );
      trimapStoreRef.current.delete(nodeId);
      patch({ tool: 'select' });
      announcerRef.current?.announce('Trimap matting applied');
    } catch (e) {
      announcerRef.current?.announce(`Trimap matting failed: ${(e as Error).message}`);
    }
  }, [state, trimapStoreRef, announcerRef, updateDoc, patch]);

  const getTrimapData = useCallback(
    (nodeId: NodeId) => trimapStoreRef.current.get(nodeId) ?? null,
    [trimapStoreRef],
  );

  const setTrimapData = useCallback(
    (nodeId: NodeId, data: Uint8Array, width: number, height: number) => {
      trimapStoreRef.current.set(nodeId, { data, width, height });
    },
    [trimapStoreRef],
  );

  return {
    removeBackground,
    cancelBackgroundRemoval,
    removeBackgroundWithOptions,
    setShowOriginalBg,
    setMaskPreviewMode,
    setRefineMaskOptions,
    setTrimapEditOptions,
    setBrushSetting,
    refineHairEdges,
    startTrimapEdit,
    applyTrimapMatting,
    confirmSubjectPicker,
    cancelSubjectPicker,
    getTrimapData,
    setTrimapData,
  };
}
