/**
 * Immutable scene Document + operations (Strata plan §3.1, §9).
 *
 * Operations return a new Document (structural sharing where practical). The
 * root is an ordered list of node ids; nodes live in a map. Paint order within
 * siblings is the array order; reorder via `moveNode` / `moveChild`.
 *
 * Container types: FrameNode + GroupNode (via `isContainer`/`getChildren`).
 * Reparent, group/ungroup, and detach-instance ops are available.
 * `walkNodes` recurses into both frame and group children.
 *
 * Ordering is array-index for the local-first editor (sufficient without sync).
 * CRDT-safe fractional ordering replaces it when sync lands (Phase 2, plan §1.1).
 */
import type { Affine, Shape } from '@strata/engine';
import type { DocumentUnit } from '@strata/shared';
import { generateKeyBetween } from '@strata/shared';
import { stripBindingForVariable } from './bindings';
import { deepCloneSubtree } from './clone';
import type {
  BleedConfig,
  ColorConfig,
  ColorSwatch,
  ManagedColor,
  SafeAreaConfig,
  SlugConfig,
  SpotColorDef,
} from './colorManagement';
import { captureSyncBaseline, detectOverrides } from './component-sync';
import type { ExportSettings } from './export-types';
import type {
  ComponentDefinition,
  ContainerNode,
  FrameNode,
  GroupNode,
  LayerColor,
  NodeId,
  Page,
  PathNode,
  SceneNode,
  ShapeNode,
  Style,
  TextNode,
} from './types';
import type { Variable } from './variables';
import { createVariableStore, deleteVariable } from './variables';
import { CURRENT_DOCUMENT_VERSION } from './version';

export interface Document {
  id: string;
  name: string;
  /** Schema version for migration (set by createDocument / migrateDocument). */
  formatVersion: string;
  /** Root-level node ids in paint order. */
  rootChildren: NodeId[];
  nodes: Record<NodeId, SceneNode>;
  /** Registered component definitions keyed by component id (task 1.1). */
  components: Record<NodeId, ComponentDefinition>;
  /** Monotonic counter for id generation. */
  nextId: number;
  /** Canvas width in px (artboard/frame size). */
  canvasWidth?: number;
  /** Canvas height in px (artboard/frame size). */
  canvasHeight?: number;
  /** Canvas background color (RGBA). */
  canvasBackground?: ManagedColor;
  /** Per-document export defaults (optional — falls back to ExportSettings globals). */
  exportDefaults?: Partial<ExportSettings>;
  /** Reusable styles keyed by style id (color, text, effect, layout). */
  styles?: Record<string, Style>;
  /** Persisted variable store with collections and modes. */
  variableStore?: import('./variables').VariableStore;
  /** References to installed libraries. */
  installedLibraries?: import('./library').InstalledLibraryRef[];
  /** Layout guides for aligning nodes on the canvas. */
  guides?: import('./types').Guide[];
  /** Pages (v1.2+). When unset, the document is in flat (pre-page) mode. */
  pages?: Page[];
  /** State machines for prototype interactions (v1.3). */
  stateMachines?: Record<string, import('./state-machine-types').StateMachine>;

  /** ID of the currently active page. Undefined for single-page documents. */
  activePageId?: NodeId;

  /** Node IDs of layers shared across all pages (visible on every page). */
  globalChildren?: NodeId[];

  // ── Print production properties (v1.1) ────────────────────────────────────

  /** Document color management configuration. */
  colorConfig?: ColorConfig;
  /** Document's display unit for measurements (px, pt, mm, cm, in, pc). */
  documentUnit?: DocumentUnit;
  /** Physical width in document units (e.g., 210 for A4 in mm). */
  physicalWidth?: number;
  /** Physical height in document units (e.g., 297 for A4 in mm). */
  physicalHeight?: number;
  /** DPI for print resolution (0 = screen/undefined). */
  dpi?: number;
  /** Bleed configuration. */
  bleed?: BleedConfig;
  /** Safe area / margin configuration. */
  safeArea?: SafeAreaConfig;
  /** Slug area configuration. */
  slug?: SlugConfig;
  /** Global color swatches. */
  swatches?: ColorSwatch[];
  /** Spot color definitions. */
  spotColors?: SpotColorDef[];

  // ── Motion / Animation properties (v1.2+) ─────────────────────────────────

  /** Named timelines for per-node property animation. */
  timelines?: Record<string, import('./motion-types').Timeline>;
  /** The currently active timeline for playback. */
  activeTimelineId?: string;

  /** Prototype interactions keyed by node id (v1.6). */
  interactions?: Record<NodeId, import('./interaction-types').DocumentInteraction[]>;

  /** Phase 5+ motion extensions (skeleton, IK, mesh deform). */
  motionExtensions?: Record<string, import('./motion-types').MotionExtension>;
  /** Reusable motion presets captured from timelines. */
  motionPresets?: Record<string, import('./motion-types').MotionPreset>;

  // ── Typography: Linked text frames (v1.7) ───────────────────────────────────

  /** Text flow chains for linked text frames. */
  textChains?: Record<string, import('./typography').TextChain>;
}

export interface NodeEntry {
  nodeId: NodeId;
  node: SceneNode;
  parentId: NodeId | null;
  /** Recursive depth (0 for root-level). */
  depth: number;
}

export function createDocument(name?: string, flat?: boolean): Document;
export function createDocument(name = 'Untitled', flat?: boolean): Document {
  const base: Document = {
    id: cryptoId(),
    formatVersion: CURRENT_DOCUMENT_VERSION,
    name,
    rootChildren: [],
    nodes: {},
    components: {},
    nextId: 1,
  };

  if (flat) {
    // Flat document: no pages, just root-level nodes
    return base;
  }

  // Create a default page with a contentRoot group
  const { id: contentRootId, doc: d1 } = nextNodeId(base);
  const contentRoot = makeGroupNode(contentRootId, {
    name: 'Page 1 content',
    children: [],
  });

  const page: Page = {
    id: cryptoId(),
    name: 'Page 1',
    width: 1920,
    height: 1080,
    backgrounds: [],
    contentRoot: contentRootId,
  };

  return {
    ...d1,
    activePageId: page.id,
    globalChildren: [],
    pages: [page],
    rootChildren: [contentRootId],
    nodes: { ...d1.nodes, [contentRootId]: contentRoot },
  };
}

function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `doc-${Math.random().toString(36).slice(2)}`;
}

/** Allocate the next stable node id from the document's counter. */
export function nextNodeId(doc: Document): { id: NodeId; doc: Document } {
  const id = `n${doc.nextId}`;
  return { id, doc: { ...doc, nextId: doc.nextId + 1 } };
}

