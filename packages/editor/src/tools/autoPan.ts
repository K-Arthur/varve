/**
 * Auto-pan when dragging near canvas edge.
 *
 * Computes edge-pan velocity proportional to pointer proximity to the
 * canvas boundary. Velocity is 0 outside the scroll zone (40 CSS px)
 * and ramps linearly to maxSpeed at the edge.
 *
 * Research basis: Figma/Illustrator edge-scroll during drag.
 */

export const EDGE_SCROLL_ZONE = 40;
export const EDGE_SCROLL_MAX_SPEED = 8;

export function computeEdgeVelocity(
  pos: number,
  min: number,
  max: number,
  zone: number = EDGE_SCROLL_ZONE,
  maxSpeed: number = EDGE_SCROLL_MAX_SPEED,
): number {
  if (pos - min < zone) return -Math.min(1, (zone - (pos - min)) / zone) * maxSpeed;
  if (max - pos < zone) return Math.min(1, (zone - (max - pos)) / zone) * maxSpeed;
  return 0;
}
