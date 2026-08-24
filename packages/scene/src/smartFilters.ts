/**
 * Object-local, nondestructive filter stacks.
 *
 * Object Filters deliberately reuse the existing Adjustment discriminated union
 * and engine FilterIR contract. The scene model owns attachment, ordering and
 * identity; the renderer owns execution. Keeping the stack as document data
 * means filters survive undo, duplication, serialization and export without
 * turning them into adjustment-layer scene nodes.
 */

import type { Adjustment, AdjustmentKind } from '@varve/engine';
import { filterKindDisplayName, makeAdjustment } from '@varve/engine';
import { cryptoId } from './document-utils';

/** All adjustment kinds are valid object-filter entries; the UI may expose a subset. */
export const SMART_FILTER_KINDS: readonly AdjustmentKind[] = [
  'brightness',
  'contrast',
  'levels',
  'curves',
  'exposure',
  'saturation',
  'hueSaturation',
  'hueRotate',
  'colorBalance',
  'selectiveColor',
  'channelMixer',
  'temperature',
  'tint',
  'vibrance',
  'sepia',
  'grayscale',
  'invert',
  'opacity',
  'blur',
  'sharpen',
  'photoFilter',
  'shadowHighlight',
  'duotone',
  'blackAndWhite',
  'posterize',
  'threshold',
  'halftone',
  'gradientMap',
  'tritone',
  'colorHalftone',
  'lut',
  'dither',
  'paletteSnap',
  'bloom',
  'rgbSplit',
  'crt',
  'vhs',
  'lightShafts',
  'lensFlare',
  'lightLeak',
  'caustics',
];

/**
 * Create an object filter for the object-local workflow.
 *
 * Adjustment layers intentionally retain neutral defaults so they can be
 * added and then configured. A command named “Add Invert” has a different
 * semantic expectation, so its creation preset is full inversion while an
 * explicit `value` override remains authoritative.
 */
export function makeSmartFilter(
  id: string,
  kind: AdjustmentKind,
  overrides: Partial<Adjustment> = {},
): Adjustment {
  const adjustment = makeAdjustment(id, kind, overrides);
  if (kind === 'invert' && !Object.hasOwn(overrides, 'value')) {
    return { ...adjustment, value: 100 } as Adjustment;
  }
  return adjustment;
}

/** Human-readable name shared by the Object Filters UI and layer summaries. */
export { filterKindDisplayName };

/** True for nodes that can own an object-local rendered-result filter stack. */
export function canHaveSmartFilters(node: { kind: string }): boolean {
  // Adjustment layers are a separate backdrop-scoped concept. Allowing a
  // second stack on them would make ordering and scope ambiguous.
  return node.kind !== 'adjustment';
}

/**
 * Return the enabled entries in a node-local stack.
 *
 * `smartFiltersEnabled` is an optional stack-level switch: absent means on,
 * which keeps older documents compatible while giving the Inspector the same
 * one-click bypass users expect from a nondestructive effect stack.
 */
export function activeSmartFilters(owner: {
  smartFilters?: readonly Adjustment[];
  smartFiltersEnabled?: boolean;
}): Adjustment[] {
  if (owner.smartFiltersEnabled === false) return [];
  return (owner.smartFilters ?? []).filter(
    (filter) => filter.visible !== false && (filter.opacity ?? 1) > 0,
  );
}

/** Whether the node has at least one enabled, non-neutral Object Filter. */
export function hasActiveSmartFilters(owner: {
  smartFilters?: readonly Adjustment[];
  smartFiltersEnabled?: boolean;
}): boolean {
  return activeSmartFilters(owner).length > 0;
}

/**
 * Clone a stack without sharing mutable parameter objects or filter identity.
 * JSON is sufficient for the adjustment wire contract and preserves unknown
 * future entries when a newer document is duplicated by an older build.
 */
export function cloneSmartFilters(filters: readonly Adjustment[]): Adjustment[] {
  return filters.map((filter) => {
    let copy: Adjustment;
    try {
      copy = JSON.parse(JSON.stringify(filter)) as Adjustment;
    } catch {
      copy = { ...filter } as Adjustment;
    }
    return { ...copy, id: cryptoId() };
  });
}
