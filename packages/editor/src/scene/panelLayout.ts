/**
 * Panel conventions, layout templates, and the divide operation.
 *
 * A panel is a FrameNode under panel conventions — the same object model as
 * frames and export regions, never a parallel node type (ADR-0238). What is
 * panel-specific is the layout: tiers and grids separated by one constant
 * gutter, plus the paper conventions a comic panel needs.
 *
 * `divideFrameIntoPanels` is the CLIP STUDIO PAINT "Divide frame border
 * equally" equivalent: it turns one frame into a rows x columns grid of child
 * panels, duplicating the target's artwork into every panel. `PANEL_LAYOUT_PRESETS`
 * is the layout-template vocabulary the domain research documents (splash,
 * two-up, three-tier, grids, webtoon stack).
 *
 * Borders render below children in every replay path, so a panel's border is
 * aligned `outside`: the clipped content area stays inside the panel bounds
 * and the border can never be covered by artwork.
 */

import {
  addChild,
  computeReparentTransform,
  type Document,
  deepCloneSubtree,
  defaultStroke,
  estimatePanelSplitRasterBytes,
  getParent,
  makeFrameNode,
  type NodeId,
  nextNodeId,
  panelMetadata,
  removeNode,
  reparentPreservingWorldTransform,
  type SceneNode,
} from '@varve/scene';
import { type Affine, generateKeyBetween } from '@varve/shared';

export type PanelLayoutPresetId =
  | 'splash'
  | 'two-up'
  | 'three-tier'
  | 'four-panel'
  | 'six-panel'
  | 'nine-panel'
  | 'webtoon-stack';

export interface PanelLayoutPreset {
  id: PanelLayoutPresetId;
  label: string;
  /** Short explanation shown in the Panel tool; this is layout guidance, not a page-size rule. */
  description?: string;
  /** Common workflow fit. These are recommendations, not publishing constraints. */
  recommendedFor?: readonly ('print' | 'manga' | 'webtoon' | 'general')[];
  rows: number;
  columns: number;
  /** Gutter as a fraction of the target width. */
  gutterRatio: number;
  /**
   * Optional vertical gutter fraction, for formats where vertical space is
   * pacing (a webtoon reads with long holds between panels; WEBTOON guidance
   * is at least ~200 px at 800 px width).
   */
  gutterRatioY?: number;
}

export const PANEL_LAYOUT_PRESETS: readonly PanelLayoutPreset[] = [
  {
    id: 'splash',
    label: 'Splash',
    description: 'One full-page panel for an establishing shot or dramatic beat.',
    recommendedFor: ['print', 'manga', 'webtoon', 'general'],
    rows: 1,
    columns: 1,
    gutterRatio: 0.04,
  },
  {
    id: 'two-up',
    label: 'Two-up',
    description: 'Two horizontal beats with a single shared gutter.',
    recommendedFor: ['print', 'manga', 'general'],
    rows: 1,
    columns: 2,
    gutterRatio: 0.04,
  },
  {
    id: 'three-tier',
    label: 'Three-tier',
    description: 'Three stacked beats for a compact page rhythm.',
    recommendedFor: ['print', 'manga', 'general'],
    rows: 3,
    columns: 1,
    gutterRatio: 0.04,
  },
  {
    id: 'four-panel',
    label: 'Four-panel',
    description: 'A balanced 2 × 2 grid for regular page storytelling.',
    recommendedFor: ['print', 'manga', 'general'],
    rows: 2,
    columns: 2,
    gutterRatio: 0.04,
  },
  {
    id: 'six-panel',
    label: 'Six-panel',
    description: 'A 3 × 2 grid for dialogue-heavy or sequential pages.',
    recommendedFor: ['print', 'manga', 'general'],
    rows: 3,
    columns: 2,
    gutterRatio: 0.04,
  },
  {
    id: 'nine-panel',
    label: 'Nine-panel',
    description: 'A dense 3 × 3 grid for montage, reaction, or rapid beats.',
    recommendedFor: ['print', 'manga', 'general'],
    rows: 3,
    columns: 3,
    gutterRatio: 0.04,
  },
  {
    id: 'webtoon-stack',
    label: 'Webtoon stack',
    description: 'Four vertically paced panels with a larger reading gap for phone scroll.',
    recommendedFor: ['webtoon'],
    rows: 4,
    columns: 1,
    gutterRatio: 0.04,
    gutterRatioY: 0.22,
  },
];

