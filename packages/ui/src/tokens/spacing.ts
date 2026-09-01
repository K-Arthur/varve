/**
 * Canonical interface-spacing source.
 *
 * The editor is a dense, pointer-first desktop application, while the
 * website needs a wider reading rhythm. Both surfaces share these primitives
 * and semantic roles; the role decides the meaning and the consumer decides
 * whether the value belongs to interface chrome or content layout.
 *
 * Document geometry, canvas coordinates, print dimensions, and interaction
 * thresholds are deliberately not represented here.
 */

export const SPACING_PRIMITIVES = {
  '0': '0',
  '05': 'clamp(0.08rem, 0.07rem + 0.03vw, 0.1rem)',
  '1': 'clamp(0.15rem, 0.14rem + 0.05vw, 0.2rem)',
  '2': 'clamp(0.3rem, 0.28rem + 0.1vw, 0.4rem)',
  '3': 'clamp(0.5rem, 0.47rem + 0.15vw, 0.65rem)',
  '4': 'clamp(0.7rem, 0.66rem + 0.2vw, 0.9rem)',
  '5': 'clamp(1rem, 0.94rem + 0.3vw, 1.3rem)',
  '6': 'clamp(1.4rem, 1.31rem + 0.45vw, 1.85rem)',
  '7': 'clamp(2rem, 1.87rem + 0.65vw, 2.65rem)',
  '8': 'clamp(2.8rem, 2.6rem + 1vw, 3.8rem)',
  '9': 'clamp(3.6rem, 3.3rem + 1.5vw, 5rem)',
  '10': 'clamp(4.5rem, 4rem + 2vw, 6.5rem)',
  '11': 'clamp(5.6rem, 5rem + 2.5vw, 8rem)',
  '12': 'clamp(7rem, 6rem + 3vw, 10rem)',
  '13': 'clamp(8.5rem, 7.5rem + 3.5vw, 12rem)',
  '14': 'clamp(10rem, 9rem + 4vw, 14rem)',
  '15': 'clamp(12rem, 10.5rem + 5vw, 16rem)',
  '16': 'clamp(14rem, 12rem + 6vw, 18.5rem)',
  '20': 'clamp(17rem, 15rem + 7vw, 22rem)',
  '24': 'clamp(21rem, 18rem + 9vw, 27rem)',
  '32': 'clamp(28rem, 24rem + 12vw, 36rem)',
} as const;

/** Repeated layout meanings. Keep this list short; local geometry is valid. */
export const SPACING_SEMANTIC = {
  'page-inline': 'clamp(1rem, 2.5vw, 1.5rem)',
  'page-block': 'var(--space-9)',
  panel: 'var(--space-3)',
  'panel-compact': 'var(--space-2)',
  dialog: 'var(--space-5)',
  card: 'var(--space-6)',
  toolbar: 'var(--space-2)',
  'toolbar-item': 'var(--space-1)',
  control: 'var(--space-2)',
  'control-group': 'var(--space-3)',
  'form-field': 'var(--space-4)',
  'label-control': 'var(--space-1)',
  'icon-label': 'var(--space-2)',
  'list-row': 'var(--space-1)',
  'menu-item': 'var(--space-1)',
  'table-cell': 'var(--space-2)',
  popover: 'var(--space-3)',
  tooltip: 'var(--space-2)',
  'empty-state': 'var(--space-8)',
} as const;

/** Existing geometry aliases retained as compatibility names during migration. */
export const SPACING_LAYOUT = {
  'panel-padding': 'var(--space-panel)',
  'toolbar-height': 'clamp(2.5rem, 2.4rem + 0.5vw, 3rem)',
  'topbar-height': 'clamp(2.25rem, 2.15rem + 0.25vw, 2.5rem)',
  'statusbar-height': 'clamp(1.5rem, 1.45rem + 0.25vw, 1.75rem)',
  'sidebar-width': 'clamp(14rem, 12rem + 8vw, 18rem)',
  'inspector-width': 'clamp(15rem, 13rem + 8vw, 20rem)',
} as const;

export type SpacingPrimitive = keyof typeof SPACING_PRIMITIVES;
export type SpacingSemantic = keyof typeof SPACING_SEMANTIC;
