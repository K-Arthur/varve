/**
 * Varve color tokens — single source of truth for color across the UI.
 *
 * Uses OKLCH color space (Björn Ottosson, 2020) for perceptually uniform
 * color representation. All tokens are stored as Oklch objects; the CSS
 * generator emits `oklch(L C H)` values.
 *
 * Accent rationale: saturated teal (#39d0c6 ≈ oklch(0.779 0.1229 188.31)).
 * Incumbents cluster around red/violet (Figma), violet (Linear), blue-violet
 * (Canva). Teal reads as "creative AND technical," has no major design-tool
 * association, and its high luminance pairs cleanly with cool-gray neutrals.
 * See ADR-0002 for the full justification.
 *
 * Scale convention (Radix-informed, 12 steps): index 1 = lightest, 12 = darkest.
 * Themes select semantic pairs from these ramps; the audit enforces WCAG 2.2 AA
 * on every fg/bg pair declared in CONTRAST_PAIRS.
 */

import type { Oklch } from './contrast';

export type Theme = 'light' | 'dark' | 'high-contrast';
export const THEMES: readonly Theme[] = ['light', 'dark', 'high-contrast'];

/** Helper: create Oklch with normalized hue (0-360) and H=0 when C=0. */
function ok(L: number, C: number, H: number): Oklch {
  const hNorm = H < 0 ? H + 360 : H;
  return { L, C, H: C < 0.0001 ? 0 : hNorm };
}

/** 12-step blue ramp (cool blue, 1 lightest → 12 darkest). */
export const BLUE: readonly Oklch[] = [
  ok(0.9594, 0.02, 250.38), // 1
  ok(0.9115, 0.0364, 252.08), // 2
  ok(0.8636, 0.0532, 252.8), // 3
  ok(0.7977, 0.0761, 251.19), // 4
  ok(0.7235, 0.099, 251.08), // 5
  ok(0.6415, 0.1247, 249.76), // 6
  ok(0.5741, 0.1309, 252.23), // 7
  ok(0.5063, 0.1332, 255.23), // 8
  ok(0.4436, 0.1271, 257.12), // 9
  ok(0.3863, 0.115, 258.17), // 10
  ok(0.3187, 0.0994, 259.79), // 11
  ok(0.2461, 0.0796, 262.26), // 12
];

/** 12-step violet ramp (1 lightest → 12 darkest). */
export const VIOLET: readonly Oklch[] = [
  ok(0.9633, 0.0206, 301.15), // 1
  ok(0.9251, 0.0351, 303.8), // 2
  ok(0.8767, 0.0557, 303.89), // 3
  ok(0.8141, 0.0799, 303.75), // 4
  ok(0.7419, 0.105, 303.32), // 5
  ok(0.6585, 0.1317, 301.2), // 6
  ok(0.5843, 0.1408, 298.31), // 7
  ok(0.5129, 0.1428, 294.74), // 8
  ok(0.4444, 0.1381, 292.44), // 9
  ok(0.3806, 0.1289, 291.77), // 10
  ok(0.3125, 0.1109, 289.57), // 11
  ok(0.241, 0.089, 288.97), // 12
];

/** 12-step amber ramp (warm golden, 1 lightest → 12 darkest). */
export const AMBER: readonly Oklch[] = [
  ok(0.981, 0.0187, 83.06), // 1
  ok(0.9549, 0.0405, 86.73), // 2
  ok(0.9238, 0.0635, 87.27), // 3
  ok(0.8811, 0.0858, 87.36), // 4
  ok(0.8306, 0.1069, 86.46), // 5
  ok(0.7748, 0.123, 84.68), // 6
  ok(0.6997, 0.1197, 85.32), // 7
  ok(0.6274, 0.1136, 84.68), // 8
  ok(0.5555, 0.1032, 85.92), // 9
  ok(0.4883, 0.0916, 87.35), // 10
  ok(0.4118, 0.0769, 88.39), // 11
  ok(0.3192, 0.0587, 85.66), // 12
];

/** 12-step green ramp (fresh green, 1 lightest → 12 darkest). */
export const GREEN: readonly Oklch[] = [
  ok(0.9727, 0.019, 152.82), // 1
  ok(0.9396, 0.0441, 150.35), // 2
  ok(0.8985, 0.0685, 150.07), // 3
  ok(0.8476, 0.0954, 149.86), // 4
  ok(0.7943, 0.1224, 149.57), // 5
  ok(0.7324, 0.1579, 148.62), // 6
  ok(0.6556, 0.1571, 148.11), // 7
  ok(0.5804, 0.147, 147.97), // 8
  ok(0.5052, 0.1304, 148.06), // 9
  ok(0.4373, 0.114, 147.88), // 10
  ok(0.3614, 0.0913, 148.47), // 11
  ok(0.2809, 0.0692, 148.17), // 12
];

/** 12-step cool-gray neutral ramp (1 lightest → 12 darkest). */
export const NEUTRAL: readonly Oklch[] = [
  ok(1.0, 0.0, 0), // 1 (pure white)
  ok(0.9755, 0.0045, 258.32), // 2
  ok(0.9448, 0.0092, 258.34), // 3
  ok(0.8948, 0.0145, 254.61), // 4
  ok(0.8075, 0.0226, 256.74), // 5
  ok(0.6798, 0.0281, 259.04), // 6
  ok(0.5699, 0.0308, 260.28), // 7
  ok(0.473, 0.0318, 262.19), // 8
  ok(0.3704, 0.0317, 263.02), // 9
  ok(0.3123, 0.0293, 262.83), // 10
  ok(0.2637, 0.0265, 262.61), // 11
  ok(0.1956, 0.0217, 263.87), // 12
];