export interface PanelCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Cell rectangles for a layout inside `bounds`, in target-local coordinates.
 *
 * One gutter becomes the outer margin, so the gutter and every outside-aligned
 * border fit inside the target. Returns an empty list for degenerate bounds.
 */
export function computePanelCells(
  bounds: { w: number; h: number },
  preset: PanelLayoutPreset,
): PanelCell[] {
  const gutterX = bounds.w * preset.gutterRatio;
  const gutterY = bounds.w * (preset.gutterRatioY ?? preset.gutterRatio);
  const margin = gutterX;
  const availableW = bounds.w - 2 * margin - (preset.columns - 1) * gutterX;
  const availableH = bounds.h - 2 * margin - (preset.rows - 1) * gutterY;
  if (availableW <= 0 || availableH <= 0) return [];

  const cellW = availableW / preset.columns;
  const cellH = availableH / preset.rows;
  const cells: PanelCell[] = [];
  for (let row = 0; row < preset.rows; row++) {
    for (let column = 0; column < preset.columns; column++) {
      cells.push({
        x: margin + column * (cellW + gutterX),
        y: margin + row * (cellH + gutterY),
        w: cellW,
        h: cellH,
      });
    }
  }
  return cells;
}

/**
 * Build the panel node: a paper-white clipping frame with a solid outside
 * border. Captured artwork renders above the paper; anything the panel only
 * partially covers stays behind it, which is the opaque-window semantics a
 * comic panel needs.
 */
export function makePanelNode(
  id: string,
  transform: Affine,
  size: { w?: number; h?: number } | undefined,
): SceneNode {
  return makeFrameNode(id, {
    name: 'Panel',
    frameRole: 'frame',
    transform,
    fill: { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 },
    children: [],
    w: size?.w ?? 400,
    h: size?.h ?? 300,
    clipContent: true,
    strokes: [{ ...defaultStroke(), align: 'outside' }],
    panel: panelMetadata(id),
  });
}

export interface PanelDivideResult {
  doc: Document;
  created: NodeId[];
}

export interface PanelDividePreview {
  presetId: PanelLayoutPresetId;
  destinationCount: number;
  sourceChildCount: number;
  estimatedAdditionalRasterBytes: number;
}

export interface PanelJoinResult {
  doc: Document;
  /** The surviving panel, or null when the selection was not joinable. */
  joined: NodeId | null;
  /** Panels removed after their children were moved into `joined`. */
  removed: NodeId[];
}

/** Computes the populated-split cost without mutating the document. */
export function previewPanelDivision(
  doc: Document,
  selection: readonly NodeId[],
  presetId: string,
): PanelDividePreview | null {
  const preset = PANEL_LAYOUT_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset || selection.length !== 1) return null;
  const frame = doc.nodes[selection[0]!];
  if (frame?.kind !== 'frame') return null;
  const cells = computePanelCells({ w: frame.w, h: frame.h }, preset);
  const sourceChildren = frame.children ?? [];
  return {
    presetId: preset.id,
    destinationCount: cells.length,
    sourceChildCount: sourceChildren.length,
    estimatedAdditionalRasterBytes: estimatePanelSplitRasterBytes(
      doc,
      sourceChildren,
      cells.length,
    ),
  };
}

/**
 * Divide the single selected frame into a panel grid.
 *
 * Artwork already inside the target is duplicated into every panel and the
 * originals are removed: each panel shows the same absolute artwork region,
 * clipped to its cell (the CLIP STUDIO PAINT "divide frame folder and
 * duplicate inside layer" behaviour). Copies keep their names and are
 * independent nodes; internal mask/scope references are remapped by the
 * canonical subtree cloner.
 */
