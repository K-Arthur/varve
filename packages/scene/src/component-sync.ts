import type { Document } from './document';
import type { ComponentDefinition, FrameNode, NodeId } from './types';

export type InstanceStatus = 'synced' | 'overridden' | 'broken';

export interface SyncResult {
  updatedInstances: NodeId[];
  preservedOverrides: number;
}

/** Frame-level properties synced from master to instance. */
export const SYNC_PROPERTIES: Array<keyof FrameNode> = [
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

export type SyncBaseline = Partial<Record<(typeof SYNC_PROPERTIES)[number], unknown>>;

/**
 * Capture a baseline snapshot of syncable properties from a frame.
 */
export function captureSyncBaseline(frame: FrameNode): SyncBaseline {
  const baseline: SyncBaseline = {};
  for (const prop of SYNC_PROPERTIES) {
    baseline[prop] = frame[prop];
  }
  return baseline;
}

function getMasterFrame(doc: Document, component: ComponentDefinition): FrameNode | undefined {
  const node = doc.nodes[component.masterRootId];
  if (node?.kind !== 'frame') return undefined;
  return node as FrameNode;
}

/**
 * Normalize empty arrays and undefined for stable equality.
 */
export function propsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const emptyA = a === undefined || (Array.isArray(a) && a.length === 0);
  const emptyB = b === undefined || (Array.isArray(b) && b.length === 0);
  if (emptyA && emptyB) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function getEffectiveBaseline(frame: FrameNode): SyncBaseline {
  if (frame.syncBaseline) return frame.syncBaseline;
  return captureSyncBaseline(frame);
}

/**
 * Detect overrides by comparing instance to last-synced baseline (not current master).
 */
export function detectOverrides(doc: Document, id: NodeId): string[] {
  const node = doc.nodes[id];
  if (node?.kind !== 'frame') return [];
  const frame = node as FrameNode;
  if (!frame.componentId) return [];

  const baseline = getEffectiveBaseline(frame);
  const overrides: string[] = [];

  for (const prop of SYNC_PROPERTIES) {
    const instanceVal = frame[prop];
    const baselineVal = baseline[prop];
    if (!propsEqual(instanceVal, baselineVal)) {
      overrides.push(prop);
    }
  }

  return overrides;
}

export function hasInstanceOverrides(doc: Document, instanceId: NodeId): boolean {
  return detectOverrides(doc, instanceId).length > 0;
}

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
 * Uses last-synced baseline to distinguish user overrides from stale master drift.
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

  const baseline = getEffectiveBaseline(frame);
  const overrides = new Set(detectOverrides(doc, instanceId));
  const updated = { ...frame } as FrameNode;
  const newBaseline: SyncBaseline = { ...baseline };

  for (const prop of SYNC_PROPERTIES) {
    if (!overrides.has(prop)) {
      (updated as unknown as Record<string, unknown>)[prop] = master[prop];
      newBaseline[prop] = master[prop];
    }
  }

  updated.syncBaseline = newBaseline;

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

export function syncAllInstances(doc: Document): { doc: Document; result: SyncResult } {
  let currentDoc = doc;
  const result: SyncResult = {
    updatedInstances: [],
    preservedOverrides: 0,
  };

  for (const compId of Object.keys(doc.components)) {
    const { doc: syncedDoc, result: compResult } = pushMasterChanges(currentDoc, compId);
    currentDoc = syncedDoc;
    result.updatedInstances.push(...compResult.updatedInstances);
    result.preservedOverrides += compResult.preservedOverrides;
  }

  return { doc: currentDoc, result };
}
