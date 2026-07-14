/**
 * Mask resolution and CRUD operations for the scene graph.
 *
 * A mask is a property on a container (FrameNode, GroupNode, or AdjustmentNode)
 * that designates one of its children as a mask source. The mask type determines
 * how the child is used:
 *   - 'clip': the mask child's outline clips the container's other children
 *   - 'alpha': the mask child's alpha channel modulates the container's other children
 *   - 'luminance': the mask child's luminance (× alpha) modulates the container's
 *     other children per SVG mask spec
 *
 * All operations are pure (immutable Document pattern).
 *
 * Research basis: Figma mask model, Adobe Photoshop layer masks,
 * Affinity Designer pixel/vector masks, SVG <clipPath>/<mask> specs.
 */
import type { Affine } from '@strata/engine';
import type { Document } from './document';
import type { Mask, MaskType, NodeId, SceneNode } from './types';

// ── Resolution ──────────────────────────────────────────────────────────────

/** Return the effective mask for a container node, or null if no mask is set. */
export function resolveMask(node: SceneNode): Mask | null {
  if (node.kind !== 'frame' && node.kind !== 'group' && node.kind !== 'adjustment') {
    return null;
  }
  const container = node as SceneNode & { mask?: Mask; children?: string[] };
  if (!container.mask) return null;
  if (container.mask.visible === false) return null;
  // For frames and groups, the mask source must be a child.
  // For adjustment nodes, the mask source is an arbitrary node reference.
  if (
    node.kind !== 'adjustment' &&
    container.children &&
    !container.children.includes(container.mask.sourceNodeId)
  ) {
    return null;
  }
  return container.mask;
}

/** True if the container has an active (visible, valid) mask. */
export function isMasked(node: SceneNode): boolean {
  return resolveMask(node) !== null;
}

/** Return the effective mask type for a container, or null if no active mask. */
export function resolveMaskType(node: SceneNode): MaskType | null {
  const mask = resolveMask(node);
  return mask ? mask.type : null;
}

// ── Find / Validate ─────────────────────────────────────────────────────────

/**
 * Find all container node IDs whose mask references the given sourceNodeId.
 */
export function findNodesUsingMaskSource(doc: Document, sourceId: NodeId): NodeId[] {
  const result: NodeId[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    const n = node as SceneNode & { mask?: Mask };
    if (n.mask?.sourceNodeId === sourceId) {
      result.push(id as NodeId);
    }
  }
  return result;
}

/**
 * Check if a node is used as a mask source by any container.
 */
export function isMaskSource(doc: Document, sourceId: NodeId): boolean {
  return findNodesUsingMaskSource(doc, sourceId).length > 0;
}

/**
 * Validate that no mask references point to non-existent nodes.
 * Returns list of container NodeIds with dangling mask references.
 */
export function validateMasks(doc: Document): NodeId[] {
  const dangling: NodeId[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    const n = node as SceneNode & { mask?: Mask };
    if (n.mask?.sourceNodeId && !doc.nodes[n.mask.sourceNodeId]) {
      dangling.push(id as NodeId);
    }
  }
  return dangling;
}

/**
 * Remove mask references to the given source node from all container nodes.
 * Returns a new Document with the masks cleared.
 */