export function divideFrameIntoPanels(
  doc: Document,
  selection: readonly NodeId[],
  presetId: string,
): PanelDivideResult {
  const preset = PANEL_LAYOUT_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset || selection.length !== 1) return { doc, created: [] };
  const frame = doc.nodes[selection[0]!];
  if (frame?.kind !== 'frame') return { doc, created: [] };

  const cells = computePanelCells({ w: frame.w, h: frame.h }, preset);
  if (cells.length === 0) return { doc, created: [] };

  const sourceChildren = [...(frame.children ?? [])];
  let next = doc;
  const created: NodeId[] = [];
  let previousPanelOrder: string | null = null;

  for (const cell of cells) {
    const { id: panelId, doc: withId } = nextNodeId(next);
    previousPanelOrder = generateKeyBetween(previousPanelOrder, null);
    const panel = makePanelNode(panelId, [1, 0, 0, 1, cell.x, cell.y] as Affine, {
      w: cell.w,
      h: cell.h,
    });
    if (panel.kind === 'frame' && panel.panel) {
      panel.panel = panelMetadata(panelId, {
        readingOrder: created.length + 1,
        readingDirection: doc.readingDirection ?? (doc.workflowProfile === 'manga' ? 'rtl' : 'ltr'),
        gutter: preset.gutterRatio,
      });
    }
    next = addChild(withId, frame.id, {
      ...panel,
      name: nextPanelName(withId),
      order: previousPanelOrder,
    } as SceneNode);
    created.push(panelId);

    // Shift each copy by the negative cell origin so the artwork renders at
    // the same absolute position it had in the target, then clip per panel.
    const panelChildren: NodeId[] = [];
    for (const childId of sourceChildren) {
      if (!next.nodes[childId]) continue;
      const cloned = deepCloneSubtree(next.nodes, next.nextId, childId, {
        translate: { x: -cell.x, y: -cell.y },
      });
      const clonedRoot = cloned.nodes[cloned.rootId];
      if (!clonedRoot) continue;
      next = {
        ...next,
        nextId: cloned.nextId,
        nodes: { ...next.nodes, ...cloned.nodes },
      };
      panelChildren.push(cloned.rootId);
    }
    if (panelChildren.length > 0) {
      const panelNode = next.nodes[panelId];
      if (panelNode?.kind === 'frame') {
        next = {
          ...next,
          nodes: {
            ...next.nodes,
            [panelId]: { ...panelNode, children: panelChildren } as SceneNode,
          },
        };
      }
    }
  }

  // The originals were only the source for the per-panel copies.
  for (const childId of sourceChildren) {
    if (next.nodes[childId]) next = removeNode(next, childId);
  }

  return { doc: next, created };
}

/**
 * Join selected sibling panels without flattening their artwork.
 *
 * The first selected panel remains as the ordinary FrameNode boundary. Every
 * other panel's children is reparented into it with a composed transform, so
 * masks, text, and raster layers retain their placed-world pose. The removed
 * panel frames are then deleted as one document operation by the caller.
 */
export function joinPanels(doc: Document, selection: readonly NodeId[]): PanelJoinResult {
  const panelIds = selection.filter((id) => {
    const node = doc.nodes[id];
    return node?.kind === 'frame' && Boolean(node.panel);
  });
  if (panelIds.length < 2) return { doc, joined: null, removed: [] };

  const survivor = panelIds[0]!;
  const parentId = getParent(doc, survivor);
  if (panelIds.some((id) => getParent(doc, id) !== parentId)) {
    return { doc, joined: null, removed: [] };
  }

  let next = doc;
  const removed: NodeId[] = [];
  for (const panelId of panelIds.slice(1)) {
    const panel = next.nodes[panelId];
    if (panel?.kind !== 'frame') continue;
    for (const childId of [...panel.children]) {
      const localTransform = computeReparentTransform(next, childId, survivor);
      if (!localTransform) continue;
      const survivorChildren =
        next.nodes[survivor]?.kind === 'frame' ? next.nodes[survivor].children : [];
      next = reparentPreservingWorldTransform(
        next,
        childId,
        survivor,
        survivorChildren.length,
        localTransform,
      );
    }
    next = removeNode(next, panelId);
    removed.push(panelId);
  }

  const node = next.nodes[survivor];
  if (node?.kind === 'frame' && node.panel) {
    next = {
      ...next,
      nodes: {
        ...next.nodes,
        [survivor]: {
          ...node,
          panel: { ...node.panel, readingOrder: 1 },
        },
      },
    };
  }
  return { doc: next, joined: survivor, removed };
}

