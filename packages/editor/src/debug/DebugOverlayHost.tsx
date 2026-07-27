/**
 * DebugOverlayHost — React component that renders SVG debug overlays on top
 * of the canvas. Uses `pointer-events: none` and is excluded from the
 * accessibility tree. Disabled entirely when debug overlays are off or
 * in production builds.
 */

import { memo, useCallback } from 'react';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../canvas/overlayZIndex';
import { useEditor } from '../context';
import type {
  DebugSnapshot,
} from './DebugOverlayRegistry';
import { isDebugBuild } from './DebugSnapshotProvider';

// ── Colors ───────────────────────────────────────────────────────────────────

const GEO_BOUNDS_COLOR = 'rgba(0, 200, 255, 0.6)';
const GEO_ORIGIN_COLOR = 'rgba(0, 200, 255, 0.9)';
const HIT_TOLERANCE_COLOR = 'rgba(255, 100, 100, 0.25)';
const HIT_CANDIDATE_COLOR = 'rgba(255, 200, 0, 0.5)';
const HIT_SELECTED_COLOR = 'rgba(255, 50, 50, 0.8)';
const SPATIAL_CELL_COLOR = 'rgba(100, 200, 100, 0.2)';
const TEXT_COLOR = 'rgba(255, 255, 255, 0.9)';
const TEXT_BG = 'rgba(0, 0, 0, 0.55)';

interface ChannelRendererProps {
  snapshot: DebugSnapshot;
  zoom: number;
  pan: { x: number; y: number };
}

