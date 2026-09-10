/**
 * Prototype screen renderer — shows the frame's real content (rendered
 * through the canonical scene→engine→IR pipeline) with clickable hotspots.
 */
import type { Document, NodeId } from '@varve/scene';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HotspotTransitionOverride } from '../../motion/smartAnimateBridge';
import { renderScreenToDataUrl } from './screenRender';

export interface PrototypeScreenViewProps {
  document: Document;
  screenId: string;
  overlayStack: string[];
  onEvent: (event: { type: 'click'; nodeId: NodeId; screenId: string }) => void;
  hitTestNode: (world: { x: number; y: number }) => { nodeId: NodeId } | null;
  getNodeBounds: (nodeId: NodeId) => { x: number; y: number; w: number; h: number } | null;
  /** Per-hotspot overrides during Smart Animate transitions. */
  hotspotOverrides?: Record<NodeId, HotspotTransitionOverride>;
}

export function PrototypeScreenView({
  document,
  screenId,
  overlayStack,
  onEvent,
  hitTestNode,
  getNodeBounds,
  hotspotOverrides,
}: PrototypeScreenViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const screen = document.nodes[screenId];
  const [screenImage, setScreenImage] = useState<string | null>(null);

  const frameW = screen?.kind === 'frame' ? (screen.w ?? 375) : 375;
  const frameH = screen?.kind === 'frame' ? (screen.h ?? 812) : 812;

  // Render the screen's real content once per screen/document/size. The
  // render is cached (LRU); the promise resolves to null in environments
  // without a raster path (jsdom), where hotspots-only remains correct.
  useEffect(() => {
    let cancelled = false;
    setScreenImage(null);
    void renderScreenToDataUrl(document, screenId, frameW, frameH).then((dataUrl) => {
      if (!cancelled) setScreenImage(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [document, screenId, frameW, frameH]);

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

  if (screen?.kind !== 'frame') {
    return <div className="prototype-screen-view__empty">Screen not found</div>;
  }

  return (
    <div
      ref={containerRef}
      className="prototype-screen-view"
      style={{ width: frameW, height: frameH }}
      onPointerDown={handlePointerDown}
      role="application"
      aria-label={`Prototype screen: ${screen.name}`}
    >
      {screenImage && (
        <img
          className="prototype-screen-view__image"
          src={screenImage}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      )}
      <div className="prototype-screen-view__label">{screen.name}</div>
      {Array.from(visibleIds).map((nodeId) => {
        const bounds = getNodeBounds(nodeId);
        const node = document.nodes[nodeId];
        const override = hotspotOverrides?.[nodeId];
        if (!bounds || !node) return null;
        const tx = node.transform?.[4] ?? 0;
        const ty = node.transform?.[5] ?? 0;
        const left = override?.left ?? tx + bounds.x;
        const top = override?.top ?? ty + bounds.y;
        const width = override?.width ?? bounds.w;
        const height = override?.height ?? bounds.h;
        const opacity = override?.opacity ?? node.opacity ?? 1;
        return (
          <button
            key={nodeId}
            type="button"
            className="prototype-screen-view__hotspot"
            style={{
              left,
              top,
              width,
              height,
              opacity,
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
