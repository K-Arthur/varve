# Varve Visual Direction — adopted patterns

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
| Literal colour palette or iconography from any reference | Every pattern is expressed in Varve's own existing teal/neutral token language; no hex values copied from any reference. |
| Glassmorphism as dominant motif (wellness app) | The frosted/translucent layer is used once (floating toolbar backdrop-filter) — not expanded to the whole application. The hero glow serves a similar "depth" role without the overhead. |

## Token additions

All new tokens added to `packages/ui/src/tokens/color.ts` and regenerated via
`pnpm --filter @varve/ui tokens:generate`. Drift-guard test enforces sync.

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

## Session 19 — Hardened Master Redesign (2026-07-01)

### Changes adopted
| Pattern | Status | Implementation |
|---------|--------|---------------|
| **OKLCH perceptual color space** | **Adopted** | All 72 ramp values + 47 semantic tokens × 3 themes migrated from sRGB to OKLCH. Drift guard updated with ±0.001 OKLCH tolerance. |
| **Hierarchical elevation system** | **Adopted** | Four opaque surface levels (sunken/default/raised/overlay) with front-lit dark mode. Shadows dark-adaptive. z-index paired to elevation. 6 new per-elevation text tokens. |
| **Neo-Bento geometry** | **Adopted** | Radii updated: sm=4px, md=8px, lg=16px, xl=28px, 2xl=40px. Bento-grid CSS primitives added. |
| **Linear-Esque micro-borders** | **Adopted** | 1px interior strokes (`--border-micro`) with accent gradient variant (`--border-micro-accent`). |
| **100% opaque surfaces** | **Adopted** | All `rgba()`, `backdrop-filter: blur()`, and `filter: brightness()` removed from surface backgrounds. FloatingToolbar blur eliminated. |
| **Hardware acceleration** | **Adopted** | `.gpu-layer` class with `translate3d(0,0,0)` applied to editor shell. |
| **Duplicate elimination** | **Adopted** | `FillStackSection` and `GradientStopEditor` deleted. `FillSection` is the single fills UI. |

### Functional defects closed
| Issue | Fix |
|-------|-----|
| Toolbar focus management broken | Added `useEffect` calling `.focus()` on `focusIdx` change |
| EffectsSection color swatch read-only | Wired to open ColorPicker popover with Done button |
| StrokeSection color swatch read-only | Wired to open ColorPicker popover with Done button |
| BindingMenu no keyboard list navigation | Added ArrowUp/ArrowDown/Enter handlers on the listbox |
| 33 components inline-styled | All replaced with CSS classes: ColorPicker (6 files), NumberInput, Slider, Toolbar, TitleBar, ErrorBoundary, TrashSection, ExportPresetPanel, BindingMenu, TokenBindIndicator, GradientEditor, + 20 Tier 2 components |

### Token expansion
| Metric | Before | After |
|--------|--------|-------|
| Contrast pairs | 24 × 3 = 72 | 30 × 3 = 90 |
| Semantic tokens | 47 | 53 (+6 per-elevation text) |
| Radius tokens | 5 | 6 (+radius-2xl: 40px) |
| Elevation tokens | 0 | 12 (4 surfaces, 2 shadows, 4 z-index, 2 micro-borders) |
| CSS files | 9 | 12 (+color-picker.css, export-preset-panel.css, title-bar.css) |

### WCAG audit
- 90/90 pairs pass across 3 themes (100%)
- Elevation pairs verified at each level for both light and dark

---

## Session 36+ — Design Language Evolution: Neo-Bento × Linear Hybrid (2026-07-05)

### Competitive Research Summary

**Research scope**: Figma, Linear, Adobe Illustrator, Adobe InDesign, Affinity Designer,
Canva, Sketch design systems and interaction paradigms.

**Key findings**:

| Tool | Best at | Design language |
|------|---------|-----------------|
| Figma | Browser-native collaboration, Auto Layout, universal Cmd+K | Clean chrome, purple accent, context-adaptive inspector |
| Linear | Keyboard-first workflows, density control, Cmd+K as primary UI | Typography-first, single blue accent, compact/comfortable/cozy |
| Affinity | Persona-based workspace, native performance | Modern flat, persona switcher, clean tool organization |
| Canva | Template-first, accessibility | Pastel, rounded, consumer-oriented |
| Sketch | Symbol system, Mac-native | Minimal, HIG-compliant |
| Adobe Illustrator | Deepest vector toolset, Appearance panel | Mature/dense, customizable workspace |
| Adobe InDesign | Page layout, paragraph styles, preflight | Production-oriented, panel-heavy |

