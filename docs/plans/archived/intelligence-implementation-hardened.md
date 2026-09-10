# Strata Intelligence — Hardened Implementation Plan

**Generated:** 2026-07-03 | **Methodology:** BMAD-lite + 6-Role Cascade Review + Adversarial Gimmick Check | **Scope:** 14 features, ~36.5 days

---

## Executive Summary

Strata Intelligence is a **14-feature, ~36.5-day implementation** of zero-LLM, zero-infra-cost, all-client-side intelligence features. Built on traditional ML (decision trees, cosine similarity, frequency analysis), heuristics (WCAG 2.1, gap detection, naming rules), and public APIs (Intl, Navigator).

**Thesis**: Design tools compete on workflow speed. Intelligence features that save 5-30 seconds per operation compound into hours saved per week. Strata's local-first architecture means these features work offline, with zero latency, and zero ongoing cost — a moat that cloud-LLM-based competitors (Figma AI, Canva Magic) cannot match.

**Investor narrative**: "Strata delivers professional design intelligence without cloud costs. Our local-first architecture enables real-time, privacy-preserving design analysis — WCAG compliance, design debt scanning, intelligent naming — that cloud tools must charge for or cannot offer offline."

---

## Pre-Flight Checklist (Before Any Feature Work)

- [ ] `pnpm typecheck` — 15/15 packages must pass (currently: 15/15)
- [ ] `pnpm test` — all existing tests pass
- [ ] `pnpm lint` — 0 new errors
- [ ] `pnpm audit:tokens` — 93/93 WCAG-AA
- [ ] `pnpm audit:emoji` — zero violations
- [ ] `cargo test --workspace` — all Rust tests pass

Run `just gate` after every completed phase. Do not proceed to next phase if gate fails.

---

## Features Cut or Merged (from original 27-feature plan)

| Original | Fate | Reason |
|----------|------|--------|
| S1 Layout Score | Merged into S7 | Commodity feature, better as debt dimension |
| S5 Export Advisor | Killed | Marginal user benefit — not worth N days |
| S9 Link Suggester | Killed | Prototype linking is intentional, not heuristic |
| S12 Cross-Doc Consistency | Blocked | Requires Platform content search (2-3 day prerequisite) |
| S13 ONNX Models | Killed | 5.5MB download, unproven marginal gain over heuristics |
| Gen#1 Smart Defaults | Already partial | Frame presets (Session 16) cover this |
| Gen#3 Health Monitor | Merged into S7 | Statistical extension of debt scanner |
| Gen#6 Predictive Prefetch | Killed | Invisible feature, zero user-facing value |
| Gen#7 Auto-Layout | Covered by existing | `computeFlexLayout.ts` already handles this |
| Gen#9 Timezone Collab | Already deferred | Needs CRDT/collaboration infrastructure |

---

## Dependency Graph

```
Phase 0a: Action Recording Infrastructure (2 days)
  │  feeds: Gen#2, Gen#8, Gen#10, Gen#13, Gen#14, S11
  ▼
Phase 0b: Foundation Math (1 day)
  │  feeds: S2 (contrast math), S7 (stats)
  ▼
Phase 1: Layout & Color Intelligence (9 days)
  ├── S3 Auto-Namer (2 days)  — no deps
  ├── S2 WCAG Fix (3 days)    — needs Phase 0b
  ├── S4 Spacing Harmonizer (2 days) — no deps
  └── S8 Image Smart-Fit (0.5 day) — no deps
  ▼
Phase 2: Design System Intelligence (9 days)
  ├── S6 Variant Detector (4 days) — no deps
  └── S7 Debt Scanner (5 days) — uses Phase 0a for UI
  ▼
Phase 3: Personalization & Onboarding (7 days) — parallel after Phase 2
  ├── Gen#10 Progressive Complexity (2 days) — needs Phase 0a
  ├── Gen#13 Onboarding Adaptation (2 days) — needs Phase 0a
  ├── Gen#2 Adaptive UI (2.5 days) — needs Phase 0a
  ▼
Phase 4: Power-User Automation (5 days) — parallel after Phase 3
  ├── Gen#5 Smart Clipboard (2 days) — no deps
  ├── Gen#8 Shortcut Recommender (1.5 days) — needs Phase 0a
  └── Gen#14 Workflow Patterns (2.5 days) — needs Phase 0a
  ▼
Phase 5: Personalization Deep (4.5 days) — parallel after Phase 3
  ├── S11 Design Fingerprint (3 days)
  └── S10 Auto-Tween Timeline (1.5 days)
```

