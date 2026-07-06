/**
 * Minimal prototype screen renderer — shows current frame with clickable hotspots.
 */
import type { Document, NodeId } from '@strata/scene';
import { useCallback, useMemo, useRef } from 'react';

export interface PrototypeScreenViewProps {
  document: Document;
  screenId: string;
  overlayStack: string[];
  onEvent: (event: { type: 'click'; nodeId: NodeId; screenId: string }) => void;
  hitTestNode: (world: { x: number; y: number }) => { nodeId: NodeId } | null;
  getNodeBounds: (nodeId: NodeId) => { x: number; y: number; w: number; h: number } | null;
}

export function PrototypeScreenView({
  document,
  screenId,
  overlayStack,
  onEvent,
  hitTestNode,
  getNodeBounds,
}: PrototypeScreenViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const screen = document.nodes[screenId];

  const visibleIds = useMemo(() => {
    const ids = new Set<NodeId>();
    if (screen && 'children' in screen) {
      for (const cid of screen.children ?? []) ids.add(cid);
    }
    for (const oid of overlayStack) ids.add(oid);
    return ids;
  }, [screen, overlayStack]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const hit = hitTestNode({ x: localX, y: localY });
      onEvent({
        type: 'click',
        nodeId: hit?.nodeId ?? screenId,
        screenId,
      });
    },
    [hitTestNode, onEvent, screenId],
  );

  if (!screen || screen.kind !== 'frame') {
    return <div className="prototype-screen-view__empty">Screen not found</div>;
  }

  const frameW = screen.w ?? 375;
  const frameH = screen.h ?? 812;

  return (
    <div
      ref={containerRef}
      className="prototype-screen-view"
      style={{ width: frameW, height: frameH }}
      onPointerDown={handlePointerDown}
      role="application"
      aria-label={`Prototype screen: ${screen.name}`}
    >
      <div className="prototype-screen-view__label">{screen.name}</div>
      {Array.from(visibleIds).map((nodeId) => {
        const bounds = getNodeBounds(nodeId);
        const node = document.nodes[nodeId];
        if (!bounds || !node) return null;
        return (
          <button
            key={nodeId}
            type="button"
            className="prototype-screen-view__hotspot"
            style={{
              left: bounds.x,
              top: bounds.y,
              width: bounds.w,
              height: bounds.h,
            }}
            aria-label={node.name}
            onPointerDown={(e) => {
              e.stopPropagation();
              onEvent({ type: 'click', nodeId, screenId });
            }}
          />
        );
      })}
    </div>
  );
}
