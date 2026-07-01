# Strata Visual Direction — adopted patterns

Record of which §2 (Synthesis) patterns from the Visual Design Overhaul prompt
were adopted, which were rejected, and why. Authored during Session 14
(2026-06-30) implementation pass.

## Pattern adoption

| # | Pattern | Status | Implementation |
|---|---|---|---|
| 1 | Type-coded layer rows (Figma redesign ref) | **Adopted** | 5 layer types (frame/group/text/shape/component-instance) each get a 3px left-edge accent bar (`::before`) + subtle row-background wash. Wash hides under selection; accent bar persists through all states. 4 new color ramps added (BLUE, VIOLET, AMBER, GREEN) plus 10 layer tokens. `data-layer-type` attribute drives CSS. |
| 2 | One accent, three jobs (Pilo ref) | **Adopted** | Audited all 6 bare `--color-accent` references in editor.css. Converted decorative uses to neutral tokens; fixed 3 broken `--color-text-tertiary` references. Kept accent for: primary action buttons, active/selected states, focus rings, interactive links, and interactive hover borders. |
| 3 | Big-number hierarchy (Vion + RentEase ref) | **Adopted** | Added `.num-display` / `.num-display__suffix` utility classes to components.css. Applied to: StatusBar zoom (separated number + "%" suffix), selection/layer count display, SpecPanel measurement values. |
| 4 | Borderless tone-separation (Vion ref) | **Adopted** | Removed resting `border-bottom` from `.file-row` list rows (rely on tone-based separation). Removed resting `border` from `.template-card`. Kept structural/functional borders: sidebars, toolbars, floating elements, focus outlines. |
| 5 | Pill chips for filter clusters (wellness app + RentEase ref) | **Adopted** | Added `.pill-group` / `.pill-group__btn` / `.pill-group__btn--active` classes to components.css. Converted AlignDistributeBar from inline-styled square buttons to pill chips. HomeToolbar already uses SegmentedControl (preserved, similar pattern). |
| 6 | Single accent breaking monochrome bar (wellness app + RentEase ref) | **Adopted** | Changed `.floating-toolbar__btn--active` background from `--color-interactive-default` (dark pressed teal) to `--color-accent-primary` (bright brand teal #39d0c6). Creates the bright accent pop against the blurred dark toolbar bar. |
| 7 | Sparse atmospheric depth (Figma redesign + wellness ref) | **Adopted** | One `::before` radial-gradient glow on the Home page hero (`--color-hero-glow` at 15% opacity, 40px blur). Static gradient (no animation). Reduces under `prefers-reduced-motion` (opacity 8%, no blur). |
| 8 | Editorial personality in one place (Pilo ref) | **Adopted** | Time-of-day-aware greeting (`Good morning`/`afternoon`/`evening`) rendered in `--font-display` (Geist) at `--font-size-2xl` — the single deliberate typographic personality moment. Subtitle uses sober `--font-body`. |

## Explicitly rejected

| Pattern | Reason |
|---|---|
| Fanned/depth-stacked card carousel (wellness app) | Wrong interaction model for a canvas tool; domain-specific to time-based schedule UI. |
| Literal colour palette or iconography from any reference | Every pattern is expressed in Strata's own existing teal/neutral token language; no hex values copied from any reference. |
| Glassmorphism as dominant motif (wellness app) | The frosted/translucent layer is used once (floating toolbar backdrop-filter) — not expanded to the whole application. The hero glow serves a similar "depth" role without the overhead. |

## Token additions

All new tokens added to `packages/ui/src/tokens/color.ts` and regenerated via
`pnpm --filter @strata/ui tokens:generate`. Drift-guard test enforces sync.

### New ramps (12-step, Radix-informed scaling)
- `BLUE` — frame layer type
- `VIOLET` — component-instance layer type
- `AMBER` — group layer type
- `GREEN` — text layer type

### New semantic tokens (CSS custom properties)
| Token | Purpose |
|---|---|
| `layer-accent-frame` | Blue accent bar for Frame rows |
| `layer-wash-frame` | Blue background wash for Frame rows |
| `layer-accent-group` | Amber accent bar for Group rows |
| `layer-wash-group` | Amber background wash for Group rows |
| `layer-accent-text` | Green accent bar for Text rows |
| `layer-wash-text` | Green background wash for Text rows |
| `layer-accent-shape` | Sandstone-orange accent bar for Shape rows |
| `layer-wash-shape` | Sandstone background wash for Shape rows |
| `layer-accent-component` | Violet accent bar for component-instance rows |
| `layer-wash-component` | Violet background wash for component-instance rows |
| `hero-glow` | Teal (#39d0c6) atmospheric glow behind Home hero greeting |
| `brand-sandstone-light` | Lightened brand-sandstone for shape wash in dark theme |

### Contrast pairs added
All 5 layer accent tokens registered against `tree-row` as grade `UI` (3:1).
Wash tokens omitted from audit — they are purely decorative/ambient, not
meaningful non-text content under WCAG 2.2 SC 1.4.11.

## WCAG audit results

- **Pre-pass**: 57 pairs across 3 themes (19 original)
- **Post-pass**: 72 pairs across 3 themes (19 original + 5 new)
- **Pass rate**: 100% (72/72)
- **Failures**: 0
- **Light accents**: group/accent-text/accent-shape moved to darker ramp steps (A(8), G(8), darker sandstone) to achieve 3:1 on near-white tree-row
- **Dark accents**: all pass (lighter ramp steps on dark tree-row)
- **High-contrast**: all accents mapped to yellow (#ffff00), washes to subtle #3c3c3c

## Niva (AI family assistant) reference

The Niva reference was cited in the prompt at §1 but no screenshots were
verified. Its claims (high-contrast lime on near-black, editorial display type,
restrained design) are consistent with the Pilo reference (§2) and did not
introduce any unique pattern not covered by other verified references. No
Niva-specific claims were invented or implemented.

## Out of scope (reaffirmed from §6)
- Brand accent colour and theme architecture unchanged (ADR-0002)
- IR-replay rendering architecture unchanged (ADR-0001)
- Coordinate math, hit-testing, tool state machines, parenting logic untouched
- Logo/icon asset work deferred to separate prompt

## §5 surfaces completion audit

| Surface | Applied P priorities | Notes |
|---|---|---|
| App shell / grid | P4 | Resting borders audited; tone-step separation preferred |
| Floating toolbar | P4, P6 | Glassmorphic bar (blur) kept; active tool switched to `accent-primary` |
| Canvas selection overlay | P3 | No accent creep; selection uses `interactive-default` correctly |
| Layers panel | P1, P4 | Type-coded rows with accent bar + wash; dead CSS removed |
| Inspector panel | P2, P4, P5 | Big-number hierarchy via spec-row__value; AlignDistributeBar → pill chips |
| Spec panel | P2, P4 | Measurement values use enhanced spec-row__value; borders structural |
| Menubar | P4 | Uses surface-raised bg + structural border; no change needed |
| Shortcut palette | P4 | Uses dialog patterns; no change needed |
| Home page | P2, P5, P7, P8 | Hero greeting + glow; num-display on counts; SegmentedControl preserved |
| Export panel | P2, P4, P5 | SpecPanel/CopyButton patterns reused; no dedicated override needed |
| Themes (L/D/HC) | P1–P7 | All new tokens defined across 3 themes + forced-colors fallback; 72/72 WCAG |

## Session 15 — Production-grade frontend polish pass (2026-07-01)

### Fixes applied

| Area | Change |
|---|---|
| **InspectorPanel nesting** | `Shell.tsx` was rendering the old `InspectorPanel.tsx` wrapper which (a) duplicated tab strip UI on top of `PropertiesPanel`'s own tabs and (b) created a double-nested `editor-inspector` element. Fixed by rendering `PropertiesPanel` directly from Shell. `PropertiesPanel` (the complete implementation with proper CSS classes, full SpecPanel, and CodeGenView) is now the single inspector entry point. |
| **StatusBar controls** | Replaced 5 inline `style` props with CSS classes: `editor-status__unit-select` (bare `<select>` → token-styled), `editor-status__toggle` / `--active` (pixel-grid and snap toggle buttons with hover/focus-visible/pressed states), `editor-status__fit-btn` (Fit button), `editor-status__info` (right-side count/name). |
| **PropertiesPanel inline styles** | Three inline-style blocks moved to CSS classes: `insp-panel__node-header` / `insp-panel__node-name` / `insp-panel__node-kind` (single-node selection header), `insp-panel__canvas-info` / `insp-panel__canvas-name` / `insp-panel__canvas-count` (empty-state canvas summary), `insp-panel__empty-hint` (export tab empty state). |
| **SnapGuidesOverlay color token** | Replaced hardcoded `stroke="#39d0c6"` with `stroke="currentColor"` + CSS class `.snap-guides-overlay` setting `color: var(--color-accent-primary)`. Snap guides now respond to theme changes. Also removed inline `style` object from the SVG element. |
| **Shell panel backdrop** | Replaced inline `style={{ position: 'fixed', ... background: 'rgba(0,0,0,0.3)' }}` on the responsive-panel backdrop with `.editor__panel-backdrop` CSS class in `editor.css`. |

### Hardcoded values eliminated
- `#39d0c6` in SnapGuidesOverlay → `var(--color-accent-primary)` via CSS
- 5 inline style blocks in StatusBar → CSS classes
- 3 inline style blocks in PropertiesPanel → CSS classes
- 1 inline style block in Shell backdrop → CSS class

### No tokens added
All changes use existing tokens; no new WCAG pairs needed.
