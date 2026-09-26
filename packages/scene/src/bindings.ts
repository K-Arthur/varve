/**
 * Property binding resolution — applies VariableStore bindings to scene nodes.
 *
 * Research basis: Figma variable bindings on layer properties.
 */
import type { ManagedColor } from './colorManagement';
import { applyAlphaModifiers } from './modifiers';
import type { PropertyBinding, SceneNode } from './types';
import { resolveBinding, type VariableStore } from './variables';

function parseHexColor(value: string): ManagedColor | undefined {
  const hex = value.trim();
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex);
  if (!m?.[1]) return undefined;
  const rgb = m[1];
  const r = Number.parseInt(rgb.slice(0, 2), 16);
  const g = Number.parseInt(rgb.slice(2, 4), 16);
  const b = Number.parseInt(rgb.slice(4, 6), 16);
  const a = m[2] ? Number.parseInt(m[2], 16) : 255;
  return { space: 'rgb', r, g, b, a };
}

export function bindingValueToFill(value: unknown): ManagedColor | undefined {
  if (typeof value === 'string') {
    return parseHexColor(value);
  }
  if (value && typeof value === 'object' && 'space' in value) {
    return value as ManagedColor;
  }
  return undefined;
}

/** Resolve the unmodified token color of a color binding (no modifiers). */
export function resolveBoundTokenColor(
  store: VariableStore | undefined,
  binding: PropertyBinding,
): ManagedColor | undefined {
  if (!store) return undefined;
  try {
    return bindingValueToFill(resolveBinding(store, binding));
  } catch {
    return undefined;
  }
}

/**
 * Resolve a fill from a binding value, applying the typed modifier stack.
 * Returns `undefined` when the value is not a compatible color — the binding
 * is preserved (never silently detached) and the original value stands.
 */
export function resolveBoundFill(
  binding: PropertyBinding,
  resolved: unknown,
): ManagedColor | undefined {
  const fillColor = bindingValueToFill(resolved);
  if (!fillColor) return undefined;
  if (binding.modifiers && binding.modifiers.length > 0) {
    const { color, valid } = applyAlphaModifiers(fillColor, binding.modifiers);
    return valid ? color : fillColor;
  }
  return fillColor;
}

/** Table appearance paints bindable through the node's `bindings` record. */
export type TablePaintKey =
  | 'table.headerFill'
  | 'table.bodyFill'
  | 'table.alternateFill'
  | 'table.borderColor'
  | 'table.dividerColor'
  | 'table.headerText'
  | 'table.bodyText';

export const TABLE_PAINT_BINDING_KEYS: readonly TablePaintKey[] = [
  'table.headerFill',
  'table.bodyFill',
  'table.alternateFill',
  'table.borderColor',
  'table.dividerColor',
  'table.headerText',
  'table.bodyText',
];

function isTablePaintKey(property: string): property is TablePaintKey {
  return (TABLE_PAINT_BINDING_KEYS as readonly string[]).includes(property);
}

type TableAppearancePaintKey =
  | 'headerFill'
  | 'bodyFill'
  | 'alternateFill'
  | 'borderColor'
  | 'dividerColor'
  | 'headerText'
  | 'bodyText';

function resolveTablePaintKey(key: TablePaintKey): TableAppearancePaintKey {
  return key.slice('table.'.length) as TableAppearancePaintKey;
}

type PaintedNode = SceneNode & {
  fills?: Array<Record<string, unknown>>;
  paintRefs?: string[];
};

const STROKE_WEIGHT_PREFIX = 'strokeWeight:';
const LEGACY_STROKE_PREFIX = 'legacy-stroke-';

/**
 * Resolve the `fill` binding onto the paint slot the renderer actually paints.
 *
 * Precedence mirrors `resolveNodePaints` (paintRefs → fills → legacy fill):
 * a shared paint reference owns its colour and is never silently rewritten,
 * a gradient/image primary paint is never flattened to the bound colour, and
 * a solid primary paint receives the bound colour while keeping its own
 * opacity/blend options. Returns `node` unchanged when the binding cannot be
 * applied — the binding itself is preserved so the UI can explain why.
 */
function applyFillBinding(node: SceneNode, binding: PropertyBinding, resolved: unknown): SceneNode {
  const bound = resolveBoundFill(binding, resolved);
  if (!bound) return node;
  const painted = node as PaintedNode;
  if (painted.paintRefs && painted.paintRefs.length > 0) return node;
  const fills = painted.fills;
  if (fills && fills.length > 0) {
    const primary = fills[0];
    if (primary?.type !== 'solid') return node;
    const nextFills = [...fills];
    nextFills[0] = { ...primary, color: bound };
    return { ...node, fills: nextFills } as SceneNode;
  }
  return { ...node, fill: bound } as SceneNode;
}

/** Map a `strokeWeight:<rowId>` binding key onto one stroke of the stack. */
function applyStrokeWeightBinding(node: SceneNode, property: string, resolved: unknown): SceneNode {
  if (typeof resolved !== 'number') return node;
  const strokes = (node as SceneNode & { strokes?: Array<{ id?: string; weight: number }> })
    .strokes;
  if (!strokes || strokes.length === 0) return node;
  const rowId = property.slice(STROKE_WEIGHT_PREFIX.length);
  if (!rowId) return node;
  let index = strokes.findIndex((stroke) => stroke.id === rowId);
  if (index < 0 && rowId.startsWith(LEGACY_STROKE_PREFIX)) {
    const legacyIndex = Number(rowId.slice(LEGACY_STROKE_PREFIX.length));
    if (Number.isInteger(legacyIndex) && legacyIndex >= 0 && legacyIndex < strokes.length) {
      index = legacyIndex;
    }
  }
  if (index < 0) return node;
  const nextStrokes = [...strokes];
  const target = nextStrokes[index];
  if (!target) return node;
  nextStrokes[index] = { ...target, weight: resolved };
  return { ...node, strokes: nextStrokes } as SceneNode;
}

