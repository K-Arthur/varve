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
import { screenToWorld } from '@varve/shared';
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
      layersDndRef.current?.handleDragMove(event);
      const ev = event.activatorEvent;
      if (ev instanceof MouseEvent || ev instanceof PointerEvent) {
        lastPointerPos.current = { x: ev.clientX, y: ev.clientY };
      }
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
        setActiveDragNode(null);
        const nodeId = data.nodeId as string;
        const canvasSection = document.querySelector('.editor-canvas');
        const canvasEl = canvasSection?.querySelector('canvas');
        if (canvasEl) {
          const rect = canvasEl.getBoundingClientRect();
          const cam = { pan: editor.state.pan, zoom: editor.state.zoom };
          const [wx, wy] = screenToWorld(
            cam,
            lastPointerPos.current.x - rect.left,
            lastPointerPos.current.y - rect.top,
          );
          editor.reparentNode(nodeId, null, Number.MAX_SAFE_INTEGER);
          editor.setNodePosition(nodeId, wx, wy);
          editor.setSelection(nodeId);
          editor.announce('Moved layer to canvas');
        }
        return;
      }

      layersDndRef.current?.handleDragEnd(event);
      setActiveDragNode(null);
    },
    [editor, layersDndRef],
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
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
