/**
 * Surface read model (ADR-0226).
 *
 * Varve has two intentionally different kinds of bounded work surface:
 *
 * - a page is an ordered publishing surface with trim, print geometry,
 *   numbering, master provenance, and page-export membership;
 * - a frame/artboard is an authored design container whose bounds and
 *   clipping come from the scene node.
 *
 * This module is additive. It derives a single read model from the current
 * page/contentRoot storage and ordinary FrameNodes. It does not change the
 * persisted schema or make page metadata into a scene node. Consumers can
 * migrate one at a time without having to rediscover ownership and coordinate
 * rules independently.
 */

import type { Affine, Rect } from '@varve/shared';
import { applyAffine, multiplyAffine, translate } from '@varve/shared';
import { isArtboard, nodeWorldBounds, nodeWorldTransform } from './coordinateService';
import type { Document } from './document';
import { buildParentIndexMap } from './document';
import { computePageNumbering } from './pageNumbering';
import { resolveOwnership, type SceneOwnership } from './pageOwnership';
import { buildPlacedScene, projectMasterNodes } from './pageScene';
import { pageBleedInsetsPx, resolvePagePrintGeometry } from './printGeometry';
import type { FrameNode, NodeId, Page, PagePlacement } from './types';
import { isContainer, isExportRegion } from './types';

export type SurfaceKind = 'page' | 'frame' | 'artboard';

/** A kind-qualified identity avoids collisions between page and node id spaces. */
export interface SurfaceRef {
  kind: SurfaceKind;
  id: NodeId;
}

export function surfaceKey(ref: SurfaceRef): string {
  return `${ref.kind}:${ref.id}`;
}

export type SurfaceOwner = SceneOwnership;

export interface SurfaceSize {
  w: number;
  h: number;
}

export interface SurfacePrintGeometry {
  /** Page-local trim rectangle. */
  trim: Rect;
  /** Resolved document-pixel bleed insets. */
  bleed: { top: number; right: number; bottom: number; left: number };
  /** Resolved document-pixel slug insets. */
  slug: { top: number; right: number; bottom: number; left: number };
  /** Derived displayed page number; never a page identity. */
  pageNumber: string;
  /** Source masters assigned to the page, in resolver order. */
  masterIds: NodeId[];
  /** Whether the page participates in document/page export. */
  exportEnabled: boolean;
}

export interface Surface {
  /** Raw page id or FrameNode id. Use `key` for map/set identity. */
  id: NodeId;
  key: string;
  kind: SurfaceKind;
  name: string;
  /** The immediate containing surface, if there is one. */
  parent: SurfaceRef | null;
  /** Scene ownership of authored content represented by this surface. */
  owner: SurfaceOwner;
  /** Direct authored children; inherited page content is listed separately. */
  children: NodeId[];
  /** World-space origin of the surface's local coordinate system. */
  placement: PagePlacement;
  /** Exact local dimensions, before rotation. */
  size: SurfaceSize;
  /** World-space axis-aligned bounds, including transforms. */
  bounds: Rect;
  /** Full local-to-world transform for frame/artboard geometry. */
  worldTransform: Affine;
  /** Canvas editing clip. Page trim/bleed clipping is output-only. */
  clipContent: boolean;
  /** Output policy is separate from canvas clip policy. */
  exportClip: 'trim-and-bleed' | 'bounds' | 'none';
  /** Direct surface export is available for normal pages and frames. */
  exportable: boolean;
  /** Included when an enclosing page is exported as a document page. */
  includedInPageExport: boolean;
  /** Page id for page-owned frames; absent for pasteboard/master frames. */
  pageId?: NodeId;
  /** Projected inherited content for a page, never copied into children. */
  inheritedNodeIds?: NodeId[];
  /** Print semantics exist only on page surfaces. */
  print?: SurfacePrintGeometry;
}

