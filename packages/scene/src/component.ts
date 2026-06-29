/**
 * Component definitions with typed slots (Strata plan §3.1, priority 8.33).
 *
 * This is the #1 differentiator. Task 1.1 implements instance creation,
 * slot-fill enforcement, and master propagation. The data shapes below
 * extend the slots-ready model from the Phase 0 scaffold.
 *
 * Research basis: Figma variant/swap and Penpot slot models (inspiration,
 * not copy). The key insight: a component declares typed slots; an instance
 * fills slots with arbitrary local content; master edits to non-slot regions
 * propagate while slot content stays local.
 */

import { addChild, type Document } from './document';
import type { ComponentDefinition, FrameNode, NodeId, SceneNode, Slot, SlotKind } from './types';

export type { ComponentDefinition, Slot, SlotKind };

/** Whether `frameSlots` fills every slot declared by `component`. */
export function slotsSatisfied(
  component: ComponentDefinition,
  frameSlots: Record<string, NodeId> | undefined,
): boolean {
  if (!frameSlots) return component.slots.length === 0;
  return component.slots.every((s) => Object.hasOwn(frameSlots, s.id));
}

/** Mutable id generator for tree-clone operations. */
class IdGen {
  private counter: number;
  constructor(doc: Document) {
    this.counter = doc.nextId;
  }
  next(): NodeId {
    return `n${this.counter++}`;
  }
  nextDoc(nextId: number): Pick<Document, 'nextId'> {
    return { nextId: Math.max(this.counter, nextId) };
  }
}

/**
 * Register a new ComponentDefinition in the document.
 * The master root must be a FrameNode that becomes the template.
 */
export function createComponent(
  doc: Document,
  name: string,
  masterRootId: NodeId,
  slots: Slot[],
): { component: ComponentDefinition; doc: Document } {
  const idGen = new IdGen(doc);
  const componentId = idGen.next();
  const component: ComponentDefinition = {
    id: componentId,
    name,
    masterRootId,
    slots,
  };
  return {
    component,
    doc: {
      ...doc,
      ...idGen.nextDoc(doc.nextId),
      components: { ...doc.components, [componentId]: component },
    },
  };
}

/**
 * Deep-clone a subtree, assigning new IDs to every cloned node.
 * Returns the new root ID and a map of new nodes.
 */
function deepCloneSubtree(
  doc: Document,
  rootId: NodeId,
  idGen: IdGen,
): { newRootId: NodeId; newNodes: Record<NodeId, SceneNode> } {
  const original = doc.nodes[rootId];
  if (!original) throw new Error(`Node ${rootId} not found`);

  const newId = idGen.next();
  const newNodes: Record<NodeId, SceneNode> = {};

  if (original.kind === 'frame' && original.children.length > 0) {
    const clonedChildren: NodeId[] = [];
    for (const cId of original.children) {
      const result = deepCloneSubtree(doc, cId, idGen);
      clonedChildren.push(result.newRootId);
      Object.assign(newNodes, result.newNodes);
    }
    newNodes[newId] = {
      ...original,
      id: newId,
      children: clonedChildren,
    } as FrameNode;
  } else {
    newNodes[newId] = { ...original, id: newId };
  }

  return { newRootId: newId, newNodes };
}

/**
 * Create a new FrameNode that is an instance of the given component.
 * Populates children from the master (deep-cloned) with slots pointing
 * to default content.
 */
export function instantiate(
  doc: Document,
  componentDef: ComponentDefinition,
): { node: FrameNode; doc: Document } {
  const masterRoot = doc.nodes[componentDef.masterRootId];
  if (masterRoot?.kind !== 'frame') {
    throw new Error(`Master root ${componentDef.masterRootId} is not a frame`);
  }

  const idGen = new IdGen(doc);
  const instanceId = idGen.next();
  const slots: Record<string, NodeId> = {};
  const newChildren: NodeId[] = [];
  const allNewNodes: Record<NodeId, SceneNode> = {};

  for (const childId of masterRoot.children) {
    const child = doc.nodes[childId];
    if (!child) continue;

    const slotDef = componentDef.slots.find((s) => s.defaultContentId === childId);

    const result = deepCloneSubtree(doc, childId, idGen);
    Object.assign(allNewNodes, result.newNodes);

    if (slotDef) {
      slots[slotDef.id] = result.newRootId;
    }
    newChildren.push(result.newRootId);
  }

  const instanceNode: FrameNode = {
    id: instanceId,
    kind: 'frame',
    name: `${componentDef.name} Instance`,
    index: 0,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    fill: [200, 200, 200, 255],
    children: newChildren,
    componentId: componentDef.id,
    slots: Object.keys(slots).length > 0 ? slots : undefined,
    strokes: [],
    effects: [],
  };

  return {
    node: instanceNode,
    doc: {
      ...doc,
      ...idGen.nextDoc(doc.nextId),
      nodes: { ...doc.nodes, ...allNewNodes, [instanceId]: instanceNode },
    },
  };
}

