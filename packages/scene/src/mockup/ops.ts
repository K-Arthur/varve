/**
 * Mockup document operations: template assets, instances, bindings, and
 * pruning. All operations are immutable (`(doc) => doc`) and safe to run
 * inside `updateDoc`.
 */

import { hashContent } from '../assets';
import type { Document } from '../document';
import type { FrameNode, NodeId } from '../types';
import { canBindMockupSource } from './binding';
import type {
  MockupInstanceData,
  MockupSourceBinding,
  MockupSurfaceOverride,
  MockupTemplateAsset,
} from './types';
import { validateInstance, validateTemplate } from './validate';

/** Current persistent template schema. Schema 1 remains readable via migration. */
export const MOCKUP_TEMPLATE_SCHEMA_VERSION = 2;

export function isMockupFrame(node: unknown): node is FrameNode & { mockup: MockupInstanceData } {
  return (
    !!node &&
    typeof node === 'object' &&
    (node as { kind?: string }).kind === 'frame' &&
    !!(node as { mockup?: unknown }).mockup
  );
}

export function getMockupTemplate(
  doc: Document,
  templateId: string,
): MockupTemplateAsset | undefined {
  return doc.mockupTemplates?.[templateId];
}

/**
 * Deterministic content hash for a template. Mirrors the asset-table hash
 * so dedup is cheap and stable across sessions.
 */
export function hashMockupTemplate(template: Omit<MockupTemplateAsset, 'contentHash'>): string {
  const canonical = {
    id: template.id,
    schemaVersion: template.schemaVersion,
    name: template.name,
    description: template.description,
    category: template.category,
    source: template.source,
    orientation: template.orientation,
    outputWidth: template.outputWidth,
    outputHeight: template.outputHeight,
    backgroundColor: template.backgroundColor,
    plateImage: template.plateImage,
    plate: template.plate,
    surfaces: template.surfaces,
    overlays: template.overlays,
    licence: template.licence,
    tags: template.tags,
    capabilities: template.capabilities,
    library: template.library,
  };
  return hashContent(JSON.stringify(canonical));
}

/**
 * Upgrade a validated legacy template to the current schema without
 * changing its geometry or instance bindings. Schema 2 only adds optional
 * fields, so this migration is deliberately structural and deterministic.
 */
export function migrateMockupTemplateSchema(template: MockupTemplateAsset): MockupTemplateAsset {
  if (template.schemaVersion >= MOCKUP_TEMPLATE_SCHEMA_VERSION) return template;
  const migrated: MockupTemplateAsset = {
    ...template,
    schemaVersion: MOCKUP_TEMPLATE_SCHEMA_VERSION,
  };
  return { ...migrated, contentHash: hashMockupTemplate(migrated) };
}

/**
 * Add a template to the document, deduplicating by content hash: identical
 * templates collapse to one entry. Returns the resolved template id.
 */
export function addMockupTemplate(
  doc: Document,
  template: MockupTemplateAsset,
): { document: Document; templateId: string } {
  const compatible = migrateMockupTemplateSchema(template);
  const contentHash = hashMockupTemplate(compatible);
  const existing = Object.values(
    doc.mockupTemplates ?? ({} as Record<string, MockupTemplateAsset>),
  ).find((t) => t.contentHash === contentHash);
  if (existing) return { document: doc, templateId: existing.id };

  const normalized: MockupTemplateAsset = {
    ...compatible,
    contentHash,
    createdAt: compatible.createdAt ?? Date.now(),
    updatedAt: compatible.updatedAt ?? Date.now(),
  };
  return {
    document: {
      ...doc,
      mockupTemplates: {
        ...doc.mockupTemplates,
        [compatible.id]: normalized,
      },
    },
    templateId: compatible.id,
  };
}

/** Drop templates not referenced by any frame's mockup payload. Library
 *  templates (user-authored for reuse) are retained until explicitly
 *  deleted. */
export function pruneUnusedMockupTemplates(doc: Document): Document {
  if (!doc.mockupTemplates) return doc;
  const used = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    if (isMockupFrame(node) && node.mockup.templateId) used.add(node.mockup.templateId);
  }
  const kept = Object.fromEntries(
    Object.entries(doc.mockupTemplates).filter(
      ([id, template]) => used.has(id) || template.library === true,
    ),
  );
  if (Object.keys(kept).length === Object.keys(doc.mockupTemplates).length) return doc;
  return {
    ...doc,
    mockupTemplates: Object.keys(kept).length > 0 ? kept : undefined,
  };
}

