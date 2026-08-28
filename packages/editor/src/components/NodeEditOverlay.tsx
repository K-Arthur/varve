import type { PathPoint } from '@varve/engine';
import { applyAffine } from '@varve/engine';
import type { ShapeNode } from '@varve/scene';
import type { Affine } from '@varve/shared';
import { computeFloatingOrigin, worldToScreen } from '@varve/shared';
import { getEditorViewport } from '../canvas/cameraState';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../canvas/overlayZIndex';

interface NodeEditOverlayProps {
  node: ShapeNode;
  selectedAnchors: ReadonlySet<number>;
  zoom: number;
  pan: { x: number; y: number };
  /** Full world transform for the node (composed from all ancestors). */
  worldTransform?: Affine;
}

// Must match the transform the canvas actually paints with
// (applyEditorCameraToCtx: floating origin) — naive world*zoom+pan drifts
// from the real paint position once panned away from world (0,0), putting
// these anchor handles somewhere other than the path they're editing.
function worldToCanvas(
  wx: number,
  wy: number,
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  const cam = { zoom, pan };
  const viewport = getEditorViewport();
  const origin = computeFloatingOrigin(cam, viewport);
  const [x, y] = worldToScreen(cam, wx, wy, viewport, origin);
  return { x, y };
}

export function NodeEditOverlay({
  node,
  selectedAnchors,
  zoom,
  pan,
  worldTransform,
}: NodeEditOverlayProps) {
  if (node.shape.kind !== 'path') return null;
  const rings = [node.shape.points, ...(node.shape.holes ?? [])];

  // Use the provided world transform, or fall back to the node's own transform
  // (which is just the translation for identity-rotated nodes).
  const wt = worldTransform ?? (node.transform as Affine);

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX,
      }}
      aria-hidden
    >
      <title>Node edit overlay</title>
      {rings.flatMap((ring, ringIndex) =>
        ring.map((p: PathPoint, i: number) => {
          const globalIndex =
            rings.slice(0, ringIndex).reduce((count, previous) => count + previous.length, 0) + i;
          const wp = applyAffine(wt, [p.x, p.y]);
          const c = worldToCanvas(wp[0], wp[1], zoom, pan);
          const selected = selectedAnchors.has(globalIndex);
          const isSmooth = p.handleIn !== null || p.handleOut !== null;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: path points have no id; position in the path is the identity and points move during editing
            <g key={`${ringIndex}-${i}`}>
              {p.handleIn && (
                <>
                  <line
                    x1={c.x}
                    y1={c.y}
                    x2={
                      worldToCanvas(
                        ...applyAffine(wt, [p.x + p.handleIn[0], p.y + p.handleIn[1]]),
                        zoom,
                        pan,
                      ).x
                    }
                    y2={
                      worldToCanvas(
                        ...applyAffine(wt, [p.x + p.handleIn[0], p.y + p.handleIn[1]]),
                        zoom,
                        pan,
                      ).y
                    }
                    stroke="var(--color-interactive-default)"
                    strokeWidth={1}
                  />
                  <circle
                    cx={
                      worldToCanvas(
                        ...applyAffine(wt, [p.x + p.handleIn[0], p.y + p.handleIn[1]]),
                        zoom,
                        pan,
                      ).x
                    }
                    cy={
                      worldToCanvas(
                        ...applyAffine(wt, [p.x + p.handleIn[0], p.y + p.handleIn[1]]),
                        zoom,
                        pan,
                      ).y
                    }
                    r={3}
                    fill="var(--color-interactive-default)"
                  />
                </>
              )}
              {p.handleOut && (
                <>
                  <line
                    x1={c.x}
                    y1={c.y}
                    x2={
                      worldToCanvas(
                        ...applyAffine(wt, [p.x + p.handleOut[0], p.y + p.handleOut[1]]),
                        zoom,
                        pan,
                      ).x
                    }
                    y2={
                      worldToCanvas(
                        ...applyAffine(wt, [p.x + p.handleOut[0], p.y + p.handleOut[1]]),
                        zoom,
                        pan,
                      ).y
                    }
                    stroke="var(--color-interactive-default)"
                    strokeWidth={1}
                  />
                  <circle
                    cx={
                      worldToCanvas(
                        ...applyAffine(wt, [p.x + p.handleOut[0], p.y + p.handleOut[1]]),
                        zoom,
                        pan,
                      ).x
                    }
                    cy={
                      worldToCanvas(
                        ...applyAffine(wt, [p.x + p.handleOut[0], p.y + p.handleOut[1]]),
                        zoom,
                        pan,
                      ).y
                    }
                    r={3}
                    fill="var(--color-interactive-default)"
                  />
                </>
              )}
              {isSmooth ? (
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={5}
                  fill={
                    selected ? 'var(--color-interactive-default)' : 'var(--color-surface-overlay)'
                  }
                  stroke="var(--color-interactive-default)"
                  strokeWidth={1.5}
                />
              ) : (
                <rect
                  x={c.x - 4}
                  y={c.y - 4}
                  width={8}
                  height={8}
                  fill={
                    selected ? 'var(--color-interactive-default)' : 'var(--color-surface-overlay)'
                  }
                  stroke="var(--color-interactive-default)"
                  strokeWidth={1.5}
                />
              )}
            </g>
          );
        }),
      )}
    </svg>
  );
}
