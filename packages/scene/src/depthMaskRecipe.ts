/** Shared scene-level ownership and validation for re-editable depth masks. */

import type { DepthMapAsset, DepthMaskRecipe, RasterMaskAsset, SceneNode } from './types';

/**
 * Deliberately structural: this ownership helper is used by document.ts and
 * document-nodes.ts, so importing the monolithic Document type here would
 * recreate their scene-module cycle even though the dependency is type-only.
 */
interface DepthMaskDocument {
  depthMaps?: Record<string, DepthMapAsset>;
  rasterMaskAssets?: Record<string, RasterMaskAsset>;
  nodes?: Record<string, SceneNode>;
}

const COMBINE_MODES = ['replace', 'intersect', 'union', 'subtract'] as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate intent without decoding the potentially large scalar payload. */
export function validateDepthMaskRecipe(recipe: unknown, doc: DepthMaskDocument): string | null {
  if (!isObject(recipe)) return 'Depth mask recipe must be an object';
  if (recipe.schemaVersion !== 1) return 'Depth mask recipe schema is unsupported';
  if (typeof recipe.depthMapId !== 'string' || !doc.depthMaps?.[recipe.depthMapId]) {
    return 'Depth mask recipe references a missing depth map';
  }
  const binding = recipe.sourceBinding;
  if (!isObject(binding) || typeof binding.nodeId !== 'string') {
    return 'Depth mask recipe source binding is invalid';
  }
  if (doc.nodes && !doc.nodes[binding.nodeId]) {
    return 'Depth mask recipe source binding references a missing node';
  }
  if (
    binding.coordinateSpace !== 'source-image-pixels' ||
    !isSafeInteger(binding.processingRevision) ||
    binding.processingRevision < 0
  ) {
    return 'Depth mask recipe source binding is invalid';
  }
  const identity = recipe.sourceIdentity;
  if (!isObject(identity) || !isFiniteNumber(identity.revision) || identity.revision < 0) {
    return 'Depth mask recipe source identity is invalid';
  }
  const range = recipe.range;
  if (!isObject(range)) return 'Depth mask recipe range is missing';
  for (const key of ['near', 'far', 'nearTransition', 'farTransition'] as const) {
    if (!isFiniteNumber(range[key]) || range[key] < 0 || range[key] > 1) {
      return `Depth mask recipe ${key} must be within 0..1`;
    }
  }
  if (typeof recipe.invert !== 'boolean') return 'Depth mask recipe inversion is invalid';
  if (!COMBINE_MODES.includes(recipe.combine as (typeof COMBINE_MODES)[number])) {
    return 'Depth mask recipe combine mode is unsupported';
  }
  if (!isSafeInteger(recipe.algorithmVersion) || recipe.algorithmVersion < 1) {
    return 'Depth mask recipe algorithm version is invalid';
  }
  if (recipe.correction !== undefined) {
    const correction = recipe.correction;
    if (!isObject(correction) || !isSafeInteger(correction.revision) || correction.revision < 0) {
      return 'Depth mask recipe correction is invalid';
    }
    if (correction.target !== 'coverage' && correction.target !== 'depth') {
      return 'Depth mask recipe correction target is invalid';
    }
    if (
      correction.assetId !== undefined &&
      (typeof correction.assetId !== 'string' || !doc.rasterMaskAssets?.[correction.assetId])
    ) {
      return 'Depth mask recipe correction references a missing mask asset';
    }
  }
  return null;
}

/** Return all depth resources needed by live effects and depth-mask recipes. */
export function collectDepthMapIds(doc: { nodes: Record<string, SceneNode> }): Set<string> {
  const ids = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    const effects = 'effects' in node ? node.effects : undefined;
    for (const effect of effects ?? []) {
      if (effect.type === 'depthBlur') ids.add(effect.depthMapId);
    }
    const recipe = node.mask?.rasterMask?.depthRecipe;
    if (recipe) ids.add(recipe.depthMapId);
  }
  return ids;
}

/**
 * Remove only depth resources no longer reachable from document nodes. The
 * caller controls when pruning occurs; simply saving a document never invokes
 * this helper, so a reusable library resource is not deleted accidentally.
 */
export function pruneUnreferencedDepthMaps<
  T extends DepthMaskDocument & {
    nodes: Record<string, SceneNode>;
    depthMaps?: Record<string, DepthMapAsset>;
  },
>(doc: T): T {
  if (!doc.depthMaps) return doc;
  const references = collectDepthMapIds(doc);
  const depthMaps = Object.fromEntries(
    Object.entries(doc.depthMaps).filter(([id]) => references.has(id)),
  );
  return Object.keys(depthMaps).length > 0
    ? { ...doc, depthMaps }
    : { ...doc, depthMaps: undefined };
}

/** Keep the type-level dependency obvious at call sites that only see nodes. */
export function depthMaskRecipeForNode(node: SceneNode): DepthMaskRecipe | undefined {
  return node.mask?.rasterMask?.depthRecipe;
}