/**
 * Fill a slot on a component instance with a given node.
 * The fill node is added as a child of the instance frame.
 * If the slot already has a fill, the old fill node is removed.
 */
export function fillSlot(
  doc: Document,
  instanceId: NodeId,
  slotId: string,
  fillNodeId: NodeId,
): Document {
  const instance = doc.nodes[instanceId];
  if (instance?.kind !== 'frame') return doc;
  const frame = instance as FrameNode;
  if (!frame.componentId) return doc;

  const currentSlots = frame.slots ?? {};

  // If the slot already has a fill, remove the old fill node
  const oldFill = currentSlots[slotId];
  let newDoc = doc;
  if (oldFill) {
    newDoc = removeChildFill(newDoc, instanceId, oldFill);
  }

  // Add the new fill node as a child
  const fillNode = newDoc.nodes[fillNodeId];
  if (!fillNode) return newDoc;

  newDoc = addChild(newDoc, instanceId, fillNode, slotId);

  return newDoc;
}

/** Remove a fill node from an instance's children and nodes map. */
function removeChildFill(doc: Document, instanceId: NodeId, fillId: NodeId): Document {
  const instance = doc.nodes[instanceId] as FrameNode | undefined;
  if (instance?.kind !== 'frame') return doc;

  const newChildren = instance.children.filter((c) => c !== fillId);
  const newSlots = instance.slots
    ? Object.fromEntries(Object.entries(instance.slots).filter(([_, v]) => v !== fillId))
    : undefined;
  const cleanedSlots = newSlots && Object.keys(newSlots).length > 0 ? newSlots : undefined;

  const nodes = { ...doc.nodes };
  delete nodes[fillId];
  nodes[instanceId] = { ...instance, children: newChildren, slots: cleanedSlots } as FrameNode;

  return { ...doc, nodes };
}

/**
 * Deep-clone a single subtree root (no prepopulated idMapping).
 */
function cloneSubtree(
  doc: Document,
  rootId: NodeId,
  idGen: IdGen,
): { newRootId: NodeId; newNodes: Record<NodeId, SceneNode> } {
  return deepCloneSubtree(doc, rootId, idGen);
}

/**
 * Propagate master changes to a component instance.
 * Non-slot children are replaced with fresh deep clones of the master's children.
 * Slot fills are preserved.
 *
 * Old orphaned nodes from prior propagations remain in doc.nodes but are
 * structurally unreachable (no parent references them).
 */
export function propagateMaster(
  doc: Document,
  componentDef: ComponentDefinition,
  instanceId: NodeId,
): Document {
  const instance = doc.nodes[instanceId];
  if (instance?.kind !== 'frame') return doc;
  const frame = instance as FrameNode;
  if (frame.componentId !== componentDef.id) return doc;

  const masterRoot = doc.nodes[componentDef.masterRootId];
  if (masterRoot?.kind !== 'frame') return doc;
  const masterFrame = masterRoot as FrameNode;

  const idGen = new IdGen(doc);
  const newChildren: NodeId[] = [];
  const allNewNodes: Record<NodeId, SceneNode> = {};

  for (const childId of masterFrame.children) {
    const child = doc.nodes[childId];
    if (!child) continue;

    const slotDef = componentDef.slots.find((s) => s.defaultContentId === childId);
    if (slotDef && frame.slots && Object.hasOwn(frame.slots, slotDef.id)) {
      // Preserve the slot fill — reference existing node
      newChildren.push(frame.slots[slotDef.id]!);
    } else {
      // Deep clone the non-slot child
      const result = cloneSubtree(doc, childId, idGen);
      newChildren.push(result.newRootId);
      Object.assign(allNewNodes, result.newNodes);
    }
  }

  return {
    ...doc,
    ...idGen.nextDoc(doc.nextId),
    nodes: {
      ...doc.nodes,
      ...allNewNodes,
      [instanceId]: { ...frame, children: newChildren, slots: frame.slots },
    },
  };
}
