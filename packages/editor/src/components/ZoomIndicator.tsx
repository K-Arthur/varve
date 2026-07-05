/**
 * Zoom indicator — a transient overlay showing the current zoom percentage.
 * Appears whenever zoom changes and auto-dismisses after 1.5s of inactivity.
 *
 * Research basis: Figma zoom indicator (transient, top-left, auto-hides).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ZoomIndicatorProps {
  zoom: number;
}

export function ZoomIndicator({ zoom }: ZoomIndicatorProps): React.ReactNode {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastZoomRef = useRef(zoom);

  const show = useCallback(() => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 1500);
  }, []);

  useEffect(() => {
    if (zoom !== lastZoomRef.current) {
      lastZoomRef.current = zoom;
      show();
    }
  }, [zoom, show]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!visible) return null;

  const pct = Math.round(zoom * 100);

  return (
    <div
      className="editor-canvas__zoom-indicator"
      role="status"
      aria-live="polite"
      aria-label={`Zoom: ${pct}%`}
    >
      {pct}%
    </div>
  );
}