const GeometryChannel = memo(function GeometryChannel({
  snapshot,
  zoom,
  pan,
}: ChannelRendererProps) {
  if (!snapshot.geometry) return null;
  const toScreen = useCallback(
    (wx: number, wy: number): [number, number] => [
      (wx - pan.x) * zoom + 960,
      (wy - pan.y) * zoom + 540,
    ],
    [zoom, pan],
  );

  return (
    <g>
      {snapshot.geometry.map((entry) => {
        if (!entry.worldBounds) return null;
        const [sx, sy] = toScreen(entry.worldBounds.x, entry.worldBounds.y);
        const sw = entry.worldBounds.w * zoom;
        const sh = entry.worldBounds.h * zoom;
        const [ox, oy] = toScreen(entry.transformOrigin[0], entry.transformOrigin[1]);

        return (
          <g key={entry.nodeId}>
            <rect
              x={sx}
              y={sy}
              width={sw}
              height={sh}
              fill="none"
              stroke={GEO_BOUNDS_COLOR}
              strokeWidth={1 / Math.max(1, zoom)}
              strokeDasharray={entry.locked ? '4,2' : undefined}
            />
            <line
              x1={ox - 4}
              y1={oy}
              x2={ox + 4}
              y2={oy}
              stroke={GEO_ORIGIN_COLOR}
              strokeWidth={1}
            />
            <line
              x1={ox}
              y1={oy - 4}
              x2={ox}
              y2={oy + 4}
              stroke={GEO_ORIGIN_COLOR}
              strokeWidth={1}
            />
            {entry.worldBounds && (
              <text
                x={sx + 2}
                y={sy - 2}
                fontSize={9 / Math.max(1, zoom)}
                fill={GEO_BOUNDS_COLOR}
                fontFamily="monospace"
              >
                {entry.name}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
});

const HitTestChannel = memo(function HitTestChannel({
  snapshot,
  zoom,
  pan,
}: ChannelRendererProps) {
  if (!snapshot.hitTest) return null;
  const { hitTest } = snapshot;
  const toScreen = useCallback(
    (wx: number, wy: number): [number, number] => [
      (wx - pan.x) * zoom + 960,
      (wy - pan.y) * zoom + 540,
    ],
    [zoom, pan],
  );

  const [px, py] = toScreen(hitTest.point[0], hitTest.point[1]);
  const tolPx = hitTest.tolerancePx;

  return (
    <g>
      <circle cx={px} cy={py} r={tolPx} fill={HIT_TOLERANCE_COLOR} stroke="none" />
      <circle
        cx={px}
        cy={py}
        r={2}
        fill={HIT_SELECTED_COLOR}
        stroke="white"
        strokeWidth={0.5}
      />
      {hitTest.candidates.map((c, i) => (
        <g key={c.nodeId}>
          <text
            x={px + tolPx + 4}
            y={py + i * 12}
            fontSize={10}
            fill={c.passedPreciseTest ? HIT_SELECTED_COLOR : HIT_CANDIDATE_COLOR}
            fontFamily="monospace"
          >
            {`#${i} ${c.name} (d=${c.distance.toFixed(1)})`}
          </text>
        </g>
      ))}
    </g>
  );
});

const SpatialIndexChannel = memo(function SpatialIndexChannel({
  snapshot,
  zoom,
  pan,
}: ChannelRendererProps) {
  if (!snapshot.spatialIndex) return null;
  const toScreen = useCallback(
    (wx: number, wy: number): [number, number] => [
      (wx - pan.x) * zoom + 960,
      (wy - pan.y) * zoom + 540,
    ],
    [zoom, pan],
  );

  return (
    <g>
      {snapshot.spatialIndex.cells.map((cell, i) => {
        const [sx, sy] = toScreen(cell.cx, cell.cy);
        const sz = cell.cellSize * zoom;
        return (
          <g key={`${cell.cx}-${cell.cy}-${i}`}>
            <rect
              x={sx}
              y={sy}
              width={sz}
              height={sz}
              fill={SPATIAL_CELL_COLOR}
              stroke="rgba(100, 200, 100, 0.4)"
              strokeWidth={0.5}
            />
            <text
              x={sx + 2}
              y={sy + 10}
              fontSize={8}
              fill="rgba(100, 200, 100, 0.8)"
              fontFamily="monospace"
            >
              {cell.nodeCount}
            </text>
          </g>
        );
      })}
    </g>
  );
});

const SelectionChannel = memo(function SelectionChannel({
  snapshot,
  zoom,
  pan,
}: ChannelRendererProps) {
  if (!snapshot.selection) return null;
  const toScreen = useCallback(
    (wx: number, wy: number): [number, number] => [
      (wx - pan.x) * zoom + 960,
      (wy - pan.y) * zoom + 540,
    ],
    [zoom, pan],
  );

  const sel = snapshot.selection;
  return null;
});

const PerformanceHUD = memo(function PerformanceHUD({
  snapshot,
}: {
  snapshot: DebugSnapshot | null;
}) {
  if (!snapshot?.performance) return null;
  const p = snapshot.performance;
  return (
    <foreignObject x={8} y={8} width={320} height={120}>
      <div
        style={{
          background: TEXT_BG,
          color: TEXT_COLOR,
          fontFamily: 'monospace',
          fontSize: 10,
          padding: '4px 8px',
          borderRadius: 4,
        }}
      >
        <div>{`Frame #${snapshot.frame}`}</div>
        <div>{`Hit-test: ${p.hitTestMs.toFixed(1)}ms`}</div>
        <div>{`Bounds: ${p.boundsMs.toFixed(1)}ms`}</div>
        <div>{`Transform: ${p.transformLookupMs.toFixed(1)}ms`}</div>
        <div>{`Spatial: ${p.spatialQueryMs.toFixed(1)}ms`}</div>
        <div>{`Cache: ${p.cacheHits}h / ${p.cacheMisses}m`}</div>
      </div>
    </foreignObject>
  );
});

export function DebugOverlayHost() {
  const { state } = useEditor();
  const enabled = state.debugOverlay.enabled;

  const isDev = isDebugBuild();
  if (!isDev || !enabled) return null;

  const ch = state.debugOverlay.channels;
  const hasAnyChannel =
    ch.geometry || ch.hitTest || ch.spatialIndex || ch.interaction || ch.selection || ch.performance;

  if (!hasAnyChannel) return null;

  return (
    <svg
      role="presentation"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX + 1,
      }}
    />
  );
}