export function makeAdjustmentNode(
  id: NodeId,
  adjustmentType: import('./types').AdjustmentType,
  params: import('./types').AdjustmentParams,
  opts: Partial<
    Pick<
      import('./types').AdjustmentNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'clipping'
      | 'effects'
      | 'order'
    >
  > = {},
): import('./types').AdjustmentNode {
  return {
    id,
    kind: 'adjustment',
    name: opts.name ?? adjustmentType.charAt(0).toUpperCase() + adjustmentType.slice(1),
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    fill: opts.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    adjustmentType,
    params,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    clipping: opts.clipping ?? false,
    effects: opts.effects ?? [],
  };
}

export function makeShapeNode(
  id: NodeId,
  shape: Shape,
  opts: Partial<
    Pick<
      ShapeNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'cornerRadius'
      | 'order'
    >
  > = {},
): ShapeNode {
  return {
    id,
    kind: 'shape',
    name: opts.name ?? 'Shape',
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    shape,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
    cornerRadius: opts.cornerRadius,
  };
}

export function makeTextNode(
  id: NodeId,
  text: string,
  opts: Partial<
    Pick<
      TextNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'fontSize'
      | 'fontFamily'
      | 'fontWeight'
      | 'fontStyle'
      | 'lineHeight'
      | 'letterSpacing'
      | 'textAlign'
      | 'textCase'
      | 'textDecoration'
      | 'textAlignVertical'
      | 'textOverflow'
      | 'textResizing'
      | 'listStyle'
      | 'paragraphSpacing'
      | 'openTypeFeatures'
      | 'variableAxes'
      | 'richText'
      | 'textMode'
      | 'pathTextSettings'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'order'
    >
  > = {},
): TextNode {
  return {
    id,
    kind: 'text',
    name: opts.name ?? 'Text',
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: true,
    locked: false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    text,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? { space: 'rgb', r: 16, g: 21, b: 31, a: 255 },
    fontSize: opts.fontSize ?? 16,
    fontFamily: opts.fontFamily ?? 'Inter',
    fontWeight: opts.fontWeight ?? 400,
    fontStyle: opts.fontStyle ?? 'normal',
    lineHeight: opts.lineHeight ?? 1.2,
    letterSpacing: opts.letterSpacing ?? 0,
    textAlign: opts.textAlign ?? 'left',
    textCase: opts.textCase,
    textDecoration: opts.textDecoration,
    textAlignVertical: opts.textAlignVertical,
    textOverflow: opts.textOverflow,
    textResizing: opts.textResizing,
    listStyle: opts.listStyle,
    paragraphSpacing: opts.paragraphSpacing,
    openTypeFeatures: opts.openTypeFeatures,
    variableAxes: opts.variableAxes,
    richText: opts.richText,
    textMode: opts.textMode,
    pathTextSettings: opts.pathTextSettings,
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
  };
}

export function makeGroupNode(
  id: NodeId,
  opts: Partial<
    Pick<
      GroupNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'children'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'order'
      | 'isolated'
      | 'effects'
    >
  > = {},
): GroupNode {
  return {
    id,
    kind: 'group',
    name: opts.name ?? 'Group',
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    children: opts.children ?? [],
    isolated: opts.isolated,
    effects: opts.effects ?? [],
  };
}

export function makeFrameNode(
  id: NodeId,
  opts: Partial<
    Pick<
      FrameNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'children'
      | 'componentId'
      | 'slots'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'order'
      | 'w'
      | 'h'
      | 'clipContent'
      | 'variant'
      | 'propertyOverrides'
      | 'syncBaseline'
    >
  > = {},
): FrameNode {
  return {
    id,
    kind: 'frame',
    name: opts.name ?? 'Frame',
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
    w: opts.w ?? 200,
    h: opts.h ?? 160,
    children: opts.children ?? [],
    componentId: opts.componentId,
    slots: opts.slots,
    clipContent: opts.clipContent,
    variant: opts.variant,
    propertyOverrides: opts.propertyOverrides,
    syncBaseline: opts.syncBaseline,
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
  };
}

/**
 * Canonical factory for creating a shape node with an image fill.
 * Replaces the deprecated makeImageNode.
 */
export function makeImageShapeNode(
  id: NodeId,
  opts: Partial<
    Pick<
      ShapeNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'order'
      | 'cornerRadius'
    >
  > & {
    /** Image source URL (data URL, file path, or asset id). */
    src?: string;
    /** Width of the image area in world-space px. */
    w?: number;
    /** Height of the image area in world-space px. */
    h?: number;
    /** How the image fills the bounds. */
    imageFit?: import('./types').ImageFit;
  } = {},
): ShapeNode {
  const w = opts.w ?? 100;
  const h = opts.h ?? 100;
  return {
    id,
    kind: 'shape',
    name: opts.name ?? 'Image',
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    shape: { kind: 'rect', x: 0, y: 0, w, h } as Shape,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    fills: [
      {
        type: 'image',
        image: { src: opts.src ?? '', fit: opts.imageFit ?? 'fill', x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
    cornerRadius: opts.cornerRadius,
  };
}

/** @deprecated Use makeImageShapeNode. */
export const makeImageNode = makeImageShapeNode;

export function makePathNode(
  id: NodeId,
  opts: Partial<
    Pick<
      PathNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'order'
      | 'points'
      | 'closed'
    >
  > = {},
): PathNode {
  return {
    id,
    kind: 'path',
    name: opts.name ?? 'Path',
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 1 },
    points: opts.points ?? [],
    closed: opts.closed ?? false,
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
  };
}

/**
 * Walk nodes in paint order (DFS), yielding each with its parent info.
 *
 * `startIds` defaults to `doc.rootChildren`, which spans every page's
 * contentRoot in the document (each page's shapes are appended there by
 * `addPage`) — the right choice for whole-document operations (e.g.
 * "fit all pages"), but wrong for anything that renders or hit-tests what's
 * currently on screen. Callers scoped to the active page should pass
 * `activePageNodes(doc)` instead.
 */
export function walkNodes(doc: Document, startIds?: NodeId[]): Map<NodeId, NodeEntry> {
  const entries = new Map<NodeId, NodeEntry>();
  function walk(parentId: NodeId | null, ids: NodeId[], depth: number) {
    for (const nid of ids) {
      const node = doc.nodes[nid];
      if (!node) continue;
      entries.set(nid, { nodeId: nid, node, parentId, depth });
      if (isContainer(node) && node.children.length > 0) {
        walk(nid, node.children, depth + 1);
      }
    }
  }
  walk(null, startIds ?? doc.rootChildren, 0);
  return entries;
}

/** Find the parent that contains the given node id. O(n) — fine for editor scale. */
export function getParent(doc: Document, id: NodeId): NodeId | null {
  if (doc.rootChildren.includes(id)) return null;
  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (isContainer(node) && node.children.includes(id)) return nid as NodeId;
  }
  return null;
}

/**
 * Build a parent-index map for O(1) parent lookups.
 *
 * Single-pass O(n) over all nodes: for each container node, maps every child
 * id to the container id. Root-level nodes (with no parent) are not included.
 *
 * Useful for fast ancestor-chain traversal in the render loop, where calling
 * `getParent` (O(n) per call) for each level of a deep tree adds up.
 */
export function buildParentIndexMap(doc: Document): Map<NodeId, NodeId> {
  const parents = new Map<NodeId, NodeId>();
  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (isContainer(node as SceneNode)) {
      for (const childId of (node as ContainerNode).children) {
        parents.set(childId, nid as NodeId);
      }
    }
  }
  return parents;
}

