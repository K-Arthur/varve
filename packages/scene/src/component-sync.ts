import type { Document } from './document';
import type { ComponentDefinition, FrameNode, NodeId } from './types';

export type InstanceStatus = 'synced' | 'overridden' | 'broken';

export interface SyncResult {
  updatedInstances: NodeId[];
  preservedOverrides: number;
}

/** Frame-level properties that are synced from master to instance. */
const SYNC_PROPERTIES: Array<keyof FrameNode> = [
  'fill',
  'fills',
  'opacity',
  'blendMode',
  'rotation',
  'strokes',
  'effects',
  'layoutStyle',
  'clipContent',
  'w',
  'h',
];

/**
 * Get the master FrameNode for a component, or undefined if missing.
 */
function getMasterFrame(
  doc: Document,
  component: ComponentDefinition,
): FrameNode | undefined {
  const node = doc.nodes[component.masterRootId];
  if (node?.kind !== 'frame') return undefined;
  return node as FrameNode;
}

/**
 * Compare two values using JSON serialization for deep equality.
 */
function propsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Detect which frame-level properties of an instance differ from its master.
 * Returns a list of property names that have been locally overridden.
 */
function detectOverrides(doc: Document, id: NodeId): string[] {
  const node = doc.nodes[id];
  if (node?.kind !== 'frame') return [];
  const frame = node as FrameNode;
  if (!frame.componentId) return [];
  const component = doc.components[frame.componentId];
  if (!component) return [];
  const master = getMasterFrame(doc, component);
  if (!master) return [];
  const overrides: string[] = [];
  for (const prop of SYNC_PROPERTIES) {
    const instanceVal = frame[prop];
    const masterVal = master[prop];
    if (!propsEqual(instanceVal, masterVal)) {
      overrides.push(prop);
    }
  }
  return overrides;
}

/**
 * Check if an instance has any local overrides compared to the master.
 */
export function hasInstanceOverrides(doc: Document, instanceId: NodeId): boolean {
  return detectOverrides(doc, instanceId).length > 0;
}

/**
 * Get the status of an instance.
 * - 'broken': component master not found
 * - 'overridden': instance has local changes vs master
 * - 'synced': instance matches master defaults
 */
export function getInstanceStatus(doc: Document, instanceId: NodeId): InstanceStatus {
  const node = doc.nodes[instanceId];
  if (node?.kind !== 'frame') return 'broken';
  const frame = node as FrameNode;
  if (!frame.componentId) return 'broken';
  const comp = doc.components[frame.componentId];
  if (!comp) return 'broken';
  const master = getMasterFrame(doc, comp);
  if (!master) return 'broken';
  return hasInstanceOverrides(doc, instanceId) ? 'overridden' : 'synced';
}

/**
 * Sync a single instance from its master.
 * Applies master frame-level properties to the instance,
 * preserving any property that differs from the master (local override).
 *
 * NOTE (V1): Override detection compares the instance to the master's current
 * values. A property that differs because the master changed is treated as an
 * override and preserved. Use `resetInstanceOverrides` from document.ts to
 * force reset an instance to master values.
 */
export function syncInstance(
  doc: Document,
  instanceId: NodeId,
): { doc: Document; status: InstanceStatus } {
  const node = doc.nodes[instanceId];
  if (node?.kind !== 'frame') return { doc, status: 'broken' as InstanceStatus };
  const frame = node as FrameNode;
  if (!frame.componentId) return { doc, status: 'broken' as InstanceStatus };
  const comp = doc.components[frame.componentId];
  if (!comp) return { doc, status: 'broken' as InstanceStatus };
  const master = getMasterFrame(doc, comp);
  if (!master) return { doc, status: 'broken' as InstanceStatus };

  const overrides = new Set(detectOverrides(doc, instanceId));
  const updated = { ...frame } as FrameNode;

  for (const prop of SYNC_PROPERTIES) {
    if (!overrides.has(prop)) {
      (updated as unknown as Record<string, unknown>)[prop] = master[prop];
    }
  }

  const status: InstanceStatus = overrides.size > 0 ? 'overridden' : 'synced';

  return {
    doc: {
      ...doc,
      nodes: {
        ...doc.nodes,
        [instanceId]: updated,
      },
    },
    status,
  };
}

/**
 * Push master component changes to all instances.
 */
export function pushMasterChanges(
  doc: Document,
  componentId: string,
): { doc: Document; result: SyncResult } {
  const comp = doc.components[componentId];
  if (!comp) return { doc, result: { updatedInstances: [], preservedOverrides: 0 } };
  const master = getMasterFrame(doc, comp);
  if (!master) return { doc, result: { updatedInstances: [], preservedOverrides: 0 } };

  let currentDoc = doc;
  const updatedInstances: NodeId[] = [];
  let preservedOverrides = 0;

  for (const [nodeId, sceneNode] of Object.entries(doc.nodes)) {
    if (sceneNode.kind !== 'frame') continue;
    const frame = sceneNode as FrameNode;
    if (frame.componentId !== componentId) continue;

    const { doc: syncedDoc, status } = syncInstance(currentDoc, nodeId);
    currentDoc = syncedDoc;
    updatedInstances.push(nodeId);
    if (status === 'overridden') {
      preservedOverrides++;
    }
  }

  return {
    doc: currentDoc,
    result: { updatedInstances, preservedOverrides },
  };
}

/**
 * Sync all instances of all components.
 */
export function syncAllInstances(
  doc: Document,
): { doc: Document; result: SyncResult } {
  let currentDoc = doc;
  const result: SyncResult = {
    updatedInstances: [],
    preservedOverrides: 0,
  };

  const componentIds = Object.keys(doc.components);

  for (const compId of componentIds) {
    const comp = doc.components[compId];
    if (!comp) continue;
    const { doc: syncedDoc, result: compResult } = pushMasterChanges(currentDoc, compId);
    currentDoc = syncedDoc;
    result.updatedInstances.push(...compResult.updatedInstances);
    result.preservedOverrides += compResult.preservedOverrides;
  }

  return { doc: currentDoc, result };
}
