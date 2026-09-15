/**
 * Placeholder fill selection for not-yet-visible image resources.
 *
 * Loading must not be visually indistinguishable from permanent failure:
 * a source in the cache's error state draws a distinct darker gray, while
 * still-loading (or unknown) sources draw the neutral placeholder. Both
 * preserve the node's geometry — the placeholder is drawn over the exact
 * fill bounds, so layout, hit testing, and selection are unaffected.
 */
import { getImageCache } from './imageCache';
import { resolveImageResourceHandle } from './imageResourceRegistry';

/** Neutral placeholder while a resource is loading (existing behaviour). */
export const LOADING_PLACEHOLDER_FILL = '#e8eaed';
/** Distinct placeholder after a permanent failure (missing/corrupt/CORS/...). */
export const FAILED_PLACEHOLDER_FILL = '#d5d8db';

/**
 * Pick the placeholder fill for an image identity. Handles resolve through
 * the resource registry before the cache lookup; raw sources pass through.
 */
export function imagePlaceholderFill(src: string): string {
  const loadable = resolveImageResourceHandle(src);
  if (getImageCache().state(loadable) === 'error') return FAILED_PLACEHOLDER_FILL;
  return LOADING_PLACEHOLDER_FILL;
}