/** True if the node is a container (has a children array). */
export function isContainer(node: SceneNode): node is ContainerNode {
  return node.kind === 'frame' || node.kind === 'group';
}

/**
 * Check if a node is within the isolated subtree.
 *
 * Walks up the ancestor chain from the candidate node to see if it eventually
 * reaches the isolated root. Returns true if the candidate is the isolated root
 * itself or any of its descendants.
 *
 * @param candidateId - The node to check
 * @param isolatedNodeId - The root of the isolated subtree
 * @param doc - The document
 * @returns true if candidate is in the isolated subtree
 */
export function isInIsolatedSubtree(
  candidateId: NodeId,
  isolatedNodeId: NodeId | null,
  doc: Document,
): boolean {
  if (!isolatedNodeId) return true; // No isolation active
  if (candidateId === isolatedNodeId) return true; // Is the isolated root itself

  // Walk up the ancestor chain
  let currentId: NodeId | null = candidateId;
  const visited = new Set<NodeId>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    if (currentId === isolatedNodeId) return true;
    currentId = getParent(doc, currentId);
  }
  return false;
}

/** Get the children array of a container node, or null if not a container. */
export function getChildren(doc: Document, id: NodeId): NodeId[] | null {
  const node = doc.nodes[id];
  if (!node || !isContainer(node)) return null;
  return node.children;
}

/** Append a node to the root paint order. */
export function addNode(doc: Document, node: SceneNode): Document {
  const index = doc.rootChildren.length;
  const prev = index > 0 ? doc.nodes[doc.rootChildren[index - 1]!] : null;
  const order = generateKeyBetween(prev?.order ?? null, null);
  const indexed = { ...node, index, order };
  return {
    ...doc,
    rootChildren: [...doc.rootChildren, node.id],
    nodes: { ...doc.nodes, [node.id]: indexed },
  };
}

/** Insert a node at a specific paint-order index in the root. */
export function insertNode(doc: Document, node: SceneNode, atIndex: number): Document {
  const next = [...doc.rootChildren];
  const clamped = Math.max(0, Math.min(atIndex, next.length));
  next.splice(clamped, 0, node.id);
  const prev = clamped > 0 ? doc.nodes[next[clamped - 1]!] : null;
  const succ = clamped < next.length - 1 ? doc.nodes[next[clamped + 1]!] : null;
  const order = generateKeyBetween(prev?.order ?? null, succ?.order ?? null);
  const nodes = { ...doc.nodes, [node.id]: { ...node, order } };
  return { ...doc, rootChildren: next, nodes };
}

/** Add a child to a container (FrameNode or GroupNode). Optionally fills a slot (frame only). */
export function addChild(
  doc: Document,
  parentId: NodeId,
  child: SceneNode,
  slotId?: string,
): Document {
  const parent = doc.nodes[parentId];
  if (!parent || !isContainer(parent)) return doc;
  const children = parent.children;
  const lastChildId = children.length > 0 ? children[children.length - 1]! : null;
  const lastChild = lastChildId ? doc.nodes[lastChildId] : null;
  const order = generateKeyBetween(lastChild?.order ?? null, null);
  const indexed = { ...child, order };
  const newChildren = [...children, child.id];
  const updated = { ...parent, children: newChildren } as SceneNode;
  if ('slots' in parent && slotId) {
    (updated as FrameNode).slots = { ...(parent.slots ?? {}), [slotId]: child.id };
  } else if ('slots' in parent && slotId === undefined) {
    (updated as FrameNode).slots = parent.slots;
  }
  const result = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [parentId]: updated,
      [child.id]: indexed,
    },
  };
  devValidate(result);
  return result;
}

/** Remove a node from the document (nested-aware). Recursively removes descendants. */
export function removeNode(doc: Document, id: NodeId): Document {
  if (!doc.nodes[id]) return doc;

  let nodes = { ...doc.nodes };

  // Collect all descendants to remove
  const toRemove = new Set<NodeId>();
  function collect(nid: NodeId) {
    if (toRemove.has(nid)) return;
    toRemove.add(nid);
    const n = nodes[nid];
    if (n && isContainer(n)) {
      for (const cId of n.children) collect(cId);
    }
  }
  collect(id);

  // Remove from parent's children list
  const parentId = getParent(doc, id);
  let rootChildren = doc.rootChildren;
  if (parentId) {
    const parent = nodes[parentId] as SceneNode | undefined;
    if (parent && isContainer(parent)) {
      const newParentChildren = parent.children.filter((c) => !toRemove.has(c));
      const updated = { ...parent, children: newParentChildren } as SceneNode;
      if ('slots' in parent && parent.slots) {
        const filteredSlots = Object.fromEntries(
          Object.entries(parent.slots).filter(([_, v]) => !toRemove.has(v)),
        );
        (updated as FrameNode).slots =
          Object.keys(filteredSlots).length > 0 ? filteredSlots : undefined;
      }
      nodes[parentId] = updated;
    }
  } else {
    rootChildren = doc.rootChildren.filter((x) => !toRemove.has(x));
  }

  // Clear mask references that point to any removed node
  for (const removedId of toRemove) {
    for (const [id, nodeEntry] of Object.entries(nodes)) {
      const n = nodeEntry as SceneNode & { mask?: import('./types').Mask };
      if (n.mask?.sourceNodeId === removedId) {
        const { mask: _unused, ...rest } = n;
        nodes = { ...nodes, [id]: rest as SceneNode };
      }
    }
  }

  // Delete all collected nodes
  for (const nid of toRemove) {
    delete nodes[nid];
  }

  const result = { ...doc, rootChildren, nodes };
  devValidate(result);
  return result;
}

/** Move a root-level node to a new paint-order index. Also updates `order` field. */
export function moveNode(doc: Document, id: NodeId, toIndex: number): Document {
  const from = doc.rootChildren.indexOf(id);
  if (from < 0) return doc;
  const next = [...doc.rootChildren];
  next.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, id);
  const node = doc.nodes[id];
  if (!node) return doc;
  const nodes = { ...doc.nodes };
  const prev = clamped > 0 ? doc.nodes[next[clamped - 1]!] : null;
  const succ = clamped < next.length - 1 ? doc.nodes[next[clamped + 1]!] : null;
  const newOrder = generateKeyBetween(prev?.order ?? null, succ?.order ?? null);
  nodes[id] = { ...node, order: newOrder } as SceneNode;
  return { ...doc, rootChildren: next, nodes };
}

