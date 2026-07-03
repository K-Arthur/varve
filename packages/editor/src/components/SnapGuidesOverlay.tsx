import type { SnapGuide } from '../tools/snapping';

interface SnapGuidesOverlayProps {
  guides: SnapGuide[];
  zoom: number;
  pan: { x: number; y: number };
}

function guideColor(type?: string): string {
  switch (type) {
    case 'midpoint':
      return '#22c55e';
    case 'size-match':
      return '#3b82f6';
    default:
      return 'currentColor';
  }
}

export function SnapGuidesOverlay({ guides, zoom, pan }: SnapGuidesOverlayProps) {
  if (guides.length === 0) return null;
  return (
    <svg className="snap-guides-overlay" aria-hidden>
      <title>Snap guides overlay</title>
      {guides.map((g, i) => {
        const pos =
          g.axis === 'vertical'
            ? g.position * zoom + pan.x
            : g.position * zoom + pan.y;
        const color = guideColor(g.type);
        return (
          <line
            key={i}
            x1={g.axis === 'vertical' ? pos : 0}
            y1={g.axis === 'vertical' ? 0 : pos}
            x2={g.axis === 'vertical' ? pos : 99999}
            y2={g.axis === 'vertical' ? 99999 : pos}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="4,2"
          />
        );
      })}
      {guides
        .filter((g) => g.label)
        .map((g, i) => {
          const color = guideColor(g.type);
          const x =
            g.axis === 'vertical'
              ? g.position * zoom + pan.x + 4
              : 10;
          const y =
            g.axis === 'horizontal'
              ? g.position * zoom + pan.y - 4
              : 20;
          return (
            <text key={`l${i}`} x={x} y={y} fontSize={10} fill={color}>
              {g.label}
            </text>
          );
        })}
      {guides
        .filter((g) => g.distance !== undefined)
        .map((g, i) => {
          const color = guideColor(g.type);
          const x =
            g.axis === 'vertical'
              ? g.position * zoom + pan.x + 4
              : 10;
          const y =
            g.axis === 'horizontal'
              ? g.position * zoom + pan.y + 12
              : 36;
          return (
            <text key={`d${i}`} x={x} y={y} fontSize={9} fill={color}>
              {g.distance}px
            </text>
          );
        })}
    </svg>
  );
}
