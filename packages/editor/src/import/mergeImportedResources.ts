import type {
  Document,
  DocumentAsset,
  DocumentIconAsset,
  Effect,
  Fill,
  IccProfileEntry,
  LiveMatteSource,
  MockupTemplateAsset,
  RasterMaskAsset,
  SceneNode,
} from '@varve/scene';
import { nextNodeId } from '@varve/scene';

export interface ImportedResourceSet {
  sourceDoc: Document;
  idMap: Map<string, string>;
}

interface ResourceMaps {
  nodeIds: Map<string, string>;
  componentIds: Map<string, string>;
  styleIds: Map<string, string>;
  paintIds: Map<string, string>;
  templateIds: Map<string, string>;
  variableIds: Map<string, string>;
  collectionIds: Map<string, string>;
  storyIds: Map<string, string>;
  timelineIds: Map<string, string>;
  motionExtensionIds: Map<string, string>;
  motionPresetIds: Map<string, string>;
  assetIds: Map<string, string>;
  rasterMaskAssetIds: Map<string, string>;
  iconAssetIds: Map<string, string>;
  iccProfileIds: Map<string, string>;
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

function resourcePayload(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const { id: _id, ...payload } = value as Record<string, unknown>;
  return payload;
}

function resourcesEquivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(resourcePayload(left)) === JSON.stringify(resourcePayload(right));
}

function mapImportedAssetIds<T extends { id: string }>(
  target: Document,
  sourceAssets: Record<string, T> | undefined,
  targetAssets: Record<string, T> | undefined,
  occupied: Set<string>,
): { doc: Document; ids: Map<string, string> } {
  let doc = target;
  const ids = new Map<string, string>();
  for (const [sourceId, sourceAsset] of Object.entries(sourceAssets ?? {})) {
    const existing = targetAssets?.[sourceId];
    if (existing && resourcesEquivalent(existing, sourceAsset)) {
      ids.set(sourceId, sourceId);
      continue;
    }
    if (!existing && !occupied.has(sourceId)) {
      occupied.add(sourceId);
      ids.set(sourceId, sourceId);
      continue;
    }
    const allocated = allocateResourceId(doc, occupied);
    doc = allocated.doc;
    ids.set(sourceId, allocated.id);
  }
  return { doc, ids };
}

function remapLiveMatteSource(
  source: LiveMatteSource,
  maps: ResourceMaps,
): LiveMatteSource | undefined {
  if (source.kind === 'scene-node') {
    const nodeId = maps.nodeIds.get(source.nodeId);
    return nodeId ? { ...source, nodeId } : undefined;
  }
  if (source.kind === 'raster-asset') {
    const assetId = maps.rasterMaskAssetIds.get(source.assetId);
    return assetId ? { ...source, assetId } : undefined;
  }
  return source;
}

function remapEffects(effects: readonly Effect[], maps: ResourceMaps): Effect[] {
  return effects.map((effect) => {
    const source = effect.mask?.source;
    if (!source) return effect;
    const remapped = remapLiveMatteSource(source, maps);
    if (!remapped) {
      const { mask: _mask, ...withoutMask } = effect;
      return withoutMask as Effect;
    }
    return { ...effect, mask: { ...effect.mask!, source: remapped } };
  });
}

function remapFill(fill: Fill, maps: ResourceMaps, assets: Document['assets']): Fill {
  if (fill.type !== 'image' || !fill.image) return fill;
  const assetId = remapId(fill.image.assetId, maps.assetIds);
  const asset = assetId ? assets?.[assetId] : undefined;
  const upscale = fill.image.upscale
    ? {
        ...fill.image.upscale,
        sourceAssetId:
          maps.assetIds.get(fill.image.upscale.sourceAssetId) ?? fill.image.upscale.sourceAssetId,
        upscaleAssetId:
          maps.assetIds.get(fill.image.upscale.upscaleAssetId) ?? fill.image.upscale.upscaleAssetId,
      }
    : undefined;
  return {
    ...fill,
    image: {
      ...fill.image,
      ...(assetId ? { assetId } : {}),
      ...(asset ? { src: asset.dataUrl } : {}),
      ...(upscale ? { upscale } : {}),
    },
  };
}