export type ArrangeOp = 'front' | 'back' | 'forward' | 'backward';

/**
 * Arrange a node within its current parent's sibling list.
 * 'front'/'back' move to the end/start (highest/lowest paint order).
 * 'forward'/'backward' step one position toward the end/start.
 * No-op when the node is already at the boundary or not found.
 */
export function arrangeNode(doc: Document, id: NodeId, op: ArrangeOp): Document {
  const parentId = getParent(doc, id);
  if (parentId) {
    const parent = doc.nodes[parentId];
    if (!parent || !isContainer(parent)) return doc;
    const siblings = parent.children;
    const from = siblings.indexOf(id);
    if (from < 0) return doc;
    let to: number;
    switch (op) {
      case 'front':
        to = siblings.length - 1;
        break;
      case 'back':
        to = 0;
        break;
      case 'forward':
        to = from + 1;
        break;
      case 'backward':
        to = from - 1;
        break;
    }
    if (to === from || to < 0 || to >= siblings.length) return doc;
    return moveChild(doc, parentId, id, to);
  } else {
    const siblings = doc.rootChildren;
    const from = siblings.indexOf(id);
    if (from < 0) return doc;
    let to: number;
    switch (op) {
      case 'front':
        to = siblings.length - 1;
        break;
      case 'back':
        to = 0;
        break;
      case 'forward':
        to = from + 1;
        break;
      case 'backward':
        to = from - 1;
        break;
    }
    if (to === from || to < 0 || to >= siblings.length) return doc;
    return moveNode(doc, id, to);
  }
}

/** Move a nested child within its parent's children array. Also updates `order` field. */
export function moveChild(doc: Document, parentId: NodeId, id: NodeId, toIndex: number): Document {
  const parent = doc.nodes[parentId];
  if (!parent || !isContainer(parent)) return doc;
  const from = parent.children.indexOf(id);
  if (from < 0) return doc;
  const newChildren = [...parent.children];
  newChildren.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, newChildren.length));
  newChildren.splice(clamped, 0, id);
  const node = doc.nodes[id];
  if (!node) return doc;
  const nodes = { ...doc.nodes };
  const prev = clamped > 0 ? doc.nodes[newChildren[clamped - 1]!] : null;
  const succ = clamped < newChildren.length - 1 ? doc.nodes[newChildren[clamped + 1]!] : null;
  const newOrder = generateKeyBetween(prev?.order ?? null, succ?.order ?? null);
  nodes[id] = { ...node, order: newOrder } as SceneNode;
  nodes[parentId] = { ...parent, children: newChildren } as SceneNode;
  return { ...doc, nodes };
}

export function setSnapExcluded(doc: Document, id: NodeId, excluded: boolean): Document {
  const n = doc.nodes[id];
  if (!n) return doc;
  return { ...doc, nodes: { ...doc.nodes, [id]: { ...n, snapExcluded: excluded } } };
}

export function setLayerColor(doc: Document, id: NodeId, color: LayerColor | null): Document {
  const node = doc.nodes[id];
  if (!node) return doc;
  return { ...doc, nodes: { ...doc.nodes, [id]: { ...node, layerColor: color } } };
}

export function setBackgroundRemoval(
  doc: Document,
  id: NodeId,
  state: import('./types').BackgroundRemovalState | undefined,
): Document {
  const node = doc.nodes[id];
  if (!node) return doc;
  // Supported on ShapeNode (shape with image fill) only
  if (node.kind !== 'shape') return doc;
  return { ...doc, nodes: { ...doc.nodes, [id]: { ...node, backgroundRemoval: state } } };
}

export function renameNode(doc: Document, id: NodeId, name: string): Document {
  const node = doc.nodes[id];
  if (!node) return doc;
  return { ...doc, nodes: { ...doc.nodes, [id]: { ...node, name } } };
}

export function getById(doc: Document, id: NodeId): SceneNode | undefined {
  return doc.nodes[id];
}

/** Convenience: list root nodes in paint order. */
export function rootNodes(doc: Document): SceneNode[] {
  return doc.rootChildren.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
}

/**
 * Reparent a node from its current parent to a new parent (or root).
 * Validates: newParent is a container, node is not its own ancestor.
 * Removes from old parent, inserts into new parent — all in one atomic op.
 *
 * If `localTransform` is provided, it replaces the node's transform in the
 * new position (used by the editor to preserve world position when the old
 * and new parents have different transforms). Otherwise the node's current
 * transform is kept verbatim (legacy behaviour that causes a world-position
 * jump when parents differ).
 */
export function reparentNode(
  doc: Document,
  id: NodeId,
  newParentId: NodeId | null,
  toIndex: number,
  localTransform?: Affine,
): Document {
  const node = doc.nodes[id];
  if (!node) return doc;

  // Validate new parent
  if (newParentId) {
    const newParent = doc.nodes[newParentId];
    if (!newParent || !isContainer(newParent)) return doc;
    if (isAncestor(doc, id, newParentId)) return doc;
  }

  const nodes = { ...doc.nodes };

  // Remove from old parent
  const oldParentId = getParent(doc, id);
  let rootChildren = [...doc.rootChildren];
  if (oldParentId) {
    const oldParent = nodes[oldParentId] as SceneNode | undefined;
    if (oldParent && isContainer(oldParent)) {
      const updated = {
        ...oldParent,
        children: oldParent.children.filter((c) => c !== id),
      } as SceneNode;
      if ('slots' in oldParent && oldParent.slots) {
        const filteredSlots = Object.fromEntries(
          Object.entries(oldParent.slots).filter(([_, v]) => v !== id),
        );
        (updated as FrameNode).slots =
          Object.keys(filteredSlots).length > 0 ? filteredSlots : undefined;
      }
      nodes[oldParentId] = updated;
    }
  } else {
    rootChildren = rootChildren.filter((x) => x !== id);
  }

  // Generate order key at the insertion position.
  const generateOrder = (siblings: NodeId[], pos: number): string => {
    const prev = pos > 0 ? doc.nodes[siblings[pos - 1]!] : null;
    const succ = pos < siblings.length - 1 ? doc.nodes[siblings[pos + 1]!] : null;
    return generateKeyBetween(prev?.order ?? null, succ?.order ?? null);
  };

  if (newParentId) {
    const newParent = nodes[newParentId];
    if (!newParent || !isContainer(newParent)) return { ...doc, rootChildren, nodes };
    const children = [...newParent.children];
    const clamped = Math.max(0, Math.min(toIndex, children.length));
    children.splice(clamped, 0, id);
    const newOrder = generateOrder(children, clamped);
    nodes[newParentId] = { ...newParent, children } as SceneNode;
    nodes[id] = {
      ...node,
      order: newOrder,
      transform: (localTransform ?? node.transform) as Affine,
    } as SceneNode;
  } else {
    const clamped = Math.max(0, Math.min(toIndex, rootChildren.length));
    rootChildren.splice(clamped, 0, id);
    const newOrder = generateOrder(rootChildren, clamped);
    nodes[id] = {
      ...node,
      order: newOrder,
      transform: (localTransform ?? node.transform) as Affine,
    } as SceneNode;
  }

  const result = { ...doc, rootChildren, nodes };
  devValidate(result);
  return result;
}

