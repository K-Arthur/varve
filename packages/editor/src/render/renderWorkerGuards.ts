import type { RenderRevision } from '@varve/shared';

/** Final guard before allocating/transferring a bitmap for an obsolete replay. */
export function shouldTransferRenderedFrame(
  completed: RenderRevision,
  active: RenderRevision,
): boolean {
  return completed >= active;
}
