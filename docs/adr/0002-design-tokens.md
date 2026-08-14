# ADR-0002: Design tokens — teal accent, OKLCH color space, elevation system, WCAG 2.2 AA gate

- **Status:** Accepted (Session 19 redesign)
- **Date:** 2026-06-27 (original), 2026-07-01 (Redesign: OKLCH + elevation)
- **Related:** Strata plan §6; ADR-0001 (render path); docs/plans/archived/redesign-strategy.md

## Context

Every color, space, type, radius, shadow, and motion value in Strata must trace
to a CSS custom property; hardcoded values are banned and enforced by audit
(Strata plan §6, §4.1). The token system must ship **three themes** (Light,
Dark, High-Contrast), all semantic pairs meeting WCAG 2.2 AA, with a distinctive
accent hue — explicitly not the default blue.

## Decisions

### Accent hue
Saturated teal — `oklch(0.779 0.1229 188.31)` (was `#39d0c6`), ramp step 6 of a
12-step teal scale. Expressed in CSS as `oklch(0.779 0.1229 188.31)`.

### Color space: OKLCH (Redesign, 2026-07-01)
Migrated from sRGB `Rgb` tuples to `Oklch` for all primitive ramps and semantic
tokens. OKLCH (Björn Ottosson, 2020) is perceptually uniform — the `L` component
corresponds to perceived lightness identically across all hues. This guarantees
predictable contrast math: `|L₁ - L₂| ≥ 0.5` implies approximately 4.5:1 WCAG
contrast, regardless of hue. CSS output is `oklch(L C H)`.

### Ramps
12-step cool-gray **neutral** (hue ~260), 12-step **teal** (hue ~188), plus
12-step blue/violet/amber/green for layer type-coding. Four feedback values
(success/warning/danger/info) in OKLCH.

### Themes
Light is the default; Dark via `prefers-color-scheme` when no in-app
`[data-theme]` choice exists; High-Contrast honors `forced-colors`. In-app
`[data-theme]` always wins over the system preference.

### Elevation system (Redesign, 2026-07-01)
Hierarchical opaque surfaces: sunken → default → raised → overlay. Dark mode
uses a front-lit model (higher surfaces are brighter). Shadows are dark-theme
adaptive (higher opacity on dark backgrounds). z-index paired to elevation level.
Six new per-elevation text tokens (`text-primary-on-default`, etc.) guaranteeing
WCAG AA contrast at every layer.

### Source of truth
`packages/ui/src/tokens/color.ts` (typed, OKLCH). A generator
emits `tokens.css` (oklch() syntax); a drift-guard test proves the two match
within ±0.001 tolerance; `audit-tokens.ts` enforces WCAG 2.2 on every declared
pair across all three themes.

## Accent rationale (§6 "justify the hue")

- **Differentiation from incumbents.** Figma = red/violet, Canva = blue-violet,
  Linear/Affinity = blue, Notion = gray. Teal owns no major design-tool
  association and reads as "creative AND technical" — fitting a tool straddling
  design and engineering handoff.
- **Distinctive without being trendy.** Teal is saturated enough to feel like a
  product accent (not a default framework blue) but calm enough for a pro tool
  that users stare at for hours.
- **Contrast-friendly.** High-luminance teal pairs cleanly with cool-gray
  neutrals on both light and dark surfaces, which lets the ramp hit AA with
  conservative pairings (validated: 51/51 pairs pass).
- **Brand mark coherence.** The layered icon (ADR: app icon) — whose stacked
  planes evoke geological strata — is drawn in the teal ramp; tokens and mark
  share one identity.

## Evidence

`pnpm audit:tokens` verifies all 30 contrast pairs × 3 themes = 90 checks pass
(expanded from the original 24 × 3 = 72 pairs to include per-elevation text
pairings). The drift-guard vitest proves `tokens.css` matches the audited TS
source within ±0.001 OKLCH tolerance.

## Consequences

- Positive: every UI value traces to a token; themes switch by attribute; the
  accent is ownable and AA-clean; tokens are generated (no hand-CSS drift).
- Accepted cost: first pass uses offline-safe **system font stacks** rather than
  bundling two webfonts; real typeface files (display + body) with
  `font-display: swap` + subset/`unicode-range` land in 0.4/0.9.
- The 4-pt fluid spacing grid uses `clamp()` so the chrome adapts to viewport
  without breakpoint thrash (§4.1).