/** 12-step teal primary ramp (1 lightest → 12 darkest). Accent = step 6. */
export const TEAL: readonly Oklch[] = [
  ok(0.9654, 0.0274, 188.32), // 1
  ok(0.934, 0.0469, 186.47), // 2
  ok(0.8896, 0.0735, 186.3), // 3
  ok(0.8387, 0.0977, 187.29), // 4
  ok(0.7873, 0.1127, 186.47), // 5
  ok(0.779, 0.1229, 188.31), // 6  -- accent
  ok(0.6577, 0.1059, 188.48), // 7
  ok(0.5449, 0.0866, 189.77), // 8
  ok(0.4452, 0.0693, 190.9), // 9
  ok(0.38, 0.0577, 191.62), // 10
  ok(0.3189, 0.0468, 192.89), // 11
  ok(0.2472, 0.0341, 195.17), // 12
];

/**
 * 12-step orange ramp (1 lightest → 12 darkest). Derived from the amber
 * light curve at hue 50; every step is in sRGB gamut (chroma at each step is
 * 0.85 × the maximum in-gamut chroma, capped at the amber chroma × 1.15).
 * Added for the workspace-mode identity palette (motion).
 */
export const ORANGE: readonly Oklch[] = [
  ok(0.981, 0.0088, 50),
  ok(0.9549, 0.0214, 50),
  ok(0.9238, 0.037, 50),
  ok(0.8811, 0.0597, 50),
  ok(0.8306, 0.0888, 50),
  ok(0.7748, 0.1242, 50),
  ok(0.6997, 0.1377, 50),
  ok(0.6274, 0.1306, 50),
  ok(0.5555, 0.1187, 50),
  ok(0.4883, 0.1053, 50),
  ok(0.4118, 0.0884, 50),
  ok(0.3192, 0.0675, 50),
];

/**
 * 12-step rose ramp (1 lightest → 12 darkest). Derived from the violet light
 * curve at hue 12; chroma is 0.85 × the maximum in-gamut chroma, capped at
 * the violet chroma × 1.2. Added for the workspace-mode identity palette
 * (codegen).
 */
export const ROSE: readonly Oklch[] = [
  ok(0.9633, 0.0156, 12),
  ok(0.9251, 0.0329, 12),
  ok(0.8767, 0.0566, 12),
  ok(0.8141, 0.0909, 12),
  ok(0.7419, 0.126, 12),
  ok(0.6585, 0.158, 12),
  ok(0.5843, 0.169, 12),
  ok(0.5129, 0.1714, 12),
  ok(0.4444, 0.151, 12),
  ok(0.3806, 0.1293, 12),
  ok(0.3125, 0.1062, 12),
  ok(0.241, 0.0819, 12),
];

/**
 * 12-step indigo ramp (1 lightest → 12 darkest). Derived from the violet
 * light curve at hue 272; chroma is 0.9 × the maximum in-gamut chroma.
 * Added for the workspace-mode identity palette (photo).
 */
export const INDIGO: readonly Oklch[] = [
  ok(0.9633, 0.0155, 272),
  ok(0.9251, 0.0322, 272),
  ok(0.8767, 0.054, 272),
  ok(0.8141, 0.0799, 272),
  ok(0.7419, 0.105, 272),
  ok(0.6585, 0.1317, 272),
  ok(0.5843, 0.1408, 272),
  ok(0.5129, 0.1428, 272),
  ok(0.4444, 0.1381, 272),
  ok(0.3806, 0.1289, 272),
  ok(0.3125, 0.1109, 272),
  ok(0.241, 0.089, 272),
];

/** Feedback hues (single base value per hue). */
export const SUCCESS: Oklch = ok(0.6342, 0.1283, 156.2);
export const WARNING: Oklch = ok(0.6399, 0.1261, 79.82);
export const DANGER: Oklch = ok(0.5763, 0.1773, 22.78);
export const INFO: Oklch = ok(0.6164, 0.132, 248.02);

/** Brand color values (used inline in SEMANTIC). */
const BRAND_SANDSTONE: Oklch = ok(0.7161, 0.1398, 60.04);
const BRAND_SANDSTONE_LIGHT: Oklch = ok(0.9652, 0.0214, 76.53);
const BRAND_TERRACOTTA: Oklch = ok(0.5745, 0.1595, 30.53);

/** Layer tag (7-color label) preset values. */
const LAYER_TAG_RED: Oklch = ok(0.57, 0.1773, 22.78);
const LAYER_TAG_ORANGE: Oklch = ok(0.6399, 0.1261, 79.82);
const LAYER_TAG_YELLOW: Oklch = ok(0.7, 0.12, 95);
const LAYER_TAG_GREEN: Oklch = ok(0.6342, 0.1283, 156.2);
const LAYER_TAG_BLUE: Oklch = ok(0.6164, 0.132, 248.02);
const LAYER_TAG_PURPLE: Oklch = ok(0.58, 0.16, 300);
const LAYER_TAG_GRAY: Oklch = ok(0.6, 0.02, 0);

/** Layer-shape accent/wash values. */
const LAYER_ACCENT_SHAPE_LIGHT: Oklch = ok(0.6158, 0.1298, 57.3);
const LAYER_WASH_SHAPE_LIGHT: Oklch = ok(0.9652, 0.0214, 76.53);
const LAYER_ACCENT_SHAPE_DARK: Oklch = ok(0.913, 0.0617, 85.44);
const LAYER_WASH_SHAPE_DARK: Oklch = ok(0.285, 0.0229, 66.69);

/** Layer-image accent/wash values (magenta/purple range). */
const LAYER_ACCENT_IMAGE_LIGHT: Oklch = ok(0.65, 0.18, 330);
const LAYER_WASH_IMAGE_LIGHT: Oklch = ok(0.965, 0.025, 330);
const LAYER_ACCENT_IMAGE_DARK: Oklch = ok(0.6, 0.18, 330);
const LAYER_WASH_IMAGE_DARK: Oklch = ok(0.2, 0.025, 330);

