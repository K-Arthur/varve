import type { Viewport } from '@varve/shared';
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

function guideColor(type?: string): string {
  switch (type) {
    case 'midpoint':
      return resolveCanvasColor('var(--color-feedback-success, #22c55e)');
    case 'size-match':
      return resolveCanvasColor('var(--color-accent-primary, #3b82f6)');
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

  return (
    <svg className="snap-guides-overlay" aria-hidden>
      <title>Snap guides overlay</title>
      {guides.map((g) => {
        const line = lineFor(g.axis, g.position);
        const color = guideColor(g.type);
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
          const line = lineFor(g.axis, g.position);
          const color = guideColor(g.type);
          const midX = (line.x1 + line.x2) / 2;
          const midY = (line.y1 + line.y2) / 2;
          return (
            <text
              key={`l:${g.axis}:${g.position}`}
              x={midX + 4}
              y={midY - 4}
              fontSize={10}
              fill={color}
            >
              {g.label}
            </text>
          );
        })}
      {guides
        .filter((g) => g.distance !== undefined)
        .map((g) => {
          const line = lineFor(g.axis, g.position);
          const color = guideColor(g.type);
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