### Design Language Evaluation: Neo-Bento × Linear Hybrid

**Decision: HYBRID APPROACH ADOPTED — with strict boundary rules**

| Domain | Strategy | Rationale |
|--------|----------|-----------|
| **Canvas workspace** | Pure Linear — minimal chrome, keyboard-first | Data-dense, needs maximum content space |
| **Home page** | Neo-Bento — bento grid file cards, atmospheric depth | Overview/snapshot, varied content types |
| **Panels (Layers/Inspector)** | Bento-lite — modular disclosure cells | Sectioned content, benefits from visual hierarchy |
| **Toolbars** | Linear — flat, single-accent, tooltip shortcuts | Power-user efficiency, reduced noise |
| **Dialogs** | Linear — clean, keyboard-navigable, focus-trapped | Task-focused, needs fast dismissal |
| **Navigation** | Linear — Cmd+K universal command entry | Always available, shortcut-discovering |

**Where Neo-Bento was REJECTED**:
- Canvas workspace (would compete with content)
- Layers tree (data-dense, needs uniform rows)
- Timeline panel (chronological linear)
- Text/code editors (reading flow disruption)

**Where Linear was REJECTED**:
- Home page file grid (needs visual hierarchy for discovery)
- Template gallery (needs differentiated preview cells)
- Settings/configuration (grouped content benefits from bento)

### New CSS Primitives Added

| Primitive | Purpose | File |
|-----------|---------|------|
| `.bento-grid` | CSS Grid container with gap + containment | components.css |
| `.bento-cell` | Neut-Bento card: radius-xl, micro-border, elevation-raised | components.css |
| `.bento-cell--featured` | Hero cell: radius-2xl, micro-border-accent, elevation-overlay | components.css |
| `.bento-span-2/3/full` | CSS Grid column span helpers | components.css |
| `.bento-grid--3/--2` | Preset grid templates | components.css |
| `[data-density]` | Three-tier density system (compact/comfortable/cozy) | components.css |
| `.varve-tip__shortcut` | Keyboard shortcut badge in tooltips | components.css |

### Density Control System

Research basis: Linear's compact/comfortable/cozy system (March 2026 refresh).

| Mode | row-gap | padding | min-height | icon-size | font-size |
|------|---------|---------|------------|-----------|-----------|
| compact | 0 | space-1 | 28px | 14px | xs |
| comfortable (default) | space-1 | space-2 | 34px | 16px | sm |
| cozy | space-2 | space-3 | 42px | 18px | base |

Applied via `data-density` attribute on panels. Layers tree,
inspector sections, and file lists support all 3 densities.

### Tooltip Shortcut System

Research basis: Linear shows keyboard shortcuts in all tooltips,
teaching users to graduate from Cmd+K to direct shortcuts.

20+ tool shortcuts registered in `FloatingToolbar.tsx`:
- V=Select, H=Hand, Z=Zoom, F=Frame, R=Rect, O=Ellipse
- L=Line, A=Arrow, P=Pen, T=Text, S=Scale, K=Slice
- I=Eyedropper, Ctrl=Inspect, J=Clone Stamp (2x=Heal, 3x=Spot)

### Architecture Decomposition

**Problem**: `EditorProvider` in context.tsx was 3831 lines with ~250 methods.

**Solution**: Provider Composition Pattern — focused sub-contexts compose
EditorProvider, with backward-compatible useEditor().

| Sub-context | Responsibility | Status |
|-------------|---------------|--------|
| `ViewportContext` | zoom, pan, canvas mode, camera animation | **Extracted** |
| `SelectionContext` | selection CRUD, multi-select helpers | **Extracted** |
| DocumentContext | document ops, undo/redo, file I/O | Pattern established |
| ToolContext | active tool, tool state | Pattern established |
| MotionContext | timeline, animation playback | Planned |
| PrototypeContext | prototype mode, presentation | Planned |

Each sub-context exposes:
1. Focused provider that wraps children
2. Focused hook (useViewport, useSelection)
3. Integration into EditorProvider for backward-compatible useEditor()

### Remaining Work (Deferred)

| Item | Phase | Dependencies |
|------|-------|-------------|
| Multi-canvas layering (3 canvases) | B-07 | — |
| Worker-based rendering (OffscreenCanvas) | C | B-07 |
| Background blur (real backdrop capture) | F-09 | — |
| Snap pruning + frame snapping | D-02/D-04 | — |
| Guide context menu | D-07 | — |
| Canvas accessibility tree expansion | E-01 | — |
| Focus traps on all 8 dialogs | E-02 | Completed (FocusTrap component) |
| Visual regression test suite | — | Playwright setup |
