/**
 * Frequency separation — scene-level model and operations.
 *
 * Representation
 * --------------
 * Applying frequency separation converts one raster layer into a marked group:
 *
 *   group "… Frequency Separation"   (frequencySeparation marker)
 *     ├─ raster "… Tone"   (low band: blurred colour/tone)
 *     └─ raster "… Detail" (high band: encoded signed residual)
 *
 * Both bands are ordinary raster layer nodes, so painting, cloning, healing,
 * masks, transforms, layer styles, history, save/reopen and export already
 * work on them. The marker points at the band ids — never at names — so
 * renaming is always safe. Rendering decodes `low + (high − 128)·2` in the IR
 * builder; the group is never composited as two ordinary layers.
 *
 * Source lifecycle
 * ----------------
 * - The original raster layer becomes the tone band; its pixels are replaced
 *   by the low-pass. The original pixels are recoverable from `low + high`
 *   until either band is edited.
 * - Changing the radius re-splits the *current* recombined state, so
 *   retouching is preserved as pixels and only the split point moves. It never
 *   silently discards edits, and it never silently keeps a stale split.
 * - `flattenFrequencySeparation` bakes the current decode into one raster
 *   layer and drops the high band and marker (an explicit, undoable command).
 * - If either band is missing, hidden, or unlinked, the group renders as an
 *   ordinary group; the marker is inert data, never a crash vector.
 */

import {
  decodeResidualChannel,
  decomposeFrequencyBands,
  FREQUENCY_SEPARATION_METHODS,
  FREQUENCY_SEPARATION_VERSION,
  type FrequencySeparationMethod,
  imageDataToRasterTiles,
  isIdentityLiquifyField,
  measureReconstruction,
  normalizeSeparationRadius,
  type ReconstructionError,
  rasterTilesToImageData,
  validateLiquifyField,
  warpImageDataByField,
} from '@varve/engine';
import { generateKeyBetween } from '@varve/shared';
import { makeGroupNode } from './document-utils';
import { makeRasterLayerNode, TILE_SIZE } from './rasterLayer';
import type {
  FrequencySeparationState,
  GroupNode,
  RasterLayerNode,
  RasterTile,
  SceneNode,
} from './types';

export type { FrequencySeparationState } from './types';

export interface FrequencySeparationGroup {
  groupId: string;
  state: FrequencySeparationState;
}

interface DocumentLike {
  nodes: Record<string, SceneNode>;
  nextId: number;
  rootChildren?: readonly string[];
}

export function isFrequencySeparationState(raw: unknown): raw is FrequencySeparationState {
  if (typeof raw !== 'object' || raw === null) return false;
  const value = raw as Record<string, unknown>;
  return (
    value.version === FREQUENCY_SEPARATION_VERSION &&
    typeof value.lowNodeId === 'string' &&
    typeof value.highNodeId === 'string' &&
    typeof value.radius === 'number' &&
    Number.isFinite(value.radius) &&
    FREQUENCY_SEPARATION_METHODS.includes(value.method as FrequencySeparationMethod)
  );
}

/** Sanitize an untrusted serialized marker. Returns null when unrecoverable. */
export function validateFrequencySeparationState(raw: unknown): FrequencySeparationState | null {
  if (!isFrequencySeparationState(raw)) return null;
  return {
    version: FREQUENCY_SEPARATION_VERSION,
    method: raw.method,
    radius: normalizeSeparationRadius(raw.radius),
    lowNodeId: raw.lowNodeId,
    highNodeId: raw.highNodeId,
    ...(typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
      ? { createdAt: raw.createdAt }
      : {}),
  };
}

export function getFrequencySeparationState(
  node: SceneNode | undefined | null,
): FrequencySeparationState | null {
  if (node?.kind !== 'group') return null;
  const raw = (node as { frequencySeparation?: unknown }).frequencySeparation;
  return validateFrequencySeparationState(raw);
}

/** Resolve a valid, still-linked marker for a group node. */
export function resolveFrequencySeparation(
  doc: DocumentLike,
  groupId: string,
): FrequencySeparationGroup | null {
  const group = doc.nodes[groupId];
  const state = getFrequencySeparationState(group);
  if (!state) return null;
  const low = doc.nodes[state.lowNodeId];
  const high = doc.nodes[state.highNodeId];
  if (low?.kind !== 'rasterLayer' || !high || high.kind !== 'rasterLayer') return null;
  return { groupId, state };
}

