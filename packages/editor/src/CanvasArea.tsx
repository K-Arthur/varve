/**
 * Canvas area — the central drawing surface (Strata plan §5.4).
 *
 * Contains the accessible focus layer (per SVG-AAM, an `aria-live` announcer
 * broadcasts selection/hit-test changes) and delegates actual rendering to the
 * engine facede + replayIr. Pan and zoom are stubbed for the first pass.
 */
import { useEffect, useRef } from 'react';

export function CanvasArea() {
  const announcer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus the canvas on mount so keyboard shortcuts work immediately.
    const el = announcer.current?.parentElement;
    // Defer focus to avoid stealing from other initial load focus.
    const id = setTimeout(() => el?.focus(), 100);
    return () => clearTimeout(id);
  }, []);

  return (
    <section className="editor-canvas" tabIndex={-1} aria-label="Canvas">
      <div className="editor-canvas__announcer" ref={announcer} role="status" aria-live="polite" />
    </section>
  );
}
