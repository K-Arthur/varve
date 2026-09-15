import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { NodeId } from '@varve/scene';
import { computeFloatingOrigin, screenToWorld } from '@varve/shared';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { EditorContextValue } from '../../context';
import type { DragData, DragEffectStackData } from '../../dnd-types';
import { isNodeEffectivelyLocked } from '../../scene/world';
import type { LayersDnDHandle } from '../LayersPanel/LayersTree';
import { EffectStackDragContext } from './effectStackDragContext';
import {
  computeCanvasDropPositions,
  resolveCanvasContentRoot,
  resolveCanvasMoveIds,
} from './layerCanvasDrop';

export interface DnDShellProps {
  children: ReactNode;
  editor: EditorContextValue;
  layersDndRef: React.RefObject<LayersDnDHandle | null>;
  /** Scoped canvas surface for this editor instance. */
  canvasRef: React.RefObject<HTMLDivElement | null>;
}

function dragUsesAppendMode(event: Event | null): boolean {
  return !!event && 'altKey' in event && event.altKey === true;
}

function effectStackEntryCount(
  node: import('@varve/scene').SceneNode | undefined,
  kind: DragEffectStackData['stackKind'],
): number {
  if (!node) return 0;
  return kind === 'layer-effects'
    ? 'effects' in node && Array.isArray(node.effects)
      ? node.effects.length
      : 0
    : (node.smartFilters?.length ?? 0);
}

function findEffectStackTarget(sourceId: NodeId, clientX: number, clientY: number): NodeId | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const row = element.closest<HTMLElement>('[role="treeitem"][data-node-id]');
    const targetId = row?.dataset.nodeId as NodeId | undefined;
    if (targetId && targetId !== sourceId) return targetId;
  }
  return null;
}

function isPointerOverElement(element: HTMLElement, clientX: number, clientY: number): boolean {
  const rect = element.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return false;
  }
  const hit = document.elementFromPoint(clientX, clientY);
  return !hit || element.contains(hit);
}

