import type { Document, SceneNode } from '@varve/scene';
import { nextNodeId } from '@varve/scene';

export interface ImportedResourceSet {
  sourceDoc: Document;
  idMap: Map<string, string>;
}

interface ResourceMaps {
  nodeIds: Map<string, string>;
  componentIds: Map<string, string>;
  styleIds: Map<string, string>;
  variableIds: Map<string, string>;
  collectionIds: Map<string, string>;
}

function allocateResourceId(doc: Document, occupied: Set<string>): { id: string; doc: Document } {
  let next = nextNodeId(doc);
  while (occupied.has(next.id)) next = nextNodeId(next.doc);
  occupied.add(next.id);
  return { id: next.id, doc: next.doc };
}

function remapId(value: string | undefined, ids: Map<string, string>): string | undefined {
  return value ? (ids.get(value) ?? value) : value;
}

function remapValue(value: string | boolean, nodeIds: Map<string, string>): string | boolean {
  return typeof value === 'string' ? (nodeIds.get(value) ?? value) : value;
}

function remapVariableValue(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/\{([^}]+)\}/g, (_, id: string) => `{${ids.get(id) ?? id}}`);
}

function remapInteractionValue(value: unknown, nodeIds: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => remapInteractionValue(entry, nodeIds));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (
      (key === 'nodeId' ||
        key === 'targetId' ||
        key === 'overlayId' ||
        key === 'newTargetId' ||
        key === 'containerId') &&
      typeof entry === 'string'
    ) {
      result[key] = nodeIds.get(entry) ?? entry;
    } else {
      result[key] = remapInteractionValue(entry, nodeIds);
    }
  }
  return result;
}

