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
import { type ReactNode, useCallback, useRef, useState } from 'react';
import type { EditorContextValue } from '../../context';
import type { DragNodeData } from '../../dnd-types';
import type { LayersDnDHandle } from '../LayersPanel/LayersTree';

export interface DnDShellProps {
  children: ReactNode;
  editor: EditorContextValue;
  layersDndRef: React.RefObject<LayersDnDHandle | null>;
}

export function DnDShell({ children, editor, layersDndRef }: DnDShellProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const lastPointerPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [activeDragNode, setActiveDragNode] = useState<{ id: NodeId; name: string } | null>(null);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      layersDndRef.current?.handleDragStart(event);
      const data = event.active.data.current as DragNodeData | undefined;
      if (data?.type === 'layer') {
        const node = editor.state.document.nodes[data.nodeId];
        if (node) {
          setActiveDragNode({ id: data.nodeId, name: node.name });
        }
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
      layersDndRef.current?.handleDragMove(event);
    },
    [layersDndRef],
  );

  const handleDragOver = useCallback(
    (event: import('@dnd-kit/core').DragOverEvent) => {
      layersDndRef.current?.handleDragOver(event);
    },
    [layersDndRef],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const data = active.data.current as DragNodeData | undefined;

      if (over?.id === 'canvas-drop-zone' && data?.type === 'layer') {
        const canvasSection = document.querySelector('.editor-canvas');
        const canvasRect = canvasSection?.getBoundingClientRect();
        if (!canvasSection || !canvasRect) {
          layersDndRef.current?.handleDragEnd(event);
          setActiveDragNode(null);
          return;
        }
        const ptr = lastPointerPos.current;
        const pointerInsideCanvas =
          ptr.x >= canvasRect.left &&
          ptr.x <= canvasRect.right &&
          ptr.y >= canvasRect.top &&
          ptr.y <= canvasRect.bottom;

        if (!pointerInsideCanvas) {
          layersDndRef.current?.handleDragEnd(event);
          setActiveDragNode(null);
          return;
        }

        setActiveDragNode(null);
        const canvasEl = canvasSection.querySelector('canvas');
        if (!canvasEl) return;
        const rect = canvasEl.getBoundingClientRect();
        const cam = {
          pan: editor.state.pan,
          zoom: editor.state.zoom,
          rotation: editor.state.cameraRotation ?? 0,
        };
        const viewport = { width: rect.width, height: rect.height };
        const origin = computeFloatingOrigin(cam, viewport);
        const [wx, wy] = screenToWorld(cam, ptr.x - rect.left, ptr.y - rect.top, viewport, origin);

        const selection = editor.state.selection;
        const moveIds =
          selection.length > 1 && selection.includes(data.nodeId as NodeId)
            ? selection
            : [data.nodeId as NodeId];

        editor.beginTransaction();
        for (const nodeId of moveIds) {
          editor.reparentNode(nodeId, null, Number.MAX_SAFE_INTEGER);
          editor.setNodePosition(nodeId, wx, wy);
        }
        editor.setSelection(moveIds[0]!);
        for (let i = 1; i < moveIds.length; i++) {
          editor.toggleSelection(moveIds[i]!, true);
        }
        editor.commitTransaction();
        editor.announce(
          moveIds.length > 1
            ? `Moved ${moveIds.length} layers to canvas`
            : `Moved layer to canvas`,
        );
        return;
      }

      layersDndRef.current?.handleDragEnd(event);
      setActiveDragNode(null);
    },
    [editor, layersDndRef],
  );

  const handleDragCancel = useCallback(() => {
    layersDndRef.current?.handleDragCancel();
    setActiveDragNode(null);
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
      {children}
      <DragOverlay dropAnimation={null}>
        {activeDragNode ? (
          <div
            className="drag-overlay"
            style={{
              padding: '4px 12px',
              background: 'var(--color-surface-raised)',
              borderRadius: 'var(--radius-sm)',
              boxShadow: 'var(--elevation-shadow-raised)',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            {activeDragNode.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