/** Find the separation group that owns a band node (for Inspector targeting). */
export function findFrequencySeparationForBand(
  doc: DocumentLike,
  bandNodeId: string,
): FrequencySeparationGroup | null {
  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'group') continue;
    const state = getFrequencySeparationState(node);
    if (!state) continue;
    if (state.lowNodeId === bandNodeId || state.highNodeId === bandNodeId) {
      const resolved = resolveFrequencySeparation(doc, node.id);
      if (resolved) return resolved;
    }
  }
  return null;
}

export interface BandTiles {
  width: number;
  height: number;
  tiles: Map<string, RasterTile>;
}

/**
 * Decode the group's current composite. Returns null when the marker is inert
 * (missing bands or mismatched sizes) so callers can fall back to normal
 * rendering. Hidden bands are still decoded: visibility is presentation, not
 * a reason to mutate the marker, and the structural replay skips hidden ones.
 */
export function decodeFrequencySeparationTiles(
  doc: DocumentLike,
  groupId: string,
): BandTiles | null {
  const resolved = resolveFrequencySeparation(doc, groupId);
  if (!resolved) return null;
  const low = doc.nodes[resolved.state.lowNodeId] as RasterLayerNode;
  const high = doc.nodes[resolved.state.highNodeId] as RasterLayerNode;
  if (low.width !== high.width || low.height !== high.height) return null;
  const width = low.width;
  const height = low.height;
  const lowImage = warpBandForDecode(low, width, height);
  const highImage = warpBandForDecode(high, width, height);
  const out = new Uint8ClampedArray(width * height * 4);
  const l = lowImage.data;
  const e = highImage.data;
  for (let i = 0; i < out.length; i += 4) {
    const alpha = l[i + 3]!;
    out[i + 3] = alpha;
    if (alpha === 0) continue;
    out[i] = l[i]! + decodeResidualChannel(e[i] ?? 128);
    out[i + 1] = l[i + 1]! + decodeResidualChannel(e[i + 1] ?? 128);
    out[i + 2] = l[i + 2]! + decodeResidualChannel(e[i + 2] ?? 128);
  }
  return {
    width,
    height,
    tiles: imageDataToRasterTiles(new ImageData(out, width, height), TILE_SIZE),
  };
}

export interface CreateFrequencySeparationOptions {
  radius: number;
  method?: FrequencySeparationMethod;
}

export interface CreateFrequencySeparationResult {
  doc: DocumentLike;
  groupId: string;
  lowId: string;
  highId: string;
  reconstruction: ReconstructionError;
}

/**
 * Convert a raster layer into an editable frequency-separation group.
 *
 * One document transaction; the caller wraps this in a single undo entry.
 * Returns null when the node is not an editable raster layer, has no pixels,
 * or is already a band of another separation (no nested separations, so the
 * decode stays a single defined pass).
 */
export function createFrequencySeparation<D extends DocumentLike>(
  doc: D,
  sourceNodeId: string,
  options: CreateFrequencySeparationOptions,
): (Omit<CreateFrequencySeparationResult, 'doc'> & { doc: D }) | null {
  const source = doc.nodes[sourceNodeId] as RasterLayerNode | undefined;
  if (source?.kind !== 'rasterLayer') return null;
  if (source.width <= 0 || source.height <= 0 || source.tiles.size === 0) return null;
  const radius = normalizeSeparationRadius(options.radius);
  const method = options.method ?? 'gaussian';

  const sourceImage = rasterTilesToImageData(source.tiles, source.width, source.height, TILE_SIZE);
  const bands = decomposeFrequencyBands(sourceImage, { radius, method });
  const reconstruction = measureReconstruction(sourceImage, bands.low, bands.high);

  const lowTiles = imageDataToRasterTiles(bands.low, TILE_SIZE);
  const highTiles = imageDataToRasterTiles(bands.high, TILE_SIZE);

  const nodes: Record<string, SceneNode> = { ...doc.nodes };
  // The original node becomes the tone band in place, keeping its id so
  // selection, history references, and external references stay valid.
  const low: RasterLayerNode = {
    ...source,
    name: toneBandName(source.name),
    // Mask and effects move to the group: they describe the composite, not one
    // band. Leaving them on the tone band would double-apply with the decode.
    mask: undefined,
    effects: [],
    tiles: bumpTileMap(lowTiles),
  };
  nodes[sourceNodeId] = low;

  const highId = mintNodeId(doc.nextId, nodes);
  const nextOrder = nextSiblingOrder(doc, sourceNodeId);
  const highNode: RasterLayerNode = {
    ...makeRasterLayerNode(highId, { width: source.width, height: source.height }),
    name: detailBandName(source.name),
    order: nextOrder,
    visible: true,
    locked: source.locked,
    fill: { ...source.fill },
    pixelMode: source.pixelMode,
    transform: [...source.transform],
    tiles: bumpTileMap(highTiles),
  };
  nodes[highId] = highNode;

  const groupId = mintNodeId(doc.nextId + 1, nodes);
  const group: GroupNode = {
    ...makeGroupNode(groupId, {
      name: `${stripBandSuffix(source.name)} Frequency Separation`,
      order: source.order ?? 'a0',
      visible: source.visible,
      locked: source.locked,
      opacity: source.opacity,
      blendMode: source.blendMode ?? 'normal',
      rotation: source.rotation ?? 0,
      transform: [1, 0, 0, 1, 0, 0],
      effects: [],
      children: [sourceNodeId, highId],
    }),
    ...(source.mask ? { mask: source.mask } : {}),
    ...(source.effects && source.effects.length > 0 ? { effects: source.effects } : {}),
  };
  nodes[groupId] = {
    ...group,
    frequencySeparation: {
      version: FREQUENCY_SEPARATION_VERSION,
      method,
      radius,
      lowNodeId: sourceNodeId,
      highNodeId: highId,
      createdAt: Date.now(),
    },
  };

  const next: DocumentLike = { ...doc, nodes, nextId: doc.nextId + 2 };
  replaceChild(next, sourceNodeId, groupId, groupId);
  return { doc: next as D, groupId, lowId: sourceNodeId, highId, reconstruction };
}