function isAncestor(doc: Document, parent: NodeId, child: NodeId): boolean {
  if (parent === child) return true;
  const node = doc.nodes[child];
  if (!node || !isContainer(node)) return false;
  for (const c of node.children) {
    if (isAncestor(doc, parent, c)) return true;
  }
  return false;
}

/**
 * Group a set of sibling nodes into a new GroupNode.
 * All nodes must share the same parent (or be root-level).
 */
export function groupNodes(doc: Document, ids: NodeId[], groupNode: GroupNode): Document {
  if (ids.length < 2) return doc;

  const firstId = ids[0];
  if (!firstId) return doc;
  const first = doc.nodes[firstId];
  if (!first) return doc;
  const parentId: NodeId | null = getParent(doc, firstId);

  for (let i = 1; i < ids.length; i++) {
    const nid = ids[i];
    if (!nid) return doc;
    const n = doc.nodes[nid];
    if (!n) return doc;
    if (getParent(doc, nid) !== parentId) return doc;
  }

  const children = [...groupNode.children];
  let d = addNode(doc, groupNode);

  const parentIdNonNull = parentId as NodeId;
  const sorted = [...ids].sort((a, b) => {
    const idxA = parentId
      ? d.nodes[parentIdNonNull] && isContainer(d.nodes[parentIdNonNull])
        ? (d.nodes[parentIdNonNull] as ContainerNode).children.indexOf(a)
        : -1
      : d.rootChildren.indexOf(a);
    const idxB = parentId
      ? d.nodes[parentIdNonNull] && isContainer(d.nodes[parentIdNonNull])
        ? (d.nodes[parentIdNonNull] as ContainerNode).children.indexOf(b)
        : -1
      : d.rootChildren.indexOf(b);
    return idxA - idxB;
  });

  for (const sid of sorted) {
    d = reparentNode(d, sid, groupNode.id, children.length);
    children.push(sid);
  }

  if (parentId === null) {
    const firstSorted = sorted[0];
    if (!firstSorted) return d;
    const firstIdxInRoot = d.rootChildren.indexOf(firstSorted);
    if (firstIdxInRoot >= 0) {
      d = moveNode(d, groupNode.id, Math.min(firstIdxInRoot, d.rootChildren.length - 1));
    }
  }

  const groupInDoc = d.nodes[groupNode.id];
  if (!groupInDoc) {
    devValidate(d);
    return d;
  }
  d = {
    ...d,
    nodes: { ...d.nodes, [groupNode.id]: { ...groupInDoc, children } as GroupNode },
  };

  devValidate(d);
  return d;
}

/**
 * Ungroup a GroupNode: move all children to the group's parent and remove the group.
 */
export function ungroupNode(doc: Document, id: NodeId): Document {
  const node = doc.nodes[id];
  if (node?.kind !== 'group') return doc;
  const group = node as GroupNode;
  const parentId: NodeId | null = getParent(doc, id);
  const children = [...group.children];

  let d = doc;
  for (let i = 0; i < children.length; i++) {
    const childId = children[i];
    if (!childId) continue;
    const toIndex = parentId
      ? (d.nodes[parentId] && isContainer(d.nodes[parentId])
          ? (d.nodes[parentId] as ContainerNode).children.indexOf(id)
          : -1) + i
      : d.rootChildren.indexOf(id) + i;
    d = reparentNode(d, childId, parentId, toIndex);
  }

  d = removeNode(d, id);
  devValidate(d);
  return d;
}

/**
 * Detach a component instance: clear its componentId so it becomes a plain frame.
 */
export function detachInstance(doc: Document, id: NodeId): Document {
  const node = doc.nodes[id];
  if (node?.kind !== 'frame') return doc;
  const frame = node as FrameNode;
  if (!frame.componentId) return doc;
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [id]: { ...frame, componentId: undefined } as FrameNode,
    },
  };
}

/**
 * Swap a component instance to a different component definition.
 * Preserves the instance's transform/position but resets slot fills and
 * inherited properties to the new master's defaults.
 */
export function swapInstance(doc: Document, id: NodeId, newComponentId: NodeId): Document {
  const node = doc.nodes[id];
  if (node?.kind !== 'frame') return doc;
  const frame = node as FrameNode;
  const newComponent = doc.components[newComponentId];
  if (!newComponent) return doc;
  const master = doc.nodes[newComponent.masterRootId];
  if (master?.kind !== 'frame') return doc;
  const masterFrame = master as FrameNode;

  // Remove old instance children from document
  let workingDoc = doc;
  const oldChildIds = [...frame.children];
  for (const childId of oldChildIds) {
    workingDoc = removeNode(workingDoc, childId);
  }

  // Clone new master children into instance
  const newChildren: NodeId[] = [];
  const newNodes: Record<NodeId, SceneNode> = {};
  const slots: Record<string, NodeId> = {};

  for (const childId of masterFrame.children) {
    const slotDef = newComponent.slots.find((s) => s.defaultContentId === childId);
    const cloneResult = deepCloneSubtree(workingDoc, childId);
    workingDoc = { ...workingDoc, nextId: cloneResult.nextId };
    Object.assign(newNodes, cloneResult.nodes);
    newChildren.push(cloneResult.rootId);
    if (slotDef) {
      slots[slotDef.id] = cloneResult.rootId;
    }
  }

  return {
    ...workingDoc,
    nodes: {
      ...workingDoc.nodes,
      ...newNodes,
      [id]: {
        ...frame,
        componentId: newComponentId,
        children: newChildren,
        fill: masterFrame.fill,
        fills: masterFrame.fills,
        strokes: masterFrame.strokes,
        effects: masterFrame.effects,
        opacity: masterFrame.opacity,
        blendMode: masterFrame.blendMode,
        rotation: masterFrame.rotation,
        layoutStyle: masterFrame.layoutStyle,
        w: masterFrame.w,
        h: masterFrame.h,
        clipContent: masterFrame.clipContent,
        slots: Object.keys(slots).length > 0 ? slots : undefined,
        syncBaseline: captureSyncBaseline(masterFrame),
        variant: undefined,
        propertyOverrides: undefined,
      } as FrameNode,
    },
  };
}

/**
 * Reset overrides on a component instance: restore inherited properties from
 * the master definition. Preserves the instance's transform, name, and slot
 * fills (those are intentional local content, not overrides).
 */