/** Collect every asset id referenced by mockup snapshot bindings. */
export function mockupSnapshotAssetIds(doc: Document): string[] {
  const ids: string[] = [];
  for (const node of Object.values(doc.nodes)) {
    if (!isMockupFrame(node)) continue;
    for (const binding of Object.values(node.mockup.surfaceBindings)) {
      if (binding.mode === 'snapshot' && binding.assetId) ids.push(binding.assetId);
    }
  }
  return ids;
}

/** Create instance payload for a frame. */
export function createMockupInstanceData(
  templateId: string,
  surfaceBindings: Record<string, MockupSourceBinding>,
): MockupInstanceData {
  return {
    templateId,
    surfaceBindings,
    createdAt: Date.now(),
  };
}

/** Bind a surface to a live node or snapshot asset. */
export function setMockupBinding(
  doc: Document,
  nodeId: NodeId,
  surfaceId: string,
  binding: MockupSourceBinding,
): Document {
  const node = doc.nodes[nodeId];
  if (!isMockupFrame(node)) return doc;
  const template = getMockupTemplate(doc, node.mockup.templateId);
  if (!template?.surfaces.some((surface) => surface.id === surfaceId)) return doc;
  if (binding.mode === 'live') {
    if (!binding.nodeId || !canBindMockupSource(doc, nodeId, binding.nodeId).ok) return doc;
  } else if (!binding.assetId || !doc.assets?.[binding.assetId]) {
    return doc;
  }
  const updated: FrameNode = {
    ...node,
    mockup: {
      ...node.mockup,
      surfaceBindings: {
        ...node.mockup.surfaceBindings,
        [surfaceId]: binding,
      },
    },
  };
  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: updated },
  };
}

/** Set per-surface overrides on an instance. */
export function setMockupSurfaceOverride(
  doc: Document,
  nodeId: NodeId,
  surfaceId: string,
  override: MockupSurfaceOverride,
): Document {
  const node = doc.nodes[nodeId];
  if (!isMockupFrame(node)) return doc;
  const overrides = {
    ...node.mockup.overrides,
    [surfaceId]: { ...node.mockup.overrides?.[surfaceId], ...override },
  };
  const updatedMockup: MockupInstanceData = { ...node.mockup, overrides };
  const updated: FrameNode = {
    ...node,
    mockup: updatedMockup,
  };
  const validation = validateInstance(
    { ...doc, nodes: { ...doc.nodes, [nodeId]: updated } },
    updatedMockup,
    nodeId,
  );
  if (!validation.ok) return doc;
  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: updated },
  };
}

/** Replace (or clear, with `null`) a surface's whole override object. */
export function replaceMockupSurfaceOverride(
  doc: Document,
  nodeId: NodeId,
  surfaceId: string,
  override: MockupSurfaceOverride | null,
): Document {
  const node = doc.nodes[nodeId];
  if (!isMockupFrame(node)) return doc;
  const nextOverrides: Record<string, MockupSurfaceOverride> = { ...node.mockup.overrides };
  if (override === null) delete nextOverrides[surfaceId];
  else nextOverrides[surfaceId] = override;
  const updated: FrameNode = {
    ...node,
    mockup: {
      ...node.mockup,
      overrides: Object.keys(nextOverrides).length > 0 ? nextOverrides : undefined,
    },
  };
  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: updated },
  };
}

/** Remove a surface binding entirely (the surface renders as unassigned). */
export function clearMockupBinding(doc: Document, nodeId: NodeId, surfaceId: string): Document {
  const node = doc.nodes[nodeId];
  if (!isMockupFrame(node)) return doc;
  const rest = { ...node.mockup.surfaceBindings };
  delete rest[surfaceId];
  const updated: FrameNode = {
    ...node,
    mockup: { ...node.mockup, surfaceBindings: rest },
  };
  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: updated },
  };
}

export interface MockupTemplateRemapAssignment {
  surfaceId: string;
  surfaceName: string;
  sourceSlot: string;
  binding?: MockupSourceBinding;
}

export interface MockupTemplateRemapPlan {
  templateFound: boolean;
  assignments: MockupTemplateRemapAssignment[];
  unboundSurfaceIds: string[];
  ambiguousSurfaceIds: string[];
  remappedCount: number;
}

