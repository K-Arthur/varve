# ADR-0002: Design tokens — teal accent, 12-step ramps, WCAG 2.2 AA gate

- **Status:** Accepted (task 0.3)
- **Date:** 2026-06-27
- **Related:** Strata plan §6; ADR-0001 (render path)

## Context

Every color, space, type, radius, shadow, and motion value in Strata must trace
to a CSS custom property; hardcoded values are banned and enforced by audit
(Strata plan §6, §4.1). The token system must ship **three themes** (Light,
Dark, High-Contrast), all semantic pairs meeting WCAG 2.2 AA, with a distinctive
accent hue — explicitly not the default blue.

## Decision

- **Accent hue: saturated teal** (`#39d0c6`, ramp step 6 of a 12-step teal scale).
- **Ramps:** 12-step cool-gray **neutral** and 12-step **teal** primary, plus
  single-value success/warning/danger/info for the first pass.
- **Themes:** Light is the default; Dark via `prefers-color-scheme` when no
  in-app `[data-theme]` choice exists; High-Contrast honors `forced-colors`.
  In-app `[data-theme]` always wins over the system preference.
- **Source of truth:** `packages/ui/src/tokens/color.ts` (typed). A generator
  emits `tokens.css`; a drift-guard test proves the two match; `audit-tokens.ts`
  enforces WCAG 2.2 on every declared pair across all three themes.

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
- **Brand mark coherence.** The layered "strata" icon (ADR: app icon) is drawn
  in the teal ramp; tokens and mark share one identity.

## Evidence

`pnpm audit:tokens` (task 0.3) verifies all 17 contrast pairs × 3 themes = 51
checks pass. The drift-guard vitest proves `tokens.css` matches the audited TS.

## Consequences

- Positive: every UI value traces to a token; themes switch by attribute; the
  accent is ownable and AA-clean; tokens are generated (no hand-CSS drift).
- Accepted cost: first pass uses offline-safe **system font stacks** rather than
  bundling two webfonts; real typeface files (display + body) with
  `font-display: swap` + subset/`unicode-range` land in 0.4/0.9.
- The 4-pt fluid spacing grid uses `clamp()` so the chrome adapts to viewport
  without breakpoint thrash (§4.1).