/**
 * Re-split the *current* recombined state at a new radius. Retouched pixels
 * are preserved exactly (up to the ±1 LSB representable residual); only the
 * split point moves. One undo entry.
 */
export function regenerateFrequencySeparation<D extends DocumentLike>(
  doc: D,
  groupId: string,
  options: CreateFrequencySeparationOptions,
): { doc: D; reconstruction: ReconstructionError } | null {
  const resolved = resolveFrequencySeparation(doc, groupId);
  if (!resolved) return null;
  const decoded = decodeFrequencySeparationTiles(doc, groupId);
  if (!decoded) return null;
  const radius = normalizeSeparationRadius(options.radius);
  const method = options.method ?? resolved.state.method;
  const image = rasterTilesToImageData(decoded.tiles, decoded.width, decoded.height, TILE_SIZE);
  const bands = decomposeFrequencyBands(image, { radius, method });
  const reconstruction = measureReconstruction(image, bands.low, bands.high);

  const nodes: Record<string, SceneNode> = { ...doc.nodes };
  const lowId = resolved.state.lowNodeId;
  const highId = resolved.state.highNodeId;
  const low = nodes[lowId] as RasterLayerNode;
  const high = nodes[highId] as RasterLayerNode;
  nodes[lowId] = bumpTileVersions({ ...low, tiles: imageDataToRasterTiles(bands.low, TILE_SIZE) });
  nodes[highId] = bumpTileVersions({
    ...high,
    tiles: imageDataToRasterTiles(bands.high, TILE_SIZE),
  });
  const group = nodes[groupId] as GroupNode;
  nodes[groupId] = {
    ...group,
    frequencySeparation: { ...resolved.state, radius, method },
  };
  return { doc: { ...doc, nodes } as D, reconstruction };
}

/**
 * Bake the current decode into a single raster layer and drop the separation.
 * Keeps the tone band's id (and therefore selection and layer identity).
 */
export function flattenFrequencySeparation<D extends DocumentLike>(
  doc: D,
  groupId: string,
): D | null {
  const resolved = resolveFrequencySeparation(doc, groupId);
  if (!resolved) return null;
  const decoded = decodeFrequencySeparationTiles(doc, groupId);
  if (!decoded) return null;
  const group = doc.nodes[groupId] as GroupNode;
  const lowId = resolved.state.lowNodeId;
  const highId = resolved.state.highNodeId;
  const low = doc.nodes[lowId] as RasterLayerNode;
  const baked: RasterLayerNode = {
    ...low,
    name: stripBandSuffix(low.name),
    tiles: bumpTileMap(decoded.tiles),
    effects: group.effects ?? low.effects,
    ...(group.mask ? { mask: group.mask } : {}),
    opacity: group.opacity ?? low.opacity,
    blendMode: group.blendMode ?? low.blendMode,
    visible: group.visible,
    locked: group.locked,
    rotation: group.rotation ?? low.rotation,
    order: group.order ?? low.order,
  };

  const nodes: Record<string, SceneNode> = { ...doc.nodes, [lowId]: baked };
  delete nodes[groupId];
  delete nodes[highId];
  const next: DocumentLike = { ...doc, nodes };
  replaceChild(next, groupId, lowId, groupId);
  return next as D;
}

