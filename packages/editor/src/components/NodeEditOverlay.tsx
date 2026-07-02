import { applyAffine } from '@strata/engine';
import type { PathPoint } from '@strata/engine';
import type { Affine } from '@strata/shared';
import type { ShapeNode } from '@strata/scene';

interface NodeEditOverlayProps {
  node: ShapeNode;
  selectedAnchors: ReadonlySet<number>;
  zoom: number;
  pan: { x: number; y: number };
  /** Full world transform for the node (composed from all ancestors). */
  worldTransform?: Affine;
}

function worldToCanvas(
  wx: number,
  wy: number,
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  return { x: wx * zoom + pan.x, y: wy * zoom + pan.y };
}

export function NodeEditOverlay({
  node,
  selectedAnchors,
  zoom,
  pan,
  worldTransform,
}: NodeEditOverlayProps) {
  if (node.shape.kind !== 'path') return null;
  const { points } = node.shape;

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
      }}
      aria-hidden
    >
      <title>Node edit overlay</title>
      {points.map((p: PathPoint, i: number) => {
        const wp = applyAffine(wt, [p.x, p.y]);
        const c = worldToCanvas(wp[0], wp[1], zoom, pan);
        const selected = selectedAnchors.has(i);
        const isSmooth = p.handleIn !== null || p.handleOut !== null;
        return (
          <g key={i}>
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
                fill={selected ? 'var(--color-interactive-default)' : 'white'}
                stroke="var(--color-interactive-default)"
                strokeWidth={1.5}
              />
            ) : (
              <rect
                x={c.x - 4}
                y={c.y - 4}
                width={8}
                height={8}
                fill={selected ? 'var(--color-interactive-default)' : 'white'}
                stroke="var(--color-interactive-default)"
                strokeWidth={1.5}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
