/**
 * Scrolling and viewport management for prototype playback.
 *
 * Handles scroll containers, scroll position management, element visibility
 * testing, and viewport bounds calculation.
 *
 * Research basis: W3C CSS Overflow spec, Figma prototype scrolling containers,
 * Intersection Observer API semantics for element visibility.
 */

export interface ScrollContainer {
  id: string;
  contentWidth: number;
  contentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
}

export interface ScrollState {
  containers: Record<string, ScrollContainer>;
}

/**
 * Create a scroll container configuration.
 */
export function createScrollContainer(
  id: string,
  contentWidth: number,
  contentHeight: number,
  viewportWidth = contentWidth,
  viewportHeight = contentHeight,
): ScrollContainer {
  return {
    id,
    contentWidth,
    contentHeight,
    viewportWidth,
    viewportHeight,
    scrollX: 0,
    scrollY: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Get the scroll position of a container.
 */
export function getScrollPosition(
  state: ScrollState,
  containerId: string,
): { x: number; y: number } | null {
  const container = state.containers[containerId];
  if (!container) return null;
  return { x: container.scrollX, y: container.scrollY };
}

/**
 * Set the scroll position of a container (clamped to content bounds).
 */
export function setScrollPosition(
  state: ScrollState,
  containerId: string,
  x: number,
  y: number,
): void {
  const container = state.containers[containerId];
  if (!container) return;
  const maxScrollX = Math.max(0, container.contentWidth - container.viewportWidth);
  const maxScrollY = Math.max(0, container.contentHeight - container.viewportHeight);
  container.scrollX = clamp(x, 0, maxScrollX);
  container.scrollY = clamp(y, 0, maxScrollY);
}

/**
 * Check if an element is visible within a scroll container's viewport.
 * An element is visible if it overlaps the visible area of the container.
 */
export function isElementVisible(
  state: ScrollState,
  containerId: string,
  elementX: number,
  elementY: number,
  elementWidth: number,
  elementHeight: number,
): boolean {
  const container = state.containers[containerId];
  if (!container) return true;

  const visibleLeft = container.scrollX;
  const visibleTop = container.scrollY;
  const visibleRight = visibleLeft + container.viewportWidth;
  const visibleBottom = visibleTop + container.viewportHeight;

  const elRight = elementX + elementWidth;
  const elBottom = elementY + elementHeight;

  return !(
    elRight < visibleLeft ||
    elementX > visibleRight ||
    elBottom < visibleTop ||
    elementY > visibleBottom
  );
}

/**
 * Get the visible bounding rect of a scroll container.
 */
export function getVisibleBounds(
  state: ScrollState,
  containerId: string,
): { x: number; y: number; w: number; h: number } | null {
  const container = state.containers[containerId];
  if (!container) return null;
  return {
    x: container.scrollX,
    y: container.scrollY,
    w: container.viewportWidth,
    h: container.viewportHeight,
  };
}
