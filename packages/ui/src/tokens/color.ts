/**
 * Strata color tokens — single source of truth for color across the UI.
 *
 * Accent rationale (Strata plan §6): a saturated **teal** (#39d0c6). Incumbents
 * cluster around red/violet (Figma), violet (Linear), blue-violet (Canva). Teal
 * reads as "creative AND technical," has no major design-tool association, and
 * its high luminance pairs cleanly with cool-gray neutrals on light and dark
 * surfaces. See ADR-0002 for the full justification.
 *
 * Scale convention (Radix-informed, 12 steps): index 1 = lightest, 12 = darkest.
 * Themes select semantic pairs from these ramps; the audit enforces WCAG 2.2 AA
 * on every fg/bg pair declared in CONTRAST_PAIRS.
 *
 * Research basis: WCAG 2.2 contrast (W3C); Radix Colors perceptual scaling
 * (WorkOS/Vercel) for ramp shape.
 */

import type { Rgb } from './contrast';

export type Theme = 'light' | 'dark' | 'high-contrast';
export const THEMES: readonly Theme[] = ['light', 'dark', 'high-contrast'];

/** 12-step cool-gray neutral ramp (1 lightest → 12 darkest). */
export const NEUTRAL: readonly Rgb[] = [
  [255, 255, 255], // 1
  [245, 247, 250], // 2
  [233, 237, 243], // 3
  [214, 221, 230], // 4
  [183, 193, 207], // 5
  [142, 153, 170], // 6
  [109, 120, 138], // 7
  [82, 92, 110], // 8
  [55, 64, 81], // 9
  [41, 49, 64], // 10
  [30, 37, 50], // 11
  [16, 21, 31], // 12
];

/** 12-step teal primary ramp (1 lightest → 12 darkest). Accent = step 6. */
export const TEAL: readonly Rgb[] = [
  [224, 250, 247], // 1
  [199, 244, 238], // 2
  [162, 235, 226], // 3
  [120, 223, 213], // 4
  [82, 209, 197], // 5
  [57, 208, 198], // 6  ← accent
  [38, 166, 158], // 7
  [29, 128, 123], // 8
  [22, 96, 93], // 9
  [18, 76, 74], // 10
  [14, 58, 57], // 11
  [9, 38, 38], // 12
];

/** Feedback hues (single base value per hue for the first pass). */
export const SUCCESS: Rgb = [56, 161, 105];
export const WARNING: Rgb = [180, 130, 24];
export const DANGER: Rgb = [205, 64, 69];
export const INFO: Rgb = [57, 138, 208];

/** Semantic token names exposed as CSS custom properties. */
export type SemanticToken =
  | 'surface-app'
  | 'surface-raised'
  | 'surface-sunken'
  | 'surface-overlay'
  | 'text-primary'
  | 'text-secondary'
  | 'text-muted'
  | 'text-on-accent'
  | 'text-on-danger'
  | 'border-subtle'
  | 'border-strong'
  | 'interactive-default'
  | 'interactive-hover'
  | 'interactive-active'
  | 'interactive-focus-ring'
  | 'feedback-success'
  | 'feedback-warning'
  | 'feedback-danger';

const N = (i: number): Rgb => NEUTRAL[i - 1] as Rgb;
const T = (i: number): Rgb => TEAL[i - 1] as Rgb;

