import type {
  AdjustmentNode,
  FrameNode,
  GroupNode,
  PathNode,
  SceneNode,
  ShapeNode,
  TextNode,
} from './types';

/** Visitor pattern for SceneNode — ensures all node kinds are handled. */
export type NodeVisitor<T> = {
  shape: (node: ShapeNode) => T;
  text: (node: TextNode) => T;
  group: (node: GroupNode) => T;
  frame: (node: FrameNode) => T;
  adjustment: (node: AdjustmentNode) => T;
  path: (node: PathNode) => T;
};

/** Visit a SceneNode with type-safe dispatch. */
export function visitNode<T>(node: SceneNode, visitor: NodeVisitor<T>): T {
  switch (node.kind) {
    case 'shape':
      return visitor.shape(node as ShapeNode);
    case 'text':
      return visitor.text(node as TextNode);
    case 'group':
      return visitor.group(node as GroupNode);
    case 'frame':
      return visitor.frame(node as FrameNode);
    case 'adjustment':
      return visitor.adjustment(node as AdjustmentNode);
    case 'path':
      return visitor.path(node as PathNode);
    default: {
      const _exhaustive: never = node;
      throw new Error(`Unhandled node kind: ${(_exhaustive as SceneNode).kind}`);
    }
  }
}

/** Partial visitor — provide only the handlers you need. */
export type PartialNodeVisitor<T> = Partial<NodeVisitor<T>> & {
  /** @deprecated ImageNode no longer exists; use shape with image fill. */
  image?: (node: ShapeNode) => never;
};

/** Visit with partial handler support + fallback. */
export function visitNodePartial<T>(
  node: SceneNode,
  visitor: PartialNodeVisitor<T>,
  fallback: (node: SceneNode) => T,
): T {
  switch (node.kind) {
    case 'shape':
      return visitor.shape ? visitor.shape(node) : fallback(node);
    case 'text':
      return visitor.text ? visitor.text(node) : fallback(node);
    case 'frame':
      return visitor.frame ? visitor.frame(node) : fallback(node);
    case 'group':
      return visitor.group ? visitor.group(node) : fallback(node);
    case 'adjustment':
      return visitor.adjustment ? visitor.adjustment(node) : fallback(node);
  }
  return fallback(node);
}

/**
 * Type guard that checks if a node is a specific kind.
 * Like `node.kind === 'frame'` but with proper type narrowing.
 */
export function isKind<K extends SceneNode['kind']>(
  node: SceneNode,
  kind: K,
): node is Extract<SceneNode, { kind: K }> {
  return node.kind === kind;
}

/**
 * Map over node properties with kind-specific handlers.
 * Returns the unmodified node if no handler matches.
 */
export function mapNode(node: SceneNode, mapper: PartialNodeVisitor<SceneNode>): SceneNode {
  return visitNodePartial(node, mapper, () => node);
}
