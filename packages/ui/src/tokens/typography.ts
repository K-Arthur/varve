/**
 * Semantic interface and content typography contracts.
 *
 * The primitive scale is intentionally small and split by behaviour:
 *
 *  - Interface chrome (`2xs`–`xl`) is **stable rem**, so a dense toolbar,
 *    inspector row, or menu never changes text size because the window was
 *    resized. It still scales with the user's UI font-size preference and with
 *    browser text zoom because the values are rem.
 *  - Display steps (`2xl`, `3xl`) are **bounded fluid clamps**: only the
 *    marketing site, splash, and empty-state headlines consume them, where a
 *    viewport-proportional size is the intent.
 *
 * The floor is 12px. Below that, no interface text is legible enough to carry
 * meaning (see `docs/architecture/interface-sizing-system.md` for the
 * research), so `2xs` is reserved for genuinely non-essential meta and every
 * step above it is at least 1px apart.
 *
 * Consumers should choose a role instead of pairing an arbitrary font size
 * with a local line-height. Canvas and authored document typography do not
 * belong in this file.
 */

export const FONT_SIZES = {
  '2xs': '0.75rem',
  xs: '0.8125rem',
  sm: '0.9375rem',
  md: '1.0625rem',
  lg: '1.3125rem',
  xl: '1.625rem',
  '2xl': 'clamp(1.75rem, 1.35rem + 0.9vw, 2.25rem)',
  '3xl': 'clamp(2.125rem, 1.6rem + 1.4vw, 2.75rem)',
} as const;

export const FONT_LINE_HEIGHTS = {
  tight: '1.15',
  normal: '1.5',
  relaxed: '1.65',
  control: '1.25',
  label: '1.35',
} as const;

export const TYPOGRAPHY_ROLES = {
  /** Badges, keyboard hints, counts, decorative meta. The 12px floor. */
  'interface-micro': {
    size: 'var(--font-size-2xs)',
    lineHeight: 'var(--font-line-label)',
    weight: 'var(--font-weight-medium)',
    family: 'var(--font-interface)',
  },
  /** Helper text, hints, status meta, table meta. */
  'interface-caption': {
    size: 'var(--font-size-xs)',
    lineHeight: 'var(--font-line-label)',
    weight: 'var(--font-weight-regular)',
    family: 'var(--font-interface)',
  },
  /** Form, field, and inspector labels. */
  'interface-label': {
    size: 'var(--font-size-xs)',
    lineHeight: 'var(--font-line-label)',
    weight: 'var(--font-weight-medium)',
    family: 'var(--font-interface)',
  },
  /** Buttons, menus, tabs, select triggers, inputs, inspector values. */
  'interface-control': {
    size: 'var(--font-size-sm)',
    lineHeight: 'var(--font-line-control)',
    weight: 'var(--font-weight-medium)',
    family: 'var(--font-interface)',
  },
  /** Section headings inside dense panels and settings groups. */
  'interface-subheading': {
    size: 'var(--font-size-sm)',
    lineHeight: 'var(--font-line-label)',
    weight: 'var(--font-weight-semibold)',
    family: 'var(--font-interface)',
  },
  /** Supporting application copy, dialog body, help text. */
  'interface-body': {
    size: 'var(--font-size-md)',
    lineHeight: 'var(--font-line-normal)',
    weight: 'var(--font-weight-regular)',
    family: 'var(--font-interface)',
  },
  /** Panel, dialog, and document-chrome titles. */
  'interface-title': {
    size: 'var(--font-size-lg)',
    lineHeight: 'var(--font-line-tight)',
    weight: 'var(--font-weight-semibold)',
    family: 'var(--font-interface)',
  },
  /** Page-level and empty-state headlines. */
  'interface-heading': {
    size: 'var(--font-size-xl)',
    lineHeight: 'var(--font-line-tight)',
    weight: 'var(--font-weight-semibold)',
    family: 'var(--font-interface)',
  },
  'content-body': {
    size: 'var(--font-size-md)',
    lineHeight: 'var(--font-line-relaxed)',
    weight: 'var(--font-weight-regular)',
    family: 'var(--font-body)',
  },
  'content-lead': {
    size: 'var(--font-size-lg)',
    lineHeight: 'var(--font-line-relaxed)',
    weight: 'var(--font-weight-regular)',
    family: 'var(--font-body)',
  },
  'display-page': {
    size: 'var(--font-size-2xl)',
    lineHeight: 'var(--font-line-tight)',
    weight: 'var(--font-weight-bold)',
    family: 'var(--font-editorial)',
  },
  'display-section': {
    size: 'var(--font-size-xl)',
    lineHeight: 'var(--font-line-tight)',
    weight: 'var(--font-weight-bold)',
    family: 'var(--font-editorial)',
  },
  'marketing-hero': {
    size: 'clamp(2rem, 4.5vw + 0.5rem, 3.5rem)',
    lineHeight: '1.08',
    weight: 'var(--font-weight-bold)',
    family: 'var(--font-editorial)',
  },
  'marketing-display': {
    size: 'clamp(3rem, 6.5vw + 0.75rem, 6rem)',
    lineHeight: '0.95',
    weight: 'var(--font-weight-bold)',
    family: 'var(--font-editorial)',
  },
  'marketing-feature': {
    size: 'clamp(2rem, 3.5vw + 0.5rem, 3.25rem)',
    lineHeight: '1.08',
    weight: 'var(--font-weight-bold)',
    family: 'var(--font-editorial)',
  },
  'marketing-section': {
    size: 'clamp(1.75rem, 3vw + 0.5rem, 2.75rem)',
    lineHeight: '1.1',
    weight: 'var(--font-weight-bold)',
    family: 'var(--font-editorial)',
  },
  'marketing-lead': {
    size: 'clamp(1rem, 1.5vw + 0.4rem, 1.2rem)',
    lineHeight: 'var(--font-line-relaxed)',
    weight: 'var(--font-weight-regular)',
    family: 'var(--font-body)',
  },
  /** Coordinates, measurements, and scan-heavy numeric UI. */
  'data-numeric': {
    size: 'var(--font-size-sm)',
    lineHeight: 'var(--font-line-control)',
    weight: 'var(--font-weight-medium)',
    family: 'var(--font-mono)',
  },
} as const;

export type TypographyRole = keyof typeof TYPOGRAPHY_ROLES;
