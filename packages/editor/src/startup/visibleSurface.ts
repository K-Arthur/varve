export interface VisibleSurfaceOptions {
  findElement?: () => Element | null;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

function hasVisibleArea(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (
    typeof HTMLCanvasElement !== 'undefined' &&
    element instanceof HTMLCanvasElement &&
    (element.width <= 0 || element.height <= 0)
  ) {
    return false;
  }
  return true;
}

/**
 * Calls `onVisible` only after the surface has non-zero layout and one browser
 * paint opportunity has elapsed. The returned cleanup prevents a stale surface
 * from completing after navigation or unmount.
 */
export function afterFirstVisiblePaint(
  selector: string,
  onVisible: () => void,
  options: VisibleSurfaceOptions = {},
): () => void {
  const findElement = options.findElement ?? (() => document.querySelector(selector));
  const requestFrame = options.requestFrame ?? requestAnimationFrame;
  const cancelFrame = options.cancelFrame ?? cancelAnimationFrame;
  let cancelled = false;
  let frameHandle = 0;

  const check = () => {
    if (cancelled) return;
    const element = findElement();
    if (!element || !hasVisibleArea(element)) {
      frameHandle = requestFrame(check);
      return;
    }

    // The first callback runs before paint. Completing in the following frame
    // guarantees the browser had an opportunity to present the visible surface.
    frameHandle = requestFrame(() => {
      if (!cancelled) onVisible();
    });
  };

  frameHandle = requestFrame(check);
  return () => {
    cancelled = true;
    cancelFrame(frameHandle);
  };
}
