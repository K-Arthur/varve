import type {
  AdjustmentNode,
  FrameNode,
  GroupNode,
  ImageNode,
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
  image: (node: ImageNode) => T;
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
    case 'image':
      return visitor.image(node as ImageNode);
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
export type PartialNodeVisitor<T> = Partial<NodeVisitor<T>>;

/** Visit with partial handler support + fallback. */
export function visitNodePartial<T>(
  node: SceneNode,
  visitor: PartialNodeVisitor<T>,
  fallback: (node: SceneNode) => T,
): T {
  const handler = visitor[node.kind as keyof NodeVisitor<T>];
  if (handler) return handler(node as any);
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
