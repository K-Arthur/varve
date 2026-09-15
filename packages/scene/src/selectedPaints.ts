/**
 * Selection paint collection and replacement.
 *
 * This is deliberately a document-domain module, rather than an Inspector
 * helper.  The inspector, commands and both render targets therefore agree on
 * what a selected paint is: explicit, currently-visible vector paint data —
 * never a sampled/composited pixel colour.
 */

import { managedColorKey } from '@varve/shared';
import { resolveBoundTokenColor } from './bindings';
import type { Document } from './document';
import { isContainer } from './document';
import { solidFill } from './fills';
import { resolveNodePaints } from './paint';
import type { RichSelection } from './richTextOps';
import type { Fill, ManagedColor, NodeId, SceneNode, TextNode } from './types';
import { buildAllVariantCaches, getEffectiveNode } from './variant-apply';

/** Roles are retained even when the compact UI aggregates one colour. */
export type SelectedPaintRole =
  | 'fill'
  | 'stroke'
  | 'gradient-stop'
  | 'text-fill'
  | 'table-fill'
  | 'table-stroke'
  | 'table-text';

export type SelectedNonColorPaintKind = 'image' | 'pattern' | 'raster';

type FillStorage =
  | 'legacy-fill'
  | 'inline-fill'
  | 'shared-paint'
  | 'style-fill'
  | 'style-override'
  | 'variable-fill';

/** An exact, writable address for one paint-bearing field in the scene. */
export type SelectedPaintLocation =
  | {
      kind: 'fill';
      storage: FillStorage;
      fillIndex: number;
      gradientStopIndex?: number;
    }
  | { kind: 'stroke'; strokeIndex: number; gradientStopIndex?: number }
  | { kind: 'text-run'; paragraphIndex: number; runIndex: number; storyId?: NodeId }
  | { kind: 'table-appearance'; key: keyof import('./table').TableAppearance }
  | { kind: 'table-cell'; cellId: string; key: 'fill' | 'borderColor' };

export interface SelectedPaintReference {
  /** Stable enough for a render; never use as a persisted identity. */
  id: string;
  nodeId: NodeId;
  nodeKind: SceneNode['kind'];
  role: SelectedPaintRole;
  color: ManagedColor;
  /** Opacity stored on a fill. Stroke/text colours use 1. */
  paintOpacity: number;
  /** Kept distinct from paint opacity; it is not part of replacement identity. */
  objectOpacity: number;
  blendMode: SceneNode['blendMode'];
  location: SelectedPaintLocation;
  linkedPaintId?: string;
  linkedStyleId?: string;
  linkedVariableId?: string;
  /** Locked, story-backed and variant-derived fields are inspectable, not mutable here. */
  editable: boolean;
  editBlockReason?: 'locked' | 'linked-story' | 'variant-derived' | 'variable-bound';
}

export interface SelectedPaintGroup {
  /** Semantic identity: source colour space + alpha + fill opacity + linked source. */
  key: string;
  color: ManagedColor;
  paintOpacity: number;
  references: SelectedPaintReference[];
  roles: SelectedPaintRole[];
  editableReferenceCount: number;
}

export interface SelectedNonColorPaint {
  kind: SelectedNonColorPaintKind;
  count: number;
  nodeIds: NodeId[];
}

export interface SelectedPaintSummary {
  references: SelectedPaintReference[];
  groups: SelectedPaintGroup[];
  nonColorPaints: SelectedNonColorPaint[];
  /** Selected raster/image data is intentionally never sampled into colours. */
  hasRasterContent: boolean;
}

export interface SelectedPaintCollectionOptions {
  /**
   * A live rich-text range. It is intentionally only honoured for a single
   * selected text node; multi-object selection always means object scope.
   */
  textRange?: RichSelection | null;
}

interface FillEntry {
  fill: Fill;
  storage: FillStorage;
  linkedPaintId?: string;
  linkedStyleId?: string;
  linkedVariableId?: string;
}

