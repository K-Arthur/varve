import type { BackgroundRemovalMethod, Document, NodeId } from '@varve/scene';
import { useCallback, useEffect, useRef } from 'react';
import { commitRasterMask, hasNativeRasterMask } from '../backgroundRemoval/commitRasterMask';
import { warmMaskRenderCache } from '../backgroundRemoval/maskRenderCache';
import {
  computePlacementRevision,
  computeSourceFingerprint,
  matchesIsolationSource,
  resolveIsolationSource,
  SubjectIsolationService,
} from '../backgroundRemoval/SubjectIsolationService';
import type { CanvasAnnouncer } from '../canvas/CanvasAnnouncer';
import { setCollapsed } from '../components/Inspector/sectionState';
import { requestInspectorTab } from './inspectorTabBridge';
import type { EditorState, MaskPreviewMode, TrimapPenMode } from './types';

export interface BackgroundRemovalAPI {
  removeBackground: (method: BackgroundRemovalMethod) => Promise<void>;
  cancelBackgroundRemoval: () => void;
  applyBackgroundRemovalPreview: () => void;
  cancelBackgroundRemovalPreview: () => void;
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
  announcerRef: React.MutableRefObject<CanvasAnnouncer | null>,
): Promise<{ imageData: ImageData; extractW: number; extractH: number } | null> {
  const { getImageCache } = await import('@varve/engine');
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
  const extractW =
    typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement
      ? img.naturalWidth || img.width
      : img.width;
  const extractH =
    typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement
      ? img.naturalHeight || img.height
      : img.height;
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
  enabled = true,
): BackgroundRemovalAPI {
  const serviceRef = useRef<SubjectIsolationService | null>(null);

  if (enabled && !serviceRef.current) {
    serviceRef.current = new SubjectIsolationService();
  }

  useEffect(() => {
    return () => {
      serviceRef.current?.dispose();
    };
  }, []);

  const cancelBackgroundRemoval = useCallback(() => {
    bgRemovalAbortRef.current?.abort();
    bgRemovalAbortRef.current = null;
    processingBgNodeRef.current = null;
    serviceRef.current?.cancel();
    patch({ backgroundRemovalOperation: null });
  }, [bgRemovalAbortRef, processingBgNodeRef, patch]);

  const removeBackgroundWithOptions = useCallback(
    async (method: BackgroundRemovalMethod, feather: number, decontaminate: boolean) => {
      if (!enabled) {
        announcerRef.current?.announce(
          'Background removal is available in the main editor window.',
        );
        return;
      }
      const captured = stateRef.current;
      const source = captured.selection
        .map((id) => resolveIsolationSource(captured.document, id))
        .find(Boolean);
      if (!source) {
        announcerRef.current?.announce('Select a shape with one image fill first');
        return;
      }
      const service = serviceRef.current;
      if (!service) return;
      const processingNodeId = source.node.id;
      const src = source.image.src;
      const sourceIdentity = { image: source.image, asset: source.asset, mask: source.mask };
      bgRemovalAbortRef.current?.abort();
      const controller = new AbortController();
      bgRemovalAbortRef.current = controller;
      processingBgNodeRef.current = processingNodeId;
      const startedAt = Date.now();
      patch({
        backgroundRemovalPreviewSession: null,
        subjectPickerSession: null,
        backgroundRemovalOperation: { nodeId: processingNodeId, stage: 'decoding', startedAt },
      });
      announcerRef.current?.announce(`Removing background using ${method}...`);
      try {
        const decoded = await decodeSource(src, announcerRef);
        if (!decoded || controller.signal.aborted) return;
        const sourceFingerprint = await computeSourceFingerprint(src, decoded.imageData);
        if (controller.signal.aborted) return;
        const request = {
          requestId: `si-${sourceFingerprint}-${processingNodeId}`,
          documentId: captured.document.id,
          nodeId: processingNodeId,
          sourceFingerprint,
          sourceIdentity,
          sourceLocator: src,
          placementRevision: computePlacementRevision(source.image),
          sourceWidth: decoded.extractW,
          sourceHeight: decoded.extractH,
          imageData: decoded.imageData,
          options: { method, feather, decontaminate },
        };
        const isCurrent = () =>
          !controller.signal.aborted &&
          bgRemovalAbortRef.current === controller &&
          !service.isStale(request, stateRef.current).stale;
        if (!isCurrent()) return;
        patch({
          backgroundRemovalOperation: { nodeId: processingNodeId, stage: 'processing', startedAt },
        });
        const isoResult = await service.isolate(request, controller.signal);

        if (!isCurrent()) {
          announcerRef.current?.announce(
            'Background removal completed but the image state changed',
          );
          return;
        }

        const engineResult = {
          maskDataUrl: isoResult.maskDataUrl,
          confidence: isoResult.confidence,
          method: isoResult.provenance.method as 'quick' | 'ai-balanced' | 'ai-quality',
          processingTimeMs: parseInt(isoResult.provenance.runtime, 10) || 0,
          width: isoResult.maskWidth,
          height: isoResult.maskHeight,
        };

        patch({
          backgroundRemovalOperation: {
            nodeId: processingNodeId,
            stage: 'preparing-preview',
            startedAt,
          },
        });
        const { finalizeMaskResult } = await import('@varve/engine');
        // Quick is the one-click path. Its heuristic can legitimately produce
        // several disconnected foreground regions (for example, a person and
        // an object they are holding), so preserve its complete mask and move
        // directly to review. AI modes retain explicit subject selection.
        const finalized =
          method === 'quick'
            ? { ...engineResult, components: undefined, needsSubjectPicker: false as const }
            : await finalizeMaskResult(engineResult, { promptIfMultiple: true });

        if (!isCurrent()) return;
        if (finalized.needsSubjectPicker && finalized.components) {
          patch({
            subjectPickerSession: {
              nodeId: processingNodeId,
              width: finalized.width,
              height: finalized.height,
              sourceWidth: decoded.extractW,
              sourceHeight: decoded.extractH,
              components: finalized.components,
              keepIds: finalized.components[0] ? [finalized.components[0].id] : [],
              pendingMaskDataUrl: finalized.maskDataUrl,
              sourceImageSrc: src,
              method: finalized.method as BackgroundRemovalMethod,
              confidence: finalized.confidence,
              feather,
              decontaminate,
              requestedMethod: method,
              documentId: request.documentId,
              sourceLocator: request.sourceLocator,
              placementRevision: request.placementRevision,
              sourceIdentity,
            },
          });
          announcerRef.current?.announce('Multiple subjects detected — pick which regions to keep');
          return;
        }

        const { getImageCache } = await import('@varve/engine');
        await warmMaskRenderCache(
          getImageCache(),
          finalized.maskDataUrl,
          finalized.width,
          finalized.height,
        );
        if (!isCurrent()) return;
        // The review region lives inside the Inspector's Background Removal
        // disclosure (registry-collapsed by default) on the Adjustments tab.
        // Opening both here makes every entry point (quick bar in any
        // workspace, inspector button, batch dialog) end on a visible review
        // instead of a silently mounted but unreachable one.
        requestInspectorTab('adjustments');
        patch({
          sectionVisibility: setCollapsed(
            stateRef.current.sectionVisibility,
            'background-removal',
            false,
          ),
        });
        patch({
          backgroundRemovalPreviewSession: {
            nodeId: processingNodeId,
            documentId: request.documentId,
            sourceLocator: request.sourceLocator,
            placementRevision: request.placementRevision,
            sourceIdentity,
            maskDataUrl: finalized.maskDataUrl,
            width: finalized.width,
            height: finalized.height,
            sourceWidth: decoded.extractW,
            sourceHeight: decoded.extractH,
            requestedMethod: method,
            actualMethod: finalized.method as BackgroundRemovalMethod,
            confidence: finalized.confidence,
            feather,
            decontaminate,
            executionProvider: isoResult.provenance.executionProvider,
            modelId: isoResult.provenance.modelId,
          },
        });
        announcerRef.current?.announce('Background removal preview ready');
      } catch (e) {
        if (controller.signal.aborted || (e as Error).message === 'cancelled') return;
        announcerRef.current?.announce(`Background removal failed: ${(e as Error).message}`);
        throw e;
      } finally {
        if (bgRemovalAbortRef.current === controller) {
          bgRemovalAbortRef.current = null;
          processingBgNodeRef.current = null;
          patch({ backgroundRemovalOperation: null });
        }
      }
    },
    [
      enabled,
      state,
      announcerRef,
      bgRemovalAbortRef,
      processingBgNodeRef,
      patch,
      stateRef,
      updateDoc,
    ],
  );

  const removeBackground = useCallback(
    (method: BackgroundRemovalMethod) => removeBackgroundWithOptions(method, 0.5, false),
    [removeBackgroundWithOptions],
  );

  const setShowOriginalBg = useCallback(
    (nodeId: NodeId | null) => {
      patch({ showOriginalBgNodeId: nodeId });
    },
    [patch],
  );

  const applyBackgroundRemovalPreview = useCallback(() => {
    if (!enabled) {
      announcerRef.current?.announce('Background removal is available in the main editor window.');
      return;
    }
    const preview = stateRef.current.backgroundRemovalPreviewSession;
    if (!preview) return;
    const currentState = stateRef.current;
    const currentSource = resolveIsolationSource(currentState.document, preview.nodeId);
    const currentNode = currentSource?.node;
    if (
      currentState.document.id !== preview.documentId ||
      !currentState.selection.includes(preview.nodeId) ||
      !currentNode ||
      !currentSource ||
      currentSource.image.src !== preview.sourceLocator ||
      (preview.sourceIdentity &&
        (preview.sourceIdentity.image !== currentSource.image ||
          preview.sourceIdentity.asset !== currentSource.asset ||
          preview.sourceIdentity.mask !== currentSource.mask)) ||
      computePlacementRevision(currentSource.image) !== preview.placementRevision
    ) {
      patch({ backgroundRemovalPreviewSession: null });
      announcerRef.current?.announce('Preview discarded because the selected image changed');
      return;
    }
    if (preview.width !== preview.sourceWidth || preview.height !== preview.sourceHeight) {
      announcerRef.current?.announce(
        'Background removal result could not be applied because its dimensions are invalid',
      );
      return;
    }
    const fields = {
      dataUrl: preview.maskDataUrl,
      width: preview.width,
      height: preview.height,
      sourceLocator: preview.sourceLocator,
      method: preview.actualMethod,
      modelId: preview.modelId,
      generatedAt: Date.now(),
      confidence: preview.confidence,
      decontaminate: preview.decontaminate,
      runtime:
        preview.executionProvider === 'native'
          ? 'native-cpu'
          : (preview.executionProvider ?? 'typescript'),
    } as const;
    const committed = commitRasterMask(currentState.document, preview.nodeId, fields);
    if (committed === currentState.document) {
      announcerRef.current?.announce(
        'Background removal result could not be applied; the preview remains available',
      );
      return;
    }
    updateDoc((document) => {
      // React may execute this updater after another queued edit. Preserve
      // unrelated changes, and refuse a replaced target or document.
      if (
        document.id !== currentState.document.id ||
        document.nodes[preview.nodeId] !== currentNode ||
        (preview.sourceIdentity &&
          !matchesIsolationSource(document, preview.nodeId, preview.sourceIdentity))
      ) {
        return document;
      }
      return document === currentState.document
        ? committed
        : commitRasterMask(document, preview.nodeId, fields);
    });
    patch({ backgroundRemovalPreviewSession: null });
    announcerRef.current?.announce(
      preview.requestedMethod === preview.actualMethod
        ? 'Background removal applied'
        : `Background removal applied using ${preview.actualMethod} fallback`,
    );
  }, [enabled, stateRef, patch, announcerRef, updateDoc]);

  const cancelBackgroundRemovalPreview = useCallback(() => {
    patch({ backgroundRemovalPreviewSession: null });
    announcerRef.current?.announce('Background removal preview cancelled');
  }, [patch, announcerRef]);

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
      if (!enabled) {
        announcerRef.current?.announce(
          'Background removal is available in the main editor window.',
        );
        return;
      }
      const session = stateRef.current.subjectPickerSession;
      if (!session) return;
      void (async () => {
        const { decodeMaskDataUrl, filterMaskByComponents, getImageCache, maskArrayToDataUrl } =
          await import('@varve/engine');
        const { mask, width, height } = await decodeMaskDataUrl(session.pendingMaskDataUrl);
        const filtered = filterMaskByComponents(mask, width, height, new Set(keepIds));
        const maskDataUrl = maskArrayToDataUrl(filtered, width, height);
        await warmMaskRenderCache(getImageCache(), maskDataUrl, width, height);
        if (
          stateRef.current.subjectPickerSession !== session ||
          stateRef.current.document.id !== session.documentId ||
          !stateRef.current.selection.includes(session.nodeId) ||
          (session.sourceIdentity &&
            !matchesIsolationSource(
              stateRef.current.document,
              session.nodeId,
              session.sourceIdentity,
            ))
        )
          return;
        requestInspectorTab('adjustments');
        patch({
          sectionVisibility: setCollapsed(
            stateRef.current.sectionVisibility,
            'background-removal',
            false,
          ),
        });
        patch({
          subjectPickerSession: null,
          backgroundRemovalPreviewSession: {
            nodeId: session.nodeId,
            documentId: session.documentId,
            sourceLocator: session.sourceLocator,
            placementRevision: session.placementRevision,
            sourceIdentity: session.sourceIdentity,
            maskDataUrl,
            width,
            height,
            sourceWidth: session.sourceWidth,
            sourceHeight: session.sourceHeight,
            requestedMethod: session.requestedMethod,
            actualMethod: session.method,
            confidence: session.confidence,
            feather: session.feather,
            decontaminate: session.decontaminate,
          },
        });
        announcerRef.current?.announce(
          `Kept ${keepIds.length} subject(s); background removal preview ready`,
        );
      })().catch((error) => {
        if (stateRef.current.subjectPickerSession === session) {
          announcerRef.current?.announce(
            `Could not prepare the selected regions: ${String(error)}`,
          );
        }
      });
    },
    [enabled, stateRef, patch, announcerRef],
  );

  const cancelSubjectPicker = useCallback(() => {
    patch({ subjectPickerSession: null });
    announcerRef.current?.announce('Subject selection cancelled');
  }, [patch, announcerRef]);

  const refineHairEdges = useCallback(async () => {
    if (!enabled) {
      announcerRef.current?.announce('Background removal is available in the main editor window.');
      return;
    }
    const captured = stateRef.current;
    const doc = captured.document;
    const source = captured.selection
      .map((id) => resolveIsolationSource(doc, id))
      .find((item) => item && hasNativeRasterMask(doc, item.node.id));
    if (!source) {
      announcerRef.current?.announce('Apply background removal first');
      return;
    }
    const imageNode = source.node;
    try {
      const { decodeMaskDataUrl, getImageCache, maskArrayToDataUrl, refineHairMatting } =
        await import('@varve/engine');
      const decoded = await decodeSource(source.image.src, announcerRef);
      if (!decoded) return;
      const { imageData, extractW: w, extractH: h } = decoded;
      const assetId = imageNode.mask!.rasterMask!.assetId;
      const asset = doc.rasterMaskAssets?.[assetId];
      const maskUrl = asset?.dataUrl;
      if (!maskUrl) {
        announcerRef.current?.announce('Could not resolve mask asset');
        return;
      }
      const { mask, width, height } = await decodeMaskDataUrl(maskUrl);
      if (width !== w || height !== h || mask.length !== w * h) {
        throw new Error('Mask dimensions do not match the source image');
      }
      const refined = refineHairMatting(imageData, mask);
      const maskDataUrl = maskArrayToDataUrl(refined, w, h);
      await warmMaskRenderCache(getImageCache(), maskDataUrl, w, h);
      if (
        stateRef.current.document.id !== doc.id ||
        !matchesIsolationSource(stateRef.current.document, imageNode.id, source)
      )
        return;
      updateDoc((d) =>
        d.id === doc.id && matchesIsolationSource(d, imageNode.id, source)
          ? commitRasterMask(d, imageNode.id, {
              dataUrl: maskDataUrl,
              width: w,
              height: h,
            })
          : d,
      );
      announcerRef.current?.announce('Hair/fur edges refined');
    } catch (e) {
      announcerRef.current?.announce(`Edge refinement failed: ${(e as Error).message}`);
    }
  }, [enabled, stateRef, announcerRef, updateDoc]);

  const startTrimapEdit = useCallback(() => {
    if (!enabled) {
      announcerRef.current?.announce('Background removal is available in the main editor window.');
      return;
    }
    const nodeId = state.selection[0];
    if (!nodeId) {
      announcerRef.current?.announce('Select an image first');
      return;
    }
    patch({ tool: 'trimapEdit' });
    announcerRef.current?.announce(
      'Trimap edit: 1=foreground, 2=unknown, 3=background. Escape to finish.',
    );
  }, [enabled, state, announcerRef, patch]);

  const applyTrimapMatting = useCallback(async () => {
    if (!enabled) {
      announcerRef.current?.announce('Background removal is available in the main editor window.');
      return;
    }
    const captured = stateRef.current;
    const nodeId = captured.selection[0];
    if (!nodeId) return;
    const trimapEntry = trimapStoreRef.current.get(nodeId);
    const doc = captured.document;
    const source = resolveIsolationSource(doc, nodeId);
    if (!trimapEntry || !source || !hasNativeRasterMask(doc, nodeId)) {
      announcerRef.current?.announce('Paint a trimap first');
      return;
    }
    try {
      const { getImageCache, maskArrayToDataUrl, solveTrimapMatting } = await import(
        '@varve/engine'
      );
      const decoded = await decodeSource(source.image.src, announcerRef);
      if (!decoded) return;
      const { imageData, extractW: w, extractH: h } = decoded;
      if (
        trimapEntry.width !== w ||
        trimapEntry.height !== h ||
        trimapEntry.data.length !== w * h
      ) {
        throw new Error('Trimap dimensions do not match the source image');
      }
      const matte = solveTrimapMatting(imageData, trimapEntry.data);
      const maskDataUrl = maskArrayToDataUrl(matte, w, h);
      await warmMaskRenderCache(getImageCache(), maskDataUrl, w, h);
      if (
        stateRef.current.document.id !== doc.id ||
        !matchesIsolationSource(stateRef.current.document, nodeId, source) ||
        trimapStoreRef.current.get(nodeId) !== trimapEntry
      )
        return;
      updateDoc((d) =>
        d.id === doc.id && matchesIsolationSource(d, nodeId, source)
          ? commitRasterMask(d, nodeId, {
              dataUrl: maskDataUrl,
              width: w,
              height: h,
            })
          : d,
      );
      trimapStoreRef.current.delete(nodeId);
      patch({ tool: 'select' });
      announcerRef.current?.announce('Trimap matting applied');
    } catch (e) {
      announcerRef.current?.announce(`Trimap matting failed: ${(e as Error).message}`);
    }
  }, [enabled, stateRef, trimapStoreRef, announcerRef, updateDoc, patch]);

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
    applyBackgroundRemovalPreview,
    cancelBackgroundRemovalPreview,
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