/**
 * Plan replacing an instance's template. Surfaces are matched by
 * `sourceSlot` semantics (stable identity), never by array position: a new
 * surface inherits the binding of the not-yet-consumed old surface with the
 * same slot. New slots with no semantic match stay explicitly unbound so the
 * UI can show them before committing.
 */
export function planMockupTemplateRemap(
  doc: Document,
  nodeId: NodeId,
  templateId: string,
): MockupTemplateRemapPlan {
  const node = doc.nodes[nodeId];
  const template = doc.mockupTemplates?.[templateId];
  if (!isMockupFrame(node) || !template) {
    return {
      templateFound: false,
      assignments: [],
      unboundSurfaceIds: [],
      ambiguousSurfaceIds: [],
      remappedCount: 0,
    };
  }
  const oldTemplate = doc.mockupTemplates?.[node.mockup.templateId];
  const oldSurfaces = oldTemplate?.surfaces ?? [];
  const consumed = new Set<string>();
  const assignments: MockupTemplateRemapAssignment[] = [];
  const unboundSurfaceIds: string[] = [];
  const ambiguousSurfaceIds: string[] = [];
  for (const surface of template.surfaces) {
    // Prefer stable surface identity. Semantic sourceSlot is the fallback
    // for a genuinely new template, but multiple candidates are unsafe to
    // guess because the same artwork may intentionally be assigned to only
    // one face.
    const exact = oldSurfaces.find((s) => s.id === surface.id && !consumed.has(s.id));
    const candidates = oldSurfaces.filter(
      (s) => s.sourceSlot === surface.sourceSlot && !consumed.has(s.id),
    );
    const match = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
    const ambiguous = !exact && candidates.length > 1;
    if (match) consumed.add(match.id);
    const binding = match ? node.mockup.surfaceBindings[match.id] : undefined;
    assignments.push({
      surfaceId: surface.id,
      surfaceName: surface.name,
      sourceSlot: surface.sourceSlot,
      binding,
    });
    if (!binding) unboundSurfaceIds.push(surface.id);
    if (ambiguous) ambiguousSurfaceIds.push(surface.id);
  }
  return {
    templateFound: true,
    assignments,
    unboundSurfaceIds,
    ambiguousSurfaceIds,
    remappedCount: assignments.filter((a) => a.binding !== undefined).length,
  };
}

/** Apply a planned template replacement (bindings remapped, overrides reset). */
export function applyMockupTemplateRemap(
  doc: Document,
  nodeId: NodeId,
  templateId: string,
): { document: Document; unboundSurfaceIds: string[] } {
  const node = doc.nodes[nodeId];
  if (!isMockupFrame(node)) return { document: doc, unboundSurfaceIds: [] };
  const plan = planMockupTemplateRemap(doc, nodeId, templateId);
  if (!plan.templateFound) return { document: doc, unboundSurfaceIds: [] };
  const bindings: Record<string, MockupSourceBinding> = {};
  for (const assignment of plan.assignments) {
    if (assignment.binding) bindings[assignment.surfaceId] = assignment.binding;
  }
  const updated: FrameNode = {
    ...node,
    mockup: {
      ...node.mockup,
      templateId,
      surfaceBindings: bindings,
      overrides: undefined,
      templateOwnerId: undefined,
    },
  };
  return {
    document: { ...doc, nodes: { ...doc.nodes, [nodeId]: updated } },
    unboundSurfaceIds: plan.unboundSurfaceIds,
  };
}

/**
 * Update an embedded template through an immutable updater. Used by authoring
 * controls; callers should make the template unique first when editing an
 * instance-owned copy so shared users are not mutated.
 */
export function updateMockupTemplate(
  doc: Document,
  templateId: string,
  updater: (template: MockupTemplateAsset) => MockupTemplateAsset,
): Document {
  const existing = doc.mockupTemplates?.[templateId];
  if (!existing) return doc;
  const next = updater(existing);
  return {
    ...doc,
    mockupTemplates: {
      ...doc.mockupTemplates,
      [templateId]: { ...next, contentHash: hashMockupTemplate(next), updatedAt: Date.now() },
    },
  };
}

/**
 * Give an instance its own private copy of its template (user library),
 * leaving every other user of the original untouched. Returns the new
 * template id, or null when the frame/template is missing or already unique.
 */