export function resetInstanceOverrides(doc: Document, id: NodeId): Document {
  const node = doc.nodes[id];
  if (node?.kind !== 'frame') return doc;
  const frame = node as FrameNode;
  if (!frame.componentId) return doc;
  const component = doc.components[frame.componentId];
  if (!component) return doc;
  const master = doc.nodes[component.masterRootId];
  if (master?.kind !== 'frame') return doc;
  const masterFrame = master as FrameNode;
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [id]: {
        ...frame,
        fill: masterFrame.fill,
        fills: masterFrame.fills,
        strokes: masterFrame.strokes,
        effects: masterFrame.effects,
        opacity: masterFrame.opacity,
        blendMode: masterFrame.blendMode,
        layoutStyle: masterFrame.layoutStyle,
      } as FrameNode,
    },
  };
}

/**
 * Detect which properties of an instance differ from its master (overrides).
 * Returns a list of property names that have been locally overridden.
 */
export function instanceOverrides(doc: Document, id: NodeId): string[] {
  return detectOverrides(doc, id);
}

// ── Page operations ──────────────────────────────────────────────────────────

/** Count existing pages to generate the next page name. */
function nextPageName(doc: Document): string {
  const count = doc.pages?.length ?? 0;
  return `Page ${count + 1}`;
}

/**
 * Add a new page to the document.
 * Creates a contentRoot group node for page content.
 */
export function addPage(
  doc: Document,
  opts?: { width?: number; height?: number; name?: string },
): Document {
  const { id: contentRootId, doc: d1 } = nextNodeId(doc);
  const contentRoot = makeGroupNode(contentRootId, {
    name: `${opts?.name ?? nextPageName(doc)} content`,
    children: [],
  });

  const page: Page = {
    id: cryptoId(),
    name: opts?.name ?? nextPageName(doc),
    width: opts?.width ?? 1920,
    height: opts?.height ?? 1080,
    backgrounds: [],
    contentRoot: contentRootId,
  };

  // Inherit print config from document if page-level not set
  if (doc.bleed) page.bleed = doc.bleed;
  if (doc.safeArea) page.safeArea = doc.safeArea;
  if (doc.slug) page.slug = doc.slug;

  return {
    ...d1,
    pages: [...(d1.pages ?? []), page],
    rootChildren: [...d1.rootChildren, contentRootId],
    nodes: { ...d1.nodes, [contentRootId]: contentRoot },
  };
}

/**
 * Remove a page from the document.
 * Removes the contentRoot node (and all descendants) and any background nodes.
 * Guards against removing the last page.
 */
export function removePage(doc: Document, pageId: NodeId): Document {
  if (!doc.pages || doc.pages.length <= 1) return doc;
  const idx = doc.pages.findIndex((p) => p.id === pageId);
  if (idx < 0) return doc;

  const page = doc.pages[idx]!;
  const nextPages = doc.pages.filter((p) => p.id !== pageId);
  const activePageStillExists =
    doc.activePageId !== undefined && nextPages.some((p) => p.id === doc.activePageId);
  const fallbackPage = nextPages[Math.min(idx, nextPages.length - 1)] ?? nextPages[0];
  let d: Document = {
    ...doc,
    pages: nextPages,
    activePageId: activePageStillExists ? doc.activePageId : fallbackPage?.id,
  };

  // Remove background nodes
  for (const bgId of page.backgrounds) {
    d = removeNode(d, bgId);
  }

  // Remove contentRoot and all its descendants
  d = removeNode(d, page.contentRoot);
  devValidate(d);
  return d;
}

/**
 * Reorder pages to match the given array of page IDs.
 * Validates that all page IDs exist and the input length matches.
 */
export function reorderPages(doc: Document, pageIds: NodeId[]): Document {
  if (!doc.pages) return doc;
  if (pageIds.length !== doc.pages.length) return doc;

  // Validate all IDs exist
  const existingIds = new Set(doc.pages.map((p) => p.id));
  for (const pid of pageIds) {
    if (!existingIds.has(pid)) return doc;
  }

  // Build reordered pages
  const idToPage = new Map(doc.pages.map((p) => [p.id, p]));
  const reordered = pageIds.map((pid) => idToPage.get(pid)!);

  return { ...doc, pages: reordered };
}

/**
 * Deep-copy a page and all its content nodes.
 * Assigns new IDs to all duplicated nodes.
 * Auto-names the copy ("Page X Copy").
 */
export function duplicatePage(doc: Document, pageId: NodeId): Document {
  if (!doc.pages) return doc;
  const sourcePage = doc.pages.find((p) => p.id === pageId);
  if (!sourcePage) return doc;

  // Clone the contentRoot subtree with new IDs
  let d = doc;
  const idMap = new Map<NodeId, NodeId>();

  function cloneNode(nid: NodeId): NodeId | null {
    const node = d.nodes[nid];
    if (!node) return null;
    if (idMap.has(nid)) return idMap.get(nid)!;

    const { id: newId, doc: d2 } = nextNodeId(d);
    d = d2;
    idMap.set(nid, newId);

    // Recursively clone children if this is a container
    let cloned: SceneNode;
    if (isContainer(node)) {
      const clonedChildren = node.children
        .map((c) => cloneNode(c))
        .filter((c): c is NodeId => c !== null);
      cloned = { ...node, id: newId, children: clonedChildren } as SceneNode;
    } else {
      cloned = { ...node, id: newId } as SceneNode;
    }

    d = { ...d, nodes: { ...d.nodes, [newId]: cloned } };
    return newId;
  }

  const newContentRootId = cloneNode(sourcePage.contentRoot);
  if (!newContentRootId) return doc;

  // Clone background nodes
  const newBackgrounds: NodeId[] = [];
  for (const bgId of sourcePage.backgrounds) {
    const newBgId = cloneNode(bgId);
    if (newBgId) newBackgrounds.push(newBgId);
  }

  const copyName = `${sourcePage.name} Copy`;

  const newPage: Page = {
    id: cryptoId(),
    name: copyName,
    width: sourcePage.width,
    height: sourcePage.height,
    bleed: sourcePage.bleed,
    safeArea: sourcePage.safeArea,
    slug: sourcePage.slug,
    backgrounds: newBackgrounds,
    contentRoot: newContentRootId,
  };

  return {
    ...d,
    pages: [...(d.pages ?? []), newPage],
    rootChildren: [...d.rootChildren, newContentRootId],
  };
}

/**
 * Update page dimensions without scaling content.
 */
export function setPageSize(
  doc: Document,
  pageId: NodeId,
  width: number,
  height: number,
): Document {
  if (!doc.pages) return doc;
  const idx = doc.pages.findIndex((p) => p.id === pageId);
  if (idx < 0) return doc;

  const updatedPages = doc.pages.map((p, i) => (i === idx ? { ...p, width, height } : p));

  return { ...doc, pages: updatedPages };
}

/**
 * Migrate a flat (pre-page) document to the page model.
 * Wraps existing rootChildren into a single default page's contentRoot.
 * If the document already has pages, returns as-is.
 * Uses A4 dimensions (210×297mm) if the document is print-oriented (dpi > 0),
 * or 1920×1080px for screen documents.
 */