interface NodeCollectionContext {
  raw: SceneNode;
  effective: SceneNode;
  variantDerived: boolean;
}

const TABLE_APPEARANCE_ROLES: ReadonlyArray<{
  key: keyof import('./table').TableAppearance;
  role: SelectedPaintRole;
  enabled: (appearance: import('./table').TableAppearance) => boolean;
}> = [
  { key: 'headerFill', role: 'table-fill', enabled: () => true },
  { key: 'bodyFill', role: 'table-fill', enabled: () => true },
  { key: 'alternateFill', role: 'table-fill', enabled: (appearance) => appearance.zebra },
  { key: 'borderColor', role: 'table-stroke', enabled: (appearance) => appearance.borderWidth > 0 },
  {
    key: 'dividerColor',
    role: 'table-stroke',
    enabled: (appearance) => appearance.dividerWidth > 0,
  },
  { key: 'headerText', role: 'table-text', enabled: () => true },
  { key: 'bodyText', role: 'table-text', enabled: () => true },
];

/**
 * Collect every active, explicit paint under the selected roots in stable paint
 * order. Selecting a container includes its visible descendants; selecting a
 * descendant as well does not duplicate it. Effects are intentionally outside
 * this feature's Paint scope and remain in their dedicated Effects inspector.
 */
export function collectSelectedPaints(
  document: Document,
  selectedIds: readonly NodeId[],
  options: SelectedPaintCollectionOptions = {},
): SelectedPaintSummary {
  const references: SelectedPaintReference[] = [];
  const nonColorPaints: SelectedNonColorPaint[] = [];
  const visited = new Set<NodeId>();
  const variantCaches = buildAllVariantCaches(document);

  const addNonColorPaint = (kind: SelectedNonColorPaintKind, nodeId: NodeId) => {
    const existing = nonColorPaints.find((paint) => paint.kind === kind);
    if (existing) {
      existing.count += 1;
      existing.nodeIds.push(nodeId);
      return;
    }
    nonColorPaints.push({ kind, count: 1, nodeIds: [nodeId] });
  };

  const visit = (id: NodeId) => {
    if (visited.has(id)) return;
    visited.add(id);
    const raw = document.nodes[id];
    if (!raw || raw.visible === false) return;
    const effective = getEffectiveNode(document, id, variantCaches) ?? raw;
    if (effective.visible === false) return;
    const context: NodeCollectionContext = {
      raw,
      effective,
      variantDerived: effective !== raw,
    };

    if (effective.kind === 'rasterLayer') {
      addNonColorPaint('raster', id);
    } else if (effective.kind !== 'group' && effective.kind !== 'adjustment') {
      collectNodePaints(
        document,
        context,
        references,
        addNonColorPaint,
        selectedIds.length === 1 && selectedIds[0] === id
          ? (options.textRange ?? undefined)
          : undefined,
      );
    }

    if (isContainer(effective)) {
      for (const childId of effective.children) visit(childId);
    }
  };

  for (const id of selectedIds) visit(id);

  return {
    references,
    groups: aggregateSelectedPaints(references),
    nonColorPaints,
    hasRasterContent: nonColorPaints.some(
      (paint) => paint.kind === 'image' || paint.kind === 'raster',
    ),
  };
}

/**
 * Update exactly the displayed, editable references. One caller transaction
 * makes this a single undo entry; unselected nodes and global paint/style
 * definitions are never modified.
 */
export function replaceSelectedPaintReferences(
  document: Document,
  references: readonly SelectedPaintReference[],
  color: ManagedColor,
): Document {
  let nodes = document.nodes;

  for (const reference of references) {
    if (!reference.editable) continue;
    const node = nodes[reference.nodeId];
    if (!node || node.locked) continue;
    const updated = replaceNodePaintReference(document, node, reference, color);
    if (updated === node) continue;
    if (nodes === document.nodes) nodes = { ...nodes };
    nodes[reference.nodeId] = updated;
  }

  return nodes === document.nodes ? document : { ...document, nodes };
}

