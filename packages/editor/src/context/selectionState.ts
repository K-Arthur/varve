import type { NodeId } from '@varve/scene';

export type SelectionOrigin = 'canvas' | 'layers' | 'keyboard' | 'command' | 'api' | 'navigation';

export const DEFAULT_SELECTION_ORIGIN: SelectionOrigin = 'canvas';

export type SelectionMode = 'object' | 'direct' | 'path' | 'text' | 'pixel';

export interface SelectionTarget {
  nodeId: NodeId;
  kind: 'text' | 'path' | 'mask' | 'crop' | 'component';
  path?: NodeId[];
}

export function nextSelectionPrimary(
  currentSelection: NodeId[],
  nextSelection: NodeId[],
  currentPrimary: NodeId | null,
  toggledId: NodeId,
  additive: boolean,
): NodeId | null {
  if (nextSelection.length === 0) return null;
  if (!additive) return toggledId;
  if (currentSelection.includes(toggledId)) {
    return currentPrimary === toggledId ? nextSelection[0]! : currentPrimary;
  }
  return currentPrimary ?? nextSelection[0]!;
}

export function normalizeSelection(
  selection: NodeId[],
  docNodes: Record<string, unknown>,
): NodeId[] {
  const seen = new Set<NodeId>();
  const result: NodeId[] = [];
  for (const id of selection) {
    if (!docNodes[id]) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export interface ObjectResizePolicy {
  defaultProportional: boolean;
  defaultCentered: boolean;
  scaleChildrenWithFrame: boolean;
  preserveImageFill: boolean;
  preserveTextFontSize: boolean;
}

export const OBJECT_RESIZE_POLICIES: Record<string, ObjectResizePolicy> = {
  shape: {
    defaultProportional: false,
    defaultCentered: false,
    scaleChildrenWithFrame: false,
    preserveImageFill: true,
    preserveTextFontSize: true,
  },
  text: {
    defaultProportional: false,
    defaultCentered: false,
    scaleChildrenWithFrame: false,
    preserveImageFill: true,
    preserveTextFontSize: true,
  },
  frame: {
    defaultProportional: false,
    defaultCentered: false,
    scaleChildrenWithFrame: false,
    preserveImageFill: true,
    preserveTextFontSize: true,
  },
  group: {
    defaultProportional: true,
    defaultCentered: false,
    scaleChildrenWithFrame: true,
    preserveImageFill: true,
    preserveTextFontSize: false,
  },
  image: {
    defaultProportional: true,
    defaultCentered: false,
    scaleChildrenWithFrame: false,
    preserveImageFill: true,
    preserveTextFontSize: true,
  },
};