export type PanelReadingDirection = 'ltr' | 'rtl';

/**
 * Order panels the way a reader traverses the page: tiers top-to-bottom, and
 * panels within a tier in the given direction (manga reads right-to-left).
 *
 * Tier membership is a top-edge band derived from the shortest panel, which is
 * exact for the grid templates this module produces and best-effort for
 * irregular hand-drawn layouts.
 */
export function orderPanelIds(
  panelIds: readonly NodeId[],
  nodes: Record<NodeId, SceneNode>,
  direction: PanelReadingDirection,
): NodeId[] {
  const entries = panelIds
    .map((id) => ({ id, node: nodes[id] }))
    .filter((entry): entry is { id: NodeId; node: SceneNode } => Boolean(entry.node));
  const heights = entries
    .map((entry) => ('h' in entry.node ? (entry.node.h as number) : 0))
    .filter((height) => height > 0);
  const band = heights.length > 0 ? Math.min(...heights) / 2 : 0;
  return [...entries]
    .sort((a, b) => {
      const ay = a.node.transform[5] ?? 0;
      const by = b.node.transform[5] ?? 0;
      if (Math.abs(ay - by) > band) return ay - by;
      const ax = a.node.transform[4] ?? 0;
      const bx = b.node.transform[4] ?? 0;
      return direction === 'rtl' ? bx - ax : ax - bx;
    })
    .map((entry) => entry.id);
}

export interface PanelRenumberResult {
  doc: Document;
  renamed: Array<{ id: NodeId; name: string }>;
}

/**
 * Renumber a frame's child panels in reading order. Names already used outside
 * the renumbered set are skipped so global name uniqueness is preserved.
 */
export function renumberPanelsInFrame(
  doc: Document,
  selection: readonly NodeId[],
  direction: PanelReadingDirection,
): PanelRenumberResult {
  if (selection.length !== 1) return { doc, renamed: [] };
  const frame = doc.nodes[selection[0]!];
  if (frame?.kind !== 'frame') return { doc, renamed: [] };
  const panelIds = (frame.children ?? []).filter((id) => doc.nodes[id]?.kind === 'frame');
  if (panelIds.length === 0) return { doc, renamed: [] };

  const ordered = orderPanelIds(panelIds, doc.nodes, direction);
  const inside = new Set<NodeId>(ordered);
  const reserved = new Set<string>();
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!node || inside.has(id as NodeId)) continue;
    if (PANEL_NAME_RE.test(node.name)) reserved.add(node.name);
  }

  const nodes = { ...doc.nodes };
  const renamed: Array<{ id: NodeId; name: string }> = [];
  let counter = 1;
  for (const id of ordered) {
    while (reserved.has(`Panel ${counter}`)) counter++;
    const name = `Panel ${counter}`;
    counter++;
    const node = nodes[id];
    if (node && node.name !== name) {
      nodes[id] = { ...node, name };
      renamed.push({ id, name });
    }
  }
  return { doc: { ...doc, nodes }, renamed };
}

const PANEL_NAME_RE = /^Panel (\d+)$/;

function nextPanelName(doc: Document): string {
  let highest = 0;
  for (const node of Object.values(doc.nodes)) {
    if (!node) continue;
    const match = PANEL_NAME_RE.exec(node.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Panel ${highest + 1}`;
}
