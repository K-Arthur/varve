/**
 * SelectionQuickBarHost — wires profile resolution + action dispatch to editor context.
 */
import type { ShapeNode } from '@strata/scene';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../context';
import { selectedImageShape } from '../../imageOperations';
import { dispatchQuickBarAction } from './quickBarActions';
import { type QuickBarActionId, resolveQuickBarProfile } from './resolveQuickBarProfile';
import { SelectionQuickBar } from './SelectionQuickBar';

export interface SelectionQuickBarHostProps {
  textEditTargetId: string | null;
  setTextEditTargetId: (id: string | null) => void;
  setNodeEditTargetId: (id: string | null) => void;
}

export function SelectionQuickBarHost({
  textEditTargetId,
  setTextEditTargetId,
  setNodeEditTargetId,
}: SelectionQuickBarHostProps) {
  const editor = useEditor();
  const { state } = editor;
  const [pending, setPending] = useState<QuickBarActionId[]>([]);

  const suppressForVariant = useMemo(() => {
    if (state.selection.length !== 1) return false;
    const singleNode = state.document.nodes[state.selection[0]!];
    if (singleNode?.kind !== 'frame' || !singleNode.componentId) return false;
    const component = state.document.components[singleNode.componentId];
    return Boolean(component?.variants && component.variants.length > 0);
  }, [state.document, state.selection]);

  const profile = useMemo(
    () =>
      resolveQuickBarProfile({
        document: state.document,
        selection: state.selection,
        tool: state.tool,
        textEditTargetId,
        bgRemovalPending: pending.includes('removeBg'),
        suppressForVariant,
      }),
    [state.document, state.selection, state.tool, textEditTargetId, pending, suppressForVariant],
  );

  const screenBounds = useMemo(() => {
    if (!profile) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const id of state.selection) {
      const b = editor.getWorldBounds(id);
      if (!b) continue;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    if (!Number.isFinite(minX)) return null;
    const { x, y } = editor.worldToCanvas(minX, minY);
    return {
      x,
      y,
      w: (maxX - minX) * state.zoom,
      h: (maxY - minY) * state.zoom,
    };
  }, [profile, state.selection, state.zoom, editor]);

  const onAction = useCallback(
    async (id: QuickBarActionId) => {
      const imageNode = selectedImageShape(state.document, state.selection);
      const pendingIds: QuickBarActionId[] =
        id === 'removeBg' || id === 'upscale' || id === 'vectorize' ? [id] : [];
      if (pendingIds.length) setPending(pendingIds);
      try {
        await dispatchQuickBarAction(id, {
          selection: state.selection,
          setTool: editor.setTool,
          setSelectedFlipH: editor.setSelectedFlipH,
          setSelectedFlipV: editor.setSelectedFlipV,
          removeBackgroundWithOptions: editor.removeBackgroundWithOptions,
          cancelBackgroundRemoval: editor.cancelBackgroundRemoval,
          upscaleSelectedImage: editor.upscaleSelectedImage,
          traceSelectedImage: editor.traceSelectedImage,
          setShowOriginalBg: editor.setShowOriginalBg,
          setRefineMaskOptions: editor.setRefineMaskOptions,
          updateNode: (nid, updater) => {
            editor.updateNode(nid, (n) => {
              if (n.kind !== 'shape') return n;
              return updater(n as ShapeNode);
            });
          },
          showOriginalBgNodeId: state.showOriginalBgNodeId ?? null,
          selectedImageNode: imageNode,
          setNodeEditTargetId,
          setTextEditTargetId,
          groupSelected: editor.groupSelected,
          booleanOp: editor.booleanOp,
          announce: editor.announce,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Action failed';
        if (msg !== 'cancelled' && msg !== 'AbortError') {
          editor.announce?.(msg);
        }
      } finally {
        if (pendingIds.length) setPending([]);
      }
    },
    [
      editor,
      state.document,
      state.selection,
      state.showOriginalBgNodeId,
      setTextEditTargetId,
      setNodeEditTargetId,
    ],
  );

  if (!profile || !screenBounds) return null;

  return (
    <SelectionQuickBar
      profile={profile}
      screenBounds={screenBounds}
      onAction={(id) => {
        void onAction(id);
      }}
      pendingActionIds={pending}
    />
  );
}
