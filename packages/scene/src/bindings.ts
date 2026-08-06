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

/**
 * Apply document variable bindings to a single node (non-destructive copy).
 */
export function applyBindingsToNode(node: SceneNode, store: VariableStore | undefined): SceneNode {
  if (!store || !node.bindings) return node;

  let next: SceneNode = node;

  for (const [property, binding] of Object.entries(node.bindings)) {
    try {
      const resolved = resolveBinding(store, binding as PropertyBinding);
      if (property === 'fill') {
        const fillColor = resolveBoundFill(binding as PropertyBinding, resolved);
        if (fillColor) {
          next = { ...next, fill: fillColor } as SceneNode;
        }
      } else if (property === 'opacity' && typeof resolved === 'number') {
        next = { ...next, opacity: resolved } as SceneNode;
      } else if (property === 'rotation' && typeof resolved === 'number') {
        next = { ...next, rotation: resolved } as SceneNode;
      } else if (property === 'x' && typeof resolved === 'number') {
        next = {
          ...next,
          transform: [...(next.transform || [1, 0, 0, 1, 0, 0])] as SceneNode['transform'],
        } as SceneNode;
        (next.transform as unknown as number[])[4] = resolved;
      } else if (property === 'y' && typeof resolved === 'number') {
        next = {
          ...next,
          transform: [...(next.transform || [1, 0, 0, 1, 0, 0])] as SceneNode['transform'],
        } as SceneNode;
        (next.transform as unknown as number[])[5] = resolved;
      } else if ((property === 'w' || property === 'width') && typeof resolved === 'number') {
        if (next.kind === 'frame') {
          next = { ...next, w: resolved } as SceneNode;
        } else if (next.kind === 'text') {
          next = { ...next, w: resolved } as SceneNode;
        } else if ('shape' in next && next.shape) {
          next = { ...next, shape: { ...next.shape, w: resolved } } as SceneNode;
        }
      } else if ((property === 'h' || property === 'height') && typeof resolved === 'number') {
        if (next.kind === 'frame') {
          next = { ...next, h: resolved } as SceneNode;
        } else if (next.kind === 'text') {
          next = { ...next, h: resolved } as SceneNode;
        } else if ('shape' in next && next.shape) {
          next = { ...next, shape: { ...next.shape, h: resolved } } as SceneNode;
        }
      } else if (property === 'fontSize' && typeof resolved === 'number' && next.kind === 'text') {
        next = { ...next, fontSize: resolved } as SceneNode;
      } else if (property === 'text' && typeof resolved === 'string' && next.kind === 'text') {
        next = { ...next, text: resolved } as SceneNode;
      } else if (isTablePaintKey(property) && next.kind === 'table') {
        // Table appearance paints resolve through the same variable pipeline
        // (aliases, modes, modifiers) and are never materialized as literals.
        const paintKey = resolveTablePaintKey(property);
        const paintColor = resolveBoundFill(binding as PropertyBinding, resolved);
        if (paintColor) {
          next = {
            ...next,
            table: {
              ...next.table,
              appearance: { ...next.table.appearance, [paintKey]: paintColor },
            },
          } as SceneNode;
        }
      }
    } catch {
      // Keep original value when binding is broken
    }
  }

  return next;
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
