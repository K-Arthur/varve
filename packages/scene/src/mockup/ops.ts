/**
 * Mockup document operations: template assets, instances, bindings, and
 * pruning. All operations are immutable (`(doc) => doc`) and safe to run
 * inside `updateDoc`.
 */

import { hashContent } from '../assets';
import type { Document } from '../document';
import type { FrameNode, NodeId } from '../types';
import type {
  MockupInstanceData,
  MockupSourceBinding,
  MockupSurfaceOverride,
  MockupTemplateAsset,
} from './types';
import { validateTemplate } from './validate';

export const MOCKUP_TEMPLATE_SCHEMA_VERSION = 1;

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
    category: template.category,
    source: template.source,
    orientation: template.orientation,
    outputWidth: template.outputWidth,
    outputHeight: template.outputHeight,
    backgroundColor: template.backgroundColor,
    plate: template.plate,
    surfaces: template.surfaces,
    overlays: template.overlays,
    licence: template.licence,
    tags: template.tags,
    capabilities: template.capabilities,
  };
  return hashContent(JSON.stringify(canonical));
}

/**
 * Add a template to the document, deduplicating by content hash: identical
 * templates collapse to one entry. Returns the resolved template id.
 */
export function addMockupTemplate(
  doc: Document,
  template: MockupTemplateAsset,
): { document: Document; templateId: string } {
  const contentHash = hashMockupTemplate(template);
  const existing = Object.values(
    doc.mockupTemplates ?? ({} as Record<string, MockupTemplateAsset>),
  ).find((t) => t.contentHash === contentHash);
  if (existing) return { document: doc, templateId: existing.id };

  const normalized: MockupTemplateAsset = {
    ...template,
    contentHash,
    createdAt: template.createdAt ?? Date.now(),
    updatedAt: template.updatedAt ?? Date.now(),
  };
  return {
    document: {
      ...doc,
      mockupTemplates: {
        ...doc.mockupTemplates,
        [template.id]: normalized,
      },
    },
    templateId: template.id,
  };
}

/** Drop templates not referenced by any frame's mockup payload. */
export function pruneUnusedMockupTemplates(doc: Document): Document {
  if (!doc.mockupTemplates) return doc;
  const used = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    if (isMockupFrame(node) && node.mockup.templateId) used.add(node.mockup.templateId);
  }
  const kept = Object.fromEntries(
    Object.entries(doc.mockupTemplates).filter(([id]) => used.has(id)),
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
  const updated: FrameNode = {
    ...node,
    mockup: { ...node.mockup, overrides },
  };
  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: updated },
  };
}

/** Replace the instance's template. */
export function setMockupTemplate(doc: Document, nodeId: NodeId, templateId: string): Document {
  const node = doc.nodes[nodeId];
  if (!isMockupFrame(node)) return doc;
  const updated: FrameNode = {
    ...node,
    mockup: { ...node.mockup, templateId, overrides: undefined },
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
  const contentHash = hashMockupTemplate(t);
  return { template: { ...t, contentHash } };
}