---

## Phase 0a: Action Recording Infrastructure (Priority: CRITICAL — blocks 5 features)

### What
Add `recordAction(actionId)` to EditorContext. Hook into all interactive surfaces.

### New files
- `packages/editor/src/intelligence/actionTracker.ts`
- `packages/editor/src/intelligence/actionTracker.test.ts` — 6 tests

### Acceptance criteria
- [ ] Every tool selection records `tool:<toolId>` via `setTool`
- [ ] Every menu action records `menu:<actionId>`
- [ ] Every shortcut dispatch records `shortcut:<shortcutId>`
- [ ] Canvas gestures (create, move, resize, rotate) record appropriately
- [ ] Actions stored in localStorage with 30-day rolling window
- [ ] `recordAction` is debounced (deduplicate rapid same-action calls)
- [ ] No performance overhead (<0.1ms per call)
- [ ] Privacy: no action data ever leaves the device

### Implementation notes
- Use `useEffect` in Shell to subscribe to tool changes from context
- Instrument `handleAction` in Menubar.tsx
- Add call in `useShortcuts` dispatch path
- Store as `Record<actionId, { count: number, lastUsed: number }>` in localStorage

---

## Phase 0b: Foundation Math (Priority: CRITICAL — blocks S2)

### What
Add WCAG 2.1 contrast math + statistical helpers to `@varve/shared`.

### New files
- `packages/shared/src/color.ts` (extend existing or create)
- `packages/shared/src/color.test.ts` — 6 tests

### Functions to add (to existing `colorConversion.ts` or new file)
```
relativeLuminance(r: number, g: number, b: number): number
  - sRGB to linear (WCAG 2.1 formula)
  - Input: 0-255 uint8, output: 0-1

contrastRatio(l1: number, l2: number): number
  - WCAG 2.1 contrast ratio formula
  - (L1 + 0.05) / (L2 + 0.05)

findAccessibleColor(fg: ManagedColor, bg: ManagedColor, targetRatio: number): ManagedColor
  - Binary search in OKLCH lightness
  - Bounded by ΔEOK < 5 from original fg
  - Returns ManagedColor

mean(values: number[]): number
stddev(values: number[]): number
```

### Files to modify
- `packages/shared/src/index.ts` — export new functions

---

## Phase 1: Layout & Color Intelligence (Priority: HIGH)

### 1.1 S3 Content-Aware Layer Naming (2 days)

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

### 1.2 S8 Image Smart-Fit (0.5 day)

#### New files
- `packages/editor/src/intelligence/imageFitAdvisor.ts`
- `packages/editor/src/intelligence/imageFitAdvisor.test.ts` — 8 tests

#### Algorithm
```
1. Image 1000×500 in frame 500×500 → AR mismatch (image wider) → 'cover'
2. Image 500×1000 in frame 500×500 → AR mismatch (image taller) → 'contain'
3. Image 500×500 in frame 500×500 → near-perfect match → 'fill'
4. AR within 5% tolerance → 'fill'
5. Frame with existing imageFit → respect existing value (don't override)
6. Image dimensions unknown → default 'fill', re-evaluate on load
```

#### Files to modify
- `packages/editor/src/context.tsx` — `createShapeAt` calls `suggestFit()` when dropping image into frame
- `packages/editor/src/CanvasArea.tsx` — drag-drop handler calls advisor

#### Acceptance criteria
- [ ] Drop image into frame → auto-applies optimal imageFit
- [ ] Toast notification shows what was applied and why
- [ ] Undo reverses the fit setting
- [ ] Does not override if user manually set imageFit

---

### 1.3 S4 Smart Spacing Harmonizer (2 days)

#### New files
- `packages/editor/src/intelligence/spacingHarmonizer.ts`
- `packages/editor/src/intelligence/spacingHarmonizer.test.ts` — 10 tests