export function makeMockupTemplateUnique(
  doc: Document,
  nodeId: NodeId,
): { document: Document; templateId: string } | null {
  const node = doc.nodes[nodeId];
  if (!isMockupFrame(node)) return null;
  const template = doc.mockupTemplates?.[node.mockup.templateId];
  if (!template) return null;
  if (node.mockup.templateOwnerId === nodeId) {
    return { document: doc, templateId: template.id };
  }
  const baseId = `user:${template.id.replace(/^user:/, '')}-${Date.now().toString(36)}`;
  let uniqueId = baseId;
  let suffix = 2;
  while (doc.mockupTemplates?.[uniqueId]) {
    uniqueId = `${baseId}-${suffix}`;
    suffix++;
  }
  const clone: MockupTemplateAsset = {
    ...template,
    id: uniqueId,
    source: 'user',
    library: true,
    name: template.name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const unique: MockupTemplateAsset = { ...clone, contentHash: hashMockupTemplate(clone) };
  const updated: FrameNode = {
    ...node,
    mockup: { ...node.mockup, templateId: uniqueId, templateOwnerId: nodeId },
  };
  return {
    document: {
      ...doc,
      mockupTemplates: { ...doc.mockupTemplates, [uniqueId]: unique },
      nodes: { ...doc.nodes, [nodeId]: updated },
    },
    templateId: uniqueId,
  };
}

/** Replace the instance's template. */
export function setMockupTemplate(doc: Document, nodeId: NodeId, templateId: string): Document {
  const node = doc.nodes[nodeId];
  if (!isMockupFrame(node) || !doc.mockupTemplates?.[templateId]) return doc;
  const updated: FrameNode = {
    ...node,
    mockup: { ...node.mockup, templateId, overrides: undefined, templateOwnerId: undefined },
  };
  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: updated },
  };
}

/** Remove the mockup payload from a frame (the frame itself stays). */
export function clearMockup(doc: Document, nodeId: NodeId): Document {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'frame' || !node.mockup) return doc;
  const { mockup: _mockup, ...rest } = node as FrameNode;
  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: { ...rest, mockup: undefined } },
  };
}

/** Mark an instance as detached (content already flattened to editable nodes). */
export function markMockupDetached(doc: Document, nodeId: NodeId, detached: boolean): Document {
  const node = doc.nodes[nodeId];
  if (!isMockupFrame(node)) return doc;
  const updated: FrameNode = {
    ...node,
    mockup: { ...node.mockup, detached },
  };
  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: updated },
  };
}

/**
 * Cheap, stable content digest of a source subtree for mockup cache
 * invalidation: node fields + referenced asset hashes. Any change to the
 * source's paint/geometry/children changes the digest; cosmetic fields
 * (order, name, layerColor) are excluded so renames don't re-render.
 */
export function computeMockupSourceDigest(
  doc: Document,
  rootId: NodeId,
  visited = new Set<NodeId>(),
): string {
  if (visited.has(rootId)) return '';
  visited.add(rootId);
  const node = doc.nodes[rootId];
  if (!node) return `missing:${rootId}`;

  const parts: unknown[] = [];
  const pushNode = (n: typeof node): void => {
    const {
      order: _o,
      name: _n,
      layerColor: _c,
      ...content
    } = n as unknown as Record<string, unknown>;
    parts.push(content);
    const fills = (content.fills ?? []) as Array<{ type?: string; image?: { assetId?: string } }>;
    for (const fill of fills) {
      const assetId = fill.type === 'image' ? fill.image?.assetId : undefined;
      const asset = assetId ? doc.assets?.[assetId] : undefined;
      if (asset) parts.push(asset.hash ?? asset.dataUrl);
    }
  };
  pushNode(node);
  if ('children' in node && node.children) {
    for (const childId of node.children) {
      parts.push(computeMockupSourceDigest(doc, childId, visited));
    }
  }
  if (node.mask?.rasterMask?.assetId) {
    const asset = doc.rasterMaskAssets?.[node.mask.rasterMask.assetId];
    if (asset) parts.push(asset.dataUrl);
  }
  return hashContent(JSON.stringify(parts));
}

/** Build a validated template from raw JSON (user import path). */
export function buildTemplateFromJson(
  raw: unknown,
): { template: MockupTemplateAsset } | { errors: string[] } {
  const validation = validateTemplate(raw);
  if (!validation.ok) return { errors: validation.errors };
  const t = raw as MockupTemplateAsset;
  const migrated = migrateMockupTemplateSchema(t);
  const contentHash = hashMockupTemplate(migrated);
  return { template: { ...migrated, contentHash } };
}
