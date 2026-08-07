/**
 * PageToolOverlay — visual page-geometry affordances for the Page tool (M6,
 * ADR-0144): the active page's trim outline plus four corner handles, drawn
 * in the accent token so they are clearly distinct from node transform
 * handles. The handles are visual affordances — the PageTool itself drives
 * the resize gesture from its own corner tolerance. Renders nothing when
 * the Page tool is inactive.
 */

import type { Document, NodeId } from '@varve/scene';
import { resolvePagePlacement } from '@varve/scene';
import { memo } from 'react';

const HANDLE_SIZE = 10;

export interface PageToolOverlayProps {
  document: Document;
  activePageId: NodeId | null;
  tool: string;
  zoom: number;
  worldToCanvas: (wx: number, wy: number) => { x: number; y: number };
}

export const PageToolOverlay = memo(function PageToolOverlay({
  document,
  activePageId,
  tool,
  zoom,
  worldToCanvas,
}: PageToolOverlayProps): React.ReactNode {
  if (tool !== 'page' || !activePageId) return null;
  const page = document.pages?.find((p) => p.id === activePageId);
  if (!page) return null;
  const placement = resolvePagePlacement(document, page.id);
  if (!placement) return null;

  const topLeft = worldToCanvas(placement.x, placement.y);
  const bottomRight = worldToCanvas(placement.x + page.width, placement.y + page.height);
  const w = bottomRight.x - topLeft.x;
  const h = bottomRight.y - topLeft.y;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

  const half = HANDLE_SIZE / 2;
  const corners = [
    { x: topLeft.x, y: topLeft.y },
    { x: bottomRight.x, y: topLeft.y },
    { x: bottomRight.x, y: bottomRight.y },
    { x: topLeft.x, y: bottomRight.y },
  ];

  return (
    <div
      className="page-tool-overlay"
      aria-hidden
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: topLeft.x,
          top: topLeft.y,
          width: w,
          height: h,
          border: `${Math.max(1, 1.5 / zoom)}px solid var(--color-accent-primary)`,
          borderRadius: 2,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.08)',
        }}
      />
      {corners.map((c, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: c.x - half,
            top: c.y - half,
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            borderRadius: 2,
            background: 'var(--color-accent-primary)',
            border: '1px solid var(--color-surface-raised)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }}
        />
      ))}
    </div>
  );
});