interface SurfaceContext {
  placements: Map<NodeId, PagePlacement>;
  parentIndex: Map<NodeId, NodeId>;
  pageRootIds: Set<NodeId>;
  frameSurfaces: Map<NodeId, Surface>;
  numbering: ReturnType<typeof computePageNumbering>;
}

function pageOwner(pageId: NodeId): SurfaceOwner {
  return { kind: 'page', pageId };
}

function frameKind(doc: Document, frame: FrameNode): Exclude<SurfaceKind, 'page'> {
  // Keep the artboard distinction in the existing coordinate service. This
  // read model is a consumer of that definition, not a second classifier.
  return isArtboard(doc, frame.id) ? 'artboard' : 'frame';
}

function framePageId(owner: SurfaceOwner): NodeId | undefined {
  return owner.kind === 'page' ? owner.pageId : undefined;
}

function shiftRect(rect: Rect, placement: PagePlacement): Rect {
  return { ...rect, x: rect.x + placement.x, y: rect.y + placement.y };
}

function pageSurface(doc: Document, page: Page, ctx: SurfaceContext): Surface | null {
  const placement = ctx.placements.get(page.id);
  if (!placement) return null;
  const contentRoot = doc.nodes[page.contentRoot];
  const children = contentRoot && isContainer(contentRoot) ? [...contentRoot.children] : [];
  const print = resolvePagePrintGeometry(doc, page.id);
  const ref: SurfaceRef = { kind: 'page', id: page.id };
  return {
    id: page.id,
    key: surfaceKey(ref),
    kind: 'page',
    name: page.name,
    parent: null,
    owner: pageOwner(page.id),
    children,
    placement,
    size: { w: page.width, h: page.height },
    bounds: { x: placement.x, y: placement.y, w: page.width, h: page.height },
    worldTransform: translate(placement.x, placement.y),
    // A page is not clipped while editing. Trim + bleed is an output
    // decision, matching the page-layout contract rather than Figma frame
    // clipping semantics.
    clipContent: false,
    exportClip: 'trim-and-bleed',
    exportable: !page.printSettings?.excludeFromExport,
    includedInPageExport: true,
    pageId: page.id,
    inheritedNodeIds: projectMasterNodes(doc, page),
    print: {
      trim: { x: 0, y: 0, w: page.width, h: page.height },
      bleed: pageBleedInsetsPx(doc, page.id),
      slug: {
        top: print.slug.top,
        right: print.slug.right,
        bottom: print.slug.bottom,
        left: print.slug.left,
      },
      pageNumber: ctx.numbering.get(page.id)?.formatted ?? '',
      masterIds: page.masterPageId ? [page.masterPageId] : [],
      exportEnabled: !page.printSettings?.excludeFromExport,
    },
  };
}

function frameSurface(doc: Document, node: FrameNode, ctx: SurfaceContext): Surface | null {
  if (isExportRegion(node)) return null;
  const owner = resolveOwnership(doc, node.id);
  const localBounds = nodeWorldBounds(doc, node.id, ctx.parentIndex);
  if (!localBounds) return null;

  const pageId = framePageId(owner);
  const pagePlacement = pageId ? ctx.placements.get(pageId) : undefined;
  const bounds = pagePlacement ? shiftRect(localBounds, pagePlacement) : localBounds;
  const localToWorld = pagePlacement
    ? multiplyAffine(
        translate(pagePlacement.x, pagePlacement.y),
        nodeWorldTransform(doc, node.id, ctx.parentIndex),
      )
    : nodeWorldTransform(doc, node.id, ctx.parentIndex);
  const origin = applyAffine(localToWorld, [0, 0]);
  const parentNodeId = ctx.parentIndex.get(node.id);
  const parentFrame = parentNodeId ? ctx.frameSurfaces.get(parentNodeId) : undefined;
  const parent: SurfaceRef | null = parentFrame
    ? { kind: parentFrame.kind, id: parentFrame.id }
    : pageId
      ? { kind: 'page', id: pageId }
      : null;
  const kind = frameKind(doc, node);
  const ref: SurfaceRef = { kind, id: node.id };
  const pageOwned = owner.kind === 'page';
  return {
    id: node.id,
    key: surfaceKey(ref),
    kind,
    name: node.name,
    parent,
    owner,
    children: [...node.children],
    placement: { x: origin[0], y: origin[1] },
    size: { w: node.w, h: node.h },
    bounds,
    worldTransform: localToWorld,
    clipContent: node.clipContent !== false,
    exportClip: node.clipContent !== false ? 'bounds' : 'none',
    exportable: true,
    includedInPageExport: pageOwned,
    ...(pageId ? { pageId } : {}),
  };
}

