/**
 * FocusOrderOverlay — numbered SVG overlay showing inferred tab/focus order.
 *
 * Renders circles with index numbers on interactive / focusable nodes in
 * the order a screen reader would encounter them. Non-exporting (the parent
 * container must have pointer-events: none or be behind the canvas).
 *
 * Research basis: WCAG 2.1 §2.4.3 (Focus Order), APG Tree View pattern.
 */

import { analyzeFocusOrder, type FocusOrderAnalysis } from '@varve/scene';
import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../context';

interface FocusOrderOverlayProps {
  enabled: boolean;
  zoom: number;
  pan: { x: number; y: number };
}

export function FocusOrderOverlay({ enabled, zoom, pan }: FocusOrderOverlayProps) {
  const { state } = useEditor();
  const [analysis, setAnalysis] = useState<FocusOrderAnalysis | null>(null);

  useEffect(() => {
    if (!enabled) {
      setAnalysis(null);
      return;
    }
    setAnalysis(analyzeFocusOrder(state.document));
  }, [enabled, state.document]);

  const indicators = useMemo(() => {
    if (!analysis || !enabled) return null;

    return analysis.entries.map((entry) => {
      const cx = entry.screenX * zoom + pan.x;
      const cy = entry.screenY * zoom + pan.y;
      return { ...entry, cx, cy };
    });
  }, [analysis, enabled, zoom, pan]);

  if (!enabled || !indicators || indicators.length === 0) return null;

  return (
    <svg
      className="focus-order-overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10,
        overflow: 'visible',
      }}
      aria-hidden="true"
    >
      <title>Focus order overlay — {indicators.length} elements</title>
      {indicators.map((entry) => (
        <g key={entry.nodeId}>
          <circle
            cx={entry.cx}
            cy={entry.cy}
            r={12}
            fill="var(--color-canvas-selection)"
            fillOpacity={0.85}
            /* The theme-inverted counter, not a fixed white: white-on-teal
             * fails in the dark theme where the selection step is light
             * (T(5)), and the counter token is exactly what the dual-tone
             * canvas contract provides for this pairing. */
            stroke="var(--color-canvas-handle-fill)"
            strokeWidth={2}
          />
          <text
            x={entry.cx}
            y={entry.cy}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--color-canvas-handle-fill)"
            fontSize={11}
            fontWeight={700}
            style={{ fontFamily: 'system-ui, sans-serif' }}
          >
            {entry.index}
          </text>
        </g>
      ))}
    </svg>
  );
}
