/**
 * Canvas name-label policy — when to paint Figma-style names above nodes.
 *
 * Frames always get a label (readable identity at any zoom). Other top-level
 * nodes only when heavily zoomed out / small on screen. Selected nodes still
 * get a label unless they are covered by the selection info strip alone —
 * canvas labels stay so zoomed-out clutter still names objects.
 *
 * Research basis: Figma frame/section title labels at low zoom.
 */

export interface NameLabelCandidate {
  id: string;
  name: string;
  kind: string;
  /** World AABB. */
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  parentId: string | null;
}

export interface NameLabelPlacement {
  id: string;
  name: string;
  /** Screen-space top-left of the node AABB. */
  screenX: number;
  screenY: number;
  kind: string;
}

/** Zoom at/below which non-frame nodes get labels. */
export const NAME_LABEL_ZOOM_THRESHOLD = 0.4;

/** Min screen px (either edge) for showing non-frame labels when zoom is mid. */
export const NAME_LABEL_MIN_SCREEN_EDGE = 32;

/** Max labels per frame to keep overlay cheap. */
export const NAME_LABEL_MAX = 80;

export function shouldShowNameLabel(opts: {
  kind: string;
  zoom: number;
  screenW: number;
  screenH: number;
  /** Hide empty / whitespace names. */
  name: string;
  /** Whether this node is inside a container (frame/group). */
  insideContainer?: boolean;
}): boolean {
  if (!opts.name.trim()) return false;
  if (opts.kind === 'frame') return true;
  // Children inside frames/groups don't get labels — the parent frame label
  // provides context. Only top-level nodes get labels when zoomed out.
  if (opts.insideContainer) return false;
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
  const sorted = [...candidates].sort((a, b) => {
    // Frames first, then shallow depth, then name.
    if (a.kind === 'frame' && b.kind !== 'frame') return -1;
    if (b.kind === 'frame' && a.kind !== 'frame') return 1;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.name.localeCompare(b.name);
  });

  for (const c of sorted) {
    if (out.length >= NAME_LABEL_MAX) break;
    const p = opts.project(c);
    // Cull if entirely outside viewport (with small margin for the label).
    if (
      p.screenX + p.screenW < -40 ||
      p.screenY + p.screenH < -20 ||
      p.screenX > opts.viewportW + 40 ||
      p.screenY > opts.viewportH + 40
    ) {
      continue;
    }
    if (
      !shouldShowNameLabel({
        kind: c.kind,
        zoom: opts.zoom,
        screenW: p.screenW,
        screenH: p.screenH,
        name: c.name,
        insideContainer: c.parentId !== null,
      })
    ) {
      continue;
    }
    out.push({
      id: c.id,
      name: c.name,
      screenX: p.screenX,
      screenY: p.screenY,
      kind: c.kind,
    });
  }
  return out;
}