/** Semantic value per theme. Each token maps to a concrete RGB. */
export const SEMANTIC: Record<Theme, Record<SemanticToken, Rgb>> = {
  light: {
    'surface-app': N(2),
    'surface-raised': N(1),
    'surface-sunken': N(3),
    'surface-overlay': N(1),
    'text-primary': N(12),
    'text-secondary': N(10),
    'text-muted': N(8),
    'text-on-accent': N(1),
    'text-on-danger': N(1),
    'border-subtle': N(4),
    'border-strong': N(7),
    'interactive-default': T(9),
    'interactive-hover': T(10),
    'interactive-active': T(11),
    'interactive-focus-ring': T(8),
    'feedback-success': SUCCESS,
    'feedback-warning': WARNING,
    'feedback-danger': DANGER,
  },
  dark: {
    'surface-app': N(12),
    'surface-raised': N(11),
    'surface-sunken': [11, 16, 24],
    'surface-overlay': [5, 8, 14],
    'text-primary': N(2),
    'text-secondary': N(4),
    'text-muted': N(6),
    'text-on-accent': N(12),
    'text-on-danger': N(1),
    'border-subtle': N(10),
    'border-strong': N(7),
    'interactive-default': T(5),
    'interactive-hover': T(4),
    'interactive-active': T(3),
    'interactive-focus-ring': T(5),
    'feedback-success': SUCCESS,
    'feedback-warning': WARNING,
    'feedback-danger': DANGER,
  },
  'high-contrast': {
    'surface-app': [0, 0, 0],
    'surface-raised': [10, 10, 10],
    'surface-sunken': [0, 0, 0],
    'surface-overlay': [0, 0, 0],
    'text-primary': [255, 255, 255],
    'text-secondary': [255, 255, 255],
    'text-muted': [220, 220, 220],
    'text-on-accent': [0, 0, 0],
    'text-on-danger': [0, 0, 0],
    'border-subtle': [255, 255, 255],
    'border-strong': [255, 255, 255],
    'interactive-default': [255, 255, 0],
    'interactive-hover': [255, 255, 0],
    'interactive-active': [255, 235, 60],
    'interactive-focus-ring': [255, 255, 0],
    'feedback-success': [0, 255, 0],
    'feedback-warning': [255, 200, 0],
    'feedback-danger': [255, 80, 80],
  },
};

import type { ContrastGrade } from './contrast';

/** The pairs the token audit enforces. UI grade = 3:1; text grades = 4.5:1+. */
export interface ContrastPair {
  name: string;
  fg: SemanticToken;
  bg: SemanticToken;
  grade: ContrastGrade;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { name: 'text-primary on surface-app', fg: 'text-primary', bg: 'surface-app', grade: 'AA' },
  { name: 'text-secondary on surface-app', fg: 'text-secondary', bg: 'surface-app', grade: 'AA' },
  { name: 'text-muted on surface-app', fg: 'text-muted', bg: 'surface-app', grade: 'AA' },
  { name: 'text-primary on surface-raised', fg: 'text-primary', bg: 'surface-raised', grade: 'AA' },
  { name: 'text-primary on surface-sunken', fg: 'text-primary', bg: 'surface-sunken', grade: 'AA' },
  {
    name: 'text-primary on surface-overlay',
    fg: 'text-primary',
    bg: 'surface-overlay',
    grade: 'AA',
  },
  {
    name: 'text-on-accent on interactive-default',
    fg: 'text-on-accent',
    bg: 'interactive-default',
    grade: 'AA',
  },
  {
    name: 'text-on-danger on feedback-danger',
    fg: 'text-on-danger',
    bg: 'feedback-danger',
    grade: 'AA',
  },
  {
    name: 'interactive-default on surface-app',
    fg: 'interactive-default',
    bg: 'surface-app',
    grade: 'UI',
  },
  {
    name: 'interactive-focus-ring on surface-app',
    fg: 'interactive-focus-ring',
    bg: 'surface-app',
    grade: 'UI',
  },
  { name: 'border-strong on surface-app', fg: 'border-strong', bg: 'surface-app', grade: 'UI' },
  {
    name: 'feedback-success on surface-app',
    fg: 'feedback-success',
    bg: 'surface-app',
    grade: 'UI',
  },
  {
    name: 'feedback-warning on surface-app',
    fg: 'feedback-warning',
    bg: 'surface-app',
    grade: 'UI',
  },
  { name: 'feedback-danger on surface-app', fg: 'feedback-danger', bg: 'surface-app', grade: 'UI' },
];
