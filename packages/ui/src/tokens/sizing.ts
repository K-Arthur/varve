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
  /* WCAG 2.2 SC 2.5.8 Target Size (Minimum): dense pointer layouts must still
   * provide a 24x24 CSS px activation area. Fine-pointer controls that opt
   * into the compact exception use this; touch layouts use
   * --touch-target-min / --icon-touch-target instead. */
  'target-min-compact': '24px',
  'touch-target-min': '44px',
  'resize-handle-visual': '2px',
  'resize-handle-hit': '12px',
  /* Focus-ring geometry. The ring COLOR is a semantic color token
   * (--color-interactive-focus-ring, theme-owned); these carry the shape so
   * a ring change is one edit, not one per control. The inset offset keeps
   * the ring inside the control's border box for inset controls (inputs,
   * selects, segmented chips) where an outer ring would be clipped by the
   * panel surface or overlap neighbouring rows in dense layouts. */
  'focus-ring-width': '2px',
  'focus-ring-offset-inset': '-1px',
} as const;

export type ComponentSize = keyof typeof COMPONENT_SIZES;
export type ComponentDimension = keyof typeof COMPONENT_DIMENSIONS;