#### Algorithm
1. Get selected nodes' siblings (same parent)
2. Sort by position on dominant axis (horizontal if wider-than-tall bounding box)
3. Compute gaps between consecutive siblings' edges
4. If fewer than 2 gaps → return null (can't harmonize)
5. Compute median gap
6. Snap each sibling's position so gaps equal median

#### Files to modify
- `packages/editor/src/Menubar.tsx` — "Harmonize Spacing" in Arrange menu
- `packages/editor/src/shortcuts/ShortcutManager.ts` — `harmonizeSpacing: { binding: { key: 'h', ctrl: true, shift: true } }`
- `packages/editor/src/shortcuts/useShortcuts.ts` — handler
- `packages/editor/src/context.tsx` — `harmonizeSpacing()` method

#### Acceptance criteria
- [ ] Ctrl+Shift+H → gaps equalized to median among selected siblings
- [ ] Menu item in Arrange menu
- [ ] Single undo step
- [ ] aria-live: "Harmonized spacing: 4 gaps set to 8px"
- [ ] Non-intrusive toast when manual spacing creates inconsistency

---

### 1.4 S2 WCAG Color Auto-Fix (3 days)

#### New files
- `packages/editor/src/intelligence/wcagFix.ts`
- `packages/editor/src/intelligence/wcagFix.test.ts` — 12 tests
- `packages/editor/src/components/Inspector/sections/ContrastIndicator.tsx`

#### Algorithm
1. For each fill color on selected node, compute contrast ratio against background
2. Background = parent frame's fill (walk ancestors), or white if none
3. If ratio < 4.5:1 (AA) or < 3.0:1 (AA large text), mark FAIL
4. Auto-fix: binary search in OKLCH lightness toward black (if text) or white (if background)
5. Stop when ratio >= target, bound by ΔEOK < 5 from original
6. For transparent fills: warn "can't verify — depends on background"
7. For gradients: check worst-case color in stops
8. For multiple fills: check topmost visible fill

#### Files to modify
- `packages/editor/src/components/Inspector/sections/FillSection.tsx` — render `<ContrastIndicator />` next to swatches
- `packages/editor/src/components/Inspector/sections/TypographySection.tsx` — render for text color

#### Acceptance criteria
- [ ] Red/green dot next to each fill swatch showing pass/fail
- [ ] Click dot → "Auto-fix" button
- [ ] Auto-fix shifts color minimally to pass WCAG AA
- [ ] Toast: "Contrast improved from 3.2:1 to 4.6:1"
- [ ] Works for text fills, shape fills, stroke colors
- [ ] WCAG large text threshold (3.0:1) when applicable

---

## Phase 2: Design System Intelligence (Priority: HIGH)

### 2.1 S6 Component Variant Detector (4 days)

#### New files
- `packages/editor/src/intelligence/variantDetector.ts`
- `packages/editor/src/intelligence/variantDetector.test.ts` — 16 tests

#### Algorithm
1. Group selected frames by structural similarity (child count ±1, same child types in order)
2. For each group, collect all NodeBase property values (fills, strokes, effects, text, cornerRadius, layoutStyle, constraints, opacity, blendMode, rotation)
3. Properties identical across frames → candidate component defaults
4. Properties that differ → candidate variant properties
5. Auto-name variants: concatenate differing property value summaries
6. Generate preview table: rows = variants, columns = differing properties

#### Files to modify
- `packages/editor/src/Menubar.tsx` — "Detect Variants" in Object menu
- `packages/editor/src/components/Inspector/MultiSelectionPanel.tsx` — "Detect Variants" button

#### Acceptance criteria
- [ ] Select 3+ similar frames → "Detect Variants" appears
- [ ] Click → preview table with detected variant properties and per-frame values
- [ ] User can edit variant property names before confirming
- [ ] User can exclude properties from variant definition
- [ ] Confirm → creates component with variants, replaces selected frames with instances
- [ ] Single undo step
- [ ] aria-live: "Detected 3 variants with 2 properties: State, Size"

---

### 2.2 S7 Design Debt Scanner (5 days)

#### New files
- `packages/editor/src/intelligence/debtScanner.ts`
- `packages/editor/src/intelligence/debtScanner.test.ts` — 20 tests
- `packages/editor/src/components/Inspector/DebtPanel.tsx`
- `packages/editor/src/components/Inspector/DebtPanel.test.tsx` — 6 tests

#### Checks (15 total, each a named pure function)
1. `findHardcodedFills(doc)` — fills not linked to any style or variable
2. `findHardcodedStrokes(doc)` — strokes not linked to any style
3. `findHardcodedEffects(doc)` — effects not linked to any style
4. `findHardcodedText(doc)` — text properties not linked to any style
5. `findOrphanedStyles(doc)` — styles not referenced by any node (reuse existing `governance.ts`)
6. `findDuplicateStyles(doc)` — styles with identical properties, different names
7. `findUnusedComponents(doc)` — components defined but never instantiated (reuse `governance.ts`)
8. `findMissingAltText(doc)` — ImageNodes without descriptive names
9. `findOversizedAssets(doc)` — images > 2MB or dimensions > 2× display size
10. `findDeepNesting(doc)` — frame trees deeper than 6 levels
11. `findZeroSizeNodes(doc)` — nodes with w=0 or h=0
12. `findTextOverflow(doc)` — text where measured content exceeds bounding box
13. `findInconsistentNaming(doc)` — nodes violating naming conventions
14. `findUnusedVariables(doc)` — variables never referenced by any binding
15. `findDuplicateComponents(doc)` — components with identical property sets

#### Merged from S1: Layout quality scoring
- Node count anomaly (stddev from user baseline)
- Color palette shift detection
- Layer depth anomaly

#### Files to modify
- `packages/editor/src/components/Inspector/PropertiesPanel.tsx` — add `'debt'` to `type Tab`
- `packages/editor/src/StatusBar.tsx` — add `<DebtBadge />` showing issue count

#### Acceptance criteria
- [ ] Inspector "Debt" tab shows categorized issue list with counts
- [ ] StatusBar shows red badge: "12 issues"
- [ ] Issues grouped: error > warning > info
- [ ] Each issue has "Fix" or "Ignore" button
- [ ] Click issue → selects affected node(s) and scrolls layers panel
- [ ] "Scan on open" setting (default: on)
- [ ] Scanner runs on `requestIdleCallback` with 50ms budget per chunk
- [ ] 5000-node document → scan <200ms
- [ ] "Fix all for hardcoded fills" creates style and links all matching nodes

---

## Phase 3: Personalization & Onboarding (Priority: HIGH)

### 3.1 Gen#10 Progressive Complexity Disclosure (2 days)

#### New files
- `packages/editor/src/intelligence/complexityProgression.ts`
- `packages/editor/src/intelligence/complexityProgression.test.ts` — 9 tests

#### Tier system
| Tier | Unlock condition | Visible tools | Visible panels |
|---|---|---|---|
| Essential (0-2 sessions) | Default | Select, Frame, Rect, Text, Hand, Zoom | Layers, Properties |
| Intermediate (3-9 sessions) | 3 sessions OR used 50% of Essential | + Ellipse, Line, Pen, Image | + Export tab, Assets |
| Advanced (10+ sessions) | 10 sessions OR explicit opt-in | + Polygon, Star, Arrow, Pencil, Scale | + Spec, Prototype, Timeline, Variables |

#### Files to modify
- `packages/editor/src/Shell.tsx` — render fewer panels/tools for new users
- `packages/editor/src/components/FloatingToolbar/FloatingToolbar.tsx` — filter tools by tier
- `packages/editor/src/Menubar.tsx` — hide advanced menu items

#### Acceptance criteria
- [ ] New users see simplified toolbar (6 essential tools)
- [ ] Tools unlock progressively with usage
- [ ] "Show advanced features" toggle in Settings overrides all tiers
- [ ] Hidden tools still work via keyboard shortcuts

---

### 3.2 Gen#13 Onboarding Adaptation (2 days)

#### New files
- `packages/editor/src/intelligence/onboardingAdapter.ts`
- `packages/editor/src/intelligence/onboardingAdapter.test.ts` — 8 tests

#### Decision tree (8 nodes)
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

#### Acceptance criteria
- [ ] After 2 minutes of first session, skill level classified
- [ ] Beginner: full guided tour with tooltips, simplified UI (tier Essential)
- [ ] Intermediate: quick-start tips, tier Intermediate
- [ ] Advanced: skip onboarding, show "What's new" changelog
- [ ] Classification override in Settings → "Experience level"

---

### 3.3 Gen#2 Adaptive Toolbar (2.5 days)

#### New files
- `packages/editor/src/intelligence/adaptiveUI.ts`
- `packages/editor/src/intelligence/adaptiveUI.test.ts` — 10 tests

#### Algorithm
- Recency-weighted frequency (β=0.9 decay)
- `score(action) = sum(decay^i) for each use`
- Toolbar sorted by score descending
- Exploration: with small ε (~0.05), surface bottom-ranked tool with faint highlight
- Cold start: all actions start with same score

#### Files to modify
- `packages/editor/src/components/FloatingToolbar/FloatingToolbar.tsx` — reorder items based on scores
- `packages/editor/src/Menubar.tsx` — most-used menu items get "starred" section
- `packages/editor/src/context.tsx` — `recordAction(actionId)` on every tool/menu/shortcut use

#### Acceptance criteria
- [ ] Toolbar items subtly reorder over time based on usage
- [ ] Exploration items shown with faint highlight
- [ ] Toggle in Settings: "Adaptive toolbar" (default: on)
- [ ] No layout shift during reorder (CSS transition)
- [ ] aria-live silent
- [ ] User can reset adaptation (Settings → "Reset toolbar to defaults")

---

## Phase 4: Power-User Automation (Priority: MEDIUM)

### 4.1 Gen#5 Smart Clipboard (2 days)

#### New files
- `packages/editor/src/intelligence/clipboardAdapter.ts`
- `packages/editor/src/intelligence/clipboardAdapter.test.ts` — 12 tests

#### Adaptation rules
| From MIME | Detected | Adaptation |
|---|---|---|
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

#### Acceptance criteria
- [ ] Ctrl+V on HTML table → structured frame, not garbled text
- [ ] Ctrl+V on CSV data → grid layout, not one long text node
- [ ] "Trace to vector" toast is non-blocking, 5s timeout
- [ ] All format adaptations undoable as single operations

---

### 4.2 Gen#8 Shortcut Recommender (1.5 days)

#### New files
- `packages/editor/src/intelligence/shortcutRecommender.ts`
- `packages/editor/src/intelligence/shortcutRecommender.test.ts` — 8 tests
- `packages/editor/src/components/ShortcutToast.tsx`

#### Algorithm
- User clicks menu item 3+ times via mouse → toast: "Tip: Ctrl+G to group"
- Counter resets if user uses shortcut
- 5 dismissals → never shown again for that action
- 30-day rolling window

#### Files to modify
- `packages/editor/src/Shell.tsx` — render `<ShortcutToast />`
- `packages/editor/src/shortcuts/ShortcutManager.ts` — expose SHORTCUT_DEFS keyed by action

#### Acceptance criteria
- [ ] Subtle toast at bottom-right after 3 mouse-only uses of shortcut-enabled action
- [ ] Shows shortcut key combo + action name
- [ ] Click toast → dismiss. "Don't show again" link
- [ ] Settings toggle: "Shortcut tips" (default: on)
- [ ] Toast respects reduced-motion (no slide animation)
- [ ] Toast accessible: aria-live, focusable, Esc to dismiss

---

### 4.3 Gen#14 Workflow Pattern Recognition (2.5 days)

#### New files
- `packages/editor/src/intelligence/workflowDetector.ts`
- `packages/editor/src/intelligence/workflowDetector.test.ts` — 12 tests
- `packages/editor/src/components/WorkflowSuggestion.tsx`

#### Algorithm
- Sliding window of size 4 over action sequence
- Pattern detected when same window appears 3+ times
- Normalize parameters (different colors → same "set_color" action)
- Exclude undo/redo from pattern detection

#### Files to modify
- `packages/editor/src/context.tsx` — `recordAction()` feeds into workflowDetector
- `packages/editor/src/Shell.tsx` — render `<WorkflowSuggestion />`

#### Acceptance criteria
- [ ] After repeating 4-action sequence 3 times, toast: "Save as workflow?"
- [ ] Save → appears in QuickActionsBar (Ctrl+;) under "Workflows"
- [ ] Run via Ctrl+; or assigned shortcut
- [ ] Stored in localStorage, exportable/importable as JSON
- [ ] Settings: "Workflow suggestions" (default: on)

---

## Phase 5: Deep Personalization (Priority: MEDIUM)

### 5.1 S11 Design Fingerprint (3 days)

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

#### Similarity: Weighted Jaccard (not cosine — handles sparsity better)

#### Files to modify
- `packages/editor/src/context.tsx` — recompute fingerprint on document save (debounced 5s)

#### Acceptance criteria
- [ ] Templates gallery sorts by "Recommended for you"
- [ ] Home screen shows "Based on your style" template section
- [ ] Fingerprint recomputes on each document save (debounced)
- [ ] Settings: "Personalized recommendations" (default: on)
- [ ] All data stays on-device (localStorage, ~500 bytes per user)

---

### 5.2 S10 Auto-Tween Timeline (1.5 days)

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

#### Acceptance criteria
- [ ] Select track, right-click → "Auto-Tween" in context menu
- [ ] Dialog: "Generate how many intermediates? [3]" with easing override
- [ ] Confirm → keyframes appear on timeline with easing curves
- [ ] Generated keyframes selected so user can adjust
- [ ] Single undo step
- [ ] Works for color, number, affine, path, and opacity tracks

---

## File Manifest

```
packages/shared/src/
├── color.ts                          [Phase 0b — NEW, or extend existing]
└── color.test.ts                     [Phase 0b — NEW]

packages/editor/src/intelligence/
├── actionTracker.ts                  [Phase 0a — NEW]
├── actionTracker.test.ts             [Phase 0a — NEW]
├── autoNamer.ts                      [Phase 1 — NEW]
├── autoNamer.test.ts                 [Phase 1 — NEW]
├── wcagFix.ts                        [Phase 1 — NEW]
├── wcagFix.test.ts                   [Phase 1 — NEW]
├── spacingHarmonizer.ts              [Phase 1 — NEW]
├── spacingHarmonizer.test.ts         [Phase 1 — NEW]
├── imageFitAdvisor.ts                [Phase 1 — NEW]
├── imageFitAdvisor.test.ts           [Phase 1 — NEW]
├── variantDetector.ts                [Phase 2 — NEW]
├── variantDetector.test.ts           [Phase 2 — NEW]
├── debtScanner.ts                    [Phase 2 — NEW]
├── debtScanner.test.ts               [Phase 2 — NEW]
├── designProfile.ts                  [Phase 5 — NEW]
├── designProfile.test.ts             [Phase 5 — NEW]
├── templateRecommender.ts            [Phase 5 — NEW]
├── templateRecommender.test.ts       [Phase 5 — NEW]
├── clipboardAdapter.ts               [Phase 4 — NEW]
├── clipboardAdapter.test.ts          [Phase 4 — NEW]
├── adaptiveUI.ts                     [Phase 3 — NEW]
├── adaptiveUI.test.ts                [Phase 3 — NEW]
├── shortcutRecommender.ts            [Phase 4 — NEW]
├── shortcutRecommender.test.ts       [Phase 4 — NEW]
├── complexityProgression.ts          [Phase 3 — NEW]
├── complexityProgression.test.ts     [Phase 3 — NEW]
├── onboardingAdapter.ts              [Phase 3 — NEW]
├── onboardingAdapter.test.ts         [Phase 3 — NEW]
├── workflowDetector.ts               [Phase 4 — NEW]
├── workflowDetector.test.ts          [Phase 4 — NEW]
└── autoTween.ts                      [Phase 5 — NEW]
└── autoTween.test.ts                 [Phase 5 — NEW]

packages/editor/src/components/
├── StatusBar/DebtBadge.tsx                           [Phase 2 — NEW]
├── Inspector/sections/ContrastIndicator.tsx          [Phase 1 — NEW]
├── Inspector/DebtPanel.tsx                           [Phase 2 — NEW]
├── Inspector/DebtPanel.test.tsx                      [Phase 2 — NEW]
├── ShortcutToast.tsx                                 [Phase 4 — NEW]
└── WorkflowSuggestion.tsx                            [Phase 4 — NEW]
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

Run `just gate` after phases 0a, 1, 2, and 3 (cross-package boundaries).

---

## Estimated Totals

| Metric | Count |
|---|---|
| Total features | 14 |
| New files | 28 source + 21 test |
| Estimated new tests | ~182 |
| Estimated total effort | ~36.5 days |
| LLM dependencies | 0 |
| API key requirements | 0 |
| Recurring costs | $0 |
| Max added bundle size | 0 (no ML models, all heuristics/math) |
| All computation | Client-side only |

---

## Committed plan — use this document for implementation in a separate session.
