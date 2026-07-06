/**
 * Property binding resolution — applies VariableStore bindings to scene nodes.
 *
 * Research basis: Figma variable bindings on layer properties.
 */
import type { ManagedColor } from './colorManagement';
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

function bindingValueToFill(value: unknown): ManagedColor | undefined {
  if (typeof value === 'string') {
    return parseHexColor(value);
  }
  if (value && typeof value === 'object' && 'space' in value) {
    return value as ManagedColor;
  }
  return undefined;
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
        const fillColor = bindingValueToFill(resolved);
        if (fillColor) {
          next = { ...next, fill: fillColor } as SceneNode;
        }
      } else if (property === 'opacity' && typeof resolved === 'number') {
        next = { ...next, opacity: resolved } as SceneNode;
      } else if (property === 'rotation' && typeof resolved === 'number') {
        next = { ...next, rotation: resolved } as SceneNode;
      } else if (property === 'w' && typeof resolved === 'number' && next.kind === 'frame') {
        next = { ...next, w: resolved } as SceneNode;
      } else if (property === 'h' && typeof resolved === 'number' && next.kind === 'frame') {
        next = { ...next, h: resolved } as SceneNode;
      } else if (property === 'fontSize' && typeof resolved === 'number' && next.kind === 'text') {
        next = { ...next, fontSize: resolved } as SceneNode;
      } else if (property === 'text' && typeof resolved === 'string' && next.kind === 'text') {
        next = { ...next, text: resolved } as SceneNode;
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