/** Public for tests and non-React command consumers. */
export function aggregateSelectedPaints(
  references: readonly SelectedPaintReference[],
): SelectedPaintGroup[] {
  const groups = new Map<string, SelectedPaintGroup>();
  for (const reference of references) {
    const key = selectedPaintIdentity(reference);
    const existing = groups.get(key);
    if (existing) {
      existing.references.push(reference);
      if (!existing.roles.includes(reference.role)) existing.roles.push(reference.role);
      if (reference.editable) existing.editableReferenceCount += 1;
      continue;
    }
    groups.set(key, {
      key,
      color: reference.color,
      paintOpacity: reference.paintOpacity,
      references: [reference],
      roles: [reference.role],
      editableReferenceCount: reference.editable ? 1 : 0,
    });
  }
  return [...groups.values()];
}

function collectNodePaints(
  document: Document,
  context: NodeCollectionContext,
  references: SelectedPaintReference[],
  addNonColorPaint: (kind: SelectedNonColorPaintKind, nodeId: NodeId) => void,
  textRange?: RichSelection,
) {
  const { effective } = context;
  const richText = effective.kind === 'text' ? effectiveRichText(document, effective) : undefined;
  const textUsesBaseFill =
    !richText ||
    richText.paragraphs.some((paragraph) =>
      paragraph.runs.some(
        (run, runIndex) =>
          runOverlapsTextRange(richText, paragraph, runIndex, textRange) &&
          !toManagedColor(run.format?.color),
      ),
    );
  const baseRole: SelectedPaintRole = effective.kind === 'text' ? 'text-fill' : 'fill';

  if (effective.kind !== 'text' || textUsesBaseFill) {
    for (const [fillIndex, entry] of resolveFillEntries(document, context).entries()) {
      collectFill(effective, entry, fillIndex, baseRole, context, references, addNonColorPaint);
    }
  }

  if (effective.kind === 'text' && richText) {
    for (const [paragraphIndex, paragraph] of richText.paragraphs.entries()) {
      for (const [runIndex, run] of paragraph.runs.entries()) {
        if (!runOverlapsTextRange(richText, paragraph, runIndex, textRange)) continue;
        const color = toManagedColor(run.format?.color);
        if (!color) continue;
        const storyId = effective.storyBinding?.storyId;
        addReference(references, effective, context, {
          id: `${effective.id}:text-run:${paragraphIndex}:${runIndex}`,
          role: 'text-fill',
          color,
          paintOpacity: 1,
          location: { kind: 'text-run', paragraphIndex, runIndex, storyId },
          editable: !storyId,
          editBlockReason: storyId ? 'linked-story' : undefined,
        });
      }
    }
  }

  if ('strokes' in effective && Array.isArray(effective.strokes)) {
    for (const [strokeIndex, stroke] of effective.strokes.entries()) {
      if (!stroke.visible) continue;
      if (stroke.gradient) {
        for (const [gradientStopIndex, stop] of stroke.gradient.stops.entries()) {
          addReference(references, effective, context, {
            id: `${effective.id}:stroke:${strokeIndex}:stop:${gradientStopIndex}`,
            role: 'gradient-stop',
            color: stop.color,
            paintOpacity: 1,
            location: { kind: 'stroke', strokeIndex, gradientStopIndex },
          });
        }
      } else {
        addReference(references, effective, context, {
          id: `${effective.id}:stroke:${strokeIndex}`,
          role: 'stroke',
          color: stroke.color,
          paintOpacity: 1,
          location: { kind: 'stroke', strokeIndex },
        });
      }
    }
  }

  if (effective.kind === 'table') {
    collectTablePaints(effective, context, references);
  }
}

