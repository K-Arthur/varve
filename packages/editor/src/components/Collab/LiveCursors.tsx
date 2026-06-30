import { useEffect, useRef, useState } from 'react';
import { useCollab } from './CollabProvider';

const IDLE_FADE_MS = 5000;
const HIDDEN_MS = 30000;

export function LiveCursors() {
  const { cursors } = useCollab();
  const [now, setNow] = useState(Date.now());
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const active = cursors.filter((c) => now - c.timestamp < HIDDEN_MS);

  return (
    <svg className="live-cursors" aria-hidden>
      {active.map((c) => {
        const age = now - c.timestamp;
        let opacity = 1;
        if (age > IDLE_FADE_MS) {
          opacity = 0.1 + 0.9 * Math.max(0, 1 - (age - IDLE_FADE_MS) / (HIDDEN_MS - IDLE_FADE_MS));
        }
        return (
          <g key={c.userId} style={{ opacity }}>
            <CursorArrow cx={c.x} cy={c.y} color={c.color} />
            <text
              x={c.x + 14}
              y={c.y + 4}
              fill={c.color}
              fontSize="11"
              fontFamily="var(--font-body, sans-serif)"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {c.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CursorArrow({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  return (
    <g transform={`translate(${cx}, ${cy})`} style={{ pointerEvents: 'none' }}>
      <polygon points="0,0 2,18 7,14 12,22 16,20 11,12 17,10" fill={color} />
    </g>
  );
}
