import type { PathPoint } from '@strata/engine';
import type { ShapeNode } from '@strata/scene';

interface NodeEditOverlayProps {
  node: ShapeNode;
  selectedAnchors: ReadonlySet<number>;
  zoom: number;
  pan: { x: number; y: number };
}

function worldToCanvas(
  wx: number,
  wy: number,
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  return { x: wx * zoom + pan.x, y: wy * zoom + pan.y };
}

export function NodeEditOverlay({ node, selectedAnchors, zoom, pan }: NodeEditOverlayProps) {
  if (node.shape.kind !== 'path') return null;
  const { points } = node.shape;
  const tx = node.transform[4];
  const ty = node.transform[5];

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
        const c = worldToCanvas(tx + p.x, ty + p.y, zoom, pan);
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
                    worldToCanvas(tx + p.x + p.handleIn[0], ty + p.y + p.handleIn[1], zoom, pan).x
                  }
                  y2={
                    worldToCanvas(tx + p.x + p.handleIn[0], ty + p.y + p.handleIn[1], zoom, pan).y
                  }
                  stroke="var(--color-interactive-default)"
                  strokeWidth={1}
                />
                <circle
                  cx={
                    worldToCanvas(tx + p.x + p.handleIn[0], ty + p.y + p.handleIn[1], zoom, pan).x
                  }
                  cy={
                    worldToCanvas(tx + p.x + p.handleIn[0], ty + p.y + p.handleIn[1], zoom, pan).y
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
                    worldToCanvas(tx + p.x + p.handleOut[0], ty + p.y + p.handleOut[1], zoom, pan).x
                  }
                  y2={
                    worldToCanvas(tx + p.x + p.handleOut[0], ty + p.y + p.handleOut[1], zoom, pan).y
                  }
                  stroke="var(--color-interactive-default)"
                  strokeWidth={1}
                />
                <circle
                  cx={
                    worldToCanvas(tx + p.x + p.handleOut[0], ty + p.y + p.handleOut[1], zoom, pan).x
                  }
                  cy={
                    worldToCanvas(tx + p.x + p.handleOut[0], ty + p.y + p.handleOut[1], zoom, pan).y
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