function collectFill(
  node: SceneNode,
  entry: FillEntry,
  fillIndex: number,
  role: SelectedPaintRole,
  context: NodeCollectionContext,
  references: SelectedPaintReference[],
  addNonColorPaint: (kind: SelectedNonColorPaintKind, nodeId: NodeId) => void,
) {
  const { fill } = entry;
  if (!fill.visible) return;
  if (fill.type === 'solid' && fill.color) {
    addReference(references, node, context, {
      id: `${node.id}:fill:${fillIndex}`,
      role,
      color: fill.color,
      paintOpacity: fill.opacity,
      location: { kind: 'fill', storage: entry.storage, fillIndex },
      linkedPaintId: entry.linkedPaintId,
      linkedStyleId: entry.linkedStyleId,
      linkedVariableId: entry.linkedVariableId,
      editable: entry.storage !== 'variable-fill',
      editBlockReason: entry.storage === 'variable-fill' ? 'variable-bound' : undefined,
    });
    return;
  }
  if (fill.type === 'gradient' && fill.gradient) {
    for (const [gradientStopIndex, stop] of fill.gradient.stops.entries()) {
      addReference(references, node, context, {
        id: `${node.id}:fill:${fillIndex}:stop:${gradientStopIndex}`,
        role: 'gradient-stop',
        color: stop.color,
        paintOpacity: fill.opacity,
        location: { kind: 'fill', storage: entry.storage, fillIndex, gradientStopIndex },
        linkedPaintId: entry.linkedPaintId,
        linkedStyleId: entry.linkedStyleId,
        linkedVariableId: entry.linkedVariableId,
        editable: entry.storage !== 'variable-fill',
        editBlockReason: entry.storage === 'variable-fill' ? 'variable-bound' : undefined,
      });
    }
    return;
  }
  if (fill.type === 'image') addNonColorPaint('image', node.id);
  if (fill.type === 'pattern') addNonColorPaint('pattern', node.id);
}

function collectTablePaints(
  node: Extract<SceneNode, { kind: 'table' }>,
  context: NodeCollectionContext,
  references: SelectedPaintReference[],
) {
  const { appearance } = node.table;
  for (const definition of TABLE_APPEARANCE_ROLES) {
    if (!definition.enabled(appearance)) continue;
    const color = appearance[definition.key];
    if (!isManagedColor(color)) continue;
    addReference(references, node, context, {
      id: `${node.id}:table:${definition.key}`,
      role: definition.role,
      color,
      paintOpacity: 1,
      location: { kind: 'table-appearance', key: definition.key },
    });
  }
  for (const cell of Object.values(node.table.cells)) {
    const row = node.table.rows[cell.rowId];
    const column = node.table.columns[cell.columnId];
    if (!cell.style || row?.hidden || column?.hidden) continue;
    for (const key of ['fill', 'borderColor'] as const) {
      const color = cell.style[key];
      if (!color || !isManagedColor(color)) continue;
      addReference(references, node, context, {
        id: `${node.id}:table-cell:${cell.id}:${key}`,
        role: key === 'fill' ? 'table-fill' : 'table-stroke',
        color,
        paintOpacity: 1,
        location: { kind: 'table-cell', cellId: cell.id, key },
        editable: !cell.locked,
        editBlockReason: cell.locked ? 'locked' : undefined,
      });
    }
  }
}

function addReference(
  references: SelectedPaintReference[],
  node: SceneNode,
  context: NodeCollectionContext,
  input: Omit<
    SelectedPaintReference,
    'nodeId' | 'nodeKind' | 'objectOpacity' | 'blendMode' | 'editable'
  > & { editable?: boolean },
) {
  const locked = context.raw.locked;
  const variantDerived = context.variantDerived;
  references.push({
    ...input,
    nodeId: node.id,
    nodeKind: node.kind,
    objectOpacity: node.opacity,
    blendMode: node.blendMode,
    editable: input.editable !== false && !locked && !variantDerived,
    editBlockReason: locked ? 'locked' : variantDerived ? 'variant-derived' : input.editBlockReason,
  });
}

