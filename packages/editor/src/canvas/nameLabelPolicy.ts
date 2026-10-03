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
  /** Label box position, kept separate when active labels need collision relief. */
  labelX: number;
  labelY: number;
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

/** Widest estimated label, in screen px. */
const NAME_LABEL_MAX_WIDTH = 280;
/** Labels sit this far above their node, in screen px. */
const NAME_LABEL_OFFSET_Y = 22;
/** Culling margin around the viewport, in screen px. */
const NAME_LABEL_CULL_MARGIN = 24;
const NAME_LABEL_HEIGHT = 18;
const NAME_LABEL_GAP = 2;
const NAME_LABEL_EDGE = 4;

type LabelBox = { x: number; y: number; w: number; h: number };
type ProjectedBounds = Pick<NameLabelPlacement, 'screenX' | 'screenY' | 'screenW' | 'screenH'>;

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
  return Math.min(
    NAME_LABEL_MAX_WIDTH,
    Math.max(28, Array.from(name).length * fontSize * 0.58 + 10),
  );
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Active names remain available; move them out of artwork and other names. */
function placeActiveLabel(
  preferred: LabelBox,
  blockers: LabelBox[],
  viewportW: number,
  viewportH: number,
): LabelBox {
  const initial = {
    ...preferred,
    x: Math.max(NAME_LABEL_EDGE, Math.min(preferred.x, viewportW - preferred.w - NAME_LABEL_EDGE)),
    y: Math.max(NAME_LABEL_EDGE, Math.min(preferred.y, viewportH - preferred.h - NAME_LABEL_EDGE)),
  };
  // Each horizontally intersecting blocker forbids an interval of label-top
  // positions. Sweep these intervals once per direction; repeated collision
  // filtering made a dense 80-name selection unnecessarily cubic.
  const intervals = blockers
    .filter((box) => initial.x < box.x + box.w && box.x < initial.x + initial.w)
    .map((box) => ({
      low: box.y - initial.h - NAME_LABEL_GAP,
      high: box.y + box.h + NAME_LABEL_GAP,
    }))
    .sort((a, b) => b.high - a.high);
  let y = initial.y;
  for (const interval of intervals) {
    if (y > interval.low && y < interval.high) y = interval.low;
  }
  if (y >= NAME_LABEL_EDGE) return { ...initial, y };
  // Near the viewport top search below instead, retaining the name.
  y = initial.y;
  intervals.sort((a, b) => a.low - b.low);
  for (const interval of intervals) {
    if (y > interval.low && y < interval.high) y = interval.high;
  }
  if (y + initial.h <= viewportH - NAME_LABEL_EDGE) return { ...initial, y };
  // An overfilled/short canvas can have no free label row. Keep the name and
  // its full title reachable; do not silently drop selected identities.
  return initial;
}