export function DnDShell({ children, editor, layersDndRef, canvasRef }: DnDShellProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const lastPointerPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const layerMoveIdsRef = useRef<NodeId[]>([]);
  const [activeDragNode, setActiveDragNode] = useState<{
    id: NodeId;
    name: string;
    /** Extra layers travelling with this one, for the "+N" badge. */
    extraCount: number;
  } | null>(null);
  const [activeEffectStack, setActiveEffectStack] = useState<{
    sourceId: NodeId;
    targetId: NodeId | null;
    stackKind: DragEffectStackData['stackKind'];
    transferMode: DragEffectStackData['transferMode'];
    entryCount: number;
  } | null>(null);
  const activeEffectStackRef = useRef(activeEffectStack);
  const effectStackTargetRef = useRef<NodeId | null>(null);
  const effectStackTransferModeRef = useRef<DragEffectStackData['transferMode']>('replace');
  activeEffectStackRef.current = activeEffectStack;

  const updateEffectStackTransferMode = useCallback(
    (transferMode: DragEffectStackData['transferMode']) => {
      effectStackTransferModeRef.current = transferMode;
      setActiveEffectStack((current) => {
        if (!current || current.transferMode === transferMode) return current;
        return { ...current, transferMode };
      });
    },
    [],
  );

  const updateEffectStackTarget = useCallback(
    (sourceId: NodeId, clientX: number, clientY: number) => {
      const targetId = findEffectStackTarget(sourceId, clientX, clientY);
      effectStackTargetRef.current = targetId;
      setActiveEffectStack((current) => {
        if (!current || current.sourceId !== sourceId || current.targetId === targetId) {
          return current;
        }
        return { ...current, targetId };
      });
    },
    [],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as DragData | undefined;
      if (data?.type === 'layer') {
        const moveIds = resolveCanvasMoveIds(
          editor.state.document,
          editor.state.selection,
          data.nodeId,
        );
        layerMoveIdsRef.current = moveIds;
        layersDndRef.current?.handleDragStart(event);
        const node = editor.state.document.nodes[data.nodeId];
        if (node) {
          // Dragging one row of a multi-selection moves the whole selection,
          // so a preview showing a single name misrepresents the operation.
          setActiveDragNode({
            id: data.nodeId,
            name: node.name,
            extraCount: Math.max(0, moveIds.length - 1),
          });
        }
        return;
      }
      if (data?.type === 'effect-stack') {
        // DnD-kit treats `data` as drag metadata rather than mutable state,
        // so keep modifier state in our own ref. This also lets Alt/Option be
        // pressed or released after pickup without the hint and final action
        // diverging.
        const transferMode = dragUsesAppendMode(event.activatorEvent) ? 'append' : 'replace';
        effectStackTransferModeRef.current = transferMode;
        const source = editor.state.document.nodes[data.sourceId];
        effectStackTargetRef.current = null;
        setActiveEffectStack({
          sourceId: data.sourceId,
          targetId: null,
          stackKind: data.stackKind,
          transferMode,
          entryCount: effectStackEntryCount(source, data.stackKind),
        });
      }
    },
    [editor, layersDndRef],
  );

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const ev = event.activatorEvent;
      if (ev instanceof MouseEvent || ev instanceof PointerEvent) {
        lastPointerPos.current = {
          x: ev.clientX + event.delta.x,
          y: ev.clientY + event.delta.y,
        };
      }
      const data = event.active.data.current as DragData | undefined;
      if (data?.type === 'layer') {
        layersDndRef.current?.handleDragMove(event);
      } else if (data?.type === 'effect-stack') {
        updateEffectStackTarget(data.sourceId, lastPointerPos.current.x, lastPointerPos.current.y);
      }
    },
    [layersDndRef, updateEffectStackTarget],
  );

  // dnd-kit folds scroll compensation into `delta`, so the reconstruction
  // above drifts once a scrollable ancestor moves. The canvas-drop hit test
  // needs the true cursor, so track it directly for the life of the drag.
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      lastPointerPos.current = { x: e.clientX, y: e.clientY };
      const activeStack = activeEffectStackRef.current;
      if (activeStack) {
        updateEffectStackTransferMode(e.altKey ? 'append' : 'replace');
        updateEffectStackTarget(activeStack.sourceId, e.clientX, e.clientY);
      }
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [updateEffectStackTarget, updateEffectStackTransferMode]);

  useEffect(() => {
    const updateModifierMode = (event: KeyboardEvent) => {
      if (!activeEffectStackRef.current) return;
      updateEffectStackTransferMode(event.altKey ? 'append' : 'replace');
    };
    window.addEventListener('keydown', updateModifierMode);
    window.addEventListener('keyup', updateModifierMode);
    return () => {
      window.removeEventListener('keydown', updateModifierMode);
      window.removeEventListener('keyup', updateModifierMode);
    };
  }, [updateEffectStackTransferMode]);

  const handleDragOver = useCallback(
    (event: import('@dnd-kit/core').DragOverEvent) => {
      const data = event.active.data.current as DragData | undefined;
      if (data?.type === 'layer') layersDndRef.current?.handleDragOver(event);
    },
    [layersDndRef],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active } = event;
      const data = active.data.current as DragData | undefined;

      if (data?.type === 'effect-stack') {
        const transferMode = effectStackTransferModeRef.current;
        setActiveEffectStack(null);
        setActiveDragNode(null);
        const targetNodeId = effectStackTargetRef.current;
        effectStackTargetRef.current = null;
        effectStackTransferModeRef.current = 'replace';
        if (!targetNodeId) {
          editor.announce('Drop the stack on a destination layer');
          return;
        }
        editor.copyEffectStackToNodes(data.sourceId, [targetNodeId], data.stackKind, transferMode);
        return;
      }

      if (data?.type === 'layer') {
        const moveIds = [...layerMoveIdsRef.current];
        layerMoveIdsRef.current = [];
        const canvasSection = canvasRef.current;
        const ptr = lastPointerPos.current;
        const pointerInsideCanvas =
          canvasSection !== null && isPointerOverElement(canvasSection, ptr.x, ptr.y);

        if (!pointerInsideCanvas) {
          layersDndRef.current?.handleDragEnd(event);
          setActiveDragNode(null);
          return;
        }

        const canvasEl = canvasSection?.querySelector<HTMLCanvasElement>(
          'canvas.editor-canvas__content-layer',
        );
        if (!canvasEl) {
          layersDndRef.current?.handleDragCancel();
          setActiveDragNode(null);
          return;
        }
        const rect = canvasEl.getBoundingClientRect();
        const cam = {
          pan: editor.state.pan,
          zoom: editor.state.zoom,
          rotation: editor.state.cameraRotation ?? 0,
        };
        const viewport = { width: rect.width, height: rect.height };
        const origin = computeFloatingOrigin(cam, viewport);
        const [wx, wy] = screenToWorld(cam, ptr.x - rect.left, ptr.y - rect.top, viewport, origin);

        const currentDoc = editor.state.document;
        const destinationParentId = resolveCanvasContentRoot(
          currentDoc,
          editor.state.workspaceMode,
        );
        const positions = moveIds.every((id) => !isNodeEffectivelyLocked(currentDoc, id))
          ? computeCanvasDropPositions(currentDoc, moveIds, [wx, wy], destinationParentId)
          : null;

        if (!positions) {
          editor.announce('This layer selection cannot be moved to the canvas');
          layersDndRef.current?.handleDragCancel();
          setActiveDragNode(null);
          return;
        }

        let committed = false;
        try {
          editor.beginTransaction();
          for (const nodeId of moveIds) {
            editor.reparentNode(nodeId, null, Number.MAX_SAFE_INTEGER);
          }
          editor.setNodePositions(positions);
          editor.setSelection(moveIds[0]!);
          for (let i = 1; i < moveIds.length; i++) {
            editor.toggleSelection(moveIds[i]!, true);
          }
          editor.commitTransaction();
          committed = true;
        } catch (error) {
          editor.abortTransaction();
          editor.announce(
            error instanceof Error ? error.message : 'The layer could not be moved to the canvas',
          );
        } finally {
          // The canvas owns the document commit, but the Layers adapter still
          // owns pointer tracking/preview cleanup for this gesture.
          layersDndRef.current?.handleDragCancel();
          setActiveDragNode(null);
        }
        if (committed) {
          editor.announce(
            moveIds.length > 1
              ? `Moved ${moveIds.length} layers to canvas`
              : 'Moved layer to canvas',
          );
        }
        return;
      }

      layersDndRef.current?.handleDragEnd(event);
      setActiveDragNode(null);
    },
    [canvasRef, editor, layersDndRef],
  );

  const handleDragCancel = useCallback(() => {
    layerMoveIdsRef.current = [];
    layersDndRef.current?.handleDragCancel();
    setActiveDragNode(null);
    setActiveEffectStack(null);
    effectStackTargetRef.current = null;
    effectStackTransferModeRef.current = 'replace';
  }, [layersDndRef]);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <EffectStackDragContext.Provider value={activeEffectStack}>
        {children}
        <DragOverlay dropAnimation={null}>
          {activeDragNode ? (
            <div
              className="drag-overlay"
              style={{
                padding: '4px 12px',
                background: 'var(--color-surface-raised)',
                borderRadius: 'var(--radius-control-compact)',
                boxShadow: 'var(--elevation-shadow-raised)',
                fontSize: 'var(--font-size-sm)',
                pointerEvents: 'none',
                width: 'max-content',
                maxWidth: '280px',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
              }}
            >
              {activeDragNode.name}
              {activeDragNode.extraCount > 0 ? (
                <span className="drag-overlay__count"> +{activeDragNode.extraCount}</span>
              ) : null}
            </div>
          ) : activeEffectStack ? (
            <div
              className="drag-overlay"
              style={{
                padding: '4px 12px',
                background: 'var(--color-surface-raised)',
                borderRadius: 'var(--radius-control-compact)',
                boxShadow: 'var(--elevation-shadow-raised)',
                fontSize: 'var(--font-size-sm)',
                pointerEvents: 'none',
                width: 'max-content',
                maxWidth: '280px',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
              }}
            >
              {activeEffectStack.transferMode === 'append' ? 'Append' : 'Copy'}{' '}
              {activeEffectStack.entryCount}{' '}
              {activeEffectStack.stackKind === 'layer-effects' ? 'Layer Effect' : 'Object Filter'}
              {activeEffectStack.entryCount === 1 ? '' : 's'}
            </div>
          ) : null}
        </DragOverlay>
      </EffectStackDragContext.Provider>
    </DndContext>
  );
}
