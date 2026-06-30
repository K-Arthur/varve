import type { SnapGuide } from '../tools/snapping';

interface SnapGuidesOverlayProps {
  guides: SnapGuide[];
  zoom: number;
  pan: { x: number; y: number };
}

export function SnapGuidesOverlay({ guides, zoom, pan }: SnapGuidesOverlayProps) {
  if (guides.length === 0) return null;
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
      {guides.map((g, i) => {
        const pos = g.axis === 'vertical' ? g.position * zoom + pan.x : g.position * zoom + pan.y;
        return (
          <line
            key={i}
            x1={g.axis === 'vertical' ? pos : 0}
            y1={g.axis === 'vertical' ? 0 : pos}
            x2={g.axis === 'vertical' ? pos : 99999}
            y2={g.axis === 'vertical' ? 99999 : pos}
            stroke="#39d0c6"
            strokeWidth={1}
            strokeDasharray="4,2"
          />
        );
      })}
    </svg>
  );
}
