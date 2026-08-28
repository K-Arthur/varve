/**
 * Latest-wins settled-frame scheduling for progressive image representations.
 *
 * A moving camera is allowed to draw a bounded proxy. Once the gesture ends,
 * this helper requests a normal canvas frame after a short quiet period so the
 * renderer can promote each visible image to its settled representation.
 */

const SETTLED_IMAGE_REFINEMENT_DELAY_MS = 180;
const pendingRefinements = new WeakMap<HTMLCanvasElement, ReturnType<typeof setTimeout>>();

export function scheduleSettledImageRefinement(
  canvas: HTMLCanvasElement,
  isInteractionActive: () => boolean,
  requestRefinement: () => void,
): void {
  if (typeof window === 'undefined') return;
  const existing = pendingRefinements.get(canvas);
  if (existing !== undefined) window.clearTimeout(existing);

  const timer = window.setTimeout(() => {
    if (isInteractionActive()) {
      scheduleSettledImageRefinement(canvas, isInteractionActive, requestRefinement);
      return;
    }
    pendingRefinements.delete(canvas);
    requestRefinement();
  }, SETTLED_IMAGE_REFINEMENT_DELAY_MS);
  pendingRefinements.set(canvas, timer);
}
