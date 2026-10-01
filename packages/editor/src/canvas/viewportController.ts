import { type Camera, clampZoom } from '@varve/shared';
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { EditorContextValue, EditorState } from '../context';
import type { ViewportContextValue } from '../context/ViewportContext';
import type { TransformCache } from '../scene/transformCache';
import type { EngineNodeMemo } from './engineNodeMemo';
import {
  cancelCanvasFrame,
  type RedrawReason as RedrawCoordinatorReason,
  scheduleCanvasFrame,
} from './perfRuntime';
import type { SubtreeIrCache } from './subtreeIrCache';
import { createTransformPreviewController } from './toolContext';

type TransformPreviewController = ReturnType<typeof createTransformPreviewController>;

interface CanvasViewportControllerOptions {
  state: EditorState;
  viewport: ViewportContextValue;
  stateRef: MutableRefObject<EditorState>;
  editorRef: MutableRefObject<EditorContextValue>;
  transformCacheRef: MutableRefObject<TransformCache>;
  subtreeIrCacheRef: MutableRefObject<SubtreeIrCache>;
  engineNodeMemoRef: MutableRefObject<EngineNodeMemo>;
  docVersionRef: MutableRefObject<number>;
  requestContentDrawRef: MutableRefObject<
    ((source: string, reason: RedrawCoordinatorReason) => void) | null
  >;
  cameraPreviewFrameKey: MutableRefObject<string | null>;
  drawOverlayRef: MutableRefObject<(() => void) | null>;
}

/** Keep gesture-time viewport and transform previews in sync without adding
 * branching to the CanvasArea render hub. */
export function useCanvasViewportController({
  state,
  viewport,
  stateRef,
  editorRef,
  transformCacheRef,
  subtreeIrCacheRef,
  engineNodeMemoRef,
  docVersionRef,
  requestContentDrawRef,
  cameraPreviewFrameKey,
  drawOverlayRef,
}: CanvasViewportControllerOptions): {
  transformPreviewController: TransformPreviewController;
  commitCamera: (camera: Camera) => void;
  previewCamera: (camera: Camera) => void;
} {
  const lastEditorStateRef = useRef(state);
  if (lastEditorStateRef.current !== state) {
    lastEditorStateRef.current = state;
    stateRef.current = state;
  }
  if (
    stateRef.current.zoom !== viewport.zoom ||
    stateRef.current.pan.x !== viewport.pan.x ||
    stateRef.current.pan.y !== viewport.pan.y ||
    stateRef.current.cameraRotation !== viewport.cameraRotation
  ) {
    stateRef.current = {
      ...stateRef.current,
      zoom: viewport.zoom,
      pan: viewport.pan,
      cameraRotation: viewport.cameraRotation,
    };
  }
  const activeTransformPreview = viewport.transformPreviewStore.getSnapshot();
  if (activeTransformPreview?.baseDocument === state.document) {
    stateRef.current = { ...stateRef.current, document: activeTransformPreview.document };
  }

  const [transformPreviewController] = useState(() =>
    createTransformPreviewController({
      stateRef,
      editorRef,
      transformCacheRef,
      subtreeIrCacheRef,
      engineNodeMemoRef,
      docVersionRef,
      transformPreviewStore: viewport.transformPreviewStore,
      requestContentDrawRef,
    }),
  );

  const commitCamera = useCallback(
    (camera: Camera) => {
      stateRef.current = {
        ...stateRef.current,
        zoom: clampZoom(camera.zoom),
        pan: { x: camera.pan.x, y: camera.pan.y },
        cameraRotation: camera.rotation ?? stateRef.current.cameraRotation,
      };
      viewport.setCamera(camera);
    },
    [stateRef, viewport.setCamera],
  );

  const previewCamera = useCallback(
    (camera: Camera) => {
      const zoom = clampZoom(camera.zoom);
      const current = stateRef.current;
      const rotation = camera.rotation ?? current.cameraRotation;
      const redrawReason = zoom !== current.zoom ? 'viewport-zoom' : 'viewport-pan';
      stateRef.current = {
        ...current,
        zoom,
        pan: { x: camera.pan.x, y: camera.pan.y },
        cameraRotation: rotation,
      };
      viewport.previewCamera(camera);
      requestContentDrawRef.current?.('camera-preview', redrawReason);
      const frameKey = cameraPreviewFrameKey.current;
      if (frameKey) scheduleCanvasFrame(frameKey, 'ui', () => drawOverlayRef.current?.());
    },
    [
      cameraPreviewFrameKey,
      drawOverlayRef,
      requestContentDrawRef,
      stateRef,
      viewport.previewCamera,
    ],
  );

  useEffect(
    () => () => {
      const frameKey = cameraPreviewFrameKey.current;
      if (frameKey) cancelCanvasFrame(frameKey);
      transformPreviewController.dispose();
    },
    [cameraPreviewFrameKey, transformPreviewController],
  );

  useEffect(() => {
    const preview = viewport.transformPreviewStore.getSnapshot();
    if (preview && preview.baseDocument !== state.document) {
      viewport.transformPreviewStore.clear();
    }
  }, [state.document, viewport.transformPreviewStore]);

  return { transformPreviewController, commitCamera, previewCamera };
}
