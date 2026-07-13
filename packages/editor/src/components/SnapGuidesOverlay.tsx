import type { Viewport } from '@strata/shared';
import { getEditorViewport } from '../canvas/cameraState';
import { guideLineScreenEndpoints } from '../canvas/guideGeometry';
import type { SnapGuide } from '../tools/snapping';

interface SnapGuidesOverlayProps {
  guides: SnapGuide[];
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation?: number;
}

function guideColor(type?: string): string {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  switch (type) {
    case 'midpoint':
      return cs.getPropertyValue('--color-feedback-success').trim() || '#22c55e';
    case 'size-match':
      return cs.getPropertyValue('--color-accent-primary').trim() || '#3b82f6';
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
      {guides.map((g, i) => {
        const line = lineFor(g.axis, g.position);
        const color = guideColor(g.type);
        return (
          <line
            key={i}
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
        .map((g, i) => {
          const line = lineFor(g.axis, g.position);
          const color = guideColor(g.type);
          const midX = (line.x1 + line.x2) / 2;
          const midY = (line.y1 + line.y2) / 2;
          return (
            <text key={`l${i}`} x={midX + 4} y={midY - 4} fontSize={10} fill={color}>
              {g.label}
            </text>
          );
        })}
      {guides
        .filter((g) => g.distance !== undefined)
        .map((g, i) => {
          const line = lineFor(g.axis, g.position);
          const color = guideColor(g.type);
          const midX = (line.x1 + line.x2) / 2;
          const midY = (line.y1 + line.y2) / 2;
          return (
            <text key={`d${i}`} x={midX + 4} y={midY + 12} fontSize={9} fill={color}>
              {g.distance}px
            </text>
          );
        })}
    </svg>
  );
}
