/**
 * Strata `<Icon>` — the single SVG-icon primitive (Strata plan §4.4).
 *
 * Built on Lucide. Enforces the accessible-name contract:
 *   - pass `label` for a meaningful icon -> role="img" + aria-label
 *   - omit `label` for a decorative icon next to visible text -> aria-hidden
 * Zero emoji anywhere; this is the only graphics primitive for UI affordances.
 *
 * Research basis: ARIA APG "icon button" / "decorative image" guidance; SVG-AAM.
 */

import { icons, type LucideIcon } from 'lucide-react';
import { forwardRef, type SVGProps } from 'react';

/** Every Lucide icon name (PascalCase). Compile-time-checked `name` prop. */
export type IconName = keyof typeof icons;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  /** Lucide icon name, e.g. "Square", "MousePointer2", "Pen". */
  name: IconName;
  /**
   * Accessible name. If provided the icon is exposed as `role="img"` with an
   * `aria-label`. If omitted the icon is marked `aria-hidden` (decorative) and
   * MUST be accompanied by a visible text label in the surrounding UI.
   */
  label?: string;
  /** Pixel size; defaults to 1em (inherits font-size). Stroke uses currentColor. */
  size?: number | string;
}

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, label, size = '1em', ...rest },
  ref,
) {
  const Cmp = icons[name] as LucideIcon;
  if (label) {
    return <Cmp ref={ref} role="img" aria-label={label} size={size} {...rest} />;
  }
  return <Cmp ref={ref} aria-hidden size={size} focusable={false} {...rest} />;
});