function remapNodeAssetReferences(
  node: SceneNode,
  maps: ResourceMaps,
  assets: Document['assets'],
): SceneNode {
  let result = node;
  if (node.fills) {
    result = {
      ...result,
      fills: node.fills.map((fill) => remapFill(fill, maps, assets)),
    } as SceneNode;
  }
  if (node.mask) {
    const mask = { ...node.mask };
    if (mask.sourceNodeId) {
      const sourceNodeId = maps.nodeIds.get(mask.sourceNodeId);
      if (sourceNodeId) mask.sourceNodeId = sourceNodeId;
      else delete mask.sourceNodeId;
    }
    if (mask.rasterMask) {
      mask.rasterMask = {
        ...mask.rasterMask,
        assetId: maps.rasterMaskAssetIds.get(mask.rasterMask.assetId) ?? mask.rasterMask.assetId,
      };
    }
    if (mask.matteSource) {
      const matteSource = remapLiveMatteSource(mask.matteSource, maps);
      if (matteSource) mask.matteSource = matteSource;
      else delete mask.matteSource;
    }
    const hasSource = Boolean(
      mask.sourceNodeId || mask.vectorMask || mask.rasterMask || mask.matteSource,
    );
    result = { ...result, mask: hasSource ? mask : undefined } as SceneNode;
  }
  if ('effects' in node && Array.isArray(node.effects)) {
    result = { ...result, effects: remapEffects(node.effects, maps) } as SceneNode;
  }
  if (node.iconAssetId) {
    const iconAssetId = maps.iconAssetIds.get(node.iconAssetId);
    result = {
      ...result,
      ...(iconAssetId ? { iconAssetId } : { iconAssetId: undefined }),
    } as SceneNode;
  }
  if (node.kind === 'frame' && node.mockup) {
    result = {
      ...result,
      mockup: {
        ...node.mockup,
        surfaceBindings: Object.fromEntries(
          Object.entries(node.mockup.surfaceBindings)
            .map(([surfaceId, binding]) => {
              if (binding.mode === 'live' && binding.nodeId) {
                const nodeId = maps.nodeIds.get(binding.nodeId);
                return nodeId ? [surfaceId, { ...binding, nodeId }] : null;
              }
              return [
                surfaceId,
                binding.assetId
                  ? {
                      ...binding,
                      assetId: maps.assetIds.get(binding.assetId) ?? binding.assetId,
                    }
                  : binding,
              ];
            })
            .filter((entry): entry is [string, (typeof node.mockup.surfaceBindings)[string]] =>
              Boolean(entry),
            ),
        ),
      },
    } as SceneNode;
  }
  return result;
}

function remapGenerativeEditAssets(
  edit: import('@varve/scene').GenerativeEditRecord,
  maps: ResourceMaps,
): import('@varve/scene').GenerativeEditRecord {
  const remapMask = (assetId: string | undefined) => remapId(assetId, maps.rasterMaskAssetIds);
  return {
    ...edit,
    sourceAssetId: remapId(edit.sourceAssetId, maps.assetIds),
    sourceSnapshotAssetId: remapId(edit.sourceSnapshotAssetId, maps.assetIds),
    maskAssetId: remapMask(edit.maskAssetId) ?? edit.maskAssetId,
    masks: {
      ...edit.masks,
      userMaskAssetId: remapMask(edit.masks.userMaskAssetId) ?? edit.masks.userMaskAssetId,
      inferenceMaskAssetId: remapMask(edit.masks.inferenceMaskAssetId),
      compositeMaskAssetId: remapMask(edit.masks.compositeMaskAssetId),
    },
    variations: edit.variations.map((variation) => ({
      ...variation,
      assetId: remapId(variation.assetId, maps.assetIds) ?? variation.assetId,
      ...(variation.thumbnailAssetId
        ? {
            thumbnailAssetId:
              remapId(variation.thumbnailAssetId, maps.assetIds) ?? variation.thumbnailAssetId,
          }
        : {}),
      contextAssetId: remapId(variation.contextAssetId, maps.assetIds),
    })),
  };
}

