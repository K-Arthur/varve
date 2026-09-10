/**
 * SelectionQuickBarHost — wires profile resolution + action dispatch to editor context.
 */
import type { ShapeNode } from '@varve/scene';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../context';
import { selectedImageShape } from '../../imageOperations';
import { setPathClosed, simplifyPathNode } from './pathQuickOps';
import { dispatchQuickBarAction } from './quickBarActions';
import { type QuickBarActionId, resolveQuickBarProfile } from './resolveQuickBarProfile';
import { SelectionQuickBar } from './SelectionQuickBar';

export interface SelectionQuickBarHostProps {
  textEditTargetId: string | null;
  setTextEditTargetId: (id: string | null) => void;
  setNodeEditTargetId: (id: string | null) => void;
  /** Canvas's own rendered height (CSS px), for clamping the bar on-screen. */
  containerHeight: number;
}

export function SelectionQuickBarHost({
  textEditTargetId,
  setTextEditTargetId,
  setNodeEditTargetId,
  containerHeight,
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
        showOriginalBgNodeId: state.showOriginalBgNodeId ?? null,
        bgRemovalPending: pending.includes('removeBg'),
        suppressForVariant,
      }),
    [
      state.document,
      state.selection,
      state.tool,
      state.showOriginalBgNodeId,
      textEditTargetId,
      pending,
      suppressForVariant,
    ],
  );

  const activeActionIds = useMemo(() => {
    const ids: QuickBarActionId[] = [];
    const imageNode = selectedImageShape(state.document, state.selection);
    if (imageNode && state.showOriginalBgNodeId === imageNode.id) {
      ids.push('showOriginal');
    }
    return ids;
  }, [state.document, state.selection, state.showOriginalBgNodeId]);

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
      // Background-removal review completes inside the Adjustments inspector
      // tab; opening it here makes the quick-bar action self-contained in
      // every workspace instead of ending with an invisible review panel.
      if (id === 'removeBg') editor.setInspectorTab('adjustments');
      try {
        await dispatchQuickBarAction(id, {
          selection: state.selection,
          setTool: editor.setTool as (tool: string) => void,
          setSelectedFlipH: editor.setSelectedFlipH,
          setSelectedFlipV: editor.setSelectedFlipV,
          removeBackgroundWithOptions: editor.removeBackgroundWithOptions,
          cancelBackgroundRemoval: editor.cancelBackgroundRemoval,
          openUpscaleDialog: editor.openUpscaleDialog,
          openVectorizeDialog: editor.openVectorizeDialog,
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
          simplifySelectedPath: () => {
            const id = state.selection[0];
            if (!id) return;
            editor.updateDoc((doc) => simplifyPathNode(doc, id));
            editor.announce('Path simplified');
          },
          toggleSelectedPathClosed: (closed) => {
            const id = state.selection[0];
            if (!id) return;
            editor.updateDoc((doc) => setPathClosed(doc, id, closed));
            editor.announce(closed ? 'Path closed' : 'Path opened');
          },
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
      containerHeight={containerHeight}
      onAction={(id) => {
        void onAction(id);
      }}
      pendingActionIds={pending}
      activeActionIds={activeActionIds}
    />
  );
}
