/**
 * Page-layout guide overlay for the active Page tool context.
 *
 * These guides are view-only: they are derived from the scene page layout,
 * never inserted into the node tree, hit-test surface, or export payload.
 * Screen/design frames do not use this overlay because they have different
 * auto-layout semantics.
 */

import type { Document, NodeId } from '@varve/scene';
import { resolvePageLayout, resolvePagePlacement } from '@varve/scene';
import { memo, useMemo } from 'react';
import './page-layout-overlay.css';

export interface PageLayoutOverlayProps {
  document: Document;
  activePageId: NodeId | null;
  tool: string;
  zoom: number;
  worldToCanvas: (wx: number, wy: number) => { x: number; y: number };
}

export const PageLayoutOverlay = memo(function PageLayoutOverlay({
  document,
  activePageId,
  tool,
  zoom,
  worldToCanvas,
}: PageLayoutOverlayProps): React.ReactNode {
  const geometry = useMemo(() => {
    if (tool !== 'page' || !activePageId) return null;
    const page = document.pages?.find((candidate) => candidate.id === activePageId);
    const placement = page ? resolvePagePlacement(document, page.id) : null;
    const layout = page ? resolvePageLayout(document, page.id) : null;
    if (!page || !placement || !layout) return null;

    const toScreen = (x: number, y: number) => worldToCanvas(placement.x + x, placement.y + y);
    const polygon = (x: number, y: number, width: number, height: number) =>
      [
        toScreen(x, y),
        toScreen(x + width, y),
        toScreen(x + width, y + height),
        toScreen(x, y + height),
      ]
        .map(({ x: sx, y: sy }) => `${sx},${sy}`)
        .join(' ');
    const usable = layout.usableBounds;
    return {
      usable: polygon(usable.x, usable.y, usable.width, usable.height),
      columns: layout.columns.map((column) =>
        polygon(column.x, usable.y, column.width, usable.height),
      ),
      issueCount: layout.issues.length,
    };
  }, [document, activePageId, tool, worldToCanvas]);

  if (!geometry) return null;

  return (
    <svg
      className="page-layout-overlay"
      aria-hidden
      role="presentation"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      data-layout-issue-count={geometry.issueCount}
    >
      <polygon
        className="page-layout-overlay__usable"
        points={geometry.usable}
        fill="none"
        strokeWidth={Math.max(1, 1 / zoom)}
        strokeDasharray={`${5 / zoom},${4 / zoom}`}
      />
      {geometry.columns.map((points) => (
        <polygon
          key={points}
          className="page-layout-overlay__column"
          points={points}
          fill="none"
          strokeWidth={Math.max(1, 1 / zoom)}
        />
      ))}
    </svg>
  );
});
