/**
 * Canonical visible component dimensions and interaction geometry.
 *
 * These values describe application UI only. Document objects, canvas
 * coordinates, exported geometry, and pointer thresholds have separate
 * contracts and must not consume these tokens.
 *
 * ## The ladder
 *
 * Five control heights exist, and every interactive control in the
 * application picks exactly one. The names follow the shared component-size
 * vocabulary (`xs` < `compact` < `default` < `large` < `xl`), and `default`
 * is the height a standard control renders at — the value the application
 * actually uses most, not an aspirational one.
 *
 *   24px  xs        micro affordances inside dense rows (WCAG 2.5.8 floor)
 *   28px  compact   compact density rows and controls
 *   32px  default   standard controls: buttons, inputs, selects, tabs, rows
 *   40px  large     prominent actions, dialog footers, comfortable forms
 *   48px  xl        marketing and splash CTAs only
 *
 * A height outside this ladder is a bug unless it is documented functional
 * geometry (overlay handles, canvas anchors, drag thresholds) or a
 * content-capacity constraint (a textarea's minimum). Coarse-pointer
 * (touch) contexts promote the interactive minimum to `--touch-target-min`
 * without changing the visible glyph.
 */

export const COMPONENT_SIZES = {
  xs: {
    controlHeight: '24px',
    iconSize: 'var(--icon-size-xs)',
    paddingInline: 'var(--space-1)',
  },
  compact: {
    controlHeight: '28px',
    iconSize: 'var(--icon-size-xs)',
    paddingInline: 'var(--space-2)',
  },
  default: {
    controlHeight: '32px',
    iconSize: 'var(--icon-size-sm)',
    paddingInline: 'var(--space-2)',
  },
  large: {
    controlHeight: '40px',
    iconSize: 'var(--icon-size-md)',
    paddingInline: 'var(--space-3)',
  },
  xl: {
    controlHeight: '48px',
    iconSize: 'var(--icon-size-lg)',
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
  'tab-min-height': '32px',
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