function mergeGroup(
  target: Document,
  sourceDoc: Document,
  entries: ImportedResourceSet[],
  occupied: Set<string>,
): { doc: Document; maps: ResourceMaps } {
  const nodeIds = new Map<string, string>();
  for (const entry of entries) {
    for (const [sourceId, targetId] of entry.idMap) nodeIds.set(sourceId, targetId);
  }

  let doc = target;
  const maps: ResourceMaps = {
    nodeIds,
    componentIds: new Map(),
    styleIds: new Map(),
    variableIds: new Map(),
    collectionIds: new Map(),
  };

  for (const id of Object.keys(sourceDoc.components)) {
    const allocated = allocateResourceId(doc, occupied);
    doc = allocated.doc;
    maps.componentIds.set(id, allocated.id);
  }
  for (const id of Object.keys(sourceDoc.styles ?? {})) {
    const allocated = allocateResourceId(doc, occupied);
    doc = allocated.doc;
    maps.styleIds.set(id, allocated.id);
  }
  for (const id of Object.keys(sourceDoc.variableStore?.variables ?? {})) {
    const allocated = allocateResourceId(doc, occupied);
    doc = allocated.doc;
    maps.variableIds.set(id, allocated.id);
  }
  for (const id of Object.keys(sourceDoc.variableStore?.collections ?? {})) {
    const allocated = allocateResourceId(doc, occupied);
    doc = allocated.doc;
    maps.collectionIds.set(id, allocated.id);
  }

  const components = { ...doc.components };
  for (const [sourceId, source] of Object.entries(sourceDoc.components)) {
    const id = maps.componentIds.get(sourceId);
    const masterRootId = nodeIds.get(source.masterRootId);
    if (!id || !masterRootId) continue;
    components[id] = {
      ...source,
      id,
      masterRootId,
      slots: source.slots.map((slot) => ({
        ...slot,
        ...(slot.defaultContentId
          ? { defaultContentId: nodeIds.get(slot.defaultContentId) ?? slot.defaultContentId }
          : {}),
      })),
      properties: source.properties?.map((property) => ({
        ...property,
        defaultValue: remapValue(property.defaultValue, nodeIds),
      })),
      variants: source.variants?.map((variant) => ({
        ...variant,
        propertyValues: Object.fromEntries(
          Object.entries(variant.propertyValues).map(([key, value]) => [
            key,
            remapValue(value, nodeIds),
          ]),
        ),
      })),
    };
  }

  const styles = { ...(doc.styles ?? {}) };
  for (const [sourceId, source] of Object.entries(sourceDoc.styles ?? {})) {
    const id = maps.styleIds.get(sourceId);
    if (!id) continue;
    styles[id] = { ...source, id };
  }

  const sourceStore = sourceDoc.variableStore;
  if (sourceStore) {
    const existing = doc.variableStore;
    const variables = { ...(existing?.variables ?? {}) };
    for (const [sourceId, variable] of Object.entries(sourceStore.variables)) {
      const id = maps.variableIds.get(sourceId);
      if (!id) continue;
      variables[id] = {
        ...variable,
        id,
        valuesByMode: Object.fromEntries(
          Object.entries(variable.valuesByMode).map(([mode, value]) => [
            mode,
            remapVariableValue(value, maps.variableIds),
          ]),
        ) as typeof variable.valuesByMode,
      };
    }
    const collections = { ...(existing?.collections ?? {}) };
    for (const [sourceId, collection] of Object.entries(sourceStore.collections)) {
      const id = maps.collectionIds.get(sourceId);
      if (!id) continue;
      collections[id] = {
        ...collection,
        id,
        variableIds: collection.variableIds.map(
          (variableId) => maps.variableIds.get(variableId) ?? variableId,
        ),
      };
    }
    doc = {
      ...doc,
      variableStore: {
        ...(existing ?? sourceStore),
        variables,
        collections,
        activeCollectionId:
          existing?.activeCollectionId ||
          remapId(sourceStore.activeCollectionId, maps.collectionIds) ||
          '',
        modes: [...new Set([...(existing?.modes ?? []), ...sourceStore.modes])],
        activeMode: existing?.activeMode ?? sourceStore.activeMode,
      },
    };
  }

  const nodes = { ...doc.nodes };
  for (const targetId of nodeIds.values()) {
    const node = nodes[targetId];
    if (!node) continue;
    const candidate = { ...node } as SceneNode & {
      componentId?: string;
      styleId?: string;
      bindings?: Record<string, { variableId: string }>;
    };
    if ('componentId' in candidate) {
      const componentId = maps.componentIds.get(candidate.componentId ?? '');
      if (componentId && components[componentId]) candidate.componentId = componentId;
      else delete candidate.componentId;
    }
    if (candidate.styleId) candidate.styleId = maps.styleIds.get(candidate.styleId);
    const bindings = (candidate as unknown as { bindings?: Record<string, { variableId: string }> })
      .bindings;
    if (bindings) {
      const remappedBindings = Object.fromEntries(
        Object.entries(bindings)
          .map(([key, binding]) => [
            key,
            { ...binding, variableId: maps.variableIds.get(binding.variableId) },
          ])
          .filter((entry): entry is [string, { variableId: string }] =>
            Boolean(entry[1].variableId),
          ),
      );
      if (Object.keys(remappedBindings).length > 0) {
        (candidate as unknown as { bindings: Record<string, { variableId: string }> }).bindings =
          remappedBindings;
      } else delete (candidate as unknown as { bindings?: unknown }).bindings;
    }
    nodes[targetId] = candidate;
  }

  const interactions = { ...(doc.interactions ?? {}) };
  for (const [sourceNodeId, sourceInteractions] of Object.entries(sourceDoc.interactions ?? {})) {
    const nodeId = nodeIds.get(sourceNodeId);
    if (!nodeId) continue;
    interactions[nodeId] = sourceInteractions.map((interaction, index) => ({
      ...interaction,
      id: `${nodeId}-interaction-${index}`,
      nodeId,
      trigger: remapInteractionValue(interaction.trigger, nodeIds),
      actions: remapInteractionValue(interaction.actions, nodeIds) as unknown[],
    }));
  }

  return {
    doc: {
      ...doc,
      nodes,
      components,
      ...(Object.keys(styles).length > 0 ? { styles } : {}),
      ...(Object.keys(interactions).length > 0 ? { interactions } : {}),
    },
    maps,
  };
}

/** Merge imported document-level resources after node IDs have been cloned. */
export function mergeImportedResources(target: Document, imports: ImportedResourceSet[]): Document {
  if (imports.length === 0) return target;
  const grouped = new Map<Document, ImportedResourceSet[]>();
  for (const entry of imports) {
    const group = grouped.get(entry.sourceDoc) ?? [];
    group.push(entry);
    grouped.set(entry.sourceDoc, group);
  }
  let doc = target;
  const occupied = new Set<string>([
    ...Object.keys(doc.nodes),
    ...Object.keys(doc.components),
    ...Object.keys(doc.styles ?? {}),
    ...Object.keys(doc.variableStore?.variables ?? {}),
    ...Object.keys(doc.variableStore?.collections ?? {}),
  ]);
  for (const [sourceDoc, entries] of grouped) {
    const merged = mergeGroup(doc, sourceDoc, entries, occupied);
    doc = merged.doc;
  }
  return doc;
}
