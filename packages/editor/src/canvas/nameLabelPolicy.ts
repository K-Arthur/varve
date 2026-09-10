/**
 * Canvas name-label policy — when to paint Figma-style names above nodes.
 *
 * Top-level frames always get a label (readable identity at any zoom). Other
 * top-level nodes only when heavily zoomed out / small on screen. Nested
 * nodes become labeled when selected, hovered, or edited, preserving
 * discoverability without turning every container into permanent chrome.
 *
 * Research basis: Figma frame/section title labels at low zoom.
 */

export interface NameLabelCandidate {
  /** Qualified rendered occurrence id; authored node ids are not unique for masters. */
  id: string;
  /** Authored node id used by selection and document commands. */
  nodeId?: string;
  name: string;
  kind: string;
  /** World AABB. */
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  parentId: string | null;
  surfaceKey?: string;
  selected?: boolean;
  hovered?: boolean;
  editing?: boolean;
  paintOrder?: number;
}

export interface NameLabelPlacement {
  id: string;
  nodeId?: string;
  name: string;
  /** Full, sanitized name retained for title/accessibility consumers. */
  fullName: string;
  /** One-line, bounded display name. */
  displayName: string;
  /** Screen-space top-left of the projected node bounds. */
  screenX: number;
  screenY: number;
  screenW: number;
  screenH: number;
  kind: string;
  surfaceKey?: string;
  selected: boolean;
  hovered: boolean;
  editing: boolean;
}

/** Zoom at/below which non-frame nodes get labels. */
export const NAME_LABEL_ZOOM_THRESHOLD = 0.4;

/** Min screen px (either edge) for showing non-frame labels when zoom is mid. */
export const NAME_LABEL_MIN_SCREEN_EDGE = 32;

/** Max labels per frame to keep overlay cheap. */
export const NAME_LABEL_MAX = 80;

/** Remove controls/newlines without changing the authored document name. */
export function oneLineLabelName(name: string): string {
  return name
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayLabelName(name: string, maxCodePoints = 64): string {
  const codePoints = Array.from(name);
  if (codePoints.length <= maxCodePoints) return name;
  return `${codePoints.slice(0, Math.max(1, maxCodePoints - 1)).join('')}…`;
}

function estimatedLabelWidth(name: string, kind: string): number {
  const fontSize = kind === 'frame' ? 11 : 10;
  // This is a deterministic pre-measure used only for culling/collision. The
  // browser still owns final glyph shaping and the full name is retained.
  return Math.min(280, Math.max(28, Array.from(name).length * fontSize * 0.58 + 10));
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function shouldShowNameLabel(opts: {
  kind: string;
  zoom: number;
  screenW: number;
  screenH: number;
  /** Hide empty / whitespace names. */
  name: string;
  /** Whether this node is inside a container (frame/group). */
  insideContainer?: boolean;
  /** Selected, hovered, or actively edited targets remain discoverable. */
  forceShow?: boolean;
}): boolean {
  if (!oneLineLabelName(opts.name)) return false;
  if (opts.forceShow) return true;
  // Children inside frames/groups don't get labels — the parent frame label
  // provides context. Only top-level nodes get labels when zoomed out.
  if (opts.insideContainer) return false;
  if (opts.kind === 'frame') return true;
  if (opts.zoom <= NAME_LABEL_ZOOM_THRESHOLD) return true;
  const edge = Math.min(opts.screenW, opts.screenH);
  return edge > 0 && edge <= NAME_LABEL_MIN_SCREEN_EDGE;
}

/**
 * Pick nodes that should show name labels, prioritize frames, cull off-screen.
 */
export function pickNameLabelCandidates(
  candidates: NameLabelCandidate[],
  opts: {
    zoom: number;
    viewportW: number;
    viewportH: number;
    /** World→screen projected top-left + size. */
    project: (c: NameLabelCandidate) => {
      screenX: number;
      screenY: number;
      screenW: number;
      screenH: number;
    };
  },
): NameLabelPlacement[] {
  const out: NameLabelPlacement[] = [];
  const indexed = candidates.map((candidate, index) => ({ candidate, index }));
  const sorted = indexed.sort((a, b) => {
    const priority = (candidate: NameLabelCandidate): number => {
      if (candidate.selected || candidate.hovered || candidate.editing) return 0;
      if (candidate.kind === 'frame' && candidate.depth === 0) return 1;
      if (candidate.kind === 'frame') return 2;
      return candidate.depth === 0 ? 3 : 4;
    };
    const priorityDelta = priority(a.candidate) - priority(b.candidate);
    if (priorityDelta !== 0) return priorityDelta;
    if (a.candidate.depth !== b.candidate.depth) {
      return a.candidate.depth - b.candidate.depth;
    }
    if ((a.candidate.paintOrder ?? a.index) !== (b.candidate.paintOrder ?? b.index)) {
      return (a.candidate.paintOrder ?? a.index) - (b.candidate.paintOrder ?? b.index);
    }
    return a.candidate.id.localeCompare(b.candidate.id);
  });
  const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];

  for (const { candidate: c } of sorted) {
    if (out.length >= NAME_LABEL_MAX) break;
    const p = opts.project(c);
    const fullName = oneLineLabelName(c.name);
    const displayName = displayLabelName(fullName);
    const labelBox = {
      x: p.screenX,
      y: p.screenY - 22,
      w: estimatedLabelWidth(displayName, c.kind),
      h: 18,
    };
    const objectBox = {
      x: p.screenX,
      y: p.screenY,
      w: Math.max(0, p.screenW),
      h: Math.max(0, p.screenH),
    };
    const viewportBox = {
      x: -24,
      y: -24,
      w: opts.viewportW + 48,
      h: opts.viewportH + 48,
    };
    // Culling includes the label box: a frame just outside the viewport can
    // still have a readable title entering through the edge.
    if (!overlaps(labelBox, viewportBox) && !overlaps(objectBox, viewportBox)) {
      continue;
    }
    const forceShow = Boolean(c.selected || c.hovered || c.editing);
    if (
      !shouldShowNameLabel({
        kind: c.kind,
        zoom: opts.zoom,
        screenW: p.screenW,
        screenH: p.screenH,
        name: fullName,
        insideContainer: c.depth > 0,
        forceShow,
      })
    ) {
      continue;
    }
    if (!forceShow && occupied.some((box) => overlaps(box, labelBox))) continue;
    occupied.push(labelBox);
    out.push({
      id: c.id,
      nodeId: c.nodeId,
      name: fullName,
      fullName,
      displayName,
      screenX: p.screenX,
      screenY: p.screenY,
      screenW: p.screenW,
      screenH: p.screenH,
      kind: c.kind,
      surfaceKey: c.surfaceKey,
      selected: Boolean(c.selected),
      hovered: Boolean(c.hovered),
      editing: Boolean(c.editing),
    });
  }
  return out;
}
