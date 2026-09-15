/**
 * useHasTouchInput — whether the current device can produce touch pointers.
 *
 * The palette's "touch multi-select" toggle is a modifier substitute for touch
 * input only (`pointerType === 'touch'`); on a mouse-only device the control
 * does nothing and reads as an unexplained glyph next to the zoom and options
 * controls. Capability-gate it instead of showing inert chrome, while still
 * rendering it whenever it is already on so it can always be turned off.
 *
 * Detection is deliberately conservative: a coarse *or* coarse-capable pointer
 * (`any-pointer`), or a reported touch point, counts. Hybrid laptops therefore
 * keep the control.
 */
import { useEffect, useState } from 'react';

function detectTouch(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(any-pointer: coarse)')?.matches ?? false;
  const touchPoints =
    typeof navigator !== 'undefined' && typeof navigator.maxTouchPoints === 'number'
      ? navigator.maxTouchPoints > 0
      : false;
  return coarse || touchPoints;
}

export function useHasTouchInput(): boolean {
  const [hasTouch, setHasTouch] = useState(detectTouch);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(any-pointer: coarse)');
    const update = () => setHasTouch(detectTouch());
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return hasTouch;
}