function createContext(doc: Document): SurfaceContext {
  const placed = buildPlacedScene(doc);
  return {
    placements: placed.placements,
    parentIndex: buildParentIndexMap(doc),
    pageRootIds: new Set((doc.pages ?? []).map((page) => page.contentRoot)),
    frameSurfaces: new Map(),
    numbering: computePageNumbering(doc),
  };
}

function appendFrames(
  doc: Document,
  ids: readonly NodeId[],
  ctx: SurfaceContext,
  result: Surface[],
): void {
  for (const id of ids) {
    const node = doc.nodes[id];
    if (node?.kind !== 'frame' || isExportRegion(node)) {
      if (node && isContainer(node)) appendFrames(doc, node.children, ctx, result);
      continue;
    }
    if (ctx.frameSurfaces.has(id)) continue;
    const surface = frameSurface(doc, node, ctx);
    if (!surface) continue;
    ctx.frameSurfaces.set(id, surface);
    result.push(surface);
    appendFrames(doc, node.children, ctx, result);
  }
}

/**
 * Derive all page and frame/artboard surfaces in deterministic order.
 *
 * Pages are emitted in `Document.pages` order, then ordinary root content is
 * walked in `rootChildren` order. The page contentRoot and master roots are
 * implementation details and never become duplicate surfaces.
 */
export function listSurfaces(doc: Document): Surface[] {
  const ctx = createContext(doc);
  const result: Surface[] = [];

  for (const page of doc.pages ?? []) {
    const surface = pageSurface(doc, page, ctx);
    if (!surface) continue;
    result.push(surface);
    appendFrames(doc, surface.children, ctx, result);
  }

  for (const rootId of doc.rootChildren) {
    if (ctx.pageRootIds.has(rootId)) continue;
    const root = doc.nodes[rootId];
    if (!root || !isContainer(root)) continue;
    if (root.kind === 'frame') appendFrames(doc, [rootId], ctx, result);
    else appendFrames(doc, root.children, ctx, result);
  }

  return result;
}

/** Find a surface by its kind-qualified identity. */
export function getSurface(doc: Document, ref: SurfaceRef): Surface | undefined {
  return listSurfaces(doc).find((surface) => surface.key === surfaceKey(ref));
}

/** Find the nearest owning surface for a node, excluding the page root group. */
export function surfaceForNode(doc: Document, nodeId: NodeId): SurfaceRef | null {
  const node = doc.nodes[nodeId];
  if (!node || isExportRegion(node)) return null;
  const surfaces = listSurfaces(doc);
  const byNode = new Map(
    surfaces.filter((surface) => surface.kind !== 'page').map((surface) => [surface.id, surface]),
  );
  const parentIndex = buildParentIndexMap(doc);
  let current: NodeId | undefined = nodeId;
  while (current) {
    const frame = byNode.get(current);
    if (frame) return { kind: frame.kind, id: frame.id };
    const parent = parentIndex.get(current);
    if (parent) {
      current = parent;
      continue;
    }
    const owner = resolveOwnership(doc, current);
    if (owner.kind === 'page') return { kind: 'page', id: owner.pageId };
    current = undefined;
  }
  return null;
}
