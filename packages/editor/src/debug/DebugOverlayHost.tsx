/**
 * DebugOverlayHost — renders SVG debug overlays atop the canvas.
 *
 * Channels: geometry (bounds, origins), hitTest (tolerance, candidates),
 * spatialIndex (grid cells), interaction (pointer), selection (ids),
 * performance (HUD). Each channel renders independently.
 *
 * Uses pointer-events: none and is excluded from the accessibility tree.
 * Production builds return null via isDebugBuild().
 */

import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../canvas/overlayZIndex';
import { useEditor } from '../context';
import type { DebugSnapshot, Point } from './DebugOverlayRegistry';
import { isDebugBuild } from './DebugSnapshotProvider';

const GEO_COLOR = 'rgba(0, 200, 255, 0.6)';
const GEO_ORIGIN = 'rgba(0, 200, 255, 0.9)';
const HIT_TOL = 'rgba(255, 100, 100, 0.2)';
const HIT_SEL = 'rgba(255, 50, 50, 0.8)';
const HIT_CAND = 'rgba(255, 200, 0, 0.6)';
const SPATIAL = 'rgba(100, 200, 100, 0.25)';
const TEXT_COLOR = 'rgba(255, 255, 255, 0.9)';
const TEXT_BG = 'rgba(0, 0, 0, 0.55)';

