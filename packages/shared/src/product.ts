/**
 * Canonical product-maturity positioning.
 *
 * Single source of truth for Varve's release stage. The desktop app (About
 * dialog), the marketing website (Hero badge, beta section, structured
 * data), and the documentation all consume this constant instead of
 * hard-coding "alpha" / "beta" / "Developer Preview" strings — those three
 * surfaces disagreed until this module existed (2026-08-10 audit).
 *
 * When the stage changes (e.g. beta -> stable), edit ONLY `stage` here and
 * regenerate/refresh the surfaces that display it; `label` and
 * `description` stay in sync automatically.
 *
 * `stage` is intentionally NOT a literal type: consumers widen it to compare
 * against future stages (e.g. "is the product stable yet?"), and a literal
 * would make those comparisons a type error today.
 */
/** Maturity stage. One of: 'pre-alpha' | 'alpha' | 'beta' | 'stable'. */
export type ProductStatusStage = 'pre-alpha' | 'alpha' | 'beta' | 'stable';

export const PRODUCT_STATUS: {
  stage: ProductStatusStage;
  label: string;
  description: string;
} = {
  stage: 'beta',
  /** Short label for badges and UI chrome (title bar, About dialog, CTA chips). */
  label: 'Public Beta',
  /**
   * One-line honest description for meta tags, llms.txt, and structured
   * data (JSON-LD). Version-agnostic on purpose — release versions move
   * independently of the maturity stage.
   */
  description:
    'Varve is in public beta: installers are published for Linux, macOS, and Windows. Core features work, but the file format and interfaces can still change and rough edges remain.',
};