function resolveFillEntries(document: Document, context: NodeCollectionContext): FillEntry[] {
  const { raw, effective } = context;
  const override = raw.styleOverrides;
  const overrideFills = asFills(override?.fills);
  if (overrideFills) {
    return overrideFills.map((fill) => ({
      fill,
      storage: 'style-override',
      linkedStyleId: raw.styleId,
    }));
  }
  const overrideFill = asFill(override?.fill);
  if (overrideFill) {
    return [{ fill: overrideFill, storage: 'style-override', linkedStyleId: raw.styleId }];
  }
  const style = raw.styleId ? document.styles?.[raw.styleId] : undefined;
  if (style?.type === 'color') {
    return [{ fill: style.fill, storage: 'style-fill', linkedStyleId: style.id }];
  }

  const binding = raw.bindings?.fill;
  const boundColor = binding ? resolveBoundTokenColor(document.variableStore, binding) : undefined;
  if (boundColor && !raw.fills?.length && !raw.paintRefs?.length) {
    return [
      {
        fill: solidFill(boundColor),
        storage: 'variable-fill',
        linkedVariableId: binding?.variableId,
      },
    ];
  }

  const fills = resolveNodePaints(
    effective as unknown as Parameters<typeof resolveNodePaints>[0],
    document,
  );
  const storage: FillStorage = effective.paintRefs?.length
    ? 'shared-paint'
    : effective.fills?.length
      ? 'inline-fill'
      : 'legacy-fill';
  return fills.map((fill, index) => ({
    fill,
    storage,
    linkedPaintId: storage === 'shared-paint' ? effective.paintRefs?.[index] : undefined,
  }));
}

function effectiveRichText(document: Document, node: TextNode) {
  const story = node.storyBinding ? document.stories?.[node.storyBinding.storyId] : undefined;
  return story?.content ?? node.richText;
}

function selectedPaintIdentity(reference: SelectedPaintReference): string {
  const semanticSource = reference.linkedPaintId
    ? `paint:${reference.linkedPaintId}`
    : reference.linkedStyleId
      ? `style:${reference.linkedStyleId}`
      : reference.linkedVariableId
        ? `variable:${reference.linkedVariableId}`
        : 'local';
  // managedColorKey intentionally keeps authoring colour spaces distinct. Add
  // profile fingerprints for RGB/CMYK too; different ICC revisions must not
  // collapse merely because their display preview currently matches.
  const fingerprint =
    'profileFingerprint' in reference.color ? reference.color.profileFingerprint : '';
  return `${managedColorKey(reference.color)}:${fingerprint ?? ''}:opacity:${numberKey(
    reference.paintOpacity,
  )}:${semanticSource}`;
}

function numberKey(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value < 0 ? '-Infinity' : 'Infinity';
  return Object.is(value, -0) ? '0' : String(value);
}

function replaceNodePaintReference(
  document: Document,
  node: SceneNode,
  reference: SelectedPaintReference,
  color: ManagedColor,
): SceneNode {
  switch (reference.location.kind) {
    case 'fill':
      return replaceFillReference(document, node, reference.location, color);
    case 'stroke':
      return replaceStrokeReference(node, reference.location, color);
    case 'text-run':
      return replaceTextRunReference(node, reference.location, color);
    case 'table-appearance':
      return replaceTableAppearanceReference(node, reference.location.key, color);
    case 'table-cell':
      return replaceTableCellReference(
        node,
        reference.location.cellId,
        reference.location.key,
        color,
      );
  }
}

