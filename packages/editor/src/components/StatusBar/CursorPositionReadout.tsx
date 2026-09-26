import { useLayoutEffect, useRef } from 'react';
import {
  type CursorWorldPosition,
  getCursorWorldPosition,
  subscribeCursorWorldPosition,
} from '../../canvas/cursorPosition';

function readoutText(cursor: CursorWorldPosition): string {
  return `X: ${Math.round(cursor.x)} Y: ${Math.round(cursor.y)}`;
}

/**
 * Live X/Y readout. The pointer publishes once per animation frame, so this
 * writes its own text from the store subscription instead of scheduling a
 * React render. A store-driven render (`useSyncExternalStore`) runs at sync
 * priority from that animation-frame callback, and React folds the pending
 * document update of an active drag into the same flush, moving the whole
 * editor re-render ahead of the frame's paint.
 */
export function CursorPositionReadout() {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const span = ref.current;
    if (!span) return;
    const render = () => {
      const cursor = getCursorWorldPosition();
      // An empty inline value defers to the stylesheet, which still hides the
      // readout at narrow widths.
      span.style.display = cursor ? '' : 'none';
      span.textContent = cursor ? readoutText(cursor) : '';
    };
    render();
    return subscribeCursorWorldPosition(render);
  }, []);

  return <span ref={ref} className="editor-status__meta editor-status__cursor" />;
}