/** Layer-adjustment accent/wash values (warm orange range). */
const LAYER_ACCENT_ADJUSTMENT_LIGHT: Oklch = ok(0.65, 0.16, 30);
const LAYER_WASH_ADJUSTMENT_LIGHT: Oklch = ok(0.965, 0.02, 30);
const LAYER_ACCENT_ADJUSTMENT_DARK: Oklch = ok(0.6, 0.16, 30);
const LAYER_WASH_ADJUSTMENT_DARK: Oklch = ok(0.2, 0.025, 30);

/** Semantic token names exposed as CSS custom properties. */
export type SemanticToken =
  | 'surface-app'
  | 'surface-base'
  | 'surface-raised'
  | 'surface-sunken'
  | 'surface-overlay'
  | 'surface-hover'
  | 'text-primary'
  | 'text-secondary'
  | 'text-subtle'
  | 'text-muted'
  | 'text-disabled'
  | 'text-on-accent'
  | 'text-on-danger'
  | 'border-subtle'
  | 'border-strong'
  | 'separator-subtle'
  | 'separator-default'
  | 'separator-strong'
  | 'separator-accent'
  | 'border-focus'
  | 'interactive-default'
  | 'interactive-hover'
  | 'interactive-hover-surface'
  | 'interactive-active'
  | 'interactive-pressed-surface'
  | 'interactive-selected-surface'
  | 'interactive-selected-surface-hover'
  | 'interactive-selected-border'
  | 'interactive-selected-foreground'
  | 'interactive-current-indicator'
  | 'interactive-checked-surface'
  | 'interactive-drop-target-surface'
  | 'interactive-drop-target-border'
  | 'interactive-drop-denied-surface'
  | 'interactive-drop-denied-border'
  | 'interactive-disabled'
  | 'interactive-focus-ring'
  | 'highlight-search-match'
  | 'highlight-search-current'
  | 'highlight-text-selection'
  | 'highlight-text-selection-foreground'
  | 'feedback-success'
  | 'feedback-warning'
  | 'feedback-danger'
  | 'feedback-info'
  | 'accent-primary'
  | 'accent-default'
  | 'accent-teal'
  | 'accent-subtle'
  /* WCAG 1.4.3 fix (2026-08-10): accent-primary text on accent-subtle washes
   * measured 1.60:1 in Light — no teal dark enough to pass 4.5:1 on the pale
   * wash while staying recognizably teal, so the pair gets its own per-theme
   * value (Light: T12, Dark: T6, HC: accent-primary). */
  | 'accent-on-subtle'
  /* WCAG 1.4.3 fix (2026-08-10): white text on feedback-success/warning fills
   * measured 3.25:1 / 3.42:1, and the HC theme's bright fills with white text
   * measured 1.37:1 / 1.64:1. Strong fills host white text in Light/Dark; the
   * HC theme's bright fills host black text via text-on-feedback. */
  | 'feedback-success-strong'
  | 'feedback-warning-strong'
  | 'text-on-feedback'
  /* Workspace-mode identity (2026-09-15). Two roles per mode: the accent
   * hosts text-on-accent in the active switcher pill (AA), and the icon
   * tints the inactive state against the menubar surface (UI 3:1). High
   * Contrast collapses every mode onto the single HC accent — hue is not a
   * state cue there. Steps are per-hue because a fixed step is not a fixed
   * contrast (see docs/audits/workspace-switcher-review-2026-09-15.md). */
  | 'workspace-accent-design'
  | 'workspace-icon-design'
  | 'workspace-accent-drawing'
  | 'workspace-icon-drawing'
  | 'workspace-accent-image'
  | 'workspace-icon-image'
  | 'workspace-accent-print'
  | 'workspace-icon-print'
  | 'workspace-accent-motion'
  | 'workspace-icon-motion'
  | 'workspace-accent-codegen'
  | 'workspace-icon-codegen'
  | 'workspace-accent-logo'
  | 'workspace-icon-logo'
  | 'workspace-accent-email'
  | 'workspace-icon-email'
  | 'tree-row'
  | 'tree-row-hover'
  | 'tree-row-selected'
  | 'tree-row-focus'
  | 'tree-indent-guide'
  | 'layer-accent-frame'
  | 'layer-wash-frame'
  | 'layer-accent-group'
  | 'layer-wash-group'
  | 'layer-accent-text'
  | 'layer-wash-text'
  | 'layer-accent-shape'
  | 'layer-wash-shape'
  | 'layer-accent-component'
  | 'layer-wash-component'
  | 'layer-accent-image'
  | 'layer-wash-image'
  | 'layer-accent-adjustment'
  | 'layer-wash-adjustment'
  | 'layer-tag-red'
  | 'layer-tag-orange'
  | 'layer-tag-yellow'
  | 'layer-tag-green'
  | 'layer-tag-blue'
  | 'layer-tag-purple'
  | 'layer-tag-gray'
  | 'hero-glow'
  | 'brand-teal'
  | 'brand-sandstone'
  | 'brand-sandstone-light'
  | 'brand-terracotta'
  /* Elevation-per-elevation text tokens (added in redesign). */
  | 'text-primary-on-default'
  | 'text-secondary-on-default'
  | 'text-primary-on-raised'
  | 'text-secondary-on-raised'
  | 'text-primary-on-overlay'
  | 'text-secondary-on-overlay'
  | 'text-muted-on-default'
  | 'text-muted-on-raised'
  | 'text-muted-on-sunken'
  | 'text-muted-on-overlay'
  | 'text-subtle-on-default'
  | 'text-subtle-on-raised'
  | 'text-subtle-on-sunken'
  | 'text-subtle-on-overlay'
  | 'text-on-warning';