function projectedObjectBox(p: ProjectedBounds): LabelBox {
  return { x: p.screenX, y: p.screenY, w: Math.max(0, p.screenW), h: Math.max(0, p.screenH) };
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
/**
 * Priority order is independent of the camera. Callers keep the candidate
 * array stable across pan/zoom frames, so the sort is cached per array.
 */
const orderedByCandidates = new WeakMap<
  NameLabelCandidate[],
  Array<{ candidate: NameLabelCandidate; index: number }>
>();

function orderedCandidates(
  candidates: NameLabelCandidate[],
): Array<{ candidate: NameLabelCandidate; index: number }> {
  const cached = orderedByCandidates.get(candidates);
  if (cached) return cached;
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
  orderedByCandidates.set(candidates, sorted);
  return sorted;
}

/**
 * Screen rectangle a node's screen AABB must intersect for its label or its
 * own box to survive culling: the culling box widened left by the widest
 * label (which runs rightward from the node) and down by the label offset
 * (labels sit above their node), plus a pixel of rounding slack.
 */
export function nameLabelReach(
  viewportW: number,
  viewportH: number,
): { x: number; y: number; w: number; h: number } {
  const slack = 1;
  const left = NAME_LABEL_CULL_MARGIN + NAME_LABEL_MAX_WIDTH + slack;
  const top = NAME_LABEL_CULL_MARGIN + slack;
  return {
    x: -left,
    y: -top,
    w: left + viewportW + NAME_LABEL_CULL_MARGIN + slack,
    h: top + viewportH + NAME_LABEL_CULL_MARGIN + NAME_LABEL_OFFSET_Y + slack,
  };
}

export function pickNameLabelCandidates(
  candidates: NameLabelCandidate[],
  opts: {
    zoom: number;
    viewportW: number;
    viewportH: number;
    /**
     * Optional cheap pre-check. Returning false must imply the candidate's
     * projected box misses `nameLabelReach`, so skipping it changes nothing.
     */
    mayBeVisible?: (c: NameLabelCandidate) => boolean;
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
  const sorted = orderedCandidates(candidates);
  const occupied: LabelBox[] = [];

  const viewportBox = {
    x: -NAME_LABEL_CULL_MARGIN,
    y: -NAME_LABEL_CULL_MARGIN,
    w: opts.viewportW + NAME_LABEL_CULL_MARGIN * 2,
    h: opts.viewportH + NAME_LABEL_CULL_MARGIN * 2,
  };

  // Active candidates sort first. Project only their visible prefix once so
  // names on nested/overlapping selections can avoid every selected body,
  // including a body encountered later in paint order.
  const activeBounds = new Map<NameLabelCandidate, ProjectedBounds>();
  const activeObjects: LabelBox[] = [];
  let visibleSelectedCount = 0;
  for (const { candidate: c } of sorted) {
    if (!(c.selected || c.hovered || c.editing)) break;
    if (activeObjects.length >= NAME_LABEL_MAX) break;
    if (opts.mayBeVisible && !opts.mayBeVisible(c)) continue;
    const projected = opts.project(c);
    activeBounds.set(c, projected);
    const box = projectedObjectBox(projected);
    if (overlaps(box, viewportBox)) {
      activeObjects.push(box);
      if (c.selected) visibleSelectedCount++;
    }
  }
  // Gap readouts sit above their spacing handles and can protrude above a
  // tiny selected node (e.g. the 1px PNG beside imported SVG artwork). Leave
  // that existing readout band clear as well as the bodies themselves.
  const activeBlockers =
    visibleSelectedCount > 1
      ? activeObjects.map((box) => ({
          ...box,
          y: box.y - NAME_LABEL_OFFSET_Y,
          h: box.h + NAME_LABEL_OFFSET_Y,
        }))
      : activeObjects;

  for (const { candidate: c } of sorted) {
    if (out.length >= NAME_LABEL_MAX) break;
    if (opts.mayBeVisible && !opts.mayBeVisible(c)) continue;
    const p = activeBounds.get(c) ?? opts.project(c);
    const objectBox = projectedObjectBox(p);
    // Culling includes the label box: a frame just outside the viewport can
    // still have a readable title entering through the edge. The widest label
    // is checked first; the real one starts at the same point and is no
    // wider, so it cannot overlap when the widest does not, and the name
    // work below is skipped for the thousands of off-screen candidates.
    const widestLabelBox = {
      x: p.screenX,
      y: p.screenY - NAME_LABEL_OFFSET_Y,
      w: NAME_LABEL_MAX_WIDTH,
      h: NAME_LABEL_HEIGHT,
    };
    const objectVisible = overlaps(objectBox, viewportBox);
    if (!objectVisible && !overlaps(widestLabelBox, viewportBox)) continue;
    const fullName = oneLineLabelName(c.name);
    const displayName = displayLabelName(fullName);
    let labelBox = { ...widestLabelBox, w: estimatedLabelWidth(displayName, c.kind) };
    if (!objectVisible && !overlaps(labelBox, viewportBox)) continue;
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
    if (forceShow && objectVisible) {
      labelBox = placeActiveLabel(
        labelBox,
        [...activeBlockers, ...occupied],
        opts.viewportW,
        opts.viewportH,
      );
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
      labelX: labelBox.x,
      labelY: labelBox.y,
      kind: c.kind,
      surfaceKey: c.surfaceKey,
      selected: Boolean(c.selected),
      hovered: Boolean(c.hovered),
      editing: Boolean(c.editing),
    });
  }
  return out;
}