/** Names used by the dialog/layers panel; kept here so all callers agree. */
export function frequencySeparationBandNames(sourceName: string): { tone: string; detail: string } {
  const base = stripBandSuffix(sourceName);
  return { tone: `${base} Tone`, detail: `${base} Detail` };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Band image for decode, with the band's own liquify field applied first.
 * Applying the field per band keeps "deform one component" (an advanced
 * operation) expressible without special-casing it in the renderer; a field
 * on the group deforms the reconstructed composite instead.
 */
function warpBandForDecode(node: RasterLayerNode, width: number, height: number): ImageData {
  const image = rasterTilesToImageData(node.tiles, width, height, TILE_SIZE);
  const field = validateLiquifyField(node.liquify);
  if (!field || isIdentityLiquifyField(field)) return image;
  return warpImageDataByField(image, field, {
    outputWidth: width,
    outputHeight: height,
  });
}

function toneBandName(name: string): string {
  return frequencySeparationBandNames(name).tone;
}

function detailBandName(name: string): string {
  return frequencySeparationBandNames(name).detail;
}

function stripBandSuffix(name: string): string {
  return name
    .replace(/ (Tone|Detail)$/, '')
    .replace(/ Frequency Separation$/, '')
    .replace(/ Copy$/, '');
}

function bumpTileVersions<T extends RasterLayerNode>(node: T): T {
  return { ...node, tiles: bumpTileMap(node.tiles) };
}

function bumpTileMap(tiles: Map<string, RasterTile>): Map<string, RasterTile> {
  const next = new Map<string, RasterTile>();
  for (const [key, tile] of tiles) {
    next.set(key, { pixels: tile.pixels, version: tile.version + 1 });
  }
  return next;
}

function mintNodeId(seed: number, nodes: Record<string, unknown>): string {
  let id = `n${seed}`;
  let counter = seed;
  while (Object.hasOwn(nodes, id)) {
    counter += 1;
    id = `n${counter}`;
  }
  return id;
}

function findParent(doc: DocumentLike, nodeId: string, excludeParentId?: string): string | null {
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (excludeParentId !== undefined && id === excludeParentId) continue;
    if ('children' in node && Array.isArray((node as { children?: string[] }).children)) {
      if ((node as { children: string[] }).children.includes(nodeId)) return id;
    }
  }
  return null;
}

function childrenOf(doc: DocumentLike, parentId: string): string[] {
  const parent = doc.nodes[parentId];
  if (parent && 'children' in parent) return [...(parent as { children: string[] }).children];
  return [...(doc.rootChildren ?? [])];
}

/**
 * Fractional order key that sorts directly after the source node, so the
 * detail band stays above the tone band under any order-based paint sort.
 */
function nextSiblingOrder(doc: DocumentLike, nodeId: string): string {
  const parentId = findParent(doc, nodeId);
  const siblings = parentId ? childrenOf(doc, parentId) : [...(doc.rootChildren ?? [])];
  const index = siblings.indexOf(nodeId);
  const self = doc.nodes[nodeId];
  const selfOrder = self?.order ?? 'a0';
  if (index < 0 || index >= siblings.length - 1) return selfOrder;
  const next = doc.nodes[siblings[index + 1]!];
  return generateKeyBetween(selfOrder, next?.order ?? null) ?? selfOrder;
}

/**
 * Replace `oldId` with `newId` in its parent (or the root list).
 *
 * `excludeParentId` prevents a just-inserted node from being mistaken for the
 * parent when it already lists `oldId` as a child (the group being created
 * contains the source node; without this, the group would reparent itself).
 */
function replaceChild(
  doc: DocumentLike,
  oldId: string,
  newId: string,
  excludeParentId?: string,
): void {
  const parentId = findParent(doc, oldId, excludeParentId);
  if (parentId) {
    const parent = doc.nodes[parentId];
    if (parent && 'children' in parent) {
      const children = [...(parent as { children: string[] }).children];
      const index = children.indexOf(oldId);
      if (index >= 0) children[index] = newId;
      doc.nodes[parentId] = { ...parent, children } as SceneNode;
    }
    return;
  }
  const roots = [...(doc.rootChildren ?? [])];
  const index = roots.indexOf(oldId);
  if (index >= 0) {
    roots[index] = newId;
    (doc as { rootChildren?: readonly string[] }).rootChildren = roots;
  }
}
