/**
 * Paint canvas overlay — symmetry guides, the clone source marker and the
 * paint-target badge.
 *
 * All three answer "what will this stroke do?" before the user commits to it.
 * They are editor chrome, not artwork: nothing here is exported, and it all
 * disappears when the paint tools are not active.
 *
 * Drawn as a single SVG rather than React elements per dab so pointer movement
 * never triggers a component tree update.
 */
import type { Camera } from '@varve/shared';
import { worldToScreen } from '@varve/shared';
import { useMemo } from 'react';
import { clampRadialCount, type SymmetrySettings, symmetryBranchCount } from '../../tools/symmetry';
import './PaintOverlay.css';

export interface PaintOverlayProps {
  camera: Camera;
  width: number;
  height: number;
  /** Symmetry settings in world coordinates, or null when off. */
  symmetry: SymmetrySettings | null;
  /** Clone/heal source point in world coordinates, or null when unset. */
  cloneSource: { x: number; y: number } | null;
  /** Live offset from source to cursor while a clone stroke is in progress. */
  cloneCursor: { x: number; y: number } | null;
  /** Status line, e.g. "Painting: Layer Mask — Card". */
  targetStatus: string | null;
  /** True when the target cannot be painted, so the badge reads as a warning. */
  targetBlocked?: boolean;
}

export function PaintOverlay({
  camera,
  width,
  height,
  symmetry,
  cloneSource,
  cloneCursor,
  targetStatus,
  targetBlocked = false,
}: PaintOverlayProps) {
  const viewport = useMemo(() => ({ width, height }), [width, height]);
  const toScreen = useMemo(
    () => (p: { x: number; y: number }) => {
      const [x, y] = worldToScreen(camera, p.x, p.y, viewport);
      return { x, y };
    },
    [camera, viewport],
  );

  const axes = useMemo(
    () => (symmetry ? symmetryAxes(symmetry, width, height, camera) : []),
    [symmetry, width, height, camera],
  );

  const showGuides = symmetry !== null && symmetry.mode !== 'none' && symmetry.visible !== false;
  const source = cloneSource ? toScreen(cloneSource) : null;
  const cursor = cloneCursor ? toScreen(cloneCursor) : null;

  if (!showGuides && !source && !targetStatus) return null;

  return (
    <>
      <svg
        className="paint-overlay"
        width={width}
        height={height}
        aria-hidden="true"
        focusable="false"
      >
        {showGuides ? (
          <g className="paint-overlay__symmetry">
            {axes.map((axis) => (
              <line
                key={`${axis.x1},${axis.y1},${axis.x2},${axis.y2}`}
                x1={axis.x1}
                y1={axis.y1}
                x2={axis.x2}
                y2={axis.y2}
              />
            ))}
            {/* The origin handle is what the user drags to move the axis. */}
            <circle
              className="paint-overlay__origin"
              cx={toScreen({ x: symmetry.originX, y: symmetry.originY }).x}
              cy={toScreen({ x: symmetry.originX, y: symmetry.originY }).y}
              r={5}
            />
          </g>
        ) : null}

        {source ? (
          <g className="paint-overlay__clone">
            {cursor ? <line x1={source.x} y1={source.y} x2={cursor.x} y2={cursor.y} /> : null}
            <circle className="paint-overlay__clone-source" cx={source.x} cy={source.y} r={7} />
            <line x1={source.x - 10} y1={source.y} x2={source.x + 10} y2={source.y} />
            <line x1={source.x} y1={source.y - 10} x2={source.x} y2={source.y + 10} />
          </g>
        ) : null}
      </svg>

      {targetStatus ? (
        <p
          className={`paint-overlay__badge${targetBlocked ? ' is-blocked' : ''}`}
          role="status"
          aria-live="polite"
        >
          {targetStatus}
        </p>
      ) : null}
    </>
  );
}

interface ScreenLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Axis lines in screen space.
 *
 * The axis lives in world space, so panning and zooming move the *view* over a
 * fixed axis rather than dragging the axis through the artwork.
 */
export function symmetryAxes(
  symmetry: SymmetrySettings,
  width: number,
  height: number,
  camera: Camera,
): ScreenLine[] {
  const [ox, oy] = worldToScreen(camera, symmetry.originX, symmetry.originY, { width, height });
  const origin = { x: ox, y: oy };
  // Long enough to cross the viewport at any rotation.
  const reach = Math.hypot(width, height);

  const lineAt = (angle: number): ScreenLine => ({
    x1: origin.x - Math.cos(angle) * reach,
    y1: origin.y - Math.sin(angle) * reach,
    x2: origin.x + Math.cos(angle) * reach,
    y2: origin.y + Math.sin(angle) * reach,
  });

  switch (symmetry.mode) {
    case 'mirrorX':
      return [lineAt(symmetry.angle)];
    case 'mirrorY':
      return [lineAt(symmetry.angle + Math.PI / 2)];
    case 'mirrorXY':
      return [lineAt(symmetry.angle), lineAt(symmetry.angle + Math.PI / 2)];
    case 'radial': {
      const count = clampRadialCount(symmetry.radialCount);
      // One guide per segment boundary; more than that is visual noise.
      return Array.from({ length: count }, (_, i) =>
        lineAt(symmetry.angle + (i * Math.PI) / count),
      );
    }
    default:
      return [];
  }
}

/** Copies a symmetry setting will paint, for the tool-options readout. */
export function symmetryCopyCount(symmetry: SymmetrySettings | null): number {
  return symmetryBranchCount(symmetry);
}
