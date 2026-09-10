/**
 * Groups a flat blend-mode option list into the standard Darken/Lighten/
 * Contrast/Comparative/Component clusters (Photoshop/Figma/CSS convention),
 * so a long dropdown scans as related families instead of one flat list.
 *
 * Takes each call site's own existing option list as-is — it does not add,
 * remove, or reorder which values are offered, only how they're grouped.
 * Every section keeps whichever blend modes are actually valid for it
 * (e.g. FillSection's Plus Darker/Plus Lighter, which shadows/effects and
 * general node blending do not expose).
 */
import type { SelectOptionGroup } from '@varve/ui';

const GROUP_ORDER = [
  'Normal',
  'Darken',
  'Lighten',
  'Contrast',
  'Comparative',
  'Component',
] as const;

const GROUP_BY_VALUE: Record<string, (typeof GROUP_ORDER)[number]> = {
  normal: 'Normal',
  darken: 'Darken',
  multiply: 'Darken',
  colorBurn: 'Darken',
  plusDarker: 'Darken',
  lighten: 'Lighten',
  screen: 'Lighten',
  colorDodge: 'Lighten',
  plusLighter: 'Lighten',
  overlay: 'Contrast',
  softLight: 'Contrast',
  hardLight: 'Contrast',
  difference: 'Comparative',
  exclusion: 'Comparative',
  hue: 'Component',
  saturation: 'Component',
  color: 'Component',
  luminosity: 'Component',
};

export function groupBlendOptions<T extends { value: string; label: string }>(
  options: readonly T[],
): SelectOptionGroup[] {
  const byGroup = new Map<string, T[]>();
  for (const option of options) {
    const group = GROUP_BY_VALUE[option.value] ?? 'Other';
    const bucket = byGroup.get(group);
    if (bucket) bucket.push(option);
    else byGroup.set(group, [option]);
  }
  const order = [...GROUP_ORDER, 'Other'];
  return order
    .filter((group) => byGroup.has(group))
    .map((group) => ({ label: group, options: byGroup.get(group)! }));
}