/** Scalar node properties that accept a numeric binding. */
function applyScalarBinding(node: SceneNode, property: string, resolved: unknown): SceneNode {
  if (typeof resolved !== 'number') return node;
  switch (property) {
    case 'opacity':
      return { ...node, opacity: resolved };
    case 'rotation':
      return { ...node, rotation: resolved };
    case 'cornerRadius':
      if (node.kind === 'shape' || node.kind === 'frame') {
        return { ...node, cornerRadius: resolved } as SceneNode;
      }
      return node;
    case 'x':
    case 'y': {
      const transform = [...(node.transform || [1, 0, 0, 1, 0, 0])] as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      transform[property === 'x' ? 4 : 5] = resolved;
      return { ...node, transform } as SceneNode;
    }
    case 'w':
    case 'width':
    case 'h':
    case 'height': {
      const isWidth = property === 'w' || property === 'width';
      if (node.kind === 'frame' || node.kind === 'text') {
        return isWidth
          ? ({ ...node, w: resolved } as SceneNode)
          : ({ ...node, h: resolved } as SceneNode);
      }
      if ('shape' in node && node.shape) {
        return {
          ...node,
          shape: isWidth ? { ...node.shape, w: resolved } : { ...node.shape, h: resolved },
        } as SceneNode;
      }
      return node;
    }
    default:
      return node;
  }
}

/** Text-only scalar properties (typography metrics). */
function applyTextBinding(node: SceneNode, property: string, resolved: unknown): SceneNode {
  if (node.kind !== 'text') return node;
  switch (property) {
    case 'fontSize':
      return typeof resolved === 'number' ? { ...node, fontSize: resolved } : node;
    case 'text':
      return typeof resolved === 'string' ? { ...node, text: resolved } : node;
    case 'lineHeight':
    case 'letterSpacing':
    case 'tracking':
    case 'paragraphSpacing':
      return typeof resolved === 'number' ? ({ ...node, [property]: resolved } as SceneNode) : node;
    default:
      return node;
  }
}

function applySingleBinding(
  node: SceneNode,
  property: string,
  binding: PropertyBinding,
  resolved: unknown,
): SceneNode {
  if (property === 'fill') return applyFillBinding(node, binding, resolved);
  if (property.startsWith(STROKE_WEIGHT_PREFIX)) {
    return applyStrokeWeightBinding(node, property, resolved);
  }
  if (isTablePaintKey(property)) {
    if (node.kind !== 'table') return node;
    // Table appearance paints resolve through the same variable pipeline
    // (aliases, modes, modifiers) and are never materialized as literals.
    const paintKey = resolveTablePaintKey(property);
    const paintColor = resolveBoundFill(binding, resolved);
    if (!paintColor) return node;
    return {
      ...node,
      table: {
        ...node.table,
        appearance: { ...node.table.appearance, [paintKey]: paintColor },
      },
    } as SceneNode;
  }
  if (
    property === 'text' ||
    property === 'fontSize' ||
    property === 'lineHeight' ||
    property === 'letterSpacing' ||
    property === 'tracking' ||
    property === 'paragraphSpacing'
  ) {
    return applyTextBinding(node, property, resolved);
  }
  return applyScalarBinding(node, property, resolved);
}

/**
 * Apply document variable bindings to a single node (non-destructive copy).
 */
export function applyBindingsToNode(node: SceneNode, store: VariableStore | undefined): SceneNode {
  if (!store || !node.bindings) return node;

  let next: SceneNode = node;

  for (const [property, binding] of Object.entries(node.bindings)) {
    try {
      const resolved = resolveBinding(store, binding as PropertyBinding);
      next = applySingleBinding(next, property, binding as PropertyBinding, resolved);
    } catch {
      // Keep original value when binding is broken
    }
  }

  return next;
}

/**
 * Why a `fill` binding does (not) drive the node's painted colour.
 *
 * The renderer only honours the binding on the primary *solid* paint of a
 * node that does not reference a shared paint, so the Inspector must report
 * the same rule instead of implying the link is live.
 */
export function fillBindingApplicability(
  node: SceneNode,
): 'applied' | 'shared-paint' | 'non-solid' {
  const painted = node as PaintedNode;
  if (painted.paintRefs && painted.paintRefs.length > 0) return 'shared-paint';
  const fills = painted.fills;
  if (fills && fills.length > 0) {
    return fills[0]?.type === 'solid' ? 'applied' : 'non-solid';
  }
  return 'applied';
}

/**
 * Remove bindings that reference a deleted variable id.
 */
export function stripBindingForVariable(
  bindings: Record<string, PropertyBinding> | undefined,
  variableId: string,
): Record<string, PropertyBinding> | undefined {
  if (!bindings) return undefined;
  const next: Record<string, PropertyBinding> = {};
  let changed = false;
  for (const [key, binding] of Object.entries(bindings)) {
    if (binding.variableId === variableId) {
      changed = true;
      continue;
    }
    next[key] = binding;
  }
  if (!changed) return bindings;
  return Object.keys(next).length > 0 ? next : undefined;
}