/** Render the geometry channel — node bounds, origins, and labels. */
function renderGeometry(
  snapshot: DebugSnapshot,
  zoom: number,
  pan: { x: number; y: number },
  density: string,
): React.ReactNode {
  if (!snapshot.geometry || snapshot.geometry.length === 0) return null;
  const showLabel = density !== 'none';
  const showAll = density === 'full';

  return (
    <g>
      {snapshot.geometry.map((entry) => {
        if (!entry.worldBounds) return null;
        const sx = (entry.worldBounds.x - pan.x) * zoom + 960;
        const sy = (entry.worldBounds.y - pan.y) * zoom + 540;
        const sw = entry.worldBounds.w * zoom;
        const sh = entry.worldBounds.h * zoom;
        const ox = (entry.transformOrigin[0] - pan.x) * zoom + 960;
        const oy = (entry.transformOrigin[1] - pan.y) * zoom + 540;
        return (
          <g key={entry.nodeId}>
            <rect
              x={sx}
              y={sy}
              width={Math.max(sw, 1)}
              height={Math.max(sh, 1)}
              fill="none"
              stroke={GEO_COLOR}
              strokeWidth={1 / Math.max(1, zoom)}
              strokeDasharray={entry.locked ? '4,2' : undefined}
            />
            <line x1={ox - 4} y1={oy} x2={ox + 4} y2={oy} stroke={GEO_ORIGIN} strokeWidth={1} />
            <line x1={ox} y1={oy - 4} x2={ox} y2={oy + 4} stroke={GEO_ORIGIN} strokeWidth={1} />
            {showLabel && (
              <text
                x={sx + 2}
                y={sy - 2}
                fontSize={8 / Math.max(1, zoom)}
                fill={GEO_COLOR}
                fontFamily="monospace"
              >
                {entry.name}
                {showAll ? ` [${entry.kind}]` : ''}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Render the hit-test channel — tolerance circle, candidates, selected node. */
function renderHitTest(
  snapshot: DebugSnapshot,
  zoom: number,
  pan: { x: number; y: number },
  _density: string,
): React.ReactNode {
  if (!snapshot.hitTest) return null;
  const h = snapshot.hitTest;
  const px = (h.point[0] - pan.x) * zoom + 960;
  const py = (h.point[1] - pan.y) * zoom + 540;
  const tol = h.tolerancePx;

  return (
    <g>
      <circle cx={px} cy={py} r={tol} fill={HIT_TOL} stroke="none" />
      <circle cx={px} cy={py} r={3} fill={HIT_SEL} stroke="white" strokeWidth={0.5} />
      {h.candidates.map((c, i) => (
        <text
          key={c.nodeId}
          x={px + tol + 4}
          y={py + i * 11 + 10}
          fontSize={9}
          fill={c.passedPreciseTest ? HIT_SEL : HIT_CAND}
          fontFamily="monospace"
        >
          {`#${i} ${c.name} d=${c.distance.toFixed(1)} ${c.passedBroadPhase ? 'BP' : '--'}`}
        </text>
      ))}
      {h.selected && (
        <text
          x={px + tol + 4}
          y={py + h.candidates.length * 11 + 14}
          fontSize={9}
          fill={HIT_SEL}
          fontFamily="monospace"
        >
          {`-> ${h.selected}`}
        </text>
      )}
    </g>
  );
}

/** Render the spatial-index channel — grid cells with node counts. */
function renderSpatialIndex(
  snapshot: DebugSnapshot,
  zoom: number,
  pan: { x: number; y: number },
  _density: string,
): React.ReactNode {
  if (!snapshot.spatialIndex) return null;
  const si = snapshot.spatialIndex;

  return (
    <g>
      {si.cells.slice(0, 200).map((cell) => {
        const sx = (cell.cx - pan.x) * zoom + 960;
        const sy = (cell.cy - pan.y) * zoom + 540;
        const sz = cell.cellSize * zoom;
        return (
          <g key={`${cell.cx}-${cell.cy}`}>
            <rect
              x={sx}
              y={sy}
              width={Math.max(sz, 1)}
              height={Math.max(sz, 1)}
              fill={SPATIAL}
              stroke="rgba(100,200,100,0.3)"
              strokeWidth={0.5}
            />
            <text
              x={sx + 2}
              y={sy + 10}
              fontSize={7}
              fill="rgba(100,200,100,0.8)"
              fontFamily="monospace"
            >
              {cell.nodeCount}
            </text>
          </g>
        );
      })}
      {si.queryRegion && (
        <rect
          x={(si.queryRegion.x - pan.x) * zoom + 960}
          y={(si.queryRegion.y - pan.y) * zoom + 540}
          width={Math.max(si.queryRegion.w * zoom, 1)}
          height={Math.max(si.queryRegion.h * zoom, 1)}
          fill="none"
          stroke="rgba(100,200,100,0.8)"
          strokeWidth={1}
          strokeDasharray="4,2"
        />
      )}
      {si.stale && (
        <text x={16} y={120} fontSize={11} fill="rgba(255,200,0,0.9)" fontFamily="monospace">
          SPATIAL INDEX STALE
        </text>
      )}
    </g>
  );
}

/** Render the selection channel — primary and editing targets. */
function renderSelection(
  snapshot: DebugSnapshot,
  _zoom: number,
  _pan: { x: number; y: number },
  _density: string,
): React.ReactNode {
  if (!snapshot.selection) return null;
  const sel = snapshot.selection;
  return (
    <g>
      {sel.selectedIds.length > 0 && (
        <text x={16} y={30} fontSize={10} fill="rgba(255,255,0,0.8)" fontFamily="monospace">
          {`sel: [${sel.selectedIds.join(', ')}]`}
          {sel.primaryId ? ` prim:${sel.primaryId}` : ''}
          {sel.touchMultiSelectActive ? ' [touch-MS]' : ''}
        </text>
      )}
      {sel.editingTarget && (
        <text x={16} y={44} fontSize={10} fill="rgba(255,200,0,0.8)" fontFamily="monospace">
          {`edit: ${sel.editingTarget} mode:${sel.selectionMode}`}
        </text>
      )}
    </g>
  );
}

/** Performance HUD — frame timing. */
function renderPerformance(snapshot: DebugSnapshot): React.ReactNode {
  if (!snapshot.performance) return null;
  const p = snapshot.performance;
  return (
    <foreignObject x={8} y={60} width={320} height={120}>
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
        <div>{`F#${snapshot.frame}  ${p.hitTestMs.toFixed(1)}ms hit  ${p.boundsMs.toFixed(1)}ms bnd`}</div>
        <div>{`${p.transformLookupMs.toFixed(1)}ms xf  ${p.spatialQueryMs.toFixed(1)}ms sq`}</div>
        <div>{`cache ${p.cacheHits}h/${p.cacheMisses}m  nodes ${p.nodesVisited}`}</div>
      </div>
    </foreignObject>
  );
}

export function DebugOverlayHost() {
  const { state } = useEditor();
  const { debugOverlay, zoom, pan, selection, tool, cursorPos, touchMultiSelect } = state;

  if (!isDebugBuild() || !debugOverlay.enabled) return null;

  const { channels, labelDensity } = debugOverlay;
  const hasAny =
    channels.geometry ||
    channels.hitTest ||
    channels.spatialIndex ||
    channels.interaction ||
    channels.selection ||
    channels.performance;
  if (!hasAny) return null;

  const density = labelDensity ?? 'sparse';
  const snapshot: DebugSnapshot = {
    timestamp: Date.now(),
    frame: 0,
    geometry: channels.geometry ? [] : null,
    hitTest: channels.hitTest
      ? {
          point: (cursorPos ? [cursorPos.x, cursorPos.y] : [0, 0]) as Point,
          toleranceWorld: 8 / Math.max(0.001, zoom),
          tolerancePx: 8,
          candidates: [],
          selected: selection[0] ?? null,
          depth: 0,
        }
      : null,
    spatialIndex: channels.spatialIndex
      ? { cells: [], queryRegion: null, candidateCount: 0, stale: false }
      : null,
    interaction: channels.interaction
      ? {
          pointerPosition: cursorPos ? ([cursorPos.x, cursorPos.y] as Point) : null,
          pointerType: 'unknown',
          pointerId: -1,
          capturedTarget: null,
          dragThresholdPx: 4,
          longPressRadiusPx: 10,
          activeModifiers: { shift: false, alt: false, ctrl: false, meta: false },
          activeTool: tool,
          toolSubstate: null,
        }
      : null,
    selection: channels.selection
      ? {
          selectedIds: selection,
          primaryId: state.primaryId,
          focusedNodeId: state.focusedNodeId,
          editingTarget: null,
          marqueeRect: null,
          selectionMode: state.selectionMode,
          touchMultiSelectActive: touchMultiSelect.active,
        }
      : null,
    performance: channels.performance
      ? {
          hitTestMs: 0,
          boundsMs: 0,
          transformLookupMs: 0,
          spatialQueryMs: 0,
          overlayRenderMs: 0,
          pointerEventFreq: 0,
          cacheHits: 0,
          cacheMisses: 0,
          nodesVisited: 0,
          timestamp: performance.now(),
        }
      : null,
  };

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
    >
      {channels.geometry && renderGeometry(snapshot, zoom, pan, density)}
      {channels.hitTest && renderHitTest(snapshot, zoom, pan, density)}
      {channels.spatialIndex && renderSpatialIndex(snapshot, zoom, pan, density)}
      {channels.selection && renderSelection(snapshot, zoom, pan, density)}
      {channels.performance && renderPerformance(snapshot)}
    </svg>
  );
}
