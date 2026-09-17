import type { PathPoint } from '@varve/engine';
import { applyAffine } from '@varve/engine';
import type { ShapeNode } from '@varve/scene';
import type { Affine } from '@varve/shared';
import { computeFloatingOrigin, nodeModeForPoint, pathRings, worldToScreen } from '@varve/shared';
import { getEditorViewport } from '../canvas/cameraState';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../canvas/overlayZIndex';

interface NodeEditOverlayProps {
  node: ShapeNode;
  selectedAnchors: ReadonlySet<number>;
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation?: number;
  viewport?: { width: number; height: number };
  /** Full world transform for the node (composed from all ancestors). */
  worldTransform?: Affine;
}

function projectWorld(
  wx: number,
  wy: number,
  zoom: number,
  pan: { x: number; y: number },
  rotation: number,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const camera = { zoom, pan, rotation };
  const origin = computeFloatingOrigin(camera, viewport);
  const [x, y] = worldToScreen(camera, wx, wy, viewport, origin);
  return { x, y };
}

function pointScreen(
  transform: Affine,
  point: readonly [number, number],
  zoom: number,
  pan: { x: number; y: number },
  rotation: number,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const world = applyAffine(transform, point);
  return projectWorld(world[0], world[1], zoom, pan, rotation, viewport);
}

export function NodeEditOverlay({
  node,
  selectedAnchors,
  zoom,
  pan,
  cameraRotation = 0,
  viewport,
  worldTransform,
}: NodeEditOverlayProps) {
  if (node.shape.kind !== 'path') return null;
  const rings = pathRings(node.shape);
  const resolvedViewport = viewport ?? getEditorViewport();
  const wt = worldTransform ?? (node.transform as Affine);
  let globalOffset = 0;

  return (
    <svg
      className="node-edit-overlay"
      data-testid="node-edit-overlay"
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
      {rings.flatMap((ring, ringIndex) => {
        const elements = ring.map((point: PathPoint, pointIndex: number) => {
          const globalIndex = globalOffset + pointIndex;
          const anchor = pointScreen(
            wt,
            [point.x, point.y],
            zoom,
            pan,
            cameraRotation,
            resolvedViewport,
          );
          const mode = nodeModeForPoint(point);
          const selected = selectedAnchors.has(globalIndex);
          const handle = (which: 'in' | 'out') => {
            const vector = which === 'in' ? point.handleIn : point.handleOut;
            if (!vector) return null;
            return pointScreen(
              wt,
              [point.x + vector[0], point.y + vector[1]],
              zoom,
              pan,
              cameraRotation,
              resolvedViewport,
            );
          };
          const inScreen = handle('in');
          const outScreen = handle('out');
          return (
            <g
              key={`node-${globalIndex}-${point.x}-${point.y}-${point.handleIn?.join(':') ?? ''}-${point.handleOut?.join(':') ?? ''}`}
              pointerEvents="none"
              data-node-anchor={globalIndex}
              data-node-ring={ringIndex}
              data-node-point={pointIndex}
              data-node-mode={mode}
              data-node-selected={selected ? 'true' : 'false'}
            >
              {inScreen && (
                <>
                  <line
                    pointerEvents="none"
                    x1={anchor.x}
                    y1={anchor.y}
                    x2={inScreen.x}
                    y2={inScreen.y}
                    stroke="var(--color-canvas-selection)"
                    strokeWidth={1}
                  />
                  <circle
                    pointerEvents="none"
                    data-node-handle="in"
                    cx={inScreen.x}
                    cy={inScreen.y}
                    r={3}
                    fill="var(--color-canvas-selection)"
                  />
                </>
              )}
              {outScreen && (
                <>
                  <line
                    pointerEvents="none"
                    x1={anchor.x}
                    y1={anchor.y}
                    x2={outScreen.x}
                    y2={outScreen.y}
                    stroke="var(--color-canvas-selection)"
                    strokeWidth={1}
                  />
                  <circle
                    pointerEvents="none"
                    data-node-handle="out"
                    cx={outScreen.x}
                    cy={outScreen.y}
                    r={3}
                    fill="var(--color-canvas-selection)"
                  />
                </>
              )}
              {mode === 'corner' ? (
                <rect
                  pointerEvents="none"
                  x={anchor.x - 4}
                  y={anchor.y - 4}
                  width={8}
                  height={8}
                  fill={
                    selected ? 'var(--color-canvas-selection)' : 'var(--color-canvas-handle-fill)'
                  }
                  stroke="var(--color-canvas-selection)"
                  strokeWidth={1.5}
                />
              ) : (
                <circle
                  pointerEvents="none"
                  cx={anchor.x}
                  cy={anchor.y}
                  r={5}
                  fill={
                    selected ? 'var(--color-canvas-selection)' : 'var(--color-canvas-handle-fill)'
                  }
                  stroke="var(--color-canvas-selection)"
                  strokeWidth={mode === 'automatic' ? 2.5 : 1.5}
                  strokeDasharray={mode === 'symmetric' ? '2 1' : undefined}
                />
              )}
            </g>
          );
        });
        globalOffset += ring.length;
        return elements;
      })}
    </svg>
  );
}
