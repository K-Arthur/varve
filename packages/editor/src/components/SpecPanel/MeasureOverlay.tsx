/**
 * MeasureOverlay — screen-space SVG overlay for dimension lines and AABB readouts
 * in inspect mode.
 *
 * Rendered as an absolutely-positioned sibling to <canvas>, following the same
 * pattern as SelectionOverlay. All coordinates in CSS logical pixels (screen
 * space), computed via worldToScreen.
 *
 * Research basis: Figma Dev Mode redline measurements; Zeplin dimension overlays.
 */

import type { Document, SceneNode } from '@strata/scene';
import { useMemo } from 'react';
import { type AABB, edgeDistance, worldBBox } from './measurement';

interface MeasureOverlayProps {
  zoom: number;
  pan: { x: number; y: number };
  selectedNodes: SceneNode[];
  doc: Document;
  hoveredNode: SceneNode | null;
}

function worldToScreen(
  wx: number,
  wy: number,
  pan: { x: number; y: number },
  zoom: number,
): [number, number] {
  return [wx * zoom + pan.x, wy * zoom + pan.y];
}

function renderDimensionLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label: string,
  key: string,
): JSX.Element {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return (
    <g key={key}>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="var(--color-interactive-default, #39d0c6)"
        strokeWidth={1}
        strokeDasharray="4,2"
      />
      <text
        x={midX}
        y={midY - 4}
        textAnchor="middle"
        fill="var(--color-interactive-default, #39d0c6)"
        fontSize={10}
        fontFamily="var(--font-mono, monospace)"
      >
        {label}
      </text>
    </g>
  );
}

export function MeasureOverlay({
  zoom,
  pan,
  selectedNodes,
  doc,
  hoveredNode,
}: MeasureOverlayProps) {
  const selected = selectedNodes[0];

  const selectedBBox = useMemo(() => {
    if (!selected) return null;
    return worldBBox(selected, doc);
  }, [selected, doc]);

  const hoveredBBox = useMemo(() => {
    if (!hoveredNode || !selected || hoveredNode.id === selected.id) return null;
    return worldBBox(hoveredNode, doc);
  }, [hoveredNode, selected, doc]);

  const distanceInfo = useMemo(() => {
    if (!selectedBBox || !hoveredBBox) return null;
    const edge = edgeDistance(selectedBBox, hoveredBBox);
    const centerX = (selectedBBox.x + selectedBBox.w / 2 + hoveredBBox.x + hoveredBBox.w / 2) / 2;
    return { edge, centerX };
  }, [selectedBBox, hoveredBBox]);

  if (!selected || !selectedBBox) return null;

  const [sx, sy] = worldToScreen(selectedBBox.x, selectedBBox.y, pan, zoom);
  const [sx2, sy2] = worldToScreen(
    selectedBBox.x + selectedBBox.w,
    selectedBBox.y + selectedBBox.h,
    pan,
    zoom,
  );

  const dim = `${Math.round(selectedBBox.w)} x ${Math.round(selectedBBox.h)}`;

  return (
    <svg
      className="measure-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      aria-hidden
    >
      {/* Selected node AABB outline */}
      <rect
        x={sx}
        y={sy}
        width={sx2 - sx}
        height={sy2 - sy}
        fill="none"
        stroke="var(--color-interactive-default, #39d0c6)"
        strokeWidth={1 / Math.max(zoom, 0.1)}
        strokeDasharray={`${4 / Math.max(zoom, 0.1)},${2 / Math.max(zoom, 0.1)}`}
      />

      {/* Dimension label at top-center */}
      <text
        x={(sx + sx2) / 2}
        y={sy - 4 / Math.max(zoom, 0.1)}
        textAnchor="middle"
        fill="var(--color-interactive-default, #39d0c6)"
        fontSize={11}
        fontFamily="var(--font-mono, monospace)"
      >
        {dim}
      </text>

      {/* Hover-to-measure dimension lines */}
      {hoveredBBox && distanceInfo && (
        <>
          {renderDimensionLine(
            sx2,
            (sy + sy2) / 2,
            worldToScreen(hoveredBBox.x, hoveredBBox.y + hoveredBBox.h / 2, pan, zoom)[0],
            worldToScreen(hoveredBBox.x, hoveredBBox.y + hoveredBBox.h / 2, pan, zoom)[1],
            `${Math.round(distanceInfo.edge.left)}px`,
            'h-gap',
          )}
          {renderDimensionLine(
            (sx + sx2) / 2,
            sy2,
            worldToScreen(hoveredBBox.x + hoveredBBox.w / 2, hoveredBBox.y, pan, zoom)[0],
            worldToScreen(hoveredBBox.x + hoveredBBox.w / 2, hoveredBBox.y, pan, zoom)[1],
            `${Math.round(distanceInfo.edge.top)}px`,
            'v-gap',
          )}
        </>
      )}
    </svg>
  );
}