function replaceFillReference(
  document: Document,
  node: SceneNode,
  location: Extract<SelectedPaintLocation, { kind: 'fill' }>,
  color: ManagedColor,
): SceneNode {
  if (location.storage === 'variable-fill') return node;
  if (location.storage === 'legacy-fill') {
    if (location.gradientStopIndex !== undefined) return node;
    return { ...node, fill: color };
  }

  if (location.storage === 'style-fill' || location.storage === 'style-override') {
    const current = resolveFillEntries(document, {
      raw: node,
      effective: node,
      variantDerived: false,
    }).map((entry) => entry.fill);
    const fills = replaceColorInFillStack(
      current,
      location.fillIndex,
      location.gradientStopIndex,
      color,
    );
    if (fills === current) return node;
    return {
      ...node,
      styleOverrides: { ...node.styleOverrides, fills },
    };
  }

  const current = resolveNodePaints(
    node as unknown as Parameters<typeof resolveNodePaints>[0],
    document,
  );
  const fills = replaceColorInFillStack(
    current,
    location.fillIndex,
    location.gradientStopIndex,
    color,
  );
  if (fills === current) return node;
  if (location.storage === 'shared-paint') {
    // A Selection Colors replacement is selection-scoped. Detaching only this
    // selected usage prevents a shared Paint from changing unselected nodes.
    const { paintRefs: _paintRefs, ...withoutPaintRefs } = node;
    return { ...withoutPaintRefs, fills } as SceneNode;
  }
  return { ...node, fills };
}

function replaceColorInFillStack(
  fills: readonly Fill[],
  fillIndex: number,
  gradientStopIndex: number | undefined,
  color: ManagedColor,
): Fill[] {
  const fill = fills[fillIndex];
  if (!fill) return fills as Fill[];
  let updated: Fill | undefined;
  if (gradientStopIndex === undefined) {
    if (fill.type !== 'solid' || !fill.color) return fills as Fill[];
    if (sameManagedColor(fill.color, color)) return fills as Fill[];
    updated = { ...fill, color };
  } else {
    const stop = fill.gradient?.stops[gradientStopIndex];
    if (!stop || !fill.gradient) return fills as Fill[];
    if (sameManagedColor(stop.color, color)) return fills as Fill[];
    const stops = [...fill.gradient.stops];
    stops[gradientStopIndex] = { ...stop, color };
    updated = { ...fill, gradient: { ...fill.gradient, stops } };
  }
  const next = [...fills];
  next[fillIndex] = updated;
  return next;
}

function replaceStrokeReference(
  node: SceneNode,
  location: Extract<SelectedPaintLocation, { kind: 'stroke' }>,
  color: ManagedColor,
): SceneNode {
  if (!('strokes' in node) || !Array.isArray(node.strokes)) return node;
  const stroke = node.strokes[location.strokeIndex];
  if (!stroke) return node;
  const strokes = [...node.strokes];
  if (location.gradientStopIndex === undefined) {
    if (stroke.gradient) return node;
    if (sameManagedColor(stroke.color, color)) return node;
    strokes[location.strokeIndex] = { ...stroke, color };
  } else {
    const stop = stroke.gradient?.stops[location.gradientStopIndex];
    if (!stop || !stroke.gradient) return node;
    if (sameManagedColor(stop.color, color)) return node;
    const stops = [...stroke.gradient.stops];
    stops[location.gradientStopIndex] = { ...stop, color };
    strokes[location.strokeIndex] = { ...stroke, gradient: { ...stroke.gradient, stops } };
  }
  return { ...node, strokes } as SceneNode;
}

function replaceTextRunReference(
  node: SceneNode,
  location: Extract<SelectedPaintLocation, { kind: 'text-run' }>,
  color: ManagedColor,
): SceneNode {
  if (node.kind !== 'text' || location.storyId) return node;
  const paragraph = node.richText?.paragraphs[location.paragraphIndex];
  const run = paragraph?.runs[location.runIndex];
  if (!paragraph || !run) return node;
  if (sameManagedColor(toManagedColor(run.format?.color), color)) return node;
  const paragraphs = [...node.richText!.paragraphs];
  const runs = [...paragraph.runs];
  runs[location.runIndex] = { ...run, format: { ...run.format, color } };
  paragraphs[location.paragraphIndex] = { ...paragraph, runs };
  return { ...node, richText: { ...node.richText!, paragraphs } };
}