export function clearMaskSource(doc: Document, sourceId: NodeId): Document {
  let nodes = { ...doc.nodes };
  for (const [id, node] of Object.entries(nodes)) {
    const n = node as SceneNode & { mask?: Mask };
    if (n.mask?.sourceNodeId === sourceId) {
      const { mask: _unused, ...rest } = n;
      nodes = { ...nodes, [id]: rest as SceneNode };
    }
  }
  return { ...doc, nodes };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isContainerNode(node: SceneNode): node is SceneNode & { mask?: Mask; children: string[] } {
  return node.kind === 'frame' || node.kind === 'group' || node.kind === 'adjustment';
}

/**
 * Returns true if the node can own a mask.
 * ShapeNode, TextNode, and PathNode cannot own masks directly (they must be
 * inside a container that has a mask).
 */
export function canNodeHaveMask(node: SceneNode): boolean {
  return isContainerNode(node);
}

// ── CRUD Operations ─────────────────────────────────────────────────────────

const VALID_MASK_TYPES: MaskType[] = ['clip', 'alpha', 'luminance'];

/**
 * Add a mask to a container node.
 *
 * @param doc - The document
 * @param containerId - The container node ID (frame, group, or adjustment)
 * @param sourceNodeId - The child node ID to use as mask source
 * @param type - The mask type ('clip', 'alpha', or 'luminance')
 * @param opts - Optional mask properties (inverted, feather, density, linked, visible, transform)
 * @returns A new document with the mask added, or the same document if invalid
 */
export function addMask(
  doc: Document,
  containerId: NodeId,
  sourceNodeId: NodeId,
  type: MaskType,
  opts?: {
    inverted?: boolean;
    feather?: number;
    density?: number;
    linked?: boolean;
    visible?: boolean;
    transform?: Affine;
    hideMaskSource?: boolean;
  },
): Document {
  const container = doc.nodes[containerId];
  if (!container) return doc;
  if (!isContainerNode(container)) return doc;
  if (!VALID_MASK_TYPES.includes(type)) return doc;

  // Source must exist
  if (!doc.nodes[sourceNodeId]) return doc;

  // Source must be a child of the container (frames and groups only)
  if (container.kind !== 'adjustment') {
    const children = container.children;
    if (children && !children.includes(sourceNodeId)) return doc;
  }

  const mask: Mask = {
    type,
    sourceNodeId,
    visible: opts?.visible ?? true,
    inverted: opts?.inverted,
    feather: opts?.feather,
    density: opts?.density,
    linked: opts?.linked,
    transform: opts?.transform,
    hideMaskSource: opts?.hideMaskSource,
  };

  // Clean undefined values
  const cleaned: Mask = { type: mask.type, sourceNodeId: mask.sourceNodeId, visible: mask.visible };
  if (mask.inverted) cleaned.inverted = true;
  if (mask.feather !== undefined && mask.feather > 0) cleaned.feather = mask.feather;
  if (mask.density !== undefined && mask.density < 1) cleaned.density = mask.density;
  if (mask.linked === false) cleaned.linked = false;
  if (mask.transform) cleaned.transform = mask.transform;
  if (mask.hideMaskSource) cleaned.hideMaskSource = true;

  const nodes = {
    ...doc.nodes,
    [containerId]: { ...container, mask: cleaned } as SceneNode,
  };

  return { ...doc, nodes };
}

/**
 * Remove the mask from a container node.
 * Does not remove the mask source node itself.
 *
 * @returns A new document with the mask removed, or the same document if no mask existed.
 */
export function removeMask(doc: Document, containerId: NodeId): Document {
  const container = doc.nodes[containerId];
  if (!container) return doc;
  if (!isContainerNode(container)) return doc;
  if (!container.mask) return doc;

  const { mask: _unused, ...rest } = container;
  const nodes = {
    ...doc.nodes,
    [containerId]: rest as SceneNode,
  };

  return { ...doc, nodes };
}

/**
 * Update a specific property on a container's mask.
 * Returns the same document if no mask exists or the value is unchanged.
 */
function updateMaskProperty<T>(
  doc: Document,
  containerId: NodeId,
  key: string,
  value: T | undefined,
  shouldInclude?: (value: T | undefined) => boolean,
): Document {
  const container = doc.nodes[containerId];
  if (!container) return doc;
  if (!isContainerNode(container)) return doc;
  if (!container.mask) return doc;

  const include = shouldInclude ? shouldInclude(value) : value !== undefined;
  const cleaned: Mask = include
    ? ({ ...container.mask, [key]: value } as Mask)
    : (() => {
        const { [key]: _removed, ...rest } = container.mask as unknown as Record<string, unknown>;
        return rest as unknown as Mask;
      })();

  const nodes = {
    ...doc.nodes,
    [containerId]: { ...container, mask: cleaned } as SceneNode,
  };

  return { ...doc, nodes };
}

/** Toggle mask visibility. */
export function setMaskVisible(doc: Document, containerId: NodeId, visible: boolean): Document {
  return updateMaskProperty(doc, containerId, 'visible', visible);
}

/** Toggle mask inversion. */
export function setMaskInverted(doc: Document, containerId: NodeId, inverted: boolean): Document {
  return updateMaskProperty(doc, containerId, 'inverted', inverted || undefined, (v) => !!v);
}

/** Set mask feather radius in world-space pixels (0 to remove feather). */
export function setMaskFeather(doc: Document, containerId: NodeId, feather: number): Document {
  const clamped = Math.max(0, feather);
  return updateMaskProperty(doc, containerId, 'feather', clamped > 0 ? clamped : undefined, (v) => {
    return (v as number) > 0;
  });
}

/** Set mask density (0-1). 1 = full effect, 0 = no effect. */
export function setMaskDensity(doc: Document, containerId: NodeId, density: number): Document {
  const clamped = Math.max(0, Math.min(1, density));
  return updateMaskProperty(doc, containerId, 'density', clamped < 1 ? clamped : undefined, (v) => {
    return (v as number) < 1;
  });
}

/** Toggle whether the mask is linked to its container transform. */
export function setMaskLinked(doc: Document, containerId: NodeId, linked: boolean): Document {
  return updateMaskProperty(
    doc,
    containerId,
    'linked',
    linked ? undefined : false,
    (v) => v === false,
  );
}

/** Set the independent mask transform (only meaningful when linked === false). */
export function setMaskTransform(
  doc: Document,
  containerId: NodeId,
  transform: Affine | undefined,
): Document {
  return updateMaskProperty(doc, containerId, 'transform', transform, (v) => v !== undefined);
}

/** Change the mask type ('clip', 'alpha', or 'luminance'). */
export function setMaskType(doc: Document, containerId: NodeId, type: MaskType): Document {
  if (!VALID_MASK_TYPES.includes(type)) return doc;
  return updateMaskProperty(doc, containerId, 'type', type);
}

/** Toggle whether the mask source node is hidden from direct rendering. */
export function setMaskHideSource(
  doc: Document,
  containerId: NodeId,
  hideSource: boolean,
): Document {
  return updateMaskProperty(
    doc,
    containerId,
    'hideMaskSource',
    hideSource || undefined,
    (v) => !!v,
  );
}

/** Change the mask source node (must be a child of the container). */
export function setMaskSourceNode(
  doc: Document,
  containerId: NodeId,
  sourceNodeId: NodeId,
): Document {
  const container = doc.nodes[containerId];
  if (!container) return doc;
  if (!isContainerNode(container)) return doc;
  if (!container.mask) return doc;

  if (!doc.nodes[sourceNodeId]) return doc;
  // For frames and groups, source must be a child
  if (container.kind !== 'adjustment') {
    const children = container.children;
    if (children && !children.includes(sourceNodeId)) return doc;
  }

  return updateMaskProperty(doc, containerId, 'sourceNodeId', sourceNodeId);
}