function mergeImportedAssets(target: Document, source: Document, maps: ResourceMaps): Document {
  const assets: Record<string, DocumentAsset> = { ...(target.assets ?? {}) };
  for (const [sourceId, asset] of Object.entries(source.assets ?? {})) {
    const id = maps.assetIds.get(sourceId);
    if (!id || (id === sourceId && assets[id])) continue;
    const metadata = asset.metadata?.iccProfileId
      ? {
          ...asset.metadata,
          iccProfileId:
            maps.iccProfileIds.get(asset.metadata.iccProfileId) ?? asset.metadata.iccProfileId,
        }
      : asset.metadata;
    assets[id] = { ...asset, id, ...(metadata ? { metadata } : {}) };
  }

  const rasterMaskAssets: Record<string, RasterMaskAsset> = {
    ...(target.rasterMaskAssets ?? {}),
  };
  for (const [sourceId, asset] of Object.entries(source.rasterMaskAssets ?? {})) {
    const id = maps.rasterMaskAssetIds.get(sourceId);
    if (!id || (id === sourceId && rasterMaskAssets[id])) continue;
    rasterMaskAssets[id] = { ...asset, id };
  }

  const iconAssets: Record<string, DocumentIconAsset> = { ...(target.iconAssets ?? {}) };
  for (const [sourceId, asset] of Object.entries(source.iconAssets ?? {})) {
    const id = maps.iconAssetIds.get(sourceId);
    if (!id || (id === sourceId && iconAssets[id])) continue;
    iconAssets[id] = {
      ...asset,
      id,
      instanceNodeIds: asset.instanceNodeIds
        .map((nodeId) => maps.nodeIds.get(nodeId))
        .filter((nodeId): nodeId is string => Boolean(nodeId)),
    };
  }

  const iccProfiles: Record<string, IccProfileEntry> = { ...(target.iccProfiles ?? {}) };
  for (const [sourceId, profile] of Object.entries(source.iccProfiles ?? {})) {
    const id = maps.iccProfileIds.get(sourceId);
    if (!id || (id === sourceId && iccProfiles[id])) continue;
    iccProfiles[id] = { ...profile, id };
  }

  return {
    ...target,
    ...(Object.keys(assets).length > 0 ? { assets } : {}),
    ...(Object.keys(rasterMaskAssets).length > 0 ? { rasterMaskAssets } : {}),
    ...(Object.keys(iconAssets).length > 0 ? { iconAssets } : {}),
    ...(Object.keys(iccProfiles).length > 0 ? { iccProfiles } : {}),
  };
}

function remapValue(value: string | boolean, nodeIds: Map<string, string>): string | boolean {
  return typeof value === 'string' ? (nodeIds.get(value) ?? value) : value;
}