export function migrateToPages(doc: Document): Document {
  if (doc.pages && doc.pages.length > 0) return doc;

  const isPrint = (doc.dpi ?? 0) > 0;
  const pageWidth = isPrint && doc.physicalWidth ? doc.physicalWidth : 1920;
  const pageHeight = isPrint && doc.physicalHeight ? doc.physicalHeight : 1080;

  const { id: contentRootId, doc: d1 } = nextNodeId(doc);
  const contentRoot = makeGroupNode(contentRootId, {
    name: 'Page 1 content',
    children: [...doc.rootChildren],
  });

  const page: Page = {
    id: cryptoId(),
    name: 'Page 1',
    width: pageWidth,
    height: pageHeight,
    backgrounds: [],
    contentRoot: contentRootId,
  };

  // Inherit print config
  if (d1.bleed) page.bleed = d1.bleed;
  if (d1.safeArea) page.safeArea = d1.safeArea;
  if (d1.slug) page.slug = d1.slug;

  return {
    ...d1,
    activePageId: page.id,
    pages: [page],
    rootChildren: [contentRootId],
    nodes: { ...d1.nodes, [contentRootId]: contentRoot },
  };
}

// ── Variable operations ──────────────────────────────────────────────────────

/**
 * Add a variable to the document's variableStore.
 * Creates a variableStore on the document if one does not exist.
 */
export function addVariableToDocument(doc: Document, variable: Variable): Document {
  const store = doc.variableStore ?? createVariableStore();
  return {
    ...doc,
    variableStore: {
      ...store,
      variables: { ...store.variables, [variable.id]: variable },
    },
  };
}

/**
 * Update a variable in the document's variableStore.
 * If the variable does not exist, returns the document unchanged.
 */
export function updateVariableInDocument(
  doc: Document,
  id: string,
  patch: Partial<Omit<Variable, 'id'>>,
): Document {
  const store = doc.variableStore;
  if (!store?.variables[id]) return doc;
  return {
    ...doc,
    variableStore: {
      ...store,
      variables: {
        ...store.variables,
        [id]: { ...store.variables[id], ...patch },
      },
    },
  };
}

/**
 * Delete a variable from the document's variableStore.
 * If the variable does not exist, returns the document unchanged.
 */
export function deleteVariableFromDocument(doc: Document, id: string): Document {
  const store = doc.variableStore;
  if (!store?.variables[id]) return doc;

  const cleanedStore = deleteVariable(store, id);

  const nodes = { ...doc.nodes };
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node.bindings) continue;
    const nextBindings = stripBindingForVariable(node.bindings, id);
    if (nextBindings !== node.bindings) {
      nodes[nodeId] = { ...node, bindings: nextBindings } as SceneNode;
    }
  }

  return { ...doc, variableStore: cleanedStore, nodes };
}

/**
 * Set the active mode on the document's variableStore.
 * Adds the mode to the modes list if not already present.
 */
export function setVariableModeOnDocument(doc: Document, mode: string): Document {
  const store = doc.variableStore ?? createVariableStore();
  const modes = store.modes.includes(mode) ? store.modes : [...store.modes, mode];
  return {
    ...doc,
    variableStore: { ...store, activeMode: mode, modes },
  };
}

// ── Guide operations ─────────────────────────────────────────────────────────

export interface AddGuideOptions {
  id?: string;
  locked?: boolean;
  color?: string;
}

