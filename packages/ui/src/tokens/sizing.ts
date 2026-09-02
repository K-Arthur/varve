/**
 * Canonical visible component dimensions and interaction geometry.
 *
 * These values describe application UI only. Document objects, canvas
 * coordinates, exported geometry, and pointer thresholds have separate
 * contracts and must not consume these tokens.
 */

export const COMPONENT_SIZES = {
  compact: {
    controlHeight: '32px',
    iconSize: 'var(--icon-size-sm)',
    paddingInline: 'var(--space-2)',
  },
  default: {
    controlHeight: '40px',
    iconSize: 'var(--icon-size-sm)',
    paddingInline: 'var(--space-3)',
  },
  large: {
    controlHeight: '48px',
    iconSize: 'var(--icon-size-md)',
    paddingInline: 'var(--space-4)',
  },
} as const;

export const COMPONENT_DIMENSIONS = {
  'menu-item-min-height': '32px',
  /** Semantic menu surface widths; FloatingPortal clamps them to the viewport. */
  'menu-compact-width': '12rem',
  'menu-default-width': '15rem',
  'menu-rich-width': '22rem',
  'menu-viewport-gutter': 'var(--space-4)',
  'tab-min-height': '36px',
  'touch-target-min': '44px',
  'resize-handle-visual': '2px',
  'resize-handle-hit': '12px',
} as const;

export type ComponentSize = keyof typeof COMPONENT_SIZES;
export type ComponentDimension = keyof typeof COMPONENT_DIMENSIONS;
