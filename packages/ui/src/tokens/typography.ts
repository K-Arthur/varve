/**
 * Semantic interface and content typography contracts.
 *
 * The primitive scale is intentionally small. Consumers should choose a role
 * instead of pairing an arbitrary font size with a local line-height. Canvas
 * and authored document typography do not belong in this file.
 */

export const FONT_SIZES = {
  '2xs': 'clamp(0.6rem, 0.58rem + 0.08vw, 0.68rem)',
  xs: 'clamp(0.72rem, 0.7rem + 0.1vw, 0.78rem)',
  sm: 'clamp(0.83rem, 0.8rem + 0.15vw, 0.92rem)',
  md: 'clamp(0.95rem, 0.91rem + 0.2vw, 1.06rem)',
  lg: 'clamp(1.08rem, 1.02rem + 0.3vw, 1.25rem)',
  xl: 'clamp(1.25rem, 1.15rem + 0.5vw, 1.55rem)',
  '2xl': 'clamp(1.5rem, 1.35rem + 0.75vw, 2rem)',
  '3xl': 'clamp(1.85rem, 1.6rem + 1.25vw, 2.65rem)',
} as const;

export const FONT_LINE_HEIGHTS = {
  tight: '1.15',
  normal: '1.5',
  relaxed: '1.65',
  control: '1.25',
  label: '1.35',
} as const;

export const TYPOGRAPHY_ROLES = {
  'interface-control': {
    size: 'var(--font-size-sm)',
    lineHeight: 'var(--font-line-control)',
    weight: 'var(--font-weight-medium)',
    family: 'var(--font-interface)',
  },
  'interface-label': {
    size: 'var(--font-size-sm)',
    lineHeight: 'var(--font-line-label)',
    weight: 'var(--font-weight-medium)',
    family: 'var(--font-interface)',
  },
  'interface-body': {
    size: 'var(--font-size-md)',
    lineHeight: 'var(--font-line-normal)',
    weight: 'var(--font-weight-regular)',
    family: 'var(--font-interface)',
  },
  'interface-caption': {
    size: 'var(--font-size-xs)',
    lineHeight: 'var(--font-line-label)',
    weight: 'var(--font-weight-regular)',
    family: 'var(--font-interface)',
  },
  'interface-title': {
    size: 'var(--font-size-lg)',
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
  'data-numeric': {
    size: 'var(--font-size-sm)',
    lineHeight: 'var(--font-line-control)',
    weight: 'var(--font-weight-medium)',
    family: 'var(--font-mono)',
  },
} as const;

export type TypographyRole = keyof typeof TYPOGRAPHY_ROLES;
