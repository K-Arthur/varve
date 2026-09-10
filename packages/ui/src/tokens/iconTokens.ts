/**
 * Icon design tokens — sizing, grid, and optical standards for the icon system.
 *
 * Icons use CSS custom properties defined in tokens.css via the `--icon-*`
 * prefix. These are the canonical sizes; feature code should never hardcode
 * icon pixel dimensions.
 *
 * Size rationale:
 * - `xs` (12px): dense toolbars, inline indicators, status badges
 * - `sm` (16px): default toolbar buttons, menu items, list rows
 * - `md` (20px): primary action buttons, sidebar navigation
 * - `lg` (24px): section headers, feature icons, empty states
 * - `xl` (32px): hero icons, onboarding illustrations
 *
 * Stroke width scales inversely with size for optical consistency.
 *
 * All sizes are integer pixel values to ensure crisp rendering on
 * standard-density displays. High-DPI displays render these at 2x/3x
 * automatically via the browser's rasterization.
 */

/** Semantic icon sizes (name -> pixel dimension). */
export const ICON_SIZES = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

export type IconSize = keyof typeof ICON_SIZES;

/** Recommended stroke width per icon size for optical balance. */
export const ICON_STROKE_WIDTHS = {
  xs: 1.5,
  sm: 1.5,
  md: 2,
  lg: 2,
  xl: 2.5,
} as const;

/** Standard icon grid sizes for icon creation presets. */
export const ICON_PRESETS = {
  grid16: 16,
  grid20: 20,
  grid24: 24,
  grid32: 32,
  grid48: 48,
  grid64: 64,
} as const;

export type IconPreset = keyof typeof ICON_PRESETS;

/** Optical padding as a fraction of the grid (for keyline shapes). */
export const ICON_KEYLINE_PADDING = 0.125; // 12.5% = 2px on a 24px grid

/** Minimum touch target size (WCAG 2.5.5). */
export const ICON_TOUCH_TARGET = 44;

/** Icon color tokens — reference semantic color tokens. */
export const ICON_COLORS = {
  /** Default icon color — inherits surrounding text. */
  default: 'var(--color-text-primary)',
  /** Secondary/muted icon. */
  muted: 'var(--color-text-muted)',
  /** Icon on accent/teal background. */
  onAccent: 'var(--color-text-on-accent)',
  /** Destructive action icon. */
  danger: 'var(--color-feedback-danger)',
  /** Warning state icon. */
  warning: 'var(--color-feedback-warning)',
  /** Success state icon. */
  success: 'var(--color-feedback-success)',
  /** Disabled icon. */
  disabled: 'var(--color-text-disabled)',
  /** Icon used over the canvas area. */
  canvas: 'var(--color-text-primary)',
} as const;

export type IconColorName = keyof typeof ICON_COLORS;

/**
 * Get the CSS custom property reference for an icon size.
 * Use in component styles: `width: var(--icon-size-sm)`.
 */
export function iconSizeVar(size: IconSize): string {
  return `var(--icon-size-${size})`;
}

/**
 * Get the CSS custom property reference for an icon color.
 */
export function iconColorVar(color: IconColorName): string {
  return ICON_COLORS[color];
}

/** All CSS custom properties emitted by the icon token generator. */
export const ICON_CSS_CUSTOM_PROPERTIES: Record<string, string> = {
  '--icon-size-xs': '12px',
  '--icon-size-sm': '16px',
  '--icon-size-md': '20px',
  '--icon-size-lg': '24px',
  '--icon-size-xl': '32px',
  '--icon-stroke-xs': '1.5px',
  '--icon-stroke-sm': '1.5px',
  '--icon-stroke-md': '2px',
  '--icon-stroke-lg': '2px',
  '--icon-stroke-xl': '2.5px',
  '--icon-touch-target': '44px',
  '--icon-keyline-padding': '12.5%',
};
