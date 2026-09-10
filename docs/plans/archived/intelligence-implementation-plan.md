# Strata Intelligence Implementation Plan

**Generated:** 2026-07-03 | **Based on:** `docs/audits/intelligence-audit-2026.md`
**Scope:** 16 features, 6 phases, ~38.5 days, ~210 tests, $0 recurring cost
**Constraint:** Zero LLM, zero API keys, zero recurring cost, all client-side computation

---

## How to Use This Document

This is a **session-ready implementation plan**. Each phase is self-contained and can be implemented in a separate session. Follow the phases in order — each builds on the previous.

**For each feature:**
1. Write the test file FIRST (TDD)
2. Implement the module
3. Wire into editor context/UI
4. Run verification gates
5. Commit

**After each phase, run:**
```bash
pnpm format
pnpm typecheck       # 15/15 packages must pass
pnpm lint            # 0 new errors on modified files
pnpm test            # all tests pass (including new ones)
pnpm audit:tokens    # 93/93 WCAG-AA across 3 themes
pnpm audit:emoji     # zero violations
just gate            # full Cascade Review gate
```

---

## Pre-Flight Checklist (Before Any Feature Work)

- [ ] `pnpm typecheck` — 15/15 packages pass
- [ ] `pnpm test` — all existing tests pass
- [ ] `pnpm lint` — 0 new errors
- [ ] `pnpm audit:tokens` — 93/93 WCAG-AA
- [ ] `pnpm audit:emoji` — zero violations
- [ ] `cargo test --workspace` — all Rust tests pass
- [ ] Create directory: `packages/editor/src/intelligence/`

---

## Existing Infrastructure (Do NOT Reimplement)

These modules already exist and should be imported, not recreated:

| Module | Location | What It Provides |
|--------|----------|-----------------|
| OKLCH color conversion | `packages/shared/src/colorConversion.ts` | sRGB to OKLCH, OKLCH to sRGB, ManagedColor helpers |
| WCAG contrast math | `packages/ui/src/tokens/contrast.ts` | `relativeLuminance()`, `contrastRatio()`, `oklchContrastRatio()`, `passes()`, `minimumRatio()`, `oklchToRgb()`, `rgbToOklch()` |
| Design governance | `packages/scene/src/governance.ts` | `findOrphanedStyles()`, `findUnusedComponents()`, `validateNamingConventions()`, `generateStyleUsageReport()`, `validateComponentProperties()` |
| Scene model | `packages/scene/src/document.ts` | `Document` interface with nodes, styles, components, variables, swatches |
| Editor context | `packages/editor/src/context.tsx:219` | `EditorContextValue` interface — add new methods here |
| Bezier math | `packages/shared/src/bezier.ts` | `cubicBezierPoint()`, `cubicBezierSplit()` |
| Easing/interpolation | `packages/shared/src/easing.ts` | Easing functions, interpolation |
| AI panel (mock) | `packages/ai/src/index.ts` | `chat()` mock, `createAssistant()` — replace in Phase 6 |
| AIPanel UI | `packages/editor/src/components/AIPanel.tsx` | Chat panel UI — wire real dispatch in Phase 6 |
| ManagedColor | `packages/scene/src/colorManagement.ts` | `ManagedColor` (Rgb/Cmyk/Gray/Spot), color config |
| Motion system | `packages/scene/src/motion.ts` | Timeline/track/keyframe CRUD |
| Timeline sampler | `packages/editor/src/timeline/TimelineSampler.ts` | Keyframe interpolation |
| Codegen | `packages/codegen/src/` | SVG/React export — extend in Phase 5 |

---

## Phase 0: Foundation (3 days)

### 0a. Action Recording Infrastructure (2 days)

**Goal:** Add `recordAction(actionId)` to EditorContext. Hook into all interactive surfaces. This is the foundation for 5 future features (adaptive UI, shortcut recommender, workflow detector, onboarding adapter, complexity progression).

#### New files
- `packages/editor/src/intelligence/actionTracker.ts`
- `packages/editor/src/intelligence/actionTracker.test.ts` — 6 tests

#### API
```typescript
interface ActionRecord {
  actionId: string;
  timestamp: number;
}

class ActionTracker {
  record(actionId: string): void;
  getCount(actionId: string, windowMs?: number): number;
  getRecentActions(windowMs: number): ActionRecord[];
  getFrequencyMap(): Map<string, number>;
  clear(): void;
  toJSON(): string;
  fromJSON(json: string): void;
}
```

#### Implementation notes
- Store as `ActionRecord[]` in localStorage key `strata:actions`
- 30-day rolling window (prune on load)
- `record()` is debounced (deduplicate rapid same-action calls within 100ms)
- Use `useEffect` in `Shell.tsx` to subscribe to tool changes from context
- Instrument `handleAction` in `Menubar.tsx`
- Add call in `useShortcuts` dispatch path
- No performance overhead (<0.1ms per call)
- Privacy: no action data ever leaves the device

#### TDD test spec (6 tests)
1. Record action → `getCount('tool:rect')` returns 1
2. Record same action 3 times → count is 3
3. Record 2 different actions → `getFrequencyMap()` has both
4. Actions older than 30 days are pruned on load
5. `toJSON()` / `fromJSON()` round-trip preserves data
6. Debounce: 5 rapid calls within 100ms → count is 1

#### Files to modify
- `packages/editor/src/context.tsx` — add `recordAction` to `EditorContextValue` and `EditorProvider`
- `packages/editor/src/Shell.tsx` — subscribe to tool changes, call `recordAction('tool:<id>')`
- `packages/editor/src/Menubar.tsx` — call `recordAction('menu:<id>')` in `handleAction`
- `packages/editor/src/shortcuts/useShortcuts.ts` — call `recordAction('shortcut:<id>')` in dispatch

#### Acceptance criteria
- [ ] Every tool selection records `tool:<toolId>`
- [ ] Every menu action records `menu:<actionId>`
- [ ] Every shortcut dispatch records `shortcut:<shortcutId>`
- [ ] Actions stored in localStorage with 30-day rolling window
- [ ] `recordAction` is debounced
- [ ] No performance overhead
- [ ] Privacy: no action data ever leaves the device

---

### 0b. WCAG Math Foundation (1 day)

**Goal:** Add statistical helpers and accessible color finder to `@varve/shared`. The WCAG contrast math already exists in `@varve/ui/tokens/contrast.ts` — this phase adds the missing `findAccessibleColor()` and stats helpers.

#### New files
- `packages/shared/src/colorMath.ts`
- `packages/shared/src/colorMath.test.ts` — 6 tests

#### Functions to implement
```typescript
import { relativeLuminance, contrastRatio, oklchToRgb, rgbToOklch, type Oklch, type Rgb } from '@varve/ui/tokens/contrast';

/** Find nearest accessible color via OKLCH lightness binary search. */
export function findAccessibleColor(
  fg: Rgb,
  bg: Rgb,
  targetRatio: number,
  maxDeltaE: number = 5.0,
): Rgb

/** Arithmetic mean of an array of numbers. */
export function mean(values: number[]): number

/** Sample standard deviation. */
export function stddev(values: number[]): number

/** Median of an array. */
export function median(values: number[]): number

/** Mode (most frequent value) with binning tolerance. */
export function binnedMode(values: number[], binSize: number): number | null

/** Delta E in OKLab (perceptual distance). */
export function deltaEOK(a: Oklch, b: Oklch): number
```

