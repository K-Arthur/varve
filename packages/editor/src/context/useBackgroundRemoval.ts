import { DEFAULT_PREVIEW_MAX_DIMENSION } from '@strata/engine';
import type { ImageCache } from '@strata/engine';
import type { BackgroundRemovalMethod, Document, NodeId, ShapeNode } from '@strata/scene';
import { useCallback } from 'react';
import type { CanvasAnnouncer } from '../canvas/CanvasAnnouncer';
import type { EditorState, TrimapPenMode } from './types';

export interface BackgroundRemovalAPI {
  removeBackground: (method: BackgroundRemovalMethod) => Promise<void>;
  cancelBackgroundRemoval: () => void;
  removeBackgroundWithOptions: (
    method: BackgroundRemovalMethod,
    feather: number,
    decontaminate: boolean,
  ) => Promise<void>;
  setShowOriginalBg: (nodeId: NodeId | null) => void;
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
 * Warm the ImageCache for a freshly-generated mask so the next render can
 * composite it synchronously. Uses a short timeout so a slow or failing load
 * never blocks the document update; the renderer will retry asynchronously.
 */
async function warmMaskCache(cache: ImageCache, maskDataUrl?: string | null): Promise<void> {
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
      try {
        const { getImageCache } = await import('@strata/engine');
        const { setBackgroundRemoval } = await import('@strata/scene');
        const cache = getImageCache();
        bgRemovalAbortRef.current?.abort();
        bgRemovalAbortRef.current = new AbortController();
        processingBgNodeRef.current = processingNodeId;
        const signal = bgRemovalAbortRef.current.signal;
        let img: HTMLImageElement | ImageBitmap | null = null;
        try {
          img = await cache.load(src);
        } catch {
          announcerRef.current?.announce(
            'Could not load image: the image source may be cross-origin or unavailable',
          );
          return;
        }
        if (!img) {
          announcerRef.current?.announce('Could not load image');
          return;
        }
        const maxDim = DEFAULT_PREVIEW_MAX_DIMENSION;
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
          return;
        }
        let imageData: ImageData;
        try {
          imageData = ctx.getImageData(0, 0, extractW, extractH);
        } catch {
          announcerRef.current?.announce(
            'Could not read image pixels: the image source may be cross-origin (CORS blocked)',
          );
          return;
        }
        const result = await import('@strata/engine').then((m) =>
          m.removeBackground(
            imageData,
            {
              method,
              feather: 0.5,
              decontaminate: true,
            },
            signal,
          ),
        );
        if (signal.aborted) return;
        if (method !== 'quick' && result.method === 'quick') {
          throw new Error('AI provider returned a Quick result');
        }
        const currentSelection = stateRef.current.selection;
        const stillSelected = currentSelection.includes(processingNodeId);
        if (!stillSelected) {
          announcerRef.current?.announce(
            'Background removal completed but the image is no longer selected',
          );
          return;
        }
        // Warm the ImageCache so the first post-update render can composite the
        // mask immediately instead of drawing the image unmasked and waiting for
        // an async load to trigger a second frame.
        await warmMaskCache(cache, result.maskDataUrl);
        updateDoc((d) =>
          setBackgroundRemoval(d, imageNode.id, {
            maskDataUrl: result.maskDataUrl,
            method: result.method,
            confidence: result.confidence,
            appliedAt: Date.now(),
            feather: 0.5,
            decontaminate: true,
          }),
        );
        announcerRef.current?.announce('Background removed');
      } catch (e) {
        if (bgRemovalAbortRef.current?.signal.aborted) {
          throw new Error('cancelled');
        }
        announcerRef.current?.announce(`Background removal failed: ${(e as Error).message}`);
        throw e;
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
      try {
        const { getImageCache } = await import('@strata/engine');
        const { setBackgroundRemoval } = await import('@strata/scene');
        const cache = getImageCache();
        bgRemovalAbortRef.current?.abort();
        bgRemovalAbortRef.current = new AbortController();
        processingBgNodeRef.current = processingNodeId;
        const signal = bgRemovalAbortRef.current.signal;
        const img = await cache.load(src);
        if (!img) {
          announcerRef.current?.announce('Could not load image');
          return;
        }
        const maxDim = DEFAULT_PREVIEW_MAX_DIMENSION;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const extractW = Math.ceil(w * scale);
        const extractH = Math.ceil(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = extractW;
        canvas.height = extractH;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, extractW, extractH);
        const imageData = ctx.getImageData(0, 0, extractW, extractH);
        const result = await import('@strata/engine').then((m) =>
          m.removeBackground(
            imageData,
            {
              method,
              feather,
              decontaminate,
            },
            signal,
          ),
        );
        if (signal.aborted) return;
        if (method !== 'quick' && result.method === 'quick') {
          throw new Error('AI provider returned a Quick result');
        }

        const { finalizeMaskResult } = await import('@strata/engine');
        const finalized = await finalizeMaskResult(result, { promptIfMultiple: true });

        if (finalized.needsSubjectPicker && finalized.components) {
          patch({
            subjectPickerSession: {
              nodeId: imageNode.id,
              width: finalized.width,
              height: finalized.height,
              components: finalized.components,
              keepIds: finalized.components[0] ? [finalized.components[0].id] : [],
              pendingMaskDataUrl: finalized.maskDataUrl,
              method: finalized.method,
              confidence: finalized.confidence,
              feather,
              decontaminate,
            },
          });
          announcerRef.current?.announce('Multiple subjects detected — pick which regions to keep');
          return;
        }

        // Warm the ImageCache so the first post-update render composites the mask
        // synchronously instead of flashing the original background.
        await warmMaskCache(cache, finalized.maskDataUrl);

        updateDoc((d) =>
          setBackgroundRemoval(d, imageNode.id, {
            maskDataUrl: finalized.maskDataUrl,
            method: finalized.method,
            confidence: finalized.confidence,
            appliedAt: Date.now(),
            feather,
            decontaminate,
          }),
        );
        announcerRef.current?.announce('Background removed');
      } catch (e) {
        if (bgRemovalAbortRef.current?.signal.aborted) {
          throw new Error('cancelled');
        }
        announcerRef.current?.announce(`Background removal failed: ${(e as Error).message}`);
        throw e;
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
        const { setBackgroundRemoval } = await import('@strata/scene');
        const { mask, width, height } = await decodeMaskDataUrl(session.pendingMaskDataUrl);
        const filtered = filterMaskByComponents(mask, width, height, new Set(keepIds));
        const maskDataUrl = maskArrayToDataUrl(filtered, width, height);
        await warmMaskCache(getImageCache(), maskDataUrl);
        updateDoc((d) =>
          setBackgroundRemoval(d, session.nodeId, {
            maskDataUrl,
            method: session.method,
            confidence: session.confidence,
            appliedAt: Date.now(),
            feather: session.feather,
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
    const imageNode = state.selection
      .map((id) => state.document.nodes[id] as ShapeNode | undefined)
      .find((n) => n && isImageShape(n) && n.backgroundRemoval?.maskDataUrl) as
      | ShapeNode
      | undefined;
    if (!imageNode?.backgroundRemoval?.maskDataUrl) {
      announcerRef.current?.announce('Apply background removal first');
      return;
    }
    try {
      const { decodeMaskDataUrl, getImageCache, maskArrayToDataUrl, refineHairMatting } =
        await import('@strata/engine');
      const { setBackgroundRemoval } = await import('@strata/scene');
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
      const { mask } = await decodeMaskDataUrl(imageNode.backgroundRemoval.maskDataUrl);
      const refined = refineHairMatting(imageData, mask);
      const maskDataUrl = maskArrayToDataUrl(refined, w, h);
      await warmMaskCache(getImageCache(), maskDataUrl);
      updateDoc((d) =>
        setBackgroundRemoval(d, imageNode.id, {
          ...imageNode.backgroundRemoval!,
          maskDataUrl,
          appliedAt: Date.now(),
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
    const node = state.document.nodes[nodeId] as ShapeNode | undefined;
    if (!trimapEntry || !node?.backgroundRemoval) {
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
      const { setBackgroundRemoval } = await import('@strata/scene');
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
        setBackgroundRemoval(d, nodeId, {
          ...node.backgroundRemoval!,
          maskDataUrl,
          appliedAt: Date.now(),
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
