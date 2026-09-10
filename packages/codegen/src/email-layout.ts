/**
 * Email layout compilation.
 *
 * Varve lets people lay out an email with auto-layout, absolute positioning, or
 * a mix of both. Email clients support neither flexbox nor grid, so this pass
 * rewrites the semantic tree into the one structure email expresses reliably:
 * sections stacked vertically, each of which may hold a single row of columns.
 *
 * Without it, a design whose containers sit side by side on the canvas compiles
 * to a vertical stack — the desktop layout is simply lost unless the designer
 * hand-tags every container as `row` and every child as `column`.
 *
 * It runs on the Email IR after node compilation and before emission, so by the
 * time the emitter runs every `row` has `column` children with resolved widths
 * and a settled reading order.
 */

import type { EmailDocumentSettings, EmailIrNode, EmailIrWarning } from './email-ir-types';

/** Two boxes count as the same band when their vertical spans overlap this much. */
const VERTICAL_OVERLAP_RATIO = 0.5;

/** Below this width a column is not worth keeping beside its neighbour. */
const MIN_COLUMN_WIDTH = 80;

/** More columns than this cannot hold a readable measure at email widths. */
const MAX_COLUMNS = 4;

export interface EmailLayoutResult {
  nodes: EmailIrNode[];
  warnings: EmailIrWarning[];
}

/** Rewrite a compiled Email IR tree into email-safe stacked/row structure. */
export function normalizeEmailLayout(
  nodes: EmailIrNode[],
  settings: EmailDocumentSettings,
): EmailLayoutResult {
  const warnings: EmailIrWarning[] = [];
  const normalized = nodes.map((node) => normalizeNode(node, settings.contentWidth, warnings));
  return { nodes: normalized, warnings };
}

function normalizeNode(
  node: EmailIrNode,
  availableWidth: number,
  warnings: EmailIrWarning[],
): EmailIrNode {
  if (node.children.length === 0) return node;

  // A custom-HTML block owns its subtree verbatim; never restructure inside it.
  if (node.kind === 'custom-html') return node;

  const innerWidth = contentWidthOf(node, availableWidth);
  reportOverlaps(node, warnings);

  // An explicitly tagged row keeps its author's intent: every child becomes a
  // column, whatever the geometry says.
  if (node.kind === 'row') {
    const columns = node.children.map((child, index) =>
      toColumn(
        normalizeNode(child, evenWidth(innerWidth, node.children.length), warnings),
        evenWidth(innerWidth, node.children.length, index === node.children.length - 1),
      ),
    );
    return { ...node, children: columns };
  }

  const bands = groupIntoBands(node.children);
  const rebuilt: EmailIrNode[] = [];

  for (const band of bands) {
    const only = band[0] as EmailIrNode;
    if (band.length === 1) {
      rebuilt.push(normalizeNode(only, innerWidth, warnings));
      continue;
    }

    const widths = resolveColumnWidths(band, innerWidth);
    const columns = band.map((child, index) =>
      toColumn(normalizeNode(child, widths[index] as number, warnings), widths[index] as number),
    );
    rebuilt.push(makeRow(node, columns, innerWidth));
  }

  return { ...node, children: rebuilt };
}

// ── Banding ───────────────────────────────────────────────────────────────────

/**
 * Group siblings into horizontal bands.
 *
 * A band is a set of siblings that sit beside one another. Siblings without
 * geometry — auto-layout children, whose order is already meaningful — keep
 * their declared sequence and are never banded.
 */
function groupIntoBands(children: EmailIrNode[]): EmailIrNode[][] {
  const allPositioned = children.every((child) => child.geometry);
  if (!allPositioned || children.length < 2) return children.map((child) => [child]);

  const ordered = [...children].sort((a, b) => {
    const ay = a.geometry?.y ?? 0;
    const by = b.geometry?.y ?? 0;
    if (ay !== by) return ay - by;
    return (a.geometry?.x ?? 0) - (b.geometry?.x ?? 0);
  });

  const bands: EmailIrNode[][] = [];
  for (const child of ordered) {
    const band = bands.at(-1);
    if (band && band.length < MAX_COLUMNS && sharesBand(band, child)) band.push(child);
    else bands.push([child]);
  }

  // Reading order within a band is left to right, which is also the DOM order
  // the plain-text and screen-reader projections will follow.
  for (const band of bands) {
    band.sort((a, b) => (a.geometry?.x ?? 0) - (b.geometry?.x ?? 0));
  }
  return bands;
}

function sharesBand(band: EmailIrNode[], candidate: EmailIrNode): boolean {
  const box = candidate.geometry;
  if (!box || box.width < MIN_COLUMN_WIDTH) return false;

  return band.every((member) => {
    const other = member.geometry;
    if (!other || other.width < MIN_COLUMN_WIDTH) return false;
    // Must not overlap horizontally...
    const disjoint = box.x >= other.x + other.width || other.x >= box.x + box.width;
    if (!disjoint) return false;
    // ...and must share most of their vertical span, or they are simply two
    // things at different heights rather than two columns.
    const overlap = Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y);
    const shortest = Math.min(box.height, other.height);
    return shortest > 0 && overlap / shortest >= VERTICAL_OVERLAP_RATIO;
  });
}

/**
 * Report the first overlapping pair in a container.
 *
 * Banded siblings are disjoint by construction, so anything still overlapping is
 * layered artwork. Email has no reliable way to stack boxes, so the compiler
 * emits them in reading order and says so — silently flattening a design that
 * relied on layering would be worse than an explicit warning.
 */