**Important:** `relativeLuminance` and `contrastRatio` already exist in `@varve/ui/src/tokens/contrast.ts`. Import them — do NOT reimplement. The `findAccessibleColor` function uses binary search in OKLCH lightness, converting to RGB for contrast checks at each step.

#### TDD test spec (6 tests)
1. `mean([1,2,3,4,5])` = 3
2. `stddev([2,4,4,4,5,5,7,9])` = 2.0 (approximately)
3. `median([1,3,5,7,9])` = 5
4. `binnedMode([4,8,8,12,12,12,16], 4)` = 12 (bin 12-16)
5. `findAccessibleColor`: input #FF0000 on #FFFFFF (ratio 4.0) → output has ratio >= 4.5 and DEok < 5.0
6. `findAccessibleColor`: input already passing → returns unchanged

#### Files to modify
- `packages/shared/src/index.ts` — export new functions

#### Acceptance criteria
- [ ] All functions are pure (no side effects)
- [ ] `findAccessibleColor` converges in <20 iterations
- [ ] DEok bound is respected (never shift color more than 5.0 perceptual distance)

**Gate:** `just gate` after Phase 0.

---

## Phase 1: Layout & Color Intelligence (11 days)

### 1.1 Content-Aware Layer Naming (2 days)

#### New files
- `packages/editor/src/intelligence/autoNamer.ts`
- `packages/editor/src/intelligence/autoNamer.test.ts` — 14 tests

#### Decision tree rules (ordered, first match wins)
```
1. kind='text' AND text matches /button|submit|cancel|sign|login|ok|save|delete|close/ → "Button: {text}"
2. kind='text' AND fontSize >= 24 AND textAlign='center' → "Heading: {text[:20]}"
3. kind='text' AND text.length > 100 → "Body: {text[:30]}..."
4. kind='text' → "Text: {text[:20]}"
5. kind='frame' AND hasComponent → "{componentName} instance"
6. kind='frame' AND hasVariant → "{componentName} / {variantName}"
7. kind='frame' AND hasLayout → "Auto-layout frame"
8. kind='frame' AND children.length >= 3 → "Section"
9. kind='image' AND src filename available → "Image: {filename}"
10. kind='rect' AND w==h AND w < 30 → "Icon placeholder"
11. kind='rect' AND w != h → "Rectangle"
12. kind='ellipse' → "Ellipse"
13. kind='path' → "Vector shape"
14. kind='group' AND children.length > 0 → "Group ({children.length})"
```

#### Files to modify
- `packages/editor/src/context.tsx` — `createShapeAt` and `createTextNodeAt` call `autoName()` on new nodes
- `packages/editor/src/components/LayersPanel/LayersRow.tsx` — rename field shows auto-suggestion as ghost text

#### TDD test spec (14 tests)
1. Text "Submit" → "Button: Submit"
2. Text fontSize=32, textAlign=center, "Welcome to Strata" → "Heading: Welcome to Strata"
3. Text fontSize=14, "Some short label" → "Text: Some short label"
4. Frame with componentId → "MyComponent instance"
5. Frame with variant → "MyComponent / hover"
6. Frame with layoutStyle → "Auto-layout frame"
7. Frame with 3+ children, no component → "Section"
8. Image src "photo-2024.jpg" → "Image: photo-2024"
9. Rect w=20, h=20 → "Icon placeholder"
10. Rect w=200, h=80 → "Rectangle"
11. Path node → "Vector shape"
12. Group with 5 children → "Group (5)"
13. Ellipse → "Ellipse"
14. Node with custom name → preserve existing name

#### Acceptance criteria
- [ ] New nodes get auto-names instead of "Rectangle 1", "Text 1"
- [ ] Auto-name counter still works (e.g., "Button: Submit 2" if "Button: Submit 1" exists)
- [ ] Rename field shows auto-suggestion as ghost text
- [ ] User can override at any time (last-set name sticks)
- [ ] `renameNode` with empty string resets to auto-name
- [ ] Operation sets initial name at creation (no async/lag)

---

### 1.2 Image Smart-Fit (0.5 day)

#### New files
- `packages/editor/src/intelligence/imageFitAdvisor.ts`
- `packages/editor/src/intelligence/imageFitAdvisor.test.ts` — 8 tests

#### Algorithm
```
1. Image 1000x500 in frame 500x500 → AR mismatch (image wider) → 'cover'
2. Image 500x1000 in frame 500x500 → AR mismatch (image taller) → 'contain'
3. Image 500x500 in frame 500x500 → near-perfect match → 'fill'
4. AR within 5% tolerance → 'fill'
5. Frame with existing imageFit → respect existing value (don't override)
6. Image dimensions unknown → default 'fill', re-evaluate on load
```

#### Files to modify
- `packages/editor/src/context.tsx` — `createShapeAt` calls `suggestFit()` when dropping image into frame
- `packages/editor/src/CanvasArea.tsx` — drag-drop handler calls advisor

#### TDD test spec (8 tests)
1. Image 1000x500 in frame 500x500 → suggests 'cover'
2. Image 500x1000 in frame 500x500 → suggests 'contain'
3. Image 500x500 in frame 500x500 → suggests 'fill'
4. Image with transparency in path shape → suggests 'crop' (mask)
5. Frame with existing `imageFit` set → respects existing value
6. Image dimensions unknown → defaults to 'fill'
7. Aspect ratio within 5% tolerance → suggests 'fill'
8. Multiple images dropped → each gets individual fit suggestion

#### Acceptance criteria
- [ ] Drop image into frame → auto-applies optimal imageFit
- [ ] Toast notification shows what was applied and why
- [ ] Undo reverses the fit setting
- [ ] Does not override if user has manually set imageFit

---

### 1.3 Smart Spacing Harmonizer (2 days)

#### New files
- `packages/editor/src/intelligence/spacingHarmonizer.ts`
- `packages/editor/src/intelligence/spacingHarmonizer.test.ts` — 10 tests