function remapVariableValue(
  value: unknown,
  ids: Map<string, string>,
  aliases: Map<string, string> = ids,
): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(
    /\{([^}]+)\}/g,
    (_, id: string) => `{${ids.get(id) ?? aliases.get(id) ?? id}}`,
  );
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
    paintIds: new Map(),
    templateIds: new Map(),
    variableIds: new Map(),
    collectionIds: new Map(),
    storyIds: new Map(),
    timelineIds: new Map(),
    motionExtensionIds: new Map(),
    motionPresetIds: new Map(),
    assetIds: new Map(),
    rasterMaskAssetIds: new Map(),
    iconAssetIds: new Map(),
    iccProfileIds: new Map(),
  };

  let mapped = mapImportedAssetIds(doc, sourceDoc.assets, doc.assets, occupied);
  doc = mapped.doc;
  maps.assetIds = mapped.ids;
  mapped = mapImportedAssetIds(doc, sourceDoc.rasterMaskAssets, doc.rasterMaskAssets, occupied);
  doc = mapped.doc;
  maps.rasterMaskAssetIds = mapped.ids;
  mapped = mapImportedAssetIds(doc, sourceDoc.iconAssets, doc.iconAssets, occupied);
  doc = mapped.doc;
  maps.iconAssetIds = mapped.ids;
  mapped = mapImportedAssetIds(doc, sourceDoc.iccProfiles, doc.iccProfiles, occupied);
  doc = mapped.doc;
  maps.iccProfileIds = mapped.ids;
  doc = mergeImportedAssets(doc, sourceDoc, maps);

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
  for (const id of Object.keys(sourceDoc.paints ?? {})) {
    const allocated = allocateResourceId(doc, occupied);
    doc = allocated.doc;
    maps.paintIds.set(id, allocated.id);
  }
  for (const id of Object.keys(sourceDoc.mockupTemplates ?? {})) {
    const allocated = allocateResourceId(doc, occupied);
    doc = allocated.doc;
    maps.templateIds.set(id, allocated.id);
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
  for (const id of Object.keys(sourceDoc.stories ?? {})) {
    const allocated = allocateResourceId(doc, occupied);
    doc = allocated.doc;
    maps.storyIds.set(id, allocated.id);
  }
  for (const id of Object.keys(sourceDoc.timelines ?? {})) {
    const allocated = allocateResourceId(doc, occupied);
    doc = allocated.doc;
    maps.timelineIds.set(id, allocated.id);
  }
  for (const id of Object.keys(sourceDoc.motionExtensions ?? {})) {
    const allocated = allocateResourceId(doc, occupied);
    doc = allocated.doc;
    maps.motionExtensionIds.set(id, allocated.id);
  }
  for (const id of Object.keys(sourceDoc.motionPresets ?? {})) {
    const allocated = allocateResourceId(doc, occupied);
    doc = allocated.doc;
    maps.motionPresetIds.set(id, allocated.id);
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
        ...(slot.defaultContentId && nodeIds.has(slot.defaultContentId)
          ? { defaultContentId: nodeIds.get(slot.defaultContentId) }
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
    styles[id] =
      source.type === 'color'
        ? { ...source, id, fill: remapFill(source.fill, maps, doc.assets) }
        : source.type === 'effect'
          ? { ...source, id, effects: remapEffects(source.effects, maps) }
          : { ...source, id };
  }

  const paints = { ...(doc.paints ?? {}) };
  for (const [sourceId, source] of Object.entries(sourceDoc.paints ?? {})) {
    const id = maps.paintIds.get(sourceId);
    if (!id) continue;
    paints[id] = {
      ...source,
      id,
      fill: remapFill(structuredClone(source.fill), maps, doc.assets),
    };
  }

  const mockupTemplates = { ...(doc.mockupTemplates ?? {}) };
  for (const [sourceId, source] of Object.entries(sourceDoc.mockupTemplates ?? {})) {
    const id = maps.templateIds.get(sourceId);
    if (!id) continue;
    mockupTemplates[id] = { ...structuredClone(source), id } as MockupTemplateAsset;
  }

  const sourceStore = sourceDoc.variableStore;
  if (sourceStore) {
    const existing = doc.variableStore;
    const variables = { ...(existing?.variables ?? {}) };
    const variableAliases = new Map<string, string>();
    for (const [sourceId, variable] of Object.entries(sourceStore.variables)) {
      const id = maps.variableIds.get(sourceId);
      if (!id) continue;
      variableAliases.set(sourceId, id);
      variableAliases.set(variable.name, id);
    }
    for (const [sourceId, variable] of Object.entries(sourceStore.variables)) {
      const id = maps.variableIds.get(sourceId);
      if (!id) continue;
      variables[id] = {
        ...variable,
        id,
        valuesByMode: Object.fromEntries(
          Object.entries(variable.valuesByMode).map(([mode, value]) => [
            mode,
            remapVariableValue(value, maps.variableIds, variableAliases),
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
        variableIds: collection.variableIds
          .map((variableId) => maps.variableIds.get(variableId))
          .filter((variableId): variableId is string => Boolean(variableId)),
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
  const generativeEdits = { ...(doc.generativeEdits ?? {}) };
  const generativeIdMap = new Map<string, string>();
  for (const [sourceEditId, sourceEdit] of Object.entries(sourceDoc.generativeEdits ?? {})) {
    const sourceNodeId = maps.nodeIds.get(sourceEdit.sourceNodeId);
    if (!sourceNodeId) continue;
    let editId = sourceEditId;
    if (generativeEdits[editId]) {
      editId = `${sourceEditId}-${sourceNodeId}`;
      let suffix = 2;
      while (generativeEdits[editId]) editId = `${sourceEditId}-${sourceNodeId}-${suffix++}`;
    }
    generativeIdMap.set(sourceEditId, editId);
    generativeEdits[editId] = {
      ...sourceEdit,
      id: editId,
      sourceNodeId,
      ...(sourceEdit.resultNodeId && maps.nodeIds.has(sourceEdit.resultNodeId)
        ? { resultNodeId: maps.nodeIds.get(sourceEdit.resultNodeId) }
        : {}),
    };
    const importedEdit = generativeEdits[editId];
    if (importedEdit) {
      generativeEdits[editId] = remapGenerativeEditAssets(importedEdit, maps);
    }
  }
  for (const targetId of nodeIds.values()) {
    const node = nodes[targetId];
    if (!node) continue;
    const candidate = { ...node } as SceneNode & {
      componentId?: string;
      styleId?: string;
      bindings?: Record<string, { variableId: string }>;
      mockup?: { templateId?: string };
      generativeEditId?: string;
      paintRefs?: string[];
      storyBinding?: { storyId: string; threadIndex: number };
      pathId?: string;
    };
    const remappedAssetReferences = remapNodeAssetReferences(candidate, maps, doc.assets);
    Object.assign(candidate, remappedAssetReferences);
    if ('componentId' in candidate) {
      const componentId = maps.componentIds.get(candidate.componentId ?? '');
      if (componentId && components[componentId]) candidate.componentId = componentId;
      else delete candidate.componentId;
    }
    if (candidate.styleId) candidate.styleId = maps.styleIds.get(candidate.styleId);
    if (candidate.paintRefs) {
      candidate.paintRefs = candidate.paintRefs
        .map((paintId) => maps.paintIds.get(paintId))
        .filter((paintId): paintId is string => Boolean(paintId));
      if (candidate.paintRefs.length === 0) delete candidate.paintRefs;
    }
    if (candidate.pathId) {
      const pathId = maps.nodeIds.get(candidate.pathId);
      if (pathId) candidate.pathId = pathId;
      else delete candidate.pathId;
    }
    if (candidate.storyBinding) {
      const storyId = maps.storyIds.get(candidate.storyBinding.storyId);
      if (storyId) candidate.storyBinding = { ...candidate.storyBinding, storyId };
      else delete candidate.storyBinding;
    }
    const bindings = (candidate as unknown as { bindings?: Record<string, { variableId: string }> })
      .bindings;
    if (bindings) {
      const remappedBindings: Record<string, { variableId: string }> = {};
      for (const [key, binding] of Object.entries(bindings)) {
        const variableId = maps.variableIds.get(binding.variableId);
        if (variableId) remappedBindings[key] = { ...binding, variableId };
      }
      if (Object.keys(remappedBindings).length > 0) {
        (candidate as unknown as { bindings: Record<string, { variableId: string }> }).bindings =
          remappedBindings;
      } else delete (candidate as unknown as { bindings?: unknown }).bindings;
    }
    if (candidate.kind === 'frame' && candidate.mockup?.templateId) {
      const templateId = maps.templateIds.get(candidate.mockup.templateId);
      if (templateId) candidate.mockup = { ...candidate.mockup, templateId };
      else delete candidate.mockup;
    }
    if (candidate.generativeEditId) {
      const editId = generativeIdMap.get(candidate.generativeEditId);
      if (editId) candidate.generativeEditId = editId;
      else delete candidate.generativeEditId;
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

  const stories = { ...(doc.stories ?? {}) };
  for (const [sourceId, story] of Object.entries(sourceDoc.stories ?? {})) {
    const id = maps.storyIds.get(sourceId);
    if (!id) continue;
    stories[id] = {
      ...structuredClone(story),
      id,
      thread: story.thread
        .map((nodeId) => maps.nodeIds.get(nodeId))
        .filter((nodeId): nodeId is string => Boolean(nodeId)),
    };
  }

  const timelines = { ...(doc.timelines ?? {}) };
  for (const [sourceId, timeline] of Object.entries(sourceDoc.timelines ?? {})) {
    const id = maps.timelineIds.get(sourceId);
    if (!id) continue;
    timelines[id] = {
      ...structuredClone(timeline),
      id,
      tracks: timeline.tracks
        .map((track) => ({
          ...track,
          nodeId: maps.nodeIds.get(track.nodeId) ?? track.nodeId,
          ...(track.nestedTimelineId
            ? { nestedTimelineId: maps.timelineIds.get(track.nestedTimelineId) }
            : {}),
        }))
        .filter((track) => new Set(maps.nodeIds.values()).has(track.nodeId)),
    };
  }

  const motionExtensions = { ...(doc.motionExtensions ?? {}) };
  for (const [sourceId, extension] of Object.entries(sourceDoc.motionExtensions ?? {})) {
    const id = maps.motionExtensionIds.get(sourceId);
    const nodeId = maps.nodeIds.get(extension.nodeId);
    if (!id || !nodeId) continue;
    motionExtensions[id] = { ...structuredClone(extension), id, nodeId };
  }

  const motionPresets = { ...(doc.motionPresets ?? {}) };
  for (const [sourceId, preset] of Object.entries(sourceDoc.motionPresets ?? {})) {
    const id = maps.motionPresetIds.get(sourceId);
    const timelineId = maps.timelineIds.get(preset.timelineId);
    if (!id || !timelineId) continue;
    motionPresets[id] = { ...preset, id, timelineId };
  }

  return {
    doc: {
      ...doc,
      nodes,
      components,
      ...(Object.keys(styles).length > 0 ? { styles } : {}),
      ...(Object.keys(paints).length > 0 ? { paints } : {}),
      ...(Object.keys(mockupTemplates).length > 0 ? { mockupTemplates } : {}),
      ...(Object.keys(interactions).length > 0 ? { interactions } : {}),
      ...(Object.keys(stories).length > 0 ? { stories } : {}),
      ...(Object.keys(timelines).length > 0 ? { timelines } : {}),
      ...(Object.keys(motionExtensions).length > 0 ? { motionExtensions } : {}),
      ...(Object.keys(motionPresets).length > 0 ? { motionPresets } : {}),
      ...(Object.keys(generativeEdits).length > 0 ? { generativeEdits } : {}),
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
    ...Object.keys(doc.paints ?? {}),
    ...Object.keys(doc.mockupTemplates ?? {}),
    ...Object.keys(doc.variableStore?.variables ?? {}),
    ...Object.keys(doc.variableStore?.collections ?? {}),
    ...Object.keys(doc.stories ?? {}),
    ...Object.keys(doc.timelines ?? {}),
    ...Object.keys(doc.motionExtensions ?? {}),
    ...Object.keys(doc.motionPresets ?? {}),
    ...Object.keys(doc.assets ?? {}),
    ...Object.keys(doc.rasterMaskAssets ?? {}),
    ...Object.keys(doc.iconAssets ?? {}),
    ...Object.keys(doc.iccProfiles ?? {}),
  ]);
  for (const [sourceDoc, entries] of grouped) {
    const merged = mergeGroup(doc, sourceDoc, entries, occupied);
    doc = merged.doc;
  }
  return doc;
}