function reportOverlaps(parent: EmailIrNode, warnings: EmailIrWarning[]): void {
  const boxed = parent.children.filter((child) => child.geometry);
  for (let i = 0; i < boxed.length; i += 1) {
    for (let j = i + 1; j < boxed.length; j += 1) {
      const first = boxed[i] as EmailIrNode;
      const second = boxed[j] as EmailIrNode;
      const a = first.geometry;
      const b = second.geometry;
      if (!a || !b) continue;
      const overlaps =
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      if (!overlaps) continue;

      const semantic = carriesMeaning(first) || carriesMeaning(second);
      warnings.push({
        severity: semantic ? 'error' : 'warning',
        code: semantic ? 'OVERLAP_SEMANTIC_CONTENT' : 'OVERLAP_DECORATIVE',
        message: semantic
          ? `"${first.name}" and "${second.name}" overlap, and at least one carries live text or a call to action. Email cannot layer them.`
          : `"${first.name}" and "${second.name}" overlap; they will be emitted in reading order rather than layered.`,
        sourceNodeId: first.sourceNodeId,
        category: 'layout',
        suggestedFix: semantic
          ? 'Separate the overlapping objects, or move the artwork into a background colour.'
          : 'Group the artwork and mark it decorative so it can be rasterised as one image.',
      });
      return; // one report per container is enough to point the designer at it
    }
  }
}

function carriesMeaning(node: EmailIrNode): boolean {
  if (node.kind === 'heading' || node.kind === 'button' || node.kind === 'paragraph') return true;
  if (node.kind === 'text' || node.kind === 'compliance') return true;
  if (node.link) return true;
  return node.children.some(carriesMeaning);
}

// ── Column construction ───────────────────────────────────────────────────────

/**
 * Split the available width across a band in proportion to the design widths,
 * then hand any rounding remainder to the last column so the parts always sum
 * to the whole. A row whose cells do not add up leaves a gap in Outlook.
 */
function resolveColumnWidths(band: EmailIrNode[], innerWidth: number): number[] {
  const designWidths = band.map((child) => child.geometry?.width ?? child.width ?? 0);
  const total = designWidths.reduce((sum, width) => sum + width, 0);

  if (total <= 0) {
    return band.map((_, index) => evenWidth(innerWidth, band.length, index === band.length - 1));
  }

  const widths = designWidths.map((width) =>
    Math.max(MIN_COLUMN_WIDTH, Math.round((width / total) * innerWidth)),
  );
  const assigned = widths.slice(0, -1).reduce((sum, width) => sum + width, 0);
  widths[widths.length - 1] = Math.max(MIN_COLUMN_WIDTH, innerWidth - assigned);
  return widths;
}

function evenWidth(innerWidth: number, count: number, isLast = false): number {
  const even = Math.floor(innerWidth / Math.max(1, count));
  return isLast ? innerWidth - even * (count - 1) : even;
}

/**
 * Wrap a node as a column cell.
 *
 * Columns default to stacking on mobile: a 300px column shown at its design
 * width on a phone is unreadable, and stacking is what a reader expects. An
 * explicit `preserve` on the source node overrides that.
 */
function toColumn(node: EmailIrNode, width: number): EmailIrNode {
  if (node.kind === 'column') {
    return { ...node, width, mobileBehavior: node.mobileBehavior ?? 'stack' };
  }
  return {
    id: `${node.id}-col`,
    sourceNodeId: node.sourceNodeId,
    kind: 'column',
    name: `${node.name} column`,
    children: [node],
    styles: {},
    compatibility: 'converted',
    width,
    mobileBehavior: node.mobileBehavior ?? 'stack',
    hideOnMobile: node.hideOnMobile,
    hideOnDesktop: node.hideOnDesktop,
    geometry: node.geometry,
  };
}

function makeRow(parent: EmailIrNode, columns: EmailIrNode[], innerWidth: number): EmailIrNode {
  const first = columns[0] as EmailIrNode;
  return {
    id: `${parent.id}-row-${first.sourceNodeId}`,
    sourceNodeId: parent.sourceNodeId,
    kind: 'row',
    name: `${parent.name} row`,
    children: columns,
    styles: {},
    compatibility: 'converted',
    width: innerWidth,
  };
}

/** The width a container's children actually have to share, after its padding. */
function contentWidthOf(node: EmailIrNode, availableWidth: number): number {
  const padding = parsePadding(node.styles.padding);
  const declared = node.geometry?.width ?? node.width ?? availableWidth;
  const inner = Math.min(declared, availableWidth) - padding.left - padding.right;
  return inner > MIN_COLUMN_WIDTH ? Math.round(inner) : availableWidth;
}

/** Parse the `top right bottom left` shorthand the style compiler emits. */
export function parsePadding(value: string | undefined): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const empty = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!value) return empty;
  const parts = value
    .trim()
    .split(/\s+/)
    .map((part) => Number.parseFloat(part))
    .map((part) => (Number.isFinite(part) ? part : 0));

  if (parts.length >= 4) {
    return {
      top: parts[0] as number,
      right: parts[1] as number,
      bottom: parts[2] as number,
      left: parts[3] as number,
    };
  }
  if (parts.length === 3) {
    return {
      top: parts[0] as number,
      right: parts[1] as number,
      bottom: parts[2] as number,
      left: parts[1] as number,
    };
  }
  if (parts.length === 2) {
    return {
      top: parts[0] as number,
      right: parts[1] as number,
      bottom: parts[0] as number,
      left: parts[1] as number,
    };
  }
  if (parts.length === 1) {
    const all = parts[0] as number;
    return { top: all, right: all, bottom: all, left: all };
  }
  return empty;
}