const N = (i: number): Oklch => NEUTRAL[i - 1] as Oklch;
const T = (i: number): Oklch => TEAL[i - 1] as Oklch;
const B = (i: number): Oklch => BLUE[i - 1] as Oklch;
const V = (i: number): Oklch => VIOLET[i - 1] as Oklch;
const A = (i: number): Oklch => AMBER[i - 1] as Oklch;
const G = (i: number): Oklch => GREEN[i - 1] as Oklch;
const O = (i: number): Oklch => ORANGE[i - 1] as Oklch;
const R = (i: number): Oklch => ROSE[i - 1] as Oklch;
const I = (i: number): Oklch => INDIGO[i - 1] as Oklch;

/** Semantic value per theme. Each token maps to a concrete OKLCH value. */
export const SEMANTIC: Record<Theme, Record<SemanticToken, Oklch>> = {
  light: {
    'surface-app': N(2),
    'surface-base': N(2),
    'surface-raised': N(1),
    'surface-sunken': N(3),
    'surface-overlay': N(1),
    'surface-hover': ok(0.88, 0.018, 258),
    'text-primary': N(12),
    'text-secondary': N(10),
    // WCAG fix: N(6)=L0.68 was 2.1:1 on light bg (catastrophic fail). L≈0.46 achieves ~4.5:1.
    'text-subtle': ok(0.46, 0.028, 261),
    // WCAG fix: N(8)=L0.473 was 4.37:1 (barely fails). L≈0.43 achieves ~5.0:1.
    'text-muted': ok(0.43, 0.032, 262),
    // Disabled controls are exempt from WCAG 1.4.3; keep at ≥3:1 for usability.
    'text-disabled': ok(0.58, 0.025, 261),
    'text-on-accent': N(1),
    'text-on-danger': N(1),
    'border-subtle': N(4),
    'border-strong': N(7),
    'separator-subtle': N(4),
    'separator-default': N(4),
    'separator-strong': N(7),
    'separator-accent': T(9),
    'border-focus': T(8),
    'interactive-default': T(9),
    'interactive-hover': T(10),
    'interactive-hover-surface': N(3),
    'interactive-active': T(11),
    'interactive-pressed-surface': T(11),
    'interactive-selected-surface': T(2),
    'interactive-selected-surface-hover': ok(0.9, 0.04, 187),
    'interactive-selected-border': T(9),
    'interactive-selected-foreground': N(12),
    'interactive-current-indicator': T(9),
    'interactive-checked-surface': T(9),
    'interactive-drop-target-surface': T(2),
    'interactive-drop-target-border': T(9),
    'interactive-drop-denied-surface': ok(0.93, 0.04, 23),
    'interactive-drop-denied-border': DANGER,
    'interactive-disabled': N(3),
    'interactive-focus-ring': T(8),
    'highlight-search-match': A(3),
    'highlight-search-current': A(5),
    'highlight-text-selection': T(2),
    'highlight-text-selection-foreground': N(12),
    'feedback-success': SUCCESS,
    'feedback-warning': WARNING,
    'feedback-danger': DANGER,
    'feedback-info': INFO,
    'accent-primary': T(6),
    'accent-default': T(6),
    'accent-teal': T(6),
    'accent-subtle': T(2),
    'accent-on-subtle': T(12),
    'feedback-success-strong': ok(0.47, 0.11, 156),
    'feedback-warning-strong': ok(0.46, 0.12, 70),
    'text-on-feedback': N(1),
    'tree-row': N(2),
    // WCAG 3.0 UI: N(7) L=0.570 provides 3.0:1 contrast against N(2) L=0.976 tree-row.
    'tree-row-hover': N(7),
    // WCAG fix: T(8)=medium teal with white text-on-accent was 3.75:1. T(9) gives 4.66:1.
    'tree-row-selected': T(9),
    'tree-row-focus': T(7),
    'tree-indent-guide': N(7),
    'layer-accent-frame': B(6),
    'layer-wash-frame': B(1),
    'layer-accent-group': A(8),
    'layer-wash-group': A(1),
    'layer-accent-text': G(8),
    'layer-wash-text': G(1),
    'layer-accent-shape': LAYER_ACCENT_SHAPE_LIGHT,
    'layer-wash-shape': LAYER_WASH_SHAPE_LIGHT,
    'layer-accent-component': V(6),
    'layer-wash-component': V(1),
    'layer-accent-image': LAYER_ACCENT_IMAGE_LIGHT,
    'layer-wash-image': LAYER_WASH_IMAGE_LIGHT,
    'layer-accent-adjustment': LAYER_ACCENT_ADJUSTMENT_LIGHT,
    'layer-wash-adjustment': LAYER_WASH_ADJUSTMENT_LIGHT,
    'hero-glow': T(6),
    'brand-teal': T(6),
    'brand-sandstone': BRAND_SANDSTONE,
    'brand-sandstone-light': BRAND_SANDSTONE_LIGHT,
    'brand-terracotta': BRAND_TERRACOTTA,
    'layer-tag-red': LAYER_TAG_RED,
    'layer-tag-orange': LAYER_TAG_ORANGE,
    'layer-tag-yellow': LAYER_TAG_YELLOW,
    'layer-tag-green': LAYER_TAG_GREEN,
    'layer-tag-blue': LAYER_TAG_BLUE,
    'layer-tag-purple': LAYER_TAG_PURPLE,
    'layer-tag-gray': LAYER_TAG_GRAY,
    'workspace-accent-design': B(8),
    'workspace-icon-design': B(6),
    'workspace-accent-drawing': G(9),
    'workspace-icon-drawing': G(8),
    'workspace-accent-image': I(8),
    'workspace-icon-image': I(7),
    'workspace-accent-print': V(8),
    'workspace-icon-print': V(7),
    'workspace-accent-motion': O(9),
    'workspace-icon-motion': O(8),
    'workspace-accent-codegen': R(7),
    'workspace-icon-codegen': R(6),
    'workspace-accent-logo': A(9),
    'workspace-icon-logo': A(8),
    'workspace-accent-email': T(8),
    'workspace-icon-email': T(8),
    'text-primary-on-default': N(12),
    'text-secondary-on-default': N(10),
    'text-primary-on-raised': N(12),
    'text-secondary-on-raised': N(10),
    'text-primary-on-overlay': N(12),
    'text-secondary-on-overlay': N(10),
    'text-muted-on-default': ok(0.43, 0.032, 262),
    'text-muted-on-raised': ok(0.35, 0.035, 262),
    'text-muted-on-sunken': ok(0.35, 0.035, 262),
    'text-muted-on-overlay': ok(0.35, 0.035, 262),
    'text-subtle-on-default': ok(0.46, 0.028, 261),
    'text-subtle-on-raised': ok(0.38, 0.03, 261),
    'text-subtle-on-sunken': ok(0.38, 0.03, 261),
    'text-subtle-on-overlay': ok(0.38, 0.03, 261),
    'text-on-warning': N(12),
  },
  dark: {
    'surface-app': N(12),
    'surface-base': N(12),
    'surface-raised': N(11),
    'surface-sunken': ok(0.1719, 0.0186, 259.66),
    'surface-overlay': ok(0.1335, 0.0152, 259.32),
    'surface-hover': ok(0.22, 0.02, 263),
    'text-primary': N(2),
    'text-secondary': N(4),
    'text-subtle': N(6),
    'text-muted': N(6),
    'text-disabled': N(8),
    'text-on-accent': N(12),
    'text-on-danger': N(1),
    'border-subtle': N(10),
    'border-strong': N(7),
    'separator-subtle': N(10),
    'separator-default': N(10),
    'separator-strong': N(7),
    'separator-accent': T(5),
    'border-focus': T(5),
    'interactive-default': T(5),
    'interactive-hover': T(4),
    'interactive-hover-surface': N(11),
    'interactive-active': T(3),
    'interactive-pressed-surface': T(3),
    'interactive-selected-surface': T(11),
    'interactive-selected-surface-hover': T(10),
    'interactive-selected-border': T(5),
    'interactive-selected-foreground': N(2),
    'interactive-current-indicator': T(5),
    'interactive-checked-surface': T(5),
    'interactive-drop-target-surface': T(11),
    'interactive-drop-target-border': T(5),
    'interactive-drop-denied-surface': ok(0.28, 0.05, 23),
    'interactive-drop-denied-border': DANGER,
    'interactive-disabled': N(10),
    'interactive-focus-ring': T(5),
    'highlight-search-match': A(10),
    'highlight-search-current': ok(0.45, 0.08, 80),
    'highlight-text-selection': T(11),
    'highlight-text-selection-foreground': N(2),
    'feedback-success': SUCCESS,
    'feedback-warning': WARNING,
    'feedback-danger': DANGER,
    'feedback-info': INFO,
    'accent-primary': T(6),
    'accent-default': T(6),
    'accent-teal': T(6),
    'accent-subtle': T(11),
    'accent-on-subtle': T(6),
    'feedback-success-strong': ok(0.47, 0.11, 156),
    'feedback-warning-strong': ok(0.46, 0.12, 70),
    'text-on-feedback': N(1),
    'tree-row': N(11),
    // WCAG 3.0 UI: N(7) L=0.570 provides ~4:1 contrast against N(11) L=0.264 tree-row.
    'tree-row-hover': N(7),
    'tree-row-selected': T(5),
    'tree-row-focus': T(7),
    'tree-indent-guide': N(7),
    'layer-accent-frame': B(3),
    'layer-wash-frame': B(11),
    'layer-accent-group': A(3),
    'layer-wash-group': A(11),
    'layer-accent-text': G(3),
    'layer-wash-text': G(11),
    'layer-accent-shape': LAYER_ACCENT_SHAPE_DARK,
    'layer-wash-shape': LAYER_WASH_SHAPE_DARK,
    'layer-accent-component': V(3),
    'layer-wash-component': V(11),
    'layer-accent-image': LAYER_ACCENT_IMAGE_DARK,
    'layer-wash-image': LAYER_WASH_IMAGE_DARK,
    'layer-accent-adjustment': LAYER_ACCENT_ADJUSTMENT_DARK,
    'layer-wash-adjustment': LAYER_WASH_ADJUSTMENT_DARK,
    'hero-glow': T(6),
    'brand-teal': T(6),
    'brand-sandstone': BRAND_SANDSTONE,
    'brand-sandstone-light': BRAND_SANDSTONE_LIGHT,
    'brand-terracotta': BRAND_TERRACOTTA,
    'layer-tag-red': LAYER_TAG_RED,
    'layer-tag-orange': LAYER_TAG_ORANGE,
    'layer-tag-yellow': LAYER_TAG_YELLOW,
    'layer-tag-green': LAYER_TAG_GREEN,
    'layer-tag-blue': LAYER_TAG_BLUE,
    'layer-tag-purple': LAYER_TAG_PURPLE,
    'layer-tag-gray': LAYER_TAG_GRAY,
    /* Dark accents maximize chroma subject to dark-text AA with margin
     * (5.4-9.6:1). Step 4 tints read as muted on the dark bar; step 6/7
     * keeps the mode hue legible while the pill still hosts dark text. */
    'workspace-accent-design': B(6),
    'workspace-icon-design': B(4),
    'workspace-accent-drawing': G(6),
    'workspace-icon-drawing': G(4),
    'workspace-accent-image': I(6),
    'workspace-icon-image': I(4),
    'workspace-accent-print': V(6),
    'workspace-icon-print': V(4),
    'workspace-accent-motion': O(7),
    'workspace-icon-motion': O(5),
    'workspace-accent-codegen': R(6),
    'workspace-icon-codegen': R(4),
    'workspace-accent-logo': A(6),
    'workspace-icon-logo': A(5),
    'workspace-accent-email': T(6),
    'workspace-icon-email': T(4),
    'text-primary-on-default': N(2),
    'text-secondary-on-default': N(4),
    'text-primary-on-raised': N(2),
    'text-secondary-on-raised': N(4),
    'text-primary-on-overlay': N(2),
    'text-secondary-on-overlay': N(4),
    'text-muted-on-default': N(6),
    'text-muted-on-raised': N(6),
    'text-muted-on-sunken': N(6),
    'text-muted-on-overlay': N(6),
    'text-subtle-on-default': N(6),
    'text-subtle-on-raised': N(6),
    'text-subtle-on-sunken': N(6),
    'text-subtle-on-overlay': N(6),
    'text-on-warning': N(12),
  },
  'high-contrast': {
    'surface-app': ok(0.0, 0.0, 0),
    'surface-base': ok(0.0, 0.0, 0),
    'surface-raised': ok(0.0971, 0.0, 0),
    'surface-sunken': ok(0.0, 0.0, 0),
    'surface-overlay': ok(0.0, 0.0, 0),
    'surface-hover': ok(0.25, 0.0, 0),
    'text-primary': ok(1.0, 0.0, 0),
    'text-secondary': ok(0.92, 0.0, 0),
    'text-subtle': ok(0.78, 0.0, 0),
    'text-muted': ok(0.8577, 0.0, 0),
    'text-disabled': ok(0.4606, 0.0, 0),
    'text-on-accent': ok(0.0, 0.0, 0),
    'text-on-danger': ok(0.0, 0.0, 0),
    'border-subtle': ok(1.0, 0.0, 0),
    'border-strong': ok(1.0, 0.0, 0),
    'separator-subtle': ok(0.55, 0.0, 0),
    'separator-default': ok(1.0, 0.0, 0),
    'separator-strong': ok(1.0, 0.0, 0),
    'separator-accent': ok(0.9519, 0.2924, 111.62),
    'border-focus': ok(0.9519, 0.2924, 111.62),
    'interactive-default': ok(0.9519, 0.2924, 111.62),
    'interactive-hover': ok(0.9519, 0.2924, 111.62),
    'interactive-hover-surface': ok(0.18, 0.0, 0),
    'interactive-active': ok(0.9043, 0.233, 108.27),
    'interactive-pressed-surface': ok(0.9043, 0.233, 108.27),
    'interactive-selected-surface': ok(0.9519, 0.2924, 111.62),
    'interactive-selected-surface-hover': ok(1.0, 0.0, 0),
    'interactive-selected-border': ok(0.9519, 0.2924, 111.62),
    'interactive-selected-foreground': ok(0.0, 0.0, 0),
    'interactive-current-indicator': ok(0.9519, 0.2924, 111.62),
    'interactive-checked-surface': ok(0.9519, 0.2924, 111.62),
    'interactive-drop-target-surface': ok(0.18, 0.0, 0),
    'interactive-drop-target-border': ok(0.9519, 0.2924, 111.62),
    'interactive-drop-denied-surface': ok(0.2, 0.0, 0),
    'interactive-drop-denied-border': ok(0.6559, 0.1934, 27.47),
    'interactive-disabled': ok(0.3901, 0.0, 0),
    'interactive-focus-ring': ok(0.9519, 0.2924, 111.62),
    'highlight-search-match': ok(0.18, 0.0, 0),
    'highlight-search-current': ok(0.36, 0.0, 0),
    'highlight-text-selection': ok(0.9519, 0.2924, 111.62),
    'highlight-text-selection-foreground': ok(0.0, 0.0, 0),
    'feedback-success': ok(0.8649, 0.2979, 142.49),
    'feedback-warning': ok(0.8446, 0.1616, 82.25),
    'feedback-danger': ok(0.6559, 0.1934, 27.47),
    'feedback-info': ok(0.7086, 0.1456, 250.24),
    'accent-primary': ok(0.9519, 0.2924, 111.62),
    'accent-default': ok(0.9519, 0.2924, 111.62),
    'accent-teal': ok(0.9519, 0.2924, 111.62),
    'accent-subtle': ok(0.5, 0.1, 111.62),
    'accent-on-subtle': ok(0.9519, 0.2924, 111.62),
    'feedback-success-strong': ok(0.8649, 0.2979, 142.49),
    'feedback-warning-strong': ok(0.8446, 0.1616, 82.25),
    'text-on-feedback': ok(0.0, 0.0, 0),
    'tree-row': ok(0.0971, 0.0, 0),
    // WCAG 3.0 UI: ok(0.55) L=0.55 provides 4.5:1 contrast against ok(0.097) tree-row.
    'tree-row-hover': ok(0.55, 0.0, 0),
    'tree-row-selected': ok(0.9519, 0.2924, 111.62),
    'tree-row-focus': ok(0.9519, 0.2924, 111.62),
    'tree-indent-guide': ok(1.0, 0.0, 0),
    'layer-accent-frame': ok(0.9519, 0.2924, 111.62),
    'layer-wash-frame': ok(0.3156, 0.0, 0),
    'layer-accent-group': ok(0.9519, 0.2924, 111.62),
    'layer-wash-group': ok(0.3156, 0.0, 0),
    'layer-accent-text': ok(0.9519, 0.2924, 111.62),
    'layer-wash-text': ok(0.3156, 0.0, 0),
    'layer-accent-shape': ok(0.9519, 0.2924, 111.62),
    'layer-wash-shape': ok(0.3156, 0.0, 0),
    'layer-accent-component': ok(0.9519, 0.2924, 111.62),
    'layer-wash-component': ok(0.3156, 0.0, 0),
    'layer-accent-image': ok(0.75, 0.28, 300),
    'layer-wash-image': ok(0.3156, 0.0, 0),
    'layer-accent-adjustment': ok(0.75, 0.28, 25),
    'layer-wash-adjustment': ok(0.3156, 0.0, 0),
    'hero-glow': ok(0.0, 0.0, 0),
    'brand-teal': ok(0.9519, 0.2924, 111.62),
    'brand-sandstone': ok(0.7161, 0.1398, 60.04),
    'brand-sandstone-light': ok(0.8221, 0.1524, 73.85),
    'brand-terracotta': ok(0.6597, 0.2267, 26.03),
    'layer-tag-red': LAYER_TAG_RED,
    'layer-tag-orange': LAYER_TAG_ORANGE,
    'layer-tag-yellow': LAYER_TAG_YELLOW,
    'layer-tag-green': LAYER_TAG_GREEN,
    'layer-tag-blue': LAYER_TAG_BLUE,
    'layer-tag-purple': LAYER_TAG_PURPLE,
    'layer-tag-gray': LAYER_TAG_GRAY,
    /* High Contrast is one accent: mode identity must not rely on hue. */
    'workspace-accent-design': ok(0.9519, 0.2924, 111.62),
    'workspace-icon-design': ok(1.0, 0.0, 0),
    'workspace-accent-drawing': ok(0.9519, 0.2924, 111.62),
    'workspace-icon-drawing': ok(1.0, 0.0, 0),
    'workspace-accent-image': ok(0.9519, 0.2924, 111.62),
    'workspace-icon-image': ok(1.0, 0.0, 0),
    'workspace-accent-print': ok(0.9519, 0.2924, 111.62),
    'workspace-icon-print': ok(1.0, 0.0, 0),
    'workspace-accent-motion': ok(0.9519, 0.2924, 111.62),
    'workspace-icon-motion': ok(1.0, 0.0, 0),
    'workspace-accent-codegen': ok(0.9519, 0.2924, 111.62),
    'workspace-icon-codegen': ok(1.0, 0.0, 0),
    'workspace-accent-logo': ok(0.9519, 0.2924, 111.62),
    'workspace-icon-logo': ok(1.0, 0.0, 0),
    'workspace-accent-email': ok(0.9519, 0.2924, 111.62),
    'workspace-icon-email': ok(1.0, 0.0, 0),
    'text-primary-on-default': ok(1.0, 0.0, 0),
    'text-secondary-on-default': ok(0.92, 0.0, 0),
    'text-primary-on-raised': ok(1.0, 0.0, 0),
    'text-secondary-on-raised': ok(0.92, 0.0, 0),
    'text-primary-on-overlay': ok(1.0, 0.0, 0),
    'text-secondary-on-overlay': ok(0.92, 0.0, 0),
    'text-muted-on-default': ok(0.8577, 0.0, 0),
    'text-muted-on-raised': ok(0.8577, 0.0, 0),
    'text-muted-on-sunken': ok(0.8577, 0.0, 0),
    'text-muted-on-overlay': ok(0.8577, 0.0, 0),
    'text-subtle-on-default': ok(0.78, 0.0, 0),
    'text-subtle-on-raised': ok(0.78, 0.0, 0),
    'text-subtle-on-sunken': ok(0.78, 0.0, 0),
    'text-subtle-on-overlay': ok(0.78, 0.0, 0),
    'text-on-warning': ok(0, 0, 0),
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

/**
 * Workspace-mode identity pairs (2026-09-15). Every mode must host
 * `text-on-accent` on its pill (AA) and clear non-text contrast as an
 * inactive icon against the menubar surface (UI). Generators keep the
 * eight modes identical in shape so a wiring mistake in one mode cannot
 * silently pass the audit.
 */
const WORKSPACE_MODE_KEYS = [
  'design',
  'drawing',
  'image',
  'print',
  'motion',
  'codegen',
  'logo',
  'email',
] as const;

const WORKSPACE_MODE_CONTRAST_PAIRS: readonly ContrastPair[] = WORKSPACE_MODE_KEYS.flatMap(
  (mode): ContrastPair[] => [
    {
      name: `text-on-accent on workspace-accent-${mode}`,
      fg: 'text-on-accent',
      bg: `workspace-accent-${mode}`,
      grade: 'AA',
    },
    {
      name: `workspace-icon-${mode} on surface-raised`,
      fg: `workspace-icon-${mode}`,
      bg: 'surface-raised',
      grade: 'UI',
    },
  ],
);

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...WORKSPACE_MODE_CONTRAST_PAIRS,
  { name: 'text-primary on surface-app', fg: 'text-primary', bg: 'surface-app', grade: 'AA' },
  { name: 'text-secondary on surface-app', fg: 'text-secondary', bg: 'surface-app', grade: 'AA' },
  { name: 'text-muted on surface-app', fg: 'text-muted', bg: 'surface-app', grade: 'AA' },
  {
    name: 'accent-on-subtle on accent-subtle',
    fg: 'accent-on-subtle',
    bg: 'accent-subtle',
    grade: 'AA',
  },
  {
    name: 'text-on-feedback on feedback-success-strong',
    fg: 'text-on-feedback',
    bg: 'feedback-success-strong',
    grade: 'AA',
  },
  {
    name: 'text-on-feedback on feedback-warning-strong',
    fg: 'text-on-feedback',
    bg: 'feedback-warning-strong',
    grade: 'AA',
  },
  {
    name: 'text-on-feedback on feedback-danger',
    fg: 'text-on-feedback',
    bg: 'feedback-danger',
    grade: 'AA',
  },
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
    name: 'text-primary on interactive-hover-surface',
    fg: 'text-primary',
    bg: 'interactive-hover-surface',
    grade: 'AA',
  },
  {
    name: 'interactive-selected-foreground on selected surface',
    fg: 'interactive-selected-foreground',
    bg: 'interactive-selected-surface',
    grade: 'AA',
  },
  {
    name: 'text-on-accent on pressed surface',
    fg: 'text-on-accent',
    bg: 'interactive-pressed-surface',
    grade: 'AA',
  },
  {
    name: 'text-primary on search match',
    fg: 'text-primary',
    bg: 'highlight-search-match',
    grade: 'AA',
  },
  {
    name: 'text-primary on current search match',
    fg: 'text-primary',
    bg: 'highlight-search-current',
    grade: 'AA',
  },
  {
    name: 'selection foreground on text selection',
    fg: 'highlight-text-selection-foreground',
    bg: 'highlight-text-selection',
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
  { name: 'border-focus on surface-app', fg: 'border-focus', bg: 'surface-app', grade: 'UI' },
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
  { name: 'feedback-info on surface-app', fg: 'feedback-info', bg: 'surface-app', grade: 'UI' },
  { name: 'tree-row-selected on tree-row', fg: 'tree-row-selected', bg: 'tree-row', grade: 'UI' },
  { name: 'tree-row-hover on tree-row', fg: 'tree-row-hover', bg: 'tree-row', grade: 'UI' },
  { name: 'tree-indent-guide on tree-row', fg: 'tree-indent-guide', bg: 'tree-row', grade: 'UI' },
  { name: 'layer-accent-frame on tree-row', fg: 'layer-accent-frame', bg: 'tree-row', grade: 'UI' },
  { name: 'layer-accent-group on tree-row', fg: 'layer-accent-group', bg: 'tree-row', grade: 'UI' },
  { name: 'layer-accent-text on tree-row', fg: 'layer-accent-text', bg: 'tree-row', grade: 'UI' },
  { name: 'layer-accent-shape on tree-row', fg: 'layer-accent-shape', bg: 'tree-row', grade: 'UI' },
  {
    name: 'layer-accent-component on tree-row',
    fg: 'layer-accent-component',
    bg: 'tree-row',
    grade: 'UI',
  },
  {
    name: 'layer-accent-image on tree-row',
    fg: 'layer-accent-image',
    bg: 'tree-row',
    grade: 'UI',
  },
  {
    name: 'layer-accent-adjustment on tree-row',
    fg: 'layer-accent-adjustment',
    bg: 'tree-row',
    grade: 'UI',
  },
  /* Per-elevation text pairs (new — redesign). */
  {
    name: 'text-primary-on-default on surface-base',
    fg: 'text-primary-on-default',
    bg: 'surface-base',
    grade: 'AA',
  },
  {
    name: 'text-secondary-on-default on surface-base',
    fg: 'text-secondary-on-default',
    bg: 'surface-base',
    grade: 'AA',
  },
  {
    name: 'text-primary-on-raised on surface-raised',
    fg: 'text-primary-on-raised',
    bg: 'surface-raised',
    grade: 'AA',
  },
  {
    name: 'text-secondary-on-raised on surface-raised',
    fg: 'text-secondary-on-raised',
    bg: 'surface-raised',
    grade: 'AA',
  },
  {
    name: 'text-primary-on-overlay on surface-overlay',
    fg: 'text-primary-on-overlay',
    bg: 'surface-overlay',
    grade: 'AA',
  },
  {
    name: 'text-secondary-on-overlay on surface-overlay',
    fg: 'text-secondary-on-overlay',
    bg: 'surface-overlay',
    grade: 'AA',
  },
  /* Per-elevation muted/subtle text pairs (a11y fix — catch real DOM combinations). */
  {
    name: 'text-on-warning on feedback-warning',
    fg: 'text-on-warning',
    bg: 'feedback-warning',
    grade: 'AA',
  },
  {
    name: 'text-muted-on-default on surface-base',
    fg: 'text-muted-on-default',
    bg: 'surface-base',
    grade: 'AA',
  },
  {
    name: 'text-muted-on-raised on surface-raised',
    fg: 'text-muted-on-raised',
    bg: 'surface-raised',
    grade: 'AA',
  },
  {
    name: 'text-muted-on-sunken on surface-sunken',
    fg: 'text-muted-on-sunken',
    bg: 'surface-sunken',
    grade: 'AA',
  },
  {
    name: 'text-muted-on-overlay on surface-overlay',
    fg: 'text-muted-on-overlay',
    bg: 'surface-overlay',
    grade: 'AA',
  },
  {
    name: 'text-subtle-on-default on surface-base',
    fg: 'text-subtle-on-default',
    bg: 'surface-base',
    grade: 'AA',
  },
  {
    name: 'text-subtle-on-raised on surface-raised',
    fg: 'text-subtle-on-raised',
    bg: 'surface-raised',
    grade: 'AA',
  },
  {
    name: 'text-subtle-on-sunken on surface-sunken',
    fg: 'text-subtle-on-sunken',
    bg: 'surface-sunken',
    grade: 'AA',
  },
  {
    name: 'text-subtle-on-overlay on surface-overlay',
    fg: 'text-subtle-on-overlay',
    bg: 'surface-overlay',
    grade: 'AA',
  },
];