export function createGuideId(): string {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Add a guide to a document. Returns a new document with the guide appended. */
export function addGuide(
  doc: Document,
  axis: 'horizontal' | 'vertical',
  position: number,
  options: AddGuideOptions = {},
): Document {
  const guide: import('./types').Guide = {
    id: options.id ?? createGuideId(),
    axis,
    position,
    ...(options.locked !== undefined ? { locked: options.locked } : {}),
    ...(options.color !== undefined ? { color: options.color } : {}),
  };
  return { ...doc, guides: [...(doc.guides ?? []), guide] };
}

/** Remove a guide by id. Returns the document unchanged if the id is not found. */
export function removeGuide(doc: Document, id: string): Document {
  if (!doc.guides || doc.guides.length === 0) return doc;
  const idx = doc.guides.findIndex((g) => g.id === id);
  if (idx < 0) return doc;
  const next = [...doc.guides];
  next.splice(idx, 1);
  return { ...doc, guides: next };
}

/** Move a guide to a new position. Returns the document unchanged if the id is not found. */
export function moveGuide(doc: Document, id: string, position: number): Document {
  if (!doc.guides || doc.guides.length === 0) return doc;
  const idx = doc.guides.findIndex((g) => g.id === id);
  if (idx < 0) return doc;
  const next = doc.guides.map((g) => (g.id === id ? { ...g, position } : g));
  return { ...doc, guides: next };
}

/** Toggle the locked state of a guide. Returns the document unchanged if the id is not found. */
export function toggleGuideLock(doc: Document, id: string): Document {
  if (!doc.guides || doc.guides.length === 0) return doc;
  const idx = doc.guides.findIndex((g) => g.id === id);
  if (idx < 0) return doc;
  const next = doc.guides.map((g) => (g.id === id ? { ...g, locked: !g.locked } : g));
  return { ...doc, guides: next };
}

/** Clear all guides from a document. */
export function clearGuides(doc: Document): Document {
  return { ...doc, guides: [] };
}

// ── Active page & global children operations ───────────────────────────────

/** Set the active page. */
export function setActivePage(doc: Document, pageId: NodeId): Document {
  if (!doc.pages?.some((p) => p.id === pageId)) return doc;
  return { ...doc, activePageId: pageId };
}

/** Add a node to global children (visible on all pages). */
export function addGlobalChild(doc: Document, nodeId: NodeId): Document {
  const current = doc.globalChildren ?? [];
  if (current.includes(nodeId)) return doc;
  return { ...doc, globalChildren: [...current, nodeId] };
}

/** Remove a node from global children. */
export function removeGlobalChild(doc: Document, nodeId: NodeId): Document {
  const current = doc.globalChildren ?? [];
  return { ...doc, globalChildren: current.filter((id) => id !== nodeId) };
}

// ── Document validation ──────────────────────────────────────────────────────

export interface DocValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate document tree integrity invariants.
 *
 * Checks:
 * 1. Every node in `nodes` is reachable from `rootChildren` / `globalChildren`
 * 2. Every child ID in a container's `children` exists in `nodes`
 * 3. No duplicate child IDs across containers / root / global
 * 4. No cycles (node is not its own ancestor)
 * 5. All mask references point to existing nodes
 * 6. All slot references point to existing nodes
 * 7. Page contentRoot / backgrounds are reachable
 */
export function validateDocument(doc: Document): DocValidationResult {
  const errors: string[] = [];

  // ── 1. Reachability ─────────────────────────────────────────────────────
  const reachable = new Set<NodeId>();
  function markReachable(ids: NodeId[]) {
    for (const nid of ids) {
      if (reachable.has(nid)) continue;
      const node = doc.nodes[nid];
      if (!node) continue;
      reachable.add(nid);
      if (isContainer(node) && node.children.length > 0) {
        markReachable(node.children);
      }
    }
  }

  const roots = [...doc.rootChildren, ...(doc.globalChildren ?? [])];
  markReachable(roots);

  for (const nid of Object.keys(doc.nodes)) {
    if (!reachable.has(nid as NodeId)) {
      errors.push(`Orphan node: ${nid} is not reachable from rootChildren or globalChildren`);
    }
  }

  // ── 1b. Page integrity ──────────────────────────────────────────────────
  if (doc.pages) {
    if (doc.activePageId && !doc.pages.some((page) => page.id === doc.activePageId)) {
      errors.push(`activePageId ${doc.activePageId} does not reference an existing page`);
    }
    for (const page of doc.pages) {
      if (!reachable.has(page.contentRoot)) {
        errors.push(`Page "${page.name}" contentRoot ${page.contentRoot} is not reachable`);
      }
      for (const bgId of page.backgrounds) {
        if (!reachable.has(bgId)) {
          errors.push(`Page "${page.name}" background ${bgId} is not reachable`);
        }
      }
    }
  }

  // ── 2. Child references exist in nodes ──────────────────────────────────
  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (isContainer(node)) {
      for (const childId of node.children) {
        if (!doc.nodes[childId]) {
          errors.push(`Container ${nid} references non-existent child ${childId}`);
        }
      }
    }
  }

  // ── 3. No duplicate child IDs ───────────────────────────────────────────
  const childToParent = new Map<NodeId, NodeId[]>();
  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (isContainer(node)) {
      for (const childId of node.children) {
        const existing = childToParent.get(childId) ?? [];
        existing.push(nid as NodeId);
        childToParent.set(childId, existing);
      }
    }
  }
  for (const [childId, parents] of childToParent) {
    if (parents.length > 1) {
      errors.push(`Node ${childId} is a child of multiple containers: ${parents.join(', ')}`);
    }
  }

  // Check rootChildren / globalChildren overlap
  const rootSet = new Set(doc.rootChildren);
  for (const gid of doc.globalChildren ?? []) {
    if (rootSet.has(gid)) {
      errors.push(`Node ${gid} appears in both rootChildren and globalChildren`);
    }
  }

  // ── 4. No cycles ────────────────────────────────────────────────────────
  const visited = new Set<NodeId>();
  const inStack = new Set<NodeId>();
  function detectCycle(nodeId: NodeId): boolean {
    if (inStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    const node = doc.nodes[nodeId];
    if (!node || !isContainer(node)) return false;
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const childId of node.children) {
      if (detectCycle(childId)) {
        inStack.delete(nodeId);
        return true;
      }
    }
    inStack.delete(nodeId);
    return false;
  }
  for (const nid of Object.keys(doc.nodes)) {
    if (detectCycle(nid as NodeId)) {
      errors.push(`Cycle detected in subtree containing node ${nid}`);
      break;
    }
  }

  // ── 5. Mask references ──────────────────────────────────────────────────
  for (const [nid, node] of Object.entries(doc.nodes)) {
    const n = node as SceneNode & { mask?: { sourceNodeId?: NodeId } };
    if (n.mask?.sourceNodeId && !doc.nodes[n.mask.sourceNodeId]) {
      errors.push(`Node ${nid} has mask referencing non-existent node ${n.mask.sourceNodeId}`);
    }
  }

  // ── 6. Slot references ──────────────────────────────────────────────────
  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (node.kind === 'frame' || node.kind === 'group') {
      const frame = node as FrameNode & { slots?: Record<string, NodeId> };
      if (frame.slots) {
        for (const [slotId, slotChildId] of Object.entries(frame.slots)) {
          if (!doc.nodes[slotChildId as NodeId]) {
            errors.push(
              `Node ${nid} has slot "${slotId}" referencing non-existent node ${slotChildId}`,
            );
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Development-mode validation guard. No-op in production builds. */
function devValidate(doc: Document): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    const result = validateDocument(doc);
    if (!result.valid) {
      // eslint-disable-next-line no-console
      console.warn('[Strata] Document validation failed:', result.errors);
    }
  }
}

// ── Text chain operations ────────────────────────────────────────────────────

/**
 * Create a new text chain for linked text frames.
 */
export function createTextChain(
  doc: Document,
  name: string,
  frameIds: NodeId[],
  richText?: import('./typography').RichText,
): { chain: import('./typography').TextChain; doc: Document } {
  const chainId = `chain-${doc.nextId}`;
  const chain: import('./typography').TextChain = {
    id: chainId,
    name,
    frameIds,
    richText,
  };
  return {
    chain,
    doc: {
      ...doc,
      nextId: doc.nextId + 1,
      textChains: { ...doc.textChains, [chainId]: chain },
    },
  };
}

/**
 * Delete a text chain and its references.
 */
export function deleteTextChain(doc: Document, chainId: string): Document {
  if (!doc.textChains?.[chainId]) return doc;
  const { [chainId]: _, ...remaining } = doc.textChains;
  return { ...doc, textChains: remaining };
}

/**
 * Append a frame to an existing text chain.
 */
export function appendFrameToChain(doc: Document, chainId: string, frameId: NodeId): Document {
  const existing = doc.textChains?.[chainId];
  if (!existing) return doc;
  if (existing.frameIds.includes(frameId)) return doc;
  return {
    ...doc,
    textChains: {
      ...doc.textChains,
      [chainId]: {
        ...existing,
        frameIds: [...existing.frameIds, frameId],
      },
    },
  };
}

/**
 * Remove a frame from a text chain.
 */
export function removeFrameFromChain(doc: Document, chainId: string, frameId: NodeId): Document {
  const existing = doc.textChains?.[chainId];
  if (!existing) return doc;
  const newFrameIds = existing.frameIds.filter((id) => id !== frameId);
  if (newFrameIds.length === existing.frameIds.length) return doc;
  return {
    ...doc,
    textChains: {
      ...doc.textChains,
      [chainId]: {
        ...existing,
        frameIds: newFrameIds,
      },
    },
  };
}

/** Get all nodes visible on the active page (page content + global children). */
export function activePageNodes(doc: Document): NodeId[] {
  const globals = doc.globalChildren ?? [];
  if (!doc.activePageId || !doc.pages || doc.pages.length === 0) {
    return [...globals, ...doc.rootChildren];
  }
  const page = doc.pages?.find((p) => p.id === doc.activePageId);
  if (!page) return [...globals, ...doc.rootChildren];
  const contentRootNode = doc.nodes[page.contentRoot] as GroupNode | undefined;
  const pageChildren = contentRootNode?.children ?? [];
  return [...globals, ...pageChildren];
}
