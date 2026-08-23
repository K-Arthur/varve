import type { Document } from '@varve/scene';
import { useEffect, useRef, useState } from 'react';
import { getToolManager } from '../canvas/toolDispatcher';
import type { EditorState } from '../context/types';
import { type CropState, commitImageCropExtended } from '../imageCrop';
import type { CropTool } from './CropTool';
import type { PerspectiveTool } from './PerspectiveTool';
import type { PaintTool } from './PaintTool';
import type { PencilTool } from './PencilTool';
import type { RefineMaskTool } from './RefineMaskTool';
import type { SmudgeTool } from './SmudgeTool';
import type { TrimapEditTool } from './TrimapEditTool';
import type { ToolContext } from './types';

interface ToolSyncEditor {
  updateDoc: (fn: (doc: Document) => Document) => void;
  announce: (msg: string) => void;
}

/**
 * Keeps the shared ToolManager singleton in sync with editor state: active
 * tool selection, live brush/refine-mask/trimap options, and the crop tool's
 * commit handler. Returns the manager ref so the caller can read the active
 * tool's cursor and crop instance directly.
 */
export function useToolManagerSync(
  editor: ToolSyncEditor,
  state: EditorState,
  buildToolCtx: (ev: PointerEvent) => ToolContext,
): React.MutableRefObject<ReturnType<typeof getToolManager> | null> {
  const tm = useRef<ReturnType<typeof getToolManager> | null>(null);
  if (!tm.current) {
    tm.current = getToolManager();
  }
  // buildToolCtx is recreated every render; hold the latest copy in a ref so
  // the sync effects only re-run on their real inputs.
  const buildToolCtxRef = useRef(buildToolCtx);
  buildToolCtxRef.current = buildToolCtx;

  // Bumped when the sync effect transitions the ToolManager's active tool.
  // Instance-backed overlays (crop) read the tool instance during render, but
  // the instance is only created/activated inside the effect below — which
  // runs AFTER the render that carries the new `state.tool`. Without a bump,
  // `renderCropOverlay` would forever see a null instance and the overlay
  // would never mount. This tick forces one extra render so overlays re-read
  // the now-populated instance.
  const [, setToolSyncTick] = useState(0);

  // Sync active tool to ToolManager when state.tool changes
  useEffect(() => {
    if (tm.current) {
      const prevActive = tm.current.activeToolId;
      const ctx = buildToolCtxRef.current({} as PointerEvent);
      tm.current.setTool(state.tool, ctx);
      if (tm.current.activeToolId !== prevActive) {
        setToolSyncTick((n) => n + 1);
      }
    }
  }, [state.tool]);

  // Push live refine-mask brush options into the active tool instance.
  useEffect(() => {
    if (state.tool !== 'refineMask' || !tm.current) return;
    const tool = tm.current.getTool<RefineMaskTool>('refineMask');
    tool?.setOptions(state.refineMaskOptions);
  }, [state.refineMaskOptions, state.tool]);

  useEffect(() => {
    if (state.tool !== 'trimapEdit' || !tm.current) return;
    const tool = tm.current.getTool<TrimapEditTool>('trimapEdit');
    tool?.setOptions(state.trimapEditOptions);
  }, [state.trimapEditOptions, state.tool]);

  // Sync brush settings to the paint/eraser tool.
  useEffect(() => {
    if (!tm.current) return;
    if (state.tool !== 'paint' && state.tool !== 'eraser') return;
    const paintTool = tm.current.getTool<PaintTool>('paint');
    const eraserTool = tm.current.getTool<PaintTool>('eraser');
    const active = state.tool === 'eraser' ? eraserTool : paintTool;
    active?.updatePresetFromSettings(state.brushSettings);
  }, [state.brushSettings, state.tool]);

  // Sync brush settings to the smudge tool.
  useEffect(() => {
    if (!tm.current) return;
    if (state.tool !== 'smudge') return;
    const smudgeTool = tm.current.getTool<SmudgeTool>('smudge');
    smudgeTool?.updatePresetFromSettings(state.brushSettings);
  }, [state.brushSettings, state.tool]);

  // Sync stroke smoothing to the pencil tool's stabilizer. Reuses the same
  // brushSettings.smoothing field the raster brush already exposes, so the
  // Inspector's existing Smoothing control drives vector pencil strokes too.
  useEffect(() => {
    if (!tm.current) return;
    if (state.tool !== 'pencil') return;
    const pencilTool = tm.current.getTool<PencilTool>('pencil');
    pencilTool?.setStabilization(state.brushSettings.smoothing);
  }, [state.brushSettings.smoothing, state.tool]);

  useEffect(() => {
    if (!tm.current) return;
    const crop = tm.current.getTool<CropTool>('crop');
    if (!crop) return;
    crop.setCommitHandler((cropState: CropState) => {
      const id = crop.getNodeId();
      if (!id) return;
      editor.updateDoc((doc) => commitImageCropExtended(doc, id, cropState));
      editor.announce('Crop applied');
    });
    return () => crop.setCommitHandler(null);
  }, [editor, state.tool]);

  // ── Perspective tool commit ──────────────────────────────────────────
  useEffect(() => {
    if (!tm.current) return;
    const perspective = tm.current.getTool<PerspectiveTool>('perspective');
    if (!perspective) return;
    perspective.setCommitHandler((ps) => {
      editor.updateDoc((doc) => {
        const node = doc.nodes[ps.nodeId];
        if (!node || node.kind !== 'shape') return doc;
        const fills = node.fills ?? [];
        const imgFill = fills.find((f) => f.type === 'image' && f.image);
        if (!imgFill) return doc;
        if (!imgFill.image) return doc;
        const newImage = { ...imgFill.image, perspective: { quad: ps.quad } };
        const newFills = fills.map((f) =>
          f === imgFill ? { ...f, image: newImage } : f,
        );
        return {
          ...doc,
          nodes: {
            ...doc.nodes,
            [ps.nodeId]: { ...node, fills: newFills },
          },
        };
      });
      editor.announce('Perspective applied');
    });
    return () => perspective.setCommitHandler(null);
  }, [editor, state.tool]);

  return tm;
}