#### Algorithm
1. Get selected nodes' siblings (same parent)
2. Sort by position on dominant axis (horizontal if wider-than-tall bounding box)
3. Compute gaps between consecutive siblings' edges
4. If fewer than 2 gaps → return null (can't harmonize)
5. Compute median gap using `binnedMode(gaps, 4)` from `colorMath.ts`
6. If mode confidence < 80% → return null (ambiguous spacing system)
7. Snap each sibling's position so gaps equal the detected base unit

#### Files to modify
- `packages/editor/src/Menubar.tsx` — "Harmonize Spacing" in Arrange menu
- `packages/editor/src/shortcuts/ShortcutManager.ts` — `harmonizeSpacing: { binding: { key: 'h', ctrl: true, shift: true } }`
- `packages/editor/src/shortcuts/useShortcuts.ts` — handler
- `packages/editor/src/context.tsx` — `harmonizeSpacing()` method

#### TDD test spec (10 tests)
1. 3 siblings: gaps [8, 8] → no change needed, returns null
2. 3 siblings: gaps [8, 3, 12] → dominant=8, suggests snapping gap[1] to 8
3. 2 siblings only → can't compute variance, returns null
4. Horizontal flow siblings (sorted by X) → correct gap detection
5. Vertical flow siblings (sorted by Y) → correct gap detection
6. Mixed flow siblings → detects dominant axis, suggests harmonizing that axis
7. Different-sized siblings → gaps computed from edges, not centers
8. Siblings with rotation → gap computed from bounding box edges
9. Transaction: harmonize is undoable as one atomic operation
10. Single sibling selected → returns null (need 2+)

#### Acceptance criteria
- [ ] Ctrl+Shift+H → gaps equalized to median among selected siblings
- [ ] Menu item in Arrange menu
- [ ] Single undo step
- [ ] aria-live: "Harmonized spacing: 4 gaps set to 8px"
- [ ] Non-intrusive toast when manual spacing creates inconsistency (debounced 2s)

---

### 1.4 WCAG Contrast Auto-Fix (3 days)

#### New files
- `packages/editor/src/intelligence/wcagFix.ts`
- `packages/editor/src/intelligence/wcagFix.test.ts` — 12 tests
- `packages/editor/src/components/Inspector/sections/ContrastIndicator.tsx`

#### Algorithm
1. For each fill color on selected node, compute contrast ratio against background
2. Background = parent frame's fill (walk ancestors), or white if none
3. If ratio < 4.5:1 (AA) or < 3.0:1 (AA large text), mark FAIL
4. Auto-fix: use `findAccessibleColor()` from `@varve/shared/colorMath`
5. For transparent fills: warn "can't verify — depends on background"
6. For gradients: check worst-case color in stops
7. For multiple fills: check topmost visible fill

**Import from existing:** `relativeLuminance`, `contrastRatio`, `oklchContrastRatio`, `passes`, `minimumRatio` from `@varve/ui/tokens/contrast`. `findAccessibleColor` from `@varve/shared/colorMath`.

#### Files to modify
- `packages/editor/src/components/Inspector/sections/FillSection.tsx` — render `<ContrastIndicator />` next to swatches
- `packages/editor/src/components/Inspector/sections/TypographySection.tsx` — render for text color

#### TDD test spec (12 tests)
1. White text (#FFFFFF) on white background → contrast 1.0:1, FAILS AA
2. Black text (#000000) on white background → contrast 21.0:1, PASSES AA
3. Gray text (#767676) on white → contrast 4.54:1, PASSES (borderline)
4. Gray text (#777777) on white → contrast 4.48:1, FAILS (just below)
5. Large text (>=18px bold or >=24px) on gray → passes at 3.0:1 threshold
6. Auto-fix: input FAILING color → output color has ratio >= 4.5:1
7. Auto-fix: output color DEok < 5.0 from input (perceptual proximity)
8. Auto-fix: input color already passes → returns unchanged
9. Auto-fix: #FF0000 on #FFFFFF (ratio 4.0) → darkens red, ratio >= 4.5
10. Transparent fills: warn "contrast depends on background — can't verify"
11. Gradient fills: check worst-case color in gradient stops
12. Multiple fills: check topmost visible fill

#### Acceptance criteria
- [ ] Red/green dot next to each fill swatch showing pass/fail
- [ ] Click dot → "Auto-fix" button
- [ ] Auto-fix shifts color minimally to pass WCAG AA
- [ ] Toast: "Contrast improved from 3.2:1 to 4.6:1"
- [ ] Works for text fills, shape fills, stroke colors
- [ ] WCAG large text threshold (3.0:1) when applicable

---

### 1.5 Color Palette Extraction (2 days)

#### New files
- `packages/editor/src/intelligence/paletteExtractor.ts`
- `packages/editor/src/intelligence/paletteExtractor.test.ts` — 10 tests

#### Algorithm
1. Downsample image to 64x64 using existing `CompositeCanvas` / `ImageCache`
2. Median-cut quantization: recursively split color space along longest axis
3. User-selectable color count (5-8, default 6)
4. Convert extracted colors to OKLCH using existing `rgbToOklch()`
5. Harmony generation: hue rotation in OKLCH space
   - Complementary: +180 degrees
   - Triadic: +120, +240 degrees
   - Analogous: +30, -30 degrees
   - Split-complementary: +150, +210 degrees
6. Gamut map: ensure all generated colors are displayable (clamp to sRGB gamut)

#### Files to modify
- `packages/editor/src/context.tsx` — add `extractPalette(nodeId)` and `generateHarmony(color, type)` methods
- `packages/editor/src/Menubar.tsx` — "Extract Palette" in Object menu for image nodes
- `packages/editor/src/components/Inspector/sections/FillSection.tsx` — "Generate Harmony" button on color swatches

#### TDD test spec (10 tests)
1. Solid red image → extracted palette contains red
2. 6-color photo → 6 distinct colors returned
3. Grayscale image → all extracted colors have C=0 in OKLCH
4. Transparent image → alpha channel ignored
5. Complementary harmony of blue (#0000FF) → contains orange-ish hue (H~30)
6. Triadic harmony → 3 colors at 120-degree intervals
7. Analogous harmony → colors within +/-30 degrees of seed
8. Split-complementary → 3 colors at 0, 150, 210 degrees
9. Gamut mapping: out-of-gamut OKLCH color → clamped to displayable range
10. 64x64 downsample → <5ms extraction time

#### Acceptance criteria
- [ ] Right-click image → "Extract Palette" → 6 dominant colors as swatches
- [ ] Click swatch → applies as fill to selected node
- [ ] "Save as document swatches" button → adds to `doc.swatches`
- [ ] Right-click any color → "Generate Harmony" → submenu with 4 harmony types
- [ ] Generated palette preview → click to apply individual colors
- [ ] All computation <5ms

---

### 1.6 Cognitive Load Budget (1.5 days)

#### New files
- `packages/editor/src/intelligence/cognitiveLoad.ts`
- `packages/editor/src/intelligence/cognitiveLoad.test.ts` — 8 tests

#### API
```typescript
interface CognitiveLoadConfig {
  /** Point values per component type or node kind. */
  pointValues: Record<string, number>;
  /** Maximum points allowed per frame before warning. */
  budget: number;
}

const DEFAULT_CONFIG: CognitiveLoadConfig = {
  pointValues: {
    button: 3,
    input: 3,
    select: 3,
    card: 5,
    dialog: 6,
    modal: 6,
    nav: 4,
    tab: 2,
    default: 1,
  },
  budget: 15,
};

function computeCognitiveLoad(frame: SceneNode, doc: Document, config?: Partial<CognitiveLoadConfig>): {
  total: number;
  budget: number;
  exceeded: boolean;
  breakdown: { nodeId: NodeId; name: string; points: number }[];
};
```

#### Files to modify
- `packages/editor/src/components/Inspector/sections/` — new `CognitiveLoadIndicator.tsx` component
- `packages/editor/src/context.tsx` — add `getCognitiveLoad(nodeId)` method

#### TDD test spec (8 tests)
1. Empty frame → total 0, not exceeded
2. Frame with 3 buttons → total 9, not exceeded
3. Frame with 5 buttons + 1 dialog → total 21, exceeded (21 > 15)
4. Frame with nested frame containing 2 cards → only counts leaf-level interactive (10)
5. Custom config with budget=30 → 21 points not exceeded
6. Custom point values: button=1 → 5 buttons = 5 points
7. Non-component rect → default 1 point
8. Config persists in localStorage

#### Acceptance criteria
- [ ] Inspector shows cognitive load indicator when a frame is selected
- [ ] Green (under budget), amber (80-100% of budget), red (exceeded)
- [ ] Click → breakdown panel listing each contributing element with point value
- [ ] Settings: "Cognitive load budget" (default: 15) and custom point values
- [ ] All computation <1ms

---

### Phase 1 Files Modified (Summary)
- `packages/shared/src/index.ts` — export new color math (Phase 0b)
- `packages/editor/src/context.tsx` — wire naming, spacing, palette, cognitive load, action tracking
- `packages/editor/src/CanvasArea.tsx` — image fit advisor on drop
- `packages/editor/src/components/Inspector/sections/FillSection.tsx` — ContrastIndicator, harmony button
- `packages/editor/src/components/Inspector/sections/TypographySection.tsx` — ContrastIndicator
- `packages/editor/src/Menubar.tsx` — new menu items (Harmonize Spacing, Extract Palette)
- `packages/editor/src/shortcuts/ShortcutManager.ts` — new shortcuts
- `packages/editor/src/shortcuts/useShortcuts.ts` — new handlers
- `packages/editor/src/Shell.tsx` — action tracker subscription
- `packages/editor/src/components/LayersPanel/LayersRow.tsx` — ghost text auto-name suggestion

**Gate:** `just gate` after Phase 1.

---

## Phase 2: Design System Intelligence (13 days)

### 2.1 Design Quality Score (4 days)

#### New files
- `packages/editor/src/intelligence/qualityScore.ts`
- `packages/editor/src/intelligence/qualityScore.test.ts` — 15 tests
- `packages/editor/src/components/StatusBar/QualityScoreIndicator.tsx`
- `packages/editor/src/components/StatusBar/QualityScoreIndicator.test.tsx` — 4 tests
- `packages/editor/src/components/Inspector/sections/QualityScoreSection.tsx`

#### Scoring pillars (market-validated by OPTIK)
| Pillar | Weight | Checks |
|--------|--------|--------|
| Typography | 25% | Scale ratio consistency, hierarchy depth (>=2 levels), line measure (45-75 chars), weight usage distribution |
| Color | 25% | Contrast ratios (WCAG AA), palette coherence (OKLCH hue clustering), dark mode coverage, token usage |
| Layout | 25% | Grid alignment (8px snap), spacing rhythm (stddev of gaps), nesting depth (<6), responsive breakpoints |
| Motion | 10% | Transition purpose (no decorative-only), easing curves (not linear for UI), reduced-motion support |
| Accessibility | 15% | Focus styles, semantic structure, touch targets (>=44px), screen reader labels |

#### Algorithm
Each pillar is a pure function returning 0-100. Weighted aggregate: `score = sum(pillarScore * weight)`. All checks operate on scene graph properties.

#### Files to modify
- `packages/editor/src/StatusBar.tsx` — insert `<QualityScoreIndicator />`
- `packages/editor/src/components/Inspector/PropertiesPanel.tsx` — add `'score'` to `type Tab`

#### TDD test spec (15 tests)
1. Empty document → score 100 (no issues to find)
2. Single text node with 8px font → typography pillar < 80 (no hierarchy)
3. Two text nodes with 12px and 48px → typography pillar >= 90 (good hierarchy)
4. Text on low-contrast background → color pillar < 70
5. All colors from tokens → color pillar bonus (+5)
6. Nodes off 8px grid → layout pillar < 80
7. 3 evenly-spaced siblings → layout pillar >= 90
8. Frame nested 8 levels deep → layout pillar < 70
9. No motion data → motion pillar = 100 (neutral, not penalized)
10. Touch target < 44px → accessibility pillar < 80
11. Image without descriptive name → accessibility pillar < 90
12. Weighted aggregate: all pillars 80 → score 80
13. Score updates when node properties change
14. 100-node document → computation <5ms
15. Configurable weights: custom weights change the aggregate

#### Acceptance criteria
- [ ] StatusBar shows colored badge: green (90+), amber (70-89), red (<70)
- [ ] Click badge → inspector opens to score tab with pillar breakdown
- [ ] Each pillar shows sub-checks with pass/fail and "Fix" button where applicable
- [ ] Score updates in real-time as nodes are modified
- [ ] Score computation runs in `requestIdleCallback`, never blocks UI
- [ ] Weights configurable in Settings

---

### 2.2 Component Variant Detector (4 days)

#### New files
- `packages/editor/src/intelligence/variantDetector.ts`
- `packages/editor/src/intelligence/variantDetector.test.ts` — 16 tests

#### Algorithm
1. Group selected frames by structural similarity (same child count +/-1, same child types in order)
2. For each group, collect all `NodeBase` property values (fills, strokes, effects, text, cornerRadius, layoutStyle, constraints, opacity, blendMode, rotation)
3. Properties identical across all frames → candidate component defaults
4. Properties that differ → candidate variant properties
5. Require 80%+ structural similarity before grouping
6. Auto-name variants: concatenate differing property value summaries
7. Generate preview table: rows = variants, columns = differing properties

#### Files to modify
- `packages/editor/src/Menubar.tsx` — "Detect Variants" in Object menu
- `packages/editor/src/components/Inspector/MultiSelectionPanel.tsx` — "Detect Variants" button when 3+ frames selected

#### TDD test spec (16 tests)
1. 3 identical frames with different fill colors → 1 variant property "fill", 3 variants
2. 3 frames with different text AND different fills → 2 variant properties
3. 2 frames → detects variants but warns "2 frames minimum for meaningful variants"
4. 1 frame → returns null, "need 2+ similar frames"
5. Frames with different child counts (>1 difference) → grouped separately
6. Frames with different child types → not grouped as same component
7. Mixed selection (frames + shapes) → only frames considered
8. Frames with component instances inside → instances preserved in variants
9. Frames with auto-layout → layoutStyle becomes variant property if it differs
10. Frames with text content → text becomes variant property if it differs
11. 10 identical frames with minor differences → correct property isolation
12. Frames with rotation differences → rotation detected as variant property
13. Frames with different visibility of children → visibility becomes variant property
14. Frames with different effects → effects detected as variant property
15. Frames with identical everything → warns "no differences detected"
16. Variant names auto-generated from differing property values

#### Acceptance criteria
- [ ] Select 3+ similar frames → "Detect Variants" appears in Object menu and multi-select panel
- [ ] Click → preview table shows detected variant properties with per-frame values
- [ ] User can edit variant property names before confirming
- [ ] User can exclude properties from variant definition
- [ ] Confirm → creates component with variants, replaces selected frames with instances
- [ ] Single undo step
- [ ] aria-live: "Detected 3 variants with 2 properties: State, Size"

---

### 2.3 Design Debt Scanner (5 days)

#### New files
- `packages/editor/src/intelligence/debtScanner.ts`
- `packages/editor/src/intelligence/debtScanner.test.ts` — 20 tests
- `packages/editor/src/components/Inspector/DebtPanel.tsx`
- `packages/editor/src/components/Inspector/DebtPanel.test.tsx` — 6 tests
- `packages/editor/src/components/StatusBar/DebtBadge.tsx`

#### Checks (15 total, each a named pure function)
1. `findHardcodedFills(doc)` — fills not linked to any style or variable
2. `findHardcodedStrokes(doc)` — strokes not linked to any style
3. `findHardcodedEffects(doc)` — effects not linked to any style
4. `findHardcodedText(doc)` — text properties not linked to any style (fontSize, fontFamily, fontWeight)
5. `findOrphanedStyles(doc)` — **reuse `governance.ts:findOrphanedStyles()`**
6. `findDuplicateStyles(doc)` — styles with identical properties, different names
7. `findUnusedComponents(doc)` — **reuse `governance.ts:findUnusedComponents()`**
8. `findMissingAltText(doc)` — ImageNodes without descriptive names
9. `findOversizedAssets(doc)` — images > 2MB or dimensions > 2x display size
10. `findDeepNesting(doc)` — frame trees deeper than 6 levels
11. `findZeroSizeNodes(doc)` — nodes with w=0 or h=0
12. `findTextOverflow(doc)` — text where measured content exceeds bounding box
13. `findInconsistentNaming(doc)` — **reuse `governance.ts:validateNamingConventions()`**
14. `findUnusedVariables(doc)` — variables never referenced by any binding
15. `findDuplicateComponents(doc)` — components with identical property sets

#### Files to modify
- `packages/editor/src/components/Inspector/PropertiesPanel.tsx` — add `'debt'` to `type Tab`
- `packages/editor/src/StatusBar.tsx` — add `<DebtBadge />` showing issue count

#### TDD test spec (20 tests)
1. Node with `styleId: null` and no bindings → flagged as hardcoded
2. Node with `styleId: set` → not flagged
3. Style in doc.styles but not referenced → flagged as orphan
4. Two styles with identical fills, different names → flagged as duplicate
5. Two styles with same name, different fills → not flagged (names are the conflict)
6. Component defined but zero instances → flagged as unused
7. Image node with name "Image 1" → flagged as missing alt text
8. Image node with name "Hero photo: team" → not flagged
9. Image 5000x4000 in 200x160 frame → flagged as oversized
10. Frame nested 8 levels deep → flagged
11. Node with w=0 → flagged as zero-size
12. Text node where measured content width > node width → flagged as overflow
13. Node named "my-button" (kebab-case for component) → flagged
14. Variable defined but no PropertyBinding references it → flagged as unused
15. Empty document → 0 issues, not crash
16. 5000-node document → scan <200ms
17. Issues grouped by severity: error > warning > info
18. Issue count badge updates when node is added/removed
19. "Fix all" for hardcoded fills creates style and links all matching nodes
20. Scanner respects locked/hidden nodes (doesn't flag what user can't see)

#### Acceptance criteria
- [ ] Inspector "Debt" tab shows categorized issue list with counts
- [ ] StatusBar shows red badge: "12 issues"
- [ ] Each issue has "Fix" or "Ignore" button
- [ ] Click issue → selects affected node(s) and scrolls layers panel
- [ ] "Scan on open" setting (default: on)
- [ ] Scanner runs on `requestIdleCallback` with 50ms budget per chunk
- [ ] 5000-node document → scan <200ms

**Gate:** `just gate` after Phase 2.

---

## Phase 3: Personalization & Onboarding (6.5 days)

### 3.1 Progressive Complexity Disclosure (2 days)

#### New files
- `packages/editor/src/intelligence/complexityProgression.ts`
- `packages/editor/src/intelligence/complexityProgression.test.ts` — 9 tests

#### Tier system
| Tier | Unlock condition | Visible tools | Visible panels |
|------|-----------------|---------------|----------------|
| Essential (0-2 sessions) | Default | Select, Frame, Rect, Text, Hand, Zoom | Layers, Properties |
| Intermediate (3-9 sessions) | 3 sessions OR used 50% of Essential | + Ellipse, Line, Pen, Image | + Export tab, Assets |
| Advanced (10+ sessions) | 10 sessions OR explicit opt-in | + Polygon, Star, Arrow, Pencil, Scale | + Spec, Prototype, Timeline, Variables |

#### Files to modify
- `packages/editor/src/Shell.tsx` — render fewer panels/tools for new users
- `packages/editor/src/components/FloatingToolbar/FloatingToolbar.tsx` — filter tools by tier
- `packages/editor/src/Menubar.tsx` — hide advanced menu items

#### TDD test spec (9 tests)
1. New user (0 sessions) → Essential tier
2. 3 sessions completed → Intermediate tier
3. 10 sessions completed → Advanced tier
4. User used 50% of Essential tools in 1 session → Intermediate unlocked
5. "Show advanced features" toggle → overrides to Advanced
6. Hidden tools still work via keyboard shortcuts
7. Session count persists in localStorage
8. Tier transition doesn't cause layout shift (CSS transition)
9. Reset: clearing localStorage → back to Essential

#### Acceptance criteria
- [ ] New users see simplified toolbar (6 essential tools)
- [ ] Tools unlock progressively with usage
- [ ] "Show advanced features" toggle in Settings overrides all tiers
- [ ] Hidden tools still work via keyboard shortcuts

---

### 3.2 Onboarding Adaptation (2 days)

#### New files
- `packages/editor/src/intelligence/onboardingAdapter.ts`
- `packages/editor/src/intelligence/onboardingAdapter.test.ts` — 8 tests

#### Decision tree (uses ActionTracker from Phase 0a)
```
1. Uses keyboard shortcuts in first minute? → YES: likely_pro, NO: continue
2. Opens existing file (not "New")? → YES: returning_user, NO: continue
3. Creates frame with children within 2 minutes? → YES: likely_intermediate, NO: continue
4. Average time between actions < 3 seconds? → YES: likely_pro, NO: continue
5. Uses color picker or typography controls? → YES: intermediate, NO: continue
6. Creates >3 nodes in first 5 minutes? → YES: intermediate, NO: likely_beginner
7. (safety net) → beginner
Output: beginner | intermediate | advanced
```

#### Files to modify
- `packages/editor/src/Shell.tsx` — onboarding flow reads skill classification

#### TDD test spec (8 tests)
1. First action is a keyboard shortcut → classified as likely_pro
2. Opens existing file → classified as returning_user
3. Creates frame with children in 90s → classified as likely_intermediate
4. Average action time < 3s → classified as likely_pro
5. Uses color picker → classified as intermediate
6. Creates >3 nodes in 5 min → classified as intermediate
7. No matching criteria → classified as beginner (safety net)
8. Classification override in Settings → "Experience level"

#### Acceptance criteria
- [ ] After 2 minutes of first session, skill level classified
- [ ] Beginner: full guided tour with tooltips, simplified UI (tier Essential)
- [ ] Intermediate: quick-start tips, tier Intermediate
- [ ] Advanced: skip onboarding, show "What's new" changelog
- [ ] Classification override in Settings

---

### 3.3 Adaptive Toolbar (2.5 days)

#### New files
- `packages/editor/src/intelligence/adaptiveUI.ts`
- `packages/editor/src/intelligence/adaptiveUI.test.ts` — 10 tests

#### Algorithm (recency-weighted frequency, validated by AIDE paper)
- `score(action) = sum(decay^i) for each use` where decay = 0.9
- Toolbar sorted by score descending
- Exploration: with small epsilon (~0.05), surface bottom-ranked tool with faint highlight
- Cold start: all actions start with same score (global prior)
- Epsilon decay: after 50 interactions, epsilon drops from 0.05 to ~0.02

#### Files to modify
- `packages/editor/src/components/FloatingToolbar/FloatingToolbar.tsx` — reorder items based on scores
- `packages/editor/src/Menubar.tsx` — most-used menu items get "starred" section
- `packages/editor/src/context.tsx` — `recordAction(actionId)` feeds into adaptiveUI (already wired in Phase 0a)

#### TDD test spec (10 tests)
1. Action A selected 10 times, Action B 3 times → A ranked above B
2. New action C never selected → ranked by global prior
3. Epsilon exploration: with epsilon=0.05, ~5% of suggestions are random exploration
4. Epsilon decay: after 50 interactions, epsilon drops from 0.05 to ~0.02
5. Cold start: all actions have equal score from global prior
6. localStorage persistence: scores survive page reload
7. Multi-device: each device has independent scores (localStorage scoped)
8. Toolbar reorder does not break roving tabindex
9. Exploration items visually distinct (subtle "new" dot)
10. User can reset adaptation (Settings → "Reset toolbar to defaults")

#### Acceptance criteria
- [ ] Toolbar items subtly reorder over time based on usage
- [ ] Exploration items shown with faint highlight (not jarring)
- [ ] Toggle in Settings: "Adaptive toolbar" (default: on)
- [ ] No layout shift during reorder (use CSS transition)
- [ ] aria-live silent (don't announce reorders)

**Gate:** `just gate` after Phase 3.

---

## Phase 4: Power-User Automation (6 days)

### 4.1 Smart Clipboard (2 days)

#### New files
- `packages/editor/src/intelligence/clipboardAdapter.ts`
- `packages/editor/src/intelligence/clipboardAdapter.test.ts` — 12 tests

#### Adaptation rules
| From MIME | Detected | Adaptation |
|-----------|----------|------------|
| `text/html` | Table (`<table>`) | Frame with grid children |
| `text/html` | Rich text | Strip tags, preserve bold/italic as TextNode properties |
| `text/csv` | CSV data | Auto-layout Frame with TextNode children |
| `text/plain` | Tab-separated | Same as CSV |
| `image/svg+xml` | SVG | Parse via existing `@varve/import` SVG parser |
| `image/png` | Small (<64px), low colors | "Trace to vector?" toast |
| `image/*` | Any image | Standard ImageNode paste |

#### Files to modify
- `packages/editor/src/clipboard.ts` — `readClipboard()` enhanced with content adaptation
- `packages/editor/src/context.tsx` — `paste()` routes through clipboardAdapter

#### TDD test spec (12 tests)
1. Paste text/html with `<table>` → creates Frame with grid children
2. Paste text/html with `<b>bold</b> and <i>italic</i>` → creates TextNode with fontWeight=bold and fontStyle=italic spans
3. Paste CSV "a,b,c\n1,2,3" → creates Frame with 2x3 grid of TextNodes
4. Paste tab-separated "a\tb\n1\t2" → same as CSV
5. Paste SVG string → delegates to SVG parser, returns SceneNode[]
6. Paste small PNG (32x32, 4 colors) → shows "Trace to vector?" toast, pastes as ImageNode if declined
7. Paste large PNG (1024x1024) → pastes as ImageNode directly (no trace offer)
8. Paste text/plain single line → creates TextNode with content
9. Paste application/vnd.strata+json → existing behavior preserved
10. Clipboard empty → returns null
11. Mixed clipboard (image + text) → prefers Strata format, falls back to image, then text
12. Unknown MIME type → returns null, no crash

#### Acceptance criteria
- [ ] Ctrl+V on HTML table → structured frame, not garbled text
- [ ] Ctrl+V on CSV data → grid layout, not one long text node
- [ ] "Trace to vector" toast is non-blocking, 5s timeout
- [ ] All format adaptations undoable as single operations

---

### 4.2 Shortcut Recommender (1.5 days)

#### New files
- `packages/editor/src/intelligence/shortcutRecommender.ts`
- `packages/editor/src/intelligence/shortcutRecommender.test.ts` — 8 tests
- `packages/editor/src/components/ShortcutToast.tsx`

#### Algorithm
- User clicks menu item 3+ times via mouse → toast: "Tip: Ctrl+G to group"
- Counter resets if user uses shortcut
- 5 dismissals → never shown again for that action
- 30-day rolling window (uses ActionTracker from Phase 0a)

#### Files to modify
- `packages/editor/src/Shell.tsx` — render `<ShortcutToast />`
- `packages/editor/src/shortcuts/ShortcutManager.ts` — expose SHORTCUT_DEFS keyed by action

#### TDD test spec (8 tests)
1. 3 mouse clicks on "Group" → triggers shortcut toast for Ctrl+G
2. User uses Ctrl+G → counter resets, no more toast for Group
3. 5 dismissals → toast never shown again for that action
4. 30-day window: old counts expire
5. Multiple actions with mouse usage → each tracked independently
6. Toast content includes shortcut key combo + action name
7. Reduced motion: no slide animation
8. Settings toggle: "Shortcut tips" (default: on)

#### Acceptance criteria
- [ ] Subtle toast at bottom-right after 3 mouse-only uses of shortcut-enabled action
- [ ] Shows shortcut key combo + action name
- [ ] Click toast → dismiss. "Don't show again" link
- [ ] Settings toggle: "Shortcut tips" (default: on)
- [ ] Toast respects reduced-motion (no slide animation)
- [ ] Toast accessible: aria-live, focusable, Esc to dismiss

---

### 4.3 Workflow Pattern Recognition (2.5 days)

#### New files
- `packages/editor/src/intelligence/workflowDetector.ts`
- `packages/editor/src/intelligence/workflowDetector.test.ts` — 12 tests
- `packages/editor/src/components/WorkflowSuggestion.tsx`

#### Algorithm
- Sliding window of size 4 over action sequence (from ActionTracker)
- Pattern detected when same window appears 3+ times
- Normalize parameters (different colors → same "set_color" action)
- Exclude undo/redo from pattern detection

#### Files to modify
- `packages/editor/src/context.tsx` — `recordAction()` feeds into workflowDetector
- `packages/editor/src/Shell.tsx` — render `<WorkflowSuggestion />`

#### TDD test spec (12 tests)
1. Sequence [create_rect, set_fill, create_text, set_font] x3 → pattern detected
2. Sequence appears 2 times only → not detected (threshold is 3)
3. Undo/redo in sequence → excluded from pattern
4. Same actions with different fill colors → normalized to same pattern
5. Pattern of length 3 → not detected (minimum window is 4)
6. Pattern of length 5 → detected (window captures first 4)
7. Two overlapping patterns → both detected
8. 100 actions in history → detection <10ms
9. Save workflow → stored in localStorage
10. Run workflow → replays actions with current parameters
11. Export workflows as JSON
12. Import workflows from JSON

#### Acceptance criteria
- [ ] After repeating 4-action sequence 3 times, toast: "Save as workflow?"
- [ ] Save → appears in QuickActionsBar (Ctrl+;) under "Workflows"
- [ ] Run via Ctrl+; or assigned shortcut
- [ ] Stored in localStorage, exportable/importable as JSON
- [ ] Settings: "Workflow suggestions" (default: on)

**Gate:** `just gate` after Phase 4.

---

## Phase 5: Deep Personalization & Codegen (7.5 days)

### 5.1 Design Fingerprint (3 days)

#### New files
- `packages/editor/src/intelligence/designProfile.ts`
- `packages/editor/src/intelligence/designProfile.test.ts` — 12 tests
- `packages/editor/src/intelligence/templateRecommender.ts`
- `packages/editor/src/intelligence/templateRecommender.test.ts` — 8 tests

#### Fingerprint vector (20 dimensions)
- 12 hue bins (OKLCH hue histogram across all fill colors in user's documents)
- 4 saturation bins
- 4 lightness bins
- Typography: top-5 font families by usage frequency
- Layout: mean spacing, flex ratio, grid ratio
- Components: top-8 most-used component types

#### Similarity: Weighted Jaccard (not cosine — handles sparsity better for design data)

#### Files to modify
- `packages/editor/src/context.tsx` — recompute fingerprint on document save (debounced 5s)

#### TDD test spec (12 tests — designProfile)
1. Empty profile (new user) → all dimensions 0
2. User creates 5 documents with blue-heavy palette → color histogram reflects blue dominance
3. User exclusively uses Inter font → typography vector shows Inter at 1.0
4. User A profile similar to Template X → X recommended
5. Profile updated on document save
6. Profile stored in localStorage (~500 bytes for 20 floats)
7. Fingerprint computation for 50 documents <100ms
8. User removes a document → profile recalculated
9. Two identical documents → fingerprint identical
10. Two completely different documents → similarity < 0.3
11. Template with no matching features → similarity 0, not recommended
12. Privacy: fingerprint cannot reconstruct original document data

#### TDD test spec (8 tests — templateRecommender)
1. Empty fingerprint → returns default templates
2. Fingerprint matching Template A → A in top 3
3. 10 templates → sorted by similarity descending
4. Template with no overlap → similarity 0, not in results
5. Top-N configurable (default 5)
6. Cold start: returns most popular templates
7. Fingerprint changes → recommendations update
8. "Not interested" on a template → excluded from future recommendations

#### Acceptance criteria
- [ ] Templates gallery sorts by "Recommended for you" based on fingerprint
- [ ] Home screen shows "Based on your style" template section
- [ ] Fingerprint recomputes on each document save (debounced)
- [ ] Settings: "Personalized recommendations" (default: on)
- [ ] All data stays on-device (localStorage, ~500 bytes)

---

### 5.2 Auto-Tween Timeline (1.5 days)

#### New files
- `packages/editor/src/intelligence/autoTween.ts`
- `packages/editor/src/intelligence/autoTween.test.ts` — 14 tests

#### Algorithm
1. Read selected track's keyframes, sorted by progress
2. For each consecutive pair, generate N intermediate keyframes at evenly-spaced progress values
3. Interpolate using `interpolateValue()` from `@varve/shared`
4. Apply track's default easing to each generated keyframe

#### Files to modify
- `packages/editor/src/timeline/TimelinePanel.tsx` — right-click "Auto-Tween Between Keyframes"

#### TDD test spec (14 tests)
1. Two keyframes at progress 0 and 1, value 0→100 → generates 3 intermediates at 0.25, 0.5, 0.75
2. Single keyframe → returns null (need 2+)
3. No keyframes → returns null
4. Color interpolation: #FF0000→#0000FF → intermediates are valid colors in sRGB space
5. Affine interpolation: identity→translate(100,0) → intermediates are valid affine matrices
6. Path interpolation: closed path A→closed path B → intermediates have same point count
7. Custom easing on source keyframe → used for generated intermediates
8. Generated keyframes use track's default easing when source has none
9. Spatial tangent interpolation for motion path keyframes
10. 5 existing keyframes + auto-tween generates 4x3 = 12 new keyframes → correct ordering
11. Auto-tween respects existing keyframes (doesn't overwrite)
12. Opacity interpolation: 0→1 → generated values in [0,1]
13. Multi-property track → interpolates each property independently
14. Undo removes all generated keyframes as one atomic operation

#### Acceptance criteria
- [ ] Select track, right-click → "Auto-Tween" in context menu
- [ ] Dialog: "Generate how many intermediates? [3]" with easing override
- [ ] Confirm → keyframes appear on timeline with easing curves
- [ ] Generated keyframes selected so user can adjust
- [ ] Single undo step
- [ ] Works for color, number, affine, path, and opacity tracks

---

### 5.3 Codegen Optimization (3 days)

#### New files
- `packages/codegen/src/optimizer.ts`
- `packages/codegen/src/optimizer.test.ts` — 12 tests

#### Algorithm
Rule-based AST rewriting. Each platform has ~20 optimization rules (pattern match → rewrite). Fallback path: if optimized output might be broken, emit verbose correct code.

| Platform | Example Rules |
|----------|--------------|
| React/Tailwind | `<div style="width:100%">` → `<div className="w-full">`; nested flexbox → Tailwind flex classes |
| Flutter | `Container(width: w, height: h, child: ...)` → `SizedBox(width: w, height: h, child: ...)` when no decoration |
| SwiftUI | `AnyView(Text(...))` → `some View { Text(...) }`; `VStack { ... }` with 1 child → unwrap |

#### Files to modify
- `packages/codegen/src/index.ts` — export `optimizeCode(code, platform, opts)`
- `packages/editor/src/components/Inspector/sections/ExportSection.tsx` — "Optimized output" toggle

#### TDD test spec (12 tests)
1. React: `<div style="width:100%;height:100%">` → `<div className="w-full h-full">`
2. React: Container with only padding → `className="p-4"` not inline style
3. Flutter: Container with width/height only → SizedBox
4. Flutter: Container with decoration → stays as Container
5. SwiftUI: AnyView wrapper → removed when possible
6. SwiftUI: VStack with 1 child → unwrapped
7. Fallback: complex nested transform → verbose correct code emitted
8. Fallback: gradient with non-standard angle → verbose code
9. Verbose mode toggle: same input → verbose output when toggle on
10. Same input always produces same output (deterministic)
11. 50-node component → optimization <50ms
12. Unknown platform → returns input unchanged

#### Acceptance criteria
- [ ] Export panel has "Optimized output" toggle (default: on)
- [ ] "Verbose mode" toggle shows unoptimized for comparison
- [ ] Optimized code is syntactically valid (verified by platform-specific parser if available)
- [ ] Every optimization has a fallback path
- [ ] Same input always produces same output

**Gate:** `just gate` after Phase 5.

---

## Phase 6: Wire AI Panel (2 days)

### 6.1 Replace mock chat() with real dispatch (1 day)

#### New files
- `packages/ai/src/intelligenceRegistry.ts`
- `packages/ai/src/intelligenceRegistry.test.ts` — 8 tests

#### API
```typescript
interface IntelligenceCommand {
  id: string;
  description: string;
  keywords: string[];
  handler: (args: { doc: Document; selectedNodes: SceneNode[] }) => IntelligenceResult;
  priority: number;
}

interface IntelligenceResult {
  content: string;
  actions?: { label: string; apply: () => void }[];
}

class IntelligenceRegistry {
  register(cmd: IntelligenceCommand): void;
  dispatch(message: string, context: { doc: Document; selectedNodes: SceneNode[] }): IntelligenceResult;
  listCommands(): IntelligenceCommand[];
}
```

#### Files to modify
- `packages/ai/src/index.ts` — replace `chat()` mock with `dispatchIntelligence()` that routes to registry
- `packages/editor/src/components/AIPanel.tsx` — pass document + selection context to dispatch

#### TDD test spec (8 tests)
1. Registry CRUD: register, list, unregister
2. Duplicate command ID → rejected
3. Fuzzy matching: "check contrast" matches command with keyword "contrast"
4. Priority ordering: higher priority command wins on keyword tie
5. Unrecognized message → returns "I can help with: ..." listing available commands
6. `chat()` still returns the same `AIMessage` shape (backward compat)
7. Empty registry → returns helpful default message
8. Multiple keyword matches → highest priority wins

#### Acceptance criteria
- [ ] Typing "check contrast" in AIPanel returns real WCAG analysis of selected node
- [ ] Typing "name layers" returns real naming suggestions for selected nodes
- [ ] Typing "scan debt" returns real design debt scan results
- [ ] Typing "harmonize spacing" returns spacing analysis
- [ ] Typing "quality score" returns current design quality score
- [ ] Typing unrecognized message returns helpful "I can help with: ..." listing

---

### 6.2 Wire QuickActions integration (1 day)

#### Files to modify
- `packages/editor/src/Shell.tsx` — add intelligence commands to QuickActionsBar

#### Acceptance criteria
- [ ] Ctrl+; shows intelligence commands (WCAG check, name layers, scan debt, harmonize spacing, quality score)
- [ ] Selecting a command dispatches to the same handler as the chat panel
- [ ] Results appear in AI panel

**Gate:** `just gate` after Phase 6.

---

## File Manifest

```
packages/shared/src/
├── colorMath.ts                          [Phase 0b — NEW]
└── colorMath.test.ts                     [Phase 0b — NEW]

packages/editor/src/intelligence/
├── actionTracker.ts                      [Phase 0a — NEW]
├── actionTracker.test.ts                 [Phase 0a — NEW]
├── autoNamer.ts                          [Phase 1 — NEW]
├── autoNamer.test.ts                     [Phase 1 — NEW]
├── imageFitAdvisor.ts                    [Phase 1 — NEW]
├── imageFitAdvisor.test.ts               [Phase 1 — NEW]
├── spacingHarmonizer.ts                  [Phase 1 — NEW]
├── spacingHarmonizer.test.ts             [Phase 1 — NEW]
├── wcagFix.ts                            [Phase 1 — NEW]
├── wcagFix.test.ts                       [Phase 1 — NEW]
├── paletteExtractor.ts                   [Phase 1 — NEW]
├── paletteExtractor.test.ts              [Phase 1 — NEW]
├── cognitiveLoad.ts                      [Phase 1 — NEW]
├── cognitiveLoad.test.ts                 [Phase 1 — NEW]
├── qualityScore.ts                       [Phase 2 — NEW]
├── qualityScore.test.ts                  [Phase 2 — NEW]
├── variantDetector.ts                    [Phase 2 — NEW]
├── variantDetector.test.ts               [Phase 2 — NEW]
├── debtScanner.ts                        [Phase 2 — NEW]
├── debtScanner.test.ts                   [Phase 2 — NEW]
├── complexityProgression.ts              [Phase 3 — NEW]
├── complexityProgression.test.ts         [Phase 3 — NEW]
├── onboardingAdapter.ts                  [Phase 3 — NEW]
├── onboardingAdapter.test.ts             [Phase 3 — NEW]
├── adaptiveUI.ts                         [Phase 3 — NEW]
├── adaptiveUI.test.ts                    [Phase 3 — NEW]
├── clipboardAdapter.ts                   [Phase 4 — NEW]
├── clipboardAdapter.test.ts              [Phase 4 — NEW]
├── shortcutRecommender.ts                [Phase 4 — NEW]
├── shortcutRecommender.test.ts           [Phase 4 — NEW]
├── workflowDetector.ts                   [Phase 4 — NEW]
├── workflowDetector.test.ts              [Phase 4 — NEW]
├── designProfile.ts                      [Phase 5 — NEW]
├── designProfile.test.ts                 [Phase 5 — NEW]
├── templateRecommender.ts                [Phase 5 — NEW]
├── templateRecommender.test.ts           [Phase 5 — NEW]
├── autoTween.ts                          [Phase 5 — NEW]
└── autoTween.test.ts                     [Phase 5 — NEW]

packages/codegen/src/
├── optimizer.ts                          [Phase 5 — NEW]
└── optimizer.test.ts                     [Phase 5 — NEW]

packages/ai/src/
├── intelligenceRegistry.ts               [Phase 6 — NEW]
└── intelligenceRegistry.test.ts          [Phase 6 — NEW]

packages/editor/src/components/
├── StatusBar/DebtBadge.tsx               [Phase 2 — NEW]
├── StatusBar/QualityScoreIndicator.tsx   [Phase 2 — NEW]
├── Inspector/sections/ContrastIndicator.tsx       [Phase 1 — NEW]
├── Inspector/sections/QualityScoreSection.tsx     [Phase 2 — NEW]
├── Inspector/sections/CognitiveLoadIndicator.tsx  [Phase 1 — NEW]
├── Inspector/DebtPanel.tsx               [Phase 2 — NEW]
├── Inspector/DebtPanel.test.tsx          [Phase 2 — NEW]
├── ShortcutToast.tsx                     [Phase 4 — NEW]
└── WorkflowSuggestion.tsx                [Phase 4 — NEW]
```

---

## Estimated Totals

| Metric | Count |
|---|---|
| Total features | 16 |
| New files | 36 source + 24 test |
| Estimated new tests | ~210 |
| Estimated total effort | ~38.5 days |
| LLM dependencies | 0 |
| API key requirements | 0 |
| Recurring costs | $0 |
| Max added bundle size | <50KB (no ML models, all heuristics/math) |
| All computation | Client-side only |

---

## Dependency Graph

```
Phase 0a: Action Recording Infrastructure (2 days)
  │  feeds: Adaptive UI, Shortcut Recommender, Workflow Detector, Onboarding Adapter, Complexity Progression
  ▼
Phase 0b: Foundation Math (1 day)
  │  feeds: WCAG Fix (contrast math), Quality Score (stats), Cognitive Load
  ▼
Phase 1: Layout & Color Intelligence (11 days)
  ├── Auto-Namer (2 days)        — no deps
  ├── Image Smart-Fit (0.5 day)  — no deps
  ├── Spacing Harmonizer (2 days) — needs Phase 0b (binnedMode)
  ├── WCAG Fix (3 days)          — needs Phase 0b (findAccessibleColor)
  ├── Palette Extraction (2 days) — no deps
  └── Cognitive Load (1.5 days)  — no deps
  ▼
Phase 2: Design System Intelligence (13 days)
  ├── Quality Score (4 days)     — needs Phase 0b (stats), Phase 1 (WCAG checks)
  ├── Variant Detector (4 days)  — no deps
  └── Debt Scanner (5 days)      — reuses governance.ts
  ▼
Phase 3: Personalization & Onboarding (6.5 days) — needs Phase 0a
  ├── Progressive Complexity (2 days) — needs Phase 0a
  ├── Onboarding Adaptation (2 days)  — needs Phase 0a
  └── Adaptive Toolbar (2.5 days)     — needs Phase 0a
  ▼
Phase 4: Power-User Automation (6 days)
  ├── Smart Clipboard (2 days)       — no deps
  ├── Shortcut Recommender (1.5 days) — needs Phase 0a
  └── Workflow Patterns (2.5 days)    — needs Phase 0a
  ▼
Phase 5: Deep Personalization & Codegen (7.5 days)
  ├── Design Fingerprint (3 days)     — no deps
  ├── Auto-Tween (1.5 days)           — no deps
  └── Codegen Optimization (3 days)   — no deps
  ▼
Phase 6: Wire AI Panel (2 days)
  ├── Intelligence Registry (1 day)   — needs Phase 1-2 features
  └── QuickActions Integration (1 day) — needs Phase 6.1
```

---

## Verification Protocol

After each phase completion:

```bash
pnpm format          # auto-format
pnpm typecheck       # 15/15 packages must pass
pnpm lint            # 0 new errors on new/modified files
pnpm test            # all tests pass (including new ones)
pnpm audit:tokens    # 93/93 WCAG-AA across 3 themes
pnpm audit:emoji     # zero violations
cargo test --workspace  # all Rust tests pass (if Rust files touched)
```

Run `just gate` after phases 0, 1, 2, 3, 4, 5, and 6 (cross-package boundaries).

---

## Key Implementation Rules (from AGENTS.md)

1. **No emoji** — SVG icons via Lucide `<Icon>` only
2. **No hardcoded color/space/type values** — trace to CSS custom properties
3. **TS strict, no `any`** — Biome enforces `noExplicitAny: error`
4. **Cross-platform** — if it works on macOS but not Linux, it's not done
5. **Each module cites its research basis** in a top-of-file comment
6. **TDD-first** — write tests before implementation
7. **All features are pure functions** in `packages/editor/src/intelligence/` namespace
8. **No external dependencies** — all algorithms are pure TS/math
9. **All features work offline** — no network calls
10. **All intelligence actions are single-undo-step reversible**

---

## Committed plan — use this document for implementation in a separate session.
