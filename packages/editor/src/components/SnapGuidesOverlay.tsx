import type { Viewport } from '@varve/shared';
import { worldToScreen } from '@varve/shared';
import { getEditorViewport } from '../canvas/cameraState';
import { resolveCanvasColor } from '../canvas/gridRenderer';
import { guideLineScreenEndpoints } from '../canvas/guideGeometry';
import type { SnapGuide } from '../tools/snapping';

interface SnapGuidesOverlayProps {
  guides: SnapGuide[];
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation?: number;
}

function guideColor(type?: string, targetId?: string): string {
  if (targetId?.startsWith('isometric:')) {
    // The isometric lattice target is the primary construction aid: render it
    // in the guide colour so the winning relationship is unmistakable.
    return resolveCanvasColor('var(--color-canvas-guide)');
  }
  switch (type) {
    case 'midpoint':
      return resolveCanvasColor('var(--color-feedback-success)');
    case 'size-match':
      return resolveCanvasColor('var(--color-canvas-guide)');
    default:
      return 'currentColor';
  }
}

export function SnapGuidesOverlay({
  guides,
  zoom,
  pan,
  cameraRotation = 0,
}: SnapGuidesOverlayProps) {
  if (guides.length === 0) return null;

  const camState = { zoom, pan, cameraRotation };
  const viewport: Viewport = getEditorViewport();

  const lineFor = (axis: 'vertical' | 'horizontal', position: number) =>
    guideLineScreenEndpoints({ axis, position }, camState, viewport);

  const screenForPoint = (point: { x: number; y: number }) =>
    worldToScreen({ zoom, pan, rotation: cameraRotation }, point.x, point.y, viewport);

  return (
    <svg className="snap-guides-overlay" aria-hidden>
      <title>Snap guides overlay</title>
      {guides.map((g) => {
        const color = guideColor(g.type, g.targetId);
        if (g.segment) {
          const [startX, startY] = screenForPoint(g.segment.start);
          const [endX, endY] = screenForPoint(g.segment.end);
          return (
            <line
              key={`s:${g.targetId ?? ''}:${startX}:${startY}`}
              x1={startX}
              y1={startY}
              x2={endX}
              y2={endY}
              stroke={color}
              strokeWidth={2}
              strokeDasharray="5,3"
            />
          );
        }
        if (g.point) {
          const [cx, cy] = screenForPoint(g.point);
          return (
            <g key={`p:${g.targetId ?? ''}:${g.point.x}:${g.point.y}`}>
              <line x1={cx - 5} y1={cy} x2={cx + 5} y2={cy} stroke={color} strokeWidth={1} />
              <line x1={cx} y1={cy - 5} x2={cx} y2={cy + 5} stroke={color} strokeWidth={1} />
              <circle cx={cx} cy={cy} r={2.5} fill="none" stroke={color} strokeWidth={1} />
            </g>
          );
        }
        const line = lineFor(g.axis, g.position);
        return (
          <line
            key={`${g.axis}:${g.position}`}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="4,2"
          />
        );
      })}
      {guides
        .filter((g) => g.label)
        .map((g) => {
          const color = guideColor(g.type, g.targetId);
          const anchor = g.point
            ? (() => {
                const [px, py] = screenForPoint(g.point);
                return { midX: px, midY: py };
              })()
            : (() => {
                const line = lineFor(g.axis, g.position);
                return { midX: (line.x1 + line.x2) / 2, midY: (line.y1 + line.y2) / 2 };
              })();
          return (
            <text
              key={`l:${g.axis}:${g.position}:${g.label}`}
              x={anchor.midX + 6}
              y={anchor.midY - 6}
              fontSize={10}
              fill={color}
            >
              {g.label}
            </text>
          );
        })}
      {guides
        .filter((g) => g.distance !== undefined && !g.point)
        .map((g) => {
          const line = lineFor(g.axis, g.position);
          const color = guideColor(g.type, g.targetId);
          const midX = (line.x1 + line.x2) / 2;
          const midY = (line.y1 + line.y2) / 2;
          return (
            <text
              key={`d:${g.axis}:${g.position}`}
              x={midX + 4}
              y={midY + 12}
              fontSize={9}
              fill={color}
            >
              {g.distance}px
            </text>
          );
        })}
    </svg>
  );
}
