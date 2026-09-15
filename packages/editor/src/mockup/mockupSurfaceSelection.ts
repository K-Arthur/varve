/**
 * Selected mockup surface for canvas editing.
 *
 * Module-level store (like `mockupTabStore`) so the canvas overlay and the
 * inspector can share a target without threading new state through the
 * editor context. The selection is always (frame, surface) scoped and is
 * cleared when the frame stops being a mockup or stops being selected.
 */

import type { NodeId } from '@varve/scene';

export interface MockupSurfaceSelection {
  frameId: NodeId;
  surfaceId: string;
}

let current: MockupSurfaceSelection | null = null;
const listeners = new Set<(selection: MockupSurfaceSelection | null) => void>();

function emit(): void {
  for (const listener of listeners) listener(current);
}

export function getMockupSurfaceSelection(): MockupSurfaceSelection | null {
  return current;
}

export function selectMockupSurface(selection: MockupSurfaceSelection): void {
  if (current?.frameId === selection.frameId && current.surfaceId === selection.surfaceId) {
    return;
  }
  current = selection;
  emit();
}

export function clearMockupSurfaceSelection(frameId?: NodeId): void {
  if (!current) return;
  if (frameId && current.frameId !== frameId) return;
  current = null;
  emit();
}

export function subscribeMockupSurfaceSelection(
  listener: (selection: MockupSurfaceSelection | null) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