function replaceTableAppearanceReference(
  node: SceneNode,
  key: keyof import('./table').TableAppearance,
  color: ManagedColor,
): SceneNode {
  if (node.kind !== 'table') return node;
  if (sameManagedColor(node.table.appearance[key] as ManagedColor | undefined, color)) return node;
  return {
    ...node,
    table: { ...node.table, appearance: { ...node.table.appearance, [key]: color } },
  };
}

function replaceTableCellReference(
  node: SceneNode,
  cellId: string,
  key: 'fill' | 'borderColor',
  color: ManagedColor,
): SceneNode {
  if (node.kind !== 'table') return node;
  const cell = node.table.cells[cellId];
  if (!cell?.style || cell.locked) return node;
  if (sameManagedColor(cell.style[key], color)) return node;
  return {
    ...node,
    table: {
      ...node.table,
      cells: {
        ...node.table.cells,
        [cellId]: { ...cell, style: { ...cell.style, [key]: color } },
      },
    },
  };
}

function asFill(value: unknown): Fill | undefined {
  if (!value || typeof value !== 'object' || !('type' in value)) return undefined;
  const type = (value as { type?: unknown }).type;
  return type === 'solid' || type === 'gradient' || type === 'image' || type === 'pattern'
    ? (value as Fill)
    : undefined;
}

function asFills(value: unknown): Fill[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const fills = value.map(asFill);
  return fills.every((fill): fill is Fill => Boolean(fill)) ? fills : undefined;
}

function toManagedColor(value: unknown): ManagedColor | undefined {
  if (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((component) => typeof component === 'number')
  ) {
    return { space: 'rgb', r: value[0]!, g: value[1]!, b: value[2]!, a: value[3]! };
  }
  return isManagedColor(value) ? value : undefined;
}

function isManagedColor(value: unknown): value is ManagedColor {
  return Boolean(
    value && typeof value === 'object' && 'space' in value && typeof value.space === 'string',
  );
}

function sameManagedColor(a: ManagedColor | undefined, b: ManagedColor): boolean {
  if (!a) return false;
  const aFingerprint = 'profileFingerprint' in a ? a.profileFingerprint : '';
  const bFingerprint = 'profileFingerprint' in b ? b.profileFingerprint : '';
  return managedColorKey(a) === managedColorKey(b) && aFingerprint === bFingerprint;
}

function runOverlapsTextRange(
  richText: NonNullable<TextNode['richText']>,
  paragraph: NonNullable<TextNode['richText']>['paragraphs'][number],
  runIndex: number,
  range: RichSelection | undefined,
): boolean {
  if (!range) return true;
  const paragraphIndex = richText.paragraphs.indexOf(paragraph);
  if (paragraphIndex < range.start.paragraphIndex || paragraphIndex > range.end.paragraphIndex) {
    return false;
  }
  const reverse =
    range.start.paragraphIndex > range.end.paragraphIndex ||
    (range.start.paragraphIndex === range.end.paragraphIndex &&
      range.start.offset > range.end.offset);
  const start = reverse ? range.end : range.start;
  const end = reverse ? range.start : range.end;
  if (paragraphIndex < start.paragraphIndex || paragraphIndex > end.paragraphIndex) return false;
  let offset = 0;
  for (let index = 0; index < runIndex; index++) offset += paragraph.runs[index]?.text.length ?? 0;
  const runEnd = offset + (paragraph.runs[runIndex]?.text.length ?? 0);
  const rangeStart = paragraphIndex === start.paragraphIndex ? start.offset : 0;
  const rangeEnd = paragraphIndex === end.paragraphIndex ? end.offset : Number.POSITIVE_INFINITY;
  if (rangeStart === rangeEnd) return offset <= rangeStart && runEnd >= rangeStart;
  return runEnd > rangeStart && offset < rangeEnd;
}
