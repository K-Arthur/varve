/**
 * Resolve which selection-anchored quick-bar profile (if any) to show.
 *
 * Research basis: Canva / Figma contextual action bars — sparse, kind-specific
 * actions only where near-canvas affordances beat the inspector.
 */
import type { Document, NodeId, SceneNode, ShapeNode } from '@varve/scene';
import { isImageShape } from '@varve/scene';
import { isCapabilityRestricted } from '../../capabilities/restrictions';

export type QuickBarKind = 'image' | 'path' | 'text' | 'multi';

export type QuickBarActionId =
  | 'crop'
  | 'removeBg'
  | 'upscale'
  | 'vectorize'
  | 'flipH'
  | 'flipV'
  | 'fitCycle'
  | 'refineMask'
  | 'showOriginal'
  | 'cancelBg'
  | 'editNodes'
  | 'simplify'
  | 'closePath'
  | 'openPath'
  | 'editText'
  | 'group'
  | 'booleanUnion'
  | 'booleanSubtract'
  | 'booleanIntersect'
  | 'booleanExclude';

export interface QuickBarAction {
  id: QuickBarActionId;
  label: string;
}

export interface QuickBarProfile {
  kind: QuickBarKind;
  actions: QuickBarAction[];
  moreActions?: QuickBarAction[];
}

export interface ResolveQuickBarInput {
  document: Document;
  selection: NodeId[];
  tool: string;
  textEditTargetId?: string | null;
  showOriginalBgNodeId?: string | null;
  bgRemovalPending?: boolean;
  /** True when VariantBox is showing for a component instance. */
  suppressForVariant?: boolean;
}

const HIDE_TOOLS = new Set([
  'nodeEdit',
  'crop',
  'refineMask',
  'trimapEdit',
  'frame',
  'rect',
  'ellipse',
  'polygon',
  'star',
  'line',
  'arrow',
  'pen',
  'pencil',
  'text',
  'image',
  'slice',
  'hand',
  'zoom',
  'scale',
  'cloneStamp',
  'healBrush',
  'spotHeal',
  'patch',
  'eyedropper',
  'inspect',
  'booleanUnion',
  'booleanSubtract',
  'booleanIntersect',
  'booleanExclude',
]);

function action(id: QuickBarActionId, label: string): QuickBarAction {
  return { id, label };
}

function isBooleanableShape(node: SceneNode): node is ShapeNode {
  return node.kind === 'shape' && !isImageShape(node);
}

function imageProfile(node: ShapeNode, input: ResolveQuickBarInput): QuickBarProfile {
  // Background removal and Enhance are on-device inference; a deployment that
  // withholds it (the browser demo) must not offer the affordance at all.
  // Vectorize stays — image trace has a pure-WASM path that works anywhere.
  const inference = !isCapabilityRestricted('inference');
  const actions: QuickBarAction[] = [
    action('crop', 'Crop'),
    ...(inference ? [action('removeBg', 'Remove background'), action('upscale', 'Enhance')] : []),
    action('vectorize', 'Vectorize'),
    action('flipH', 'Flip horizontal'),
    action('flipV', 'Flip vertical'),
  ];
  const moreActions: QuickBarAction[] = [action('fitCycle', 'Cycle fit')];
  if (inference && node.backgroundRemoval?.maskDataUrl) {
    moreActions.push(action('refineMask', 'Refine mask'));
    const showingOriginal = input.showOriginalBgNodeId === node.id;
    moreActions.push(action('showOriginal', showingOriginal ? 'Hide original' : 'Show original'));
  }
  if (inference && input.bgRemovalPending) {
    moreActions.push(action('cancelBg', 'Cancel'));
  }
  return { kind: 'image', actions, moreActions };
}

function pathProfile(node: ShapeNode): QuickBarProfile {
  const closed = node.shape.kind === 'path' && node.shape.closed;
  const actions: QuickBarAction[] = [
    action('editNodes', 'Edit nodes'),
    action('simplify', 'Simplify'),
    action('flipH', 'Flip horizontal'),
    action('flipV', 'Flip vertical'),
    closed ? action('openPath', 'Open path') : action('closePath', 'Close path'),
  ];
  return { kind: 'path', actions };
}

function textProfile(): QuickBarProfile {
  return {
    kind: 'text',
    actions: [
      action('editText', 'Edit text'),
      action('flipH', 'Flip horizontal'),
      action('flipV', 'Flip vertical'),
    ],
  };
}

function multiProfile(nodes: SceneNode[]): QuickBarProfile {
  const actions: QuickBarAction[] = [action('group', 'Group')];
  if (nodes.length >= 2 && nodes.every(isBooleanableShape)) {
    actions.push(
      action('booleanUnion', 'Union'),
      action('booleanSubtract', 'Subtract'),
      action('booleanIntersect', 'Intersect'),
      action('booleanExclude', 'Exclude'),
    );
  }
  return { kind: 'multi', actions };
}

/** Map current selection + tool state to a quick-bar profile, or null to hide. */
export function resolveQuickBarProfile(input: ResolveQuickBarInput): QuickBarProfile | null {
  const { document: doc, selection, tool } = input;

  if (selection.length === 0) return null;
  if (HIDE_TOOLS.has(tool)) return null;
  if (input.suppressForVariant) return null;
  if (input.textEditTargetId) return null;

  if (selection.length >= 2) {
    const nodes = selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    if (nodes.length < 2) return null;
    return multiProfile(nodes);
  }

  const node = doc.nodes[selection[0]!];
  if (!node) return null;

  if (node.kind === 'shape' && isImageShape(node)) {
    return imageProfile(node, input);
  }
  if (node.kind === 'shape' && node.shape.kind === 'path') {
    return pathProfile(node);
  }
  if (node.kind === 'text') {
    return textProfile();
  }
  return null;
}
