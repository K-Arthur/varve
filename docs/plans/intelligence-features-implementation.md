# Strata Intelligence Features — Implementation Plan

**Date:** 2026-07-03 | **Scope:** 27 features across 8 phases | **Constraint:** Zero LLM, zero API keys, zero recurring cost, all client-side

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

## Phase 0: Wire the Existing AI Scaffold (Priority: CRITICAL, Effort: 3 days)

**Goal:** The `@varve/ai` package and `AIPanel.tsx` already exist with mock responses. Replace mocks with real intelligence dispatch that calls Phase 1-3 modules. This makes the chat panel actually useful immediately.

### 0.1 Replace mock chat() with real dispatch

**Files to modify:**
- `packages/ai/src/index.ts` — replace `chat()` mock (lines 5-8 keyword-matching) with a `dispatchIntelligence(message: string): AIMessage` that routes to real handlers
- `packages/ai/src/intelligenceRegistry.ts` — **NEW FILE** — registry of all intelligence commands with metadata

**Test files:**
- `packages/ai/src/intelligenceRegistry.test.ts` — **NEW** — 8 tests: registry CRUD, duplicate command rejection, fuzzy matching, priority ordering

**Acceptance criteria:**
- [ ] Typing "check contrast" in AIPanel returns real WCAG analysis of selected node
- [ ] Typing "name layers" returns real naming suggestions for selected nodes
- [ ] Typing "scan debt" returns real design debt scan results
- [ ] Typing unrecognized message returns helpful "I can help with: ..." listing available commands
- [ ] `chat()` still returns the same `AIMessage` shape (backward compat)

**Dependencies:** Phase 1 features must exist before their commands can be registered.

### 0.2 Wire QuickActions integration

**Files to modify:**
- `packages/editor/src/Shell.tsx:363-373` — add intelligence commands to QuickActionsBar

**Acceptance criteria:**
- [ ] Ctrl+; shows intelligence commands (WCAG check, name layers, scan debt, harmonize spacing)
- [ ] Selecting a command dispatches to the same handler as the chat panel

---

## Phase 1: Layout & Color Intelligence (Priority: HIGH, Effort: 5 days)

**Features:** S1 Layout Quality Score, S2 WCAG Color Auto-Fix, S4 Smart Spacing Harmonizer, S5 Export Format Intelligence, S8 Image Smart-Fit

### 1.1 Layout Quality Score (S1)

**New files:**
- `packages/editor/src/intelligence/layoutScore.ts` — scoring engine
- `packages/editor/src/intelligence/layoutScore.test.ts` — 15 tests
- `packages/editor/src/components/StatusBar/LayoutScoreIndicator.tsx` — StatusBar badge
- `packages/editor/src/components/StatusBar/LayoutScoreIndicator.test.tsx` — 4 tests
- `packages/editor/src/components/Inspector/sections/LayoutScoreSection.tsx` — detail panel in inspector

**Files to modify:**
- `packages/editor/src/StatusBar.tsx:140-141` — insert `<LayoutScoreIndicator />` between cursor coords and unit selector
- `packages/editor/src/components/Inspector/PropertiesPanel.tsx:38-113` — add `'score'` to `type Tab`

**TDD test spec (write tests FIRST, then implement):**
1. Single node selected → score 100, no issues
2. Two misaligned nodes (x=0, x=7) → score < 80, issue "2 nodes off 8px grid"
3. Three evenly-spaced siblings (gaps: 8, 8) → score 100, no spacing issue
4. Three unevenly-spaced siblings (gaps: 8, 3, 12) → score < 80, issue "inconsistent spacing (stddev 4.5px)"
5. Two overlapping non-sibling non-masked nodes → issue flagged
6. Masked node overlapping its masker → no false positive
7. Frame nested 7 levels deep → issue flagged
8. Empty container → score 100
9. Locked/hidden nodes excluded from analysis
10. 100-node selection → computation <5ms
11. Score updates when node position changes
12. Multi-selection: worst score among all selected
13. Size harmony: 3 children with matching widths → no issue
14. Size harmony: 3 children with different widths → issue if stddev > 5px
15. Degenerate case: selection with mixed kinds (frame + text + image) → handles gracefully

**Acceptance criteria:**
- [ ] StatusBar shows a colored badge: green (90+), amber (70-89), red (<70)
- [ ] Click badge opens inspector to score tab with categorized issue list
- [ ] Each issue shows: description + "Fix" button (where applicable)
- [ ] Issues update in real-time as nodes are moved
- [ ] Score computation runs in `requestIdleCallback`, never blocks UI

### 1.2 WCAG Color Auto-Fix (S2)

**New files:**
- `packages/editor/src/intelligence/wcagFix.ts` — contrast checker + auto-fix
- `packages/editor/src/intelligence/wcagFix.test.ts` — 12 tests
- `packages/editor/src/components/Inspector/sections/ContrastIndicator.tsx` — small indicator chip

**Files to modify:**
- `packages/editor/src/components/Inspector/sections/FillSection.tsx` — render `<ContrastIndicator />` next to fill color swatches
- `packages/editor/src/components/Inspector/sections/TypographySection.tsx` — render for text color

**TDD test spec:**
1. White text (#FFFFFF) on white background → contrast 1.0:1, FAILS AA (4.5:1)
2. Black text (#000000) on white background → contrast 21.0:1, PASSES AA
3. Gray text (#767676) on white → contrast 4.54:1, PASSES (borderline)
4. Gray text (#777777) on white → contrast 4.48:1, FAILS (just below threshold)
5. Large text (≥18px bold or ≥24px) on gray → passes at 3.0:1 threshold
6. Auto-fix: input FAILING color → output color has ratio ≥ 4.5:1
7. Auto-fix: output color ΔEOK < 5.0 from input (perceptual proximity)
8. Auto-fix: input color already passes → returns unchanged
9. Auto-fix: #FF0000 on #FFFFFF (ratio 4.0) → darkens red, ratio ≥ 4.5
10. Handle transparent fills: warn "contrast depends on background — can't verify"
11. Gradient fills: check worst-case color in gradient stops
12. Multiple fills: check topmost visible fill

**Acceptance criteria:**
- [ ] Red/green dot next to each fill swatch showing pass/fail
- [ ] Click dot → "Auto-fix" button appears
- [ ] Auto-fix shifts color minimally to pass WCAG AA
- [ ] Toast: "Contrast improved from 3.2:1 to 4.6:1"
- [ ] Works for text fills, shape fills, stroke colors

### 1.3 Smart Spacing Harmonizer (S4)

**New files:**
- `packages/editor/src/intelligence/spacingHarmonizer.ts`
- `packages/editor/src/intelligence/spacingHarmonizer.test.ts` — 10 tests

**Files to modify:**
- `packages/editor/src/Menubar.tsx:130-160` — add "Harmonize Spacing" to Arrange menu + `handleAction` case
- `packages/editor/src/shortcuts/ShortcutManager.ts:SHORTCUT_DEFS` — add `harmonizeSpacing: { binding: { key: 'h', ctrl: true, shift: true }, label: 'Harmonize Spacing', category: 'Arrange' }`
- `packages/editor/src/shortcuts/useShortcuts.ts` — add handler case
- `packages/editor/src/context.tsx:224-605` — add `harmonizeSpacing()` method to `EditorContextValue`

**TDD test spec:**
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

**Acceptance criteria:**
- [ ] Select 3+ siblings, press Ctrl+Shift+H → gaps equalized to median
- [ ] Menu item "Harmonize Spacing" appears in Arrange menu
- [ ] Operation is a single undo step
- [ ] aria-live announces: "Harmonized spacing: 4 gaps set to 8px"
- [ ] Non-intrusive toast when manual spacing creates inconsistency (debounced, 2s delay)

### 1.4 Export Format Intelligence (S5)

**New files:**
- `packages/editor/src/intelligence/exportAdvisor.ts`
- `packages/editor/src/intelligence/exportAdvisor.test.ts` — 10 tests

**Files to modify:**
- `packages/editor/src/components/Inspector/PropertiesPanel.tsx` — export tab now calls `exportAdvisor.suggest(node)` for pre-filled defaults

**TDD test spec:**
1. Closed path node → suggests SVG
2. JPEG image node (src ends .jpg) → suggests JPEG 85%
3. PNG image with transparency → suggests PNG
4. Frame with only vector children → suggests SVG
5. Frame with mixed vector+image children → suggests PNG @2x
6. Large node (w > 2000) → suggests JPEG 80%
7. Text node → suggests SVG (outline text)
8. Node with existing export presets → uses user's last-manually-set format
9. Group containing only path children → suggests SVG
10. Node with no discernible content → suggests PNG (safe default)

**Acceptance criteria:**
- [ ] Export tab pre-fills Format, Scale, and Suffix when a node is selected
- [ ] Shows a small "Why?" tooltip explaining the suggestion
- [ ] User can override (intelligence is advisory, not enforced)
- [ ] Remembers per-user overrides (localStorage, keyed by node-type + format)

### 1.5 Image Smart-Fit (S8)

**New files:**
- `packages/editor/src/intelligence/imageFitAdvisor.ts`
- `packages/editor/src/intelligence/imageFitAdvisor.test.ts` — 8 tests

**Files to modify:**
- `packages/editor/src/context.tsx:1249` — `createShapeAt` calls `imageFitAdvisor.suggestFit()` when dropping an image into a frame
- `packages/editor/src/CanvasArea.tsx` — drag-drop handler in canvas component

**TDD test spec:**
1. Image 1000×500 in frame 500×500 → AR mismatch (image wider), suggests 'cover'
2. Image 500×1000 in frame 500×500 → AR mismatch (image taller), suggests 'contain'
3. Image 500×500 in frame 500×500 → near-perfect match, suggests 'fill'
4. Image with transparency in path shape → suggests 'crop' (mask)
5. Frame with existing `imageFit` set → respects existing value (don't override)
6. Image dimensions unknown (not yet loaded) → defaults to 'fill', re-evaluates on load
7. Aspect ratio within 5% tolerance → suggests 'fill'
8. Multiple images dropped → each gets individual fit suggestion

**Acceptance criteria:**
- [ ] Drop image into frame → auto-applies optimal imageFit
- [ ] Toast notification shows what was applied and why
- [ ] Undo reverses the fit setting
- [ ] Does not override if user has manually set imageFit previously

---

## Phase 2: Naming & Semantic Intelligence (Priority: HIGH, Effort: 5 days)

**Features:** S3 Content-Aware Layer Naming, Generic #5 Smart Clipboard, Generic #12 Semantic Version Diff

### 2.1 Content-Aware Layer Naming (S3)

**New files:**
- `packages/editor/src/intelligence/autoNamer.ts` — decision tree classifier
- `packages/editor/src/intelligence/autoNamer.test.ts` — 14 tests

**Files to modify:**
- `packages/editor/src/components/Inspector/sections/PositionSizeSection.tsx` — name input shows autocomplete suggestions from autoNamer
- `packages/editor/src/components/LayersPanel/LayersRow.tsx` — inline rename uses autoNamer suggestions
- `packages/editor/src/context.tsx:1249,1330` — `createShapeAt` and `createTextNodeAt` call autoNamer to set initial name

**Decision tree rules (ordered, first match wins):**
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

**TDD test spec:**
1. Text node "Submit" → "Button: Submit"
2. Text node fontSize=32, textAlign=center, "Welcome to Strata" → "Heading: Welcome to Strata"
3. Text node fontSize=14, "Some short label" → "Text: Some short label"
4. Frame with componentId set → "MyComponent instance"
5. Frame with variant set → "MyComponent / hover"
6. Frame with layoutStyle set → "Auto-layout frame"
7. Frame with 3+ children, no component → "Section"
8. Image node with src "photo-2024.jpg" → "Image: photo-2024"
9. Rect node w=20, h=20 → "Icon placeholder"
10. Rect node w=200, h=80 → "Rectangle"
11. Path node → "Vector shape"
12. Group with 5 children → "Group (5)"
13. Ellipse → "Ellipse"
14. Node with user-set custom name not matching any heuristic → preserve existing name

**Acceptance criteria:**
- [ ] New nodes get auto-names instead of "Rectangle 1", "Text 1"
- [ ] Auto-name counter still works (e.g., "Button: Submit 2" if "Button: Submit 1" exists)
- [ ] Rename field shows auto-suggestion as ghost text
- [ ] User can override at any time (last-set name sticks)
- [ ] `renameNode` with empty string resets to auto-name

### 2.2 Smart Clipboard Adaptation (Generic #5)

**New files:**
- `packages/editor/src/intelligence/clipboardAdapter.ts` — format detection + adaptation rules
- `packages/editor/src/intelligence/clipboardAdapter.test.ts` — 12 tests

**Files to modify:**
- `packages/editor/src/clipboard.ts:42-59` — `readClipboard()` enhanced with content adaptation
- `packages/editor/src/context.tsx:466` — `paste()` handler routes through clipboardAdapter

**Adaptation rules:**
| From MIME | Detected content | Adaptation |
|---|---|---|
| `text/html` | Table (`<table>`) | Convert to Frame with grid children |
| `text/html` | Rich text | Strip tags, preserve bold/italic as TextNode properties |
| `text/csv` | CSV data | Convert to Auto-layout Frame with TextNode children |
| `text/plain` | Tab-separated values | Same as CSV |
| `image/svg+xml` | SVG content | Parse via existing `@varve/import` SVG parser |
| `image/png` | Small (<64px), low color count | Offer "Trace to vector?" toast |
| `image/*` | Any image | Standard ImageNode paste (already exists) |

**TDD test spec:**
1. Paste text/html with `<table>` → creates Frame with grid children
2. Paste text/html with `<b>bold</b> and <i>italic</i>` → creates TextNode with fontWeight=bold and fontStyle=italic spans
3. Paste CSV "a,b,c\n1,2,3" → creates Frame with 2×3 grid of TextNodes
4. Paste tab-separated "a\tb\n1\t2" → same as CSV
5. Paste SVG string → delegates to @varve/import SVG parser, returns SceneNode[]
6. Paste small PNG (32×32, 4 colors) → shows "Trace to vector?" toast, pastes as ImageNode if declined
7. Paste large PNG (1024×1024) → pastes as ImageNode directly (no trace offer)
8. Paste text/plain single line → creates TextNode with content
9. Paste application/vnd.strata+json → existing behavior preserved
10. Clipboard empty → returns null
11. Mixed clipboard (image + text) → prefers Strata format, falls back to image, then text
12. Unknown MIME type → returns null, no crash

**Acceptance criteria:**
- [ ] Ctrl+V on HTML table → structured frame, not garbled text
- [ ] Ctrl+V on CSV data → grid layout, not one long text node
- [ ] "Trace to vector" toast is non-blocking, has 5s timeout
- [ ] All format adaptations are undoable as single operations

### 2.3 Semantic Version Diff (Generic #12)

**New files:**
- `packages/editor/src/intelligence/semanticDiff.ts` — diff engine
- `packages/editor/src/intelligence/semanticDiff.test.ts` — 14 tests

**Files to modify:**
- `packages/editor/src/components/VersionHistory/VersionHistory.tsx` — add "Compare" button between versions that renders diff view

**Diff categories:**
1. **Property changes:** color, size, text, font, opacity, effects (grouped by type)
2. **Structural changes:** added nodes, removed nodes, reparented, reordered
3. **Semantic changes:** component swap, variant change, style link/unlink, instance detach

**TDD test spec:**
1. Two identical documents → empty diff
2. Node A color changed from red to blue → "Color: #FF0000 → #0000FF"
3. Node B font size changed from 16 to 20 → "Font size: 16 → 20"
4. Node C added (not in old doc) → "Added: Rectangle (n42)"
5. Node D removed (not in new doc) → "Removed: Text (n17)"
6. Node E reparented from frame F1 to F2 → "Reparented: n23 → n45"
7. Node F opacity changed + position changed → grouped as "3 properties changed"
8. Component instance variant changed → "Variant: default → hover"
9. Style unlinked → "Unlinked from style 'Primary Blue'"
10. Instance detached → "Detached from component 'Button'"
11. 5000-node documents → diff <200ms
12. Node with no changes → excluded from diff summary
13. Diff summary output format matches expected JSON schema
14. Nodes matched by stable ID (not position) across versions

**Acceptance criteria:**
- [ ] Version history panel shows "Compare" button next to each version entry
- [ ] Click compare → side-by-side or stacked diff view
- [ ] Changes grouped by category with counts: "3 property changes, 1 added, 0 removed"
- [ ] Click a change → highlight affected node on canvas + scroll layers panel to it
- [ ] Visual overlay: old state shown in red outline, new state in green

---

## Phase 3: Design System Intelligence (Priority: HIGH, Effort: 7 days)

**Features:** S6 Component Variant Detector, S7 Design Debt Scanner, S12 Cross-Document Style Consistency

### 3.1 Component Variant Detector (S6)

**New files:**
- `packages/editor/src/intelligence/variantDetector.ts`
- `packages/editor/src/intelligence/variantDetector.test.ts` — 16 tests

**Files to modify:**
- `packages/editor/src/Menubar.tsx` — Object menu: "Detect Variants"
- `packages/editor/src/components/Inspector/MultiSelectionPanel.tsx` — "Detect Variants" button when N frames selected
- `packages/editor/src/components/Inspector/PropertiesPanel.tsx` — new `VariantDetectionResult` panel (shown temporarily after detection)

**Algorithm steps:**
1. Group selected frames by structural similarity (same child count ±1, same child types in order)
2. For each group, collect all `NodeBase` property values (fills, strokes, effects, text, cornerRadius, layoutStyle, constraints, opacity, blendMode, rotation)
3. Properties identical across all frames → candidate component defaults
4. Properties that differ → candidate variant properties
5. Auto-name variants: concatenate differing property names (e.g., "State=default, hover, disabled")
6. Generate a preview table: rows = variants, columns = differing properties

**TDD test spec:**
1. 3 identical frames with different fill colors → 1 variant property "fill", 3 variants
2. 3 frames with different text AND different fills → 2 variant properties
3. 2 frames → detects variants but warns "2 frames minimum for meaningful variants"
4. 1 frame → returns null, "need 2+ similar frames"
5. Frames with different child counts (>1 difference) → grouped separately, not as variants
6. Frames with different child types → not grouped as same component
7. Mixed selection (frames + shapes) → only frames considered
8. Frames with component instances inside → instances preserved in variants
9. Frames with auto-layout → layoutStyle becomes a variant property if it differs
10. Frames with text content → text becomes variant property if it differs
11. 10 identical frames with minor differences → correct property isolation
12. Frames with rotation differences → rotation detected as variant property
13. Frames with different visibility of children → visibility becomes variant property
14. Frames with different effects → effects detected as variant property
15. Frames with identical everything → warns "no differences detected, not meaningful as variants"
16. Variant names auto-generated from differing property values

**Acceptance criteria:**
- [ ] Select 3+ similar frames → "Detect Variants" appears in Object menu and multi-select panel
- [ ] Click → preview table shows detected variant properties with per-frame values
- [ ] User can edit variant property names before confirming
- [ ] User can exclude properties from variant definition
- [ ] Confirm → creates component with variants, replaces selected frames with instances
- [ ] Operation is undoable
- [ ] aria-live: "Detected 3 variants with 2 properties: State, Size"

### 3.2 Design Debt Scanner (S7)

**New files:**
- `packages/editor/src/intelligence/debtScanner.ts`
- `packages/editor/src/intelligence/debtScanner.test.ts` — 20 tests
- `packages/editor/src/components/Inspector/DebtPanel.tsx` — new inspector tab content
- `packages/editor/src/components/Inspector/DebtPanel.test.tsx` — 6 tests

**Files to modify:**
- `packages/editor/src/components/Inspector/PropertiesPanel.tsx:38` — add `'debt'` to `type Tab`
- `packages/editor/src/StatusBar.tsx:140-141` — add `<DebtBadge />` showing issue count

**Checks (each is a named, testable function):**
1. `findHardcodedFills(doc)` — fills not linked to any style or variable
2. `findHardcodedStrokes(doc)` — strokes not linked to any style
3. `findHardcodedEffects(doc)` — effects not linked to any style
4. `findHardcodedText(doc)` — text properties not linked to any style (fontSize, fontFamily, fontWeight)
5. `findOrphanedStyles(doc)` — styles in doc.styles not referenced by any node (reuse existing governance.ts)
6. `findDuplicateStyles(doc)` — styles with identical properties but different names
7. `findUnusedComponents(doc)` — components defined but never instantiated (reuse existing governance.ts)
8. `findMissingAltText(doc)` — image nodes without descriptive names
9. `findOversizedAssets(doc)` — images > 2MB or dimensions > 2× display size
10. `findDeepNesting(doc)` — frame trees deeper than 6 levels
11. `findZeroSizeNodes(doc)` — nodes with w=0 or h=0
12. `findTextOverflow(doc)` — text where measured content exceeds bounding box
13. `findInconsistentNaming(doc)` — nodes violating naming conventions
14. `findUnusedVariables(doc)` — variables never referenced by any binding
15. `findDuplicateComponents(doc)` — components with identical property sets

**TDD test spec:**
1. Node with `styleId: null` and no bindings → flagged as hardcoded
2. Node with `styleId: set` → not flagged
3. Style in doc.styles but not referenced → flagged as orphan
4. Two styles with identical fills, different names → flagged as duplicate
5. Two styles with same name, different fills → not flagged (names are the conflict)
6. Component defined but zero instances → flagged as unused
7. Image node with name "Image 1" → flagged as missing alt text
8. Image node with name "Hero photo: team" → not flagged
9. Image 5000×4000 in 200×160 frame → flagged as oversized
10. Frame nested 8 levels deep → flagged
11. Node with w=0 → flagged as zero-size
12. Text node where `measureText(text, fontSize, fontFamily).width > w` → flagged as overflow
13. Node named "my-button" (kebab-case, not PascalCase for components) → flagged
14. Variable defined but no PropertyBinding references it → flagged as unused
15. Empty document → 0 issues, not crash
16. 5000-node document → scan <200ms
17. Issues grouped by severity: error > warning > info
18. Issue count badge updates when node is added/removed
19. "Fix all" for hardcoded fills creates style and links all matching nodes
20. Scanner respects locked/hidden nodes (doesn't flag what user can't see)

**Acceptance criteria:**
- [ ] Inspector 4th tab "Debt" shows categorized issue list with counts
- [ ] StatusBar shows red badge: "12 issues"
- [ ] Each issue has "Fix" or "Ignore" button
- [ ] Click issue → selects affected node(s) and scrolls layers panel
- [ ] "Scan on open" setting (default: on) — runs scanner when document loads
- [ ] Issues persist in document metadata (recomputed on each scan, not stored)
- [ ] Scanner runs on `requestIdleCallback` with 50ms budget per chunk (handles large docs)

### 3.3 Cross-Document Style Consistency (S12)

**New files:**
- `packages/editor/src/intelligence/crossDocConsistency.ts`
- `packages/editor/src/intelligence/crossDocConsistency.test.ts` — 14 tests
- `packages/editor/src/components/Inspector/CrossDocConsistencyPanel.tsx`

**Files to modify:**
- `packages/platform/src/platform.ts:97` — implement `searchFileContent()` stub (currently empty) to support cross-doc analysis

**Checks:**
1. `findDuplicateColors(docs)` — color styles across documents with ΔEOK < 1.0 but different names
2. `findInconsistentSpacing(docs)` — documents using different grid baselines (8px vs 10px)
3. `findFontFragmentation(docs)` — same font family defined in multiple documents
4. `findComponentDrift(docs)` — same component name with different property sets across docs
5. `findStyleFragmentation(docs)` — identical text styles defined in multiple documents

**TDD test spec:**
1. Doc A: style "Primary Blue" (ΔEOK match to Doc B "Brand Blue") → flagged as duplicate
2. Doc A: color different from Doc B by ΔEOK > 2.0 → not flagged
3. Doc A using 8px grid, Doc B using 10px grid → flagged as inconsistent spacing
4. Both using 8px → not flagged
5. "Inter" defined in Doc A and Doc B with different fallback chains → flagged
6. "Inter" defined identically → not flagged
7. Component "Button" in Doc A has 3 properties, in Doc B has 4 → flagged as drift
8. Component "Button" identical in both → not flagged
9. Workspace with 0 documents → empty result, not crash
10. Workspace with 50 documents → scan <5s
11. Results cache invalidation when a document is modified
12. Each issue links to source document and target document
13. Merge suggestion: "Use 'Primary Blue' from Doc A in Doc B" with one-click apply
14. Style name conflict resolution when merging: prompt user if target doc has existing style with same name

**Acceptance criteria:**
- [ ] Panel accessible from home screen (workspace-level, not editor)
- [ ] Shows matrix: rows=documents, columns=consistency dimensions (colors, spacing, fonts, components)
- [ ] Green/amber/red cells per dimension
- [ ] Click cell → drill-down to specific issues
- [ ] "Apply fix" merges styles/components across documents
- [ ] Fixes create undo-able operations in target documents

---

## Phase 4: Animation & Prototype Intelligence (Priority: MEDIUM, Effort: 5 days)

**Features:** S9 Prototype Link Suggester, S10 Timeline Auto-Tween

### 4.1 Prototype Link Suggester (S9)

**New files:**
- `packages/editor/src/intelligence/linkSuggester.ts`
- `packages/editor/src/intelligence/linkSuggester.test.ts` — 12 tests

**Files to modify:**
- `packages/editor/src/context.tsx:224-605` — add `suggestLinks()` method
- `packages/editor/src/Menubar.tsx` — Object menu: "Suggest prototype links"
- `packages/editor/src/CanvasArea.tsx` — floating suggestion chip between frames when both selected

**Heuristics (ordered, cascading):**
1. Sequential naming: "Screen 1" + "Screen 2" → link 1→2
2. Flow naming: "Login", "Login Error", "Login Success" → link Login→both
3. Identical dimensions: frames with same w/h → likely same flow
4. Spatial proximity + similar names → likely related
5. 80%+ structural overlap → likely state/variant of same screen

**TDD test spec:**
1. "Frame 1" and "Frame 2" → suggests link Frame1→Frame2
2. "Login", "Login Error", "Login Success" → suggests Login→Error, Login→Success
3. Frames with identical w/h and similar names → suggested
4. Frames 50px apart with matching dimensions → suggested
5. Frame A where 85% of children match Frame B structurally → suggested
6. Two unrelated frames → no suggestion
7. Frame A→B link already exists → not re-suggested
8. 20 frames: "Screen 1" through "Screen 20" → suggests 1→2, 2→3, ..., 19→20
9. Suggestion applied → creates interaction with default "On click → Navigate to" trigger
10. User dismisses suggestion → not re-suggested for same frame pair (stored per-session)
11. Frames in different pages → not suggested (interactions are intra-page)
12. Frames with existing outgoing interactions → only suggests non-duplicate links

**Acceptance criteria:**
- [ ] Select 2+ frames → "Suggest prototype links" in Object menu
- [ ] Click → creates interactions for all detected relationships
- [ ] Preview: before confirming, shows dashed arrows on canvas between linked frames
- [ ] User can remove individual suggested links before confirming
- [ ] Works with existing prototype data (doesn't clobber existing interactions)
- [ ] aria-live: "Suggested 3 links. 2 already existed. 1 new link created."

### 4.2 Timeline Auto-Tween (S10)

**New files:**
- `packages/editor/src/intelligence/autoTween.ts`
- `packages/editor/src/intelligence/autoTween.test.ts` — 14 tests

**Files to modify:**
- `packages/editor/src/timeline/TimelinePanel.tsx` — right-click context menu: "Auto-Tween Between Keyframes"
- `packages/scene/src/motion.ts` — use existing `addKeyframe()` op

**Algorithm:**
1. Read selected track's keyframes, sorted by progress
2. Find consecutive pairs of keyframes
3. For each pair, generate N intermediate keyframes at evenly-spaced progress values
4. For each intermediate, interpolate value using `interpolateValue()` from `packages/shared/src/interpolation.ts`
5. Apply track's default easing to each generated keyframe

**TDD test spec:**
1. Two keyframes at progress 0 and 1, value 0→100 → generates 3 intermediates at 0.25, 0.5, 0.75
2. Single keyframe → returns null (need 2+)
3. No keyframes → returns null
4. Color interpolation: #FF0000→#0000FF → intermediates are valid colors in sRGB space
5. Affine interpolation: identity→translate(100,0) → intermediates are valid affine matrices
6. Path interpolation: closed path A→closed path B → intermediates have same point count
7. Custom easing on source keyframe → used for generated intermediates
8. Generated keyframes use track's default easing when source has none
9. Spatial tangent interpolation for motion path keyframes
10. 5 existing keyframes + auto-tween generates 4×3 = 12 new keyframes → correct ordering
11. Auto-tween respects existing keyframes (doesn't overwrite)
12. Opacity interpolation: 0→1 → generated values in [0,1]
13. Multi-property track (e.g., both x and y animated) → interpolates each property independently
14. Undo removes all generated keyframes as one atomic operation

**Acceptance criteria:**
- [ ] Select track, right-click → "Auto-Tween" in context menu
- [ ] Dialog: "Generate how many intermediates? [3]" with easing override option
- [ ] Confirm → keyframes appear on timeline with easing curves
- [ ] Generated keyframes are selected so user can adjust
- [ ] Operation is undoable as single step
- [ ] Works for color, number, affine, path, and opacity tracks
- [ ] Preview: during dialog, timeline shows ghost keyframes (not yet committed)

---

## Phase 5: Personalization & Adaptation (Priority: MEDIUM, Effort: 7 days)

**Features:** Generic #2 Adaptive UI, Generic #8 Shortcut Recommender, Generic #10 Progressive Complexity, Generic #13 Onboarding Adaptation

### 5.1 Usage-Aware Adaptive UI (Generic #2)

**New files:**
- `packages/editor/src/intelligence/adaptiveUI.ts` — epsilon-greedy bandit engine
- `packages/editor/src/intelligence/adaptiveUI.test.ts` — 10 tests

**Files to modify:**
- `packages/editor/src/components/FloatingToolbar/FloatingToolbar.tsx` — toolbar items reorder based on bandit scores
- `packages/editor/src/Menubar.tsx` — most-used menu items get "starred" section at top
- `packages/editor/src/context.tsx:224-605` — `recordAction(actionId)` calls bandit engine on every tool select, menu click, shortcut use

**TDD test spec:**
1. Action A selected 10 times, Action B 3 times → A ranked above B
2. New action C never selected → ranked by global prior (pre-seeded defaults)
3. Epsilon exploration: with ε=0.15, ~15% of suggestions are random exploration
4. Epsilon decay: after 50 interactions, ε drops from 0.15 to ~0.02
5. Cold start: all actions have equal score from global prior
6. localStorage persistence: scores survive page reload
7. Multi-device: each device has independent bandit (localStorage scoped)
8. Toolbar reorder does not break roving tabindex
9. Exploration items visually distinct (subtle "new" dot)
10. User can reset adaptation (Settings → "Reset toolbar to defaults")

**Acceptance criteria:**
- [ ] Toolbar items subtly reorder over time based on usage
- [ ] Exploration items shown with faint highlight (not jarring)
- [ ] Toggle in Settings: "Adaptive toolbar" (default: on)
- [ ] No layout shift during reorder (use CSS transition)
- [ ] aria-live silent (don't announce reorders)

### 5.2 Contextual Shortcut Recommender (Generic #8)

**New files:**
- `packages/editor/src/intelligence/shortcutRecommender.ts`
- `packages/editor/src/intelligence/shortcutRecommender.test.ts` — 8 tests

**Files to modify:**
- `packages/editor/src/Shell.tsx` — render `<ShortcutToast />` in a fixed position
- `packages/editor/src/components/ShortcutToast.tsx` — **NEW** — non-intrusive toast component

**TDD test spec:**
1. User clicks "Group" via mouse 3 times → toast shows "Tip: Ctrl+G to group"
2. User clicks "Group" via mouse, then uses Ctrl+G → counter resets, no toast
3. User dismisses toast 5 times for same action → never shown again for that action
4. Toast auto-dismisses after 8 seconds
5. Multiple toasts queued (show one at a time)
6. Toast respects reduced-motion preference (no slide animation)
7. 30-day rolling window for action counts
8. Toast accessible: announced via aria-live, focusable, Esc to dismiss

**Acceptance criteria:**
- [ ] Subtle toast appears at bottom-right of editor after 3 mouse-only uses of a shortcut-enabled action
- [ ] Toast shows shortcut key combo + action name
- [ ] Click toast → dismiss. "Don't show again" link in toast.
- [ ] Settings toggle: "Shortcut tips" (default: on)

### 5.3 Progressive Complexity Disclosure (Generic #10)

**New files:**
- `packages/editor/src/intelligence/complexityProgression.ts`
- `packages/editor/src/intelligence/complexityProgression.test.ts` — 9 tests

**Files to modify:**
- `packages/editor/src/Shell.tsx:287-508` — render fewer panels/tools for new users
- `packages/editor/src/components/FloatingToolbar/FloatingToolbar.tsx` — hide advanced tools based on tier
- `packages/editor/src/Menubar.tsx` — hide advanced menu items

**Tier system:**
| Tier | Unlock condition | Visible tools | Visible panels |
|---|---|---|---|
| Essential (0-2 sessions) | Default | Select, Frame, Rect, Text, Hand, Zoom | Layers, Properties |
| Intermediate (3-9 sessions) | 3 sessions OR used 50% of Essential tools | + Ellipse, Line, Pen, Image | + Export tab, Assets |
| Advanced (10+ sessions) | 10 sessions OR explicit opt-in | + Polygon, Star, Arrow, Pencil, Scale | + Spec tab, Prototype, Timeline, Variables |

**TDD test spec:**
1. Session 1 → Essential tier, 6 tools visible
2. Session 3 → Intermediate tier, 10 tools visible
3. Session 10 → Advanced tier, all tools visible
4. User clicks "Show all tools" in Settings → Advanced tier immediately
5. User at Intermediate, doesn't use app for 30 days → stays at Intermediate (no regression)
6. Tool count updates at session start, not mid-session
7. Hidden tools still accessible via search/quick-actions (power users can find them)
8. Complexity tier persisted in localStorage
9. Roving tabindex still works with reduced tool set

**Acceptance criteria:**
- [ ] New users see simplified toolbar (6 essential tools)
- [ ] Tools unlock progressively with usage
- [ ] "Show advanced features" toggle in Settings overrides all tiers
- [ ] Hidden tools still work via keyboard shortcuts (don't block power users)
- [ ] Welcome tour step mentions progressive unlocking

### 5.4 User Behavior-Based Onboarding Adaptation (Generic #13)

**New files:**
- `packages/editor/src/intelligence/onboardingAdapter.ts` — decision tree classifier
- `packages/editor/src/intelligence/onboardingAdapter.test.ts` — 8 tests

**Files to modify:**
- `packages/editor/src/Shell.tsx` — onboarding flow reads skill classification

**Decision tree (hand-crafted, 8 nodes):**
```
1. Uses keyboard shortcuts in first minute? → YES: likely_pro, NO: continue
2. Opens existing file (not "New")? → YES: returning_user, NO: continue
3. Creates frame with children within 2 minutes? → YES: likely_intermediate, NO: continue
4. Average time between actions < 3 seconds? → YES: likely_pro, NO: continue
5. Uses color picker or typography controls? → YES: intermediate, NO: likely_beginner
6. Creates >3 nodes in first 5 minutes? → YES: intermediate, NO: likely_beginner
7. (safety net) → beginner
Output: beginner | intermediate | advanced
```

**TDD test spec:**
1. User uses Ctrl+C in first minute → classified as advanced
2. User opens existing file → classified as returning_user (≠ beginner)
3. User creates frame + child within 2 min → classified as intermediate
4. User clicks slowly, creates 1 rectangle in 5 min → classified as beginner
5. User uses color picker within first session → classified as intermediate
6. Classification runs once at session start (not continuously)
7. Classification stored in localStorage, reused on next session
8. Beginner gets full guided tour; advanced gets "Skip tour → go to canvas" option

**Acceptance criteria:**
- [ ] After 2 minutes of first session, skill level is classified
- [ ] Beginner: full guided tour with tooltips, simplified UI (tier Essential)
- [ ] Intermediate: quick-start tips, tier Intermediate
- [ ] Advanced: skip onboarding, tier Advanced, show "What's new" changelog instead
- [ ] Classification override: user can change in Settings → "Experience level"

---

## Phase 6: User Behavior & Workflow (Priority: MEDIUM, Effort: 7 days)

**Features:** Generic #14 Workflow Pattern Recognition, Generic #6 Predictive Prefetch, Generic #1 Intelligent Defaults, Generic #9 Timezone Collaboration

### 6.1 Workflow Pattern Recognition (Generic #14)

**New files:**
- `packages/editor/src/intelligence/workflowDetector.ts` — sequence mining engine
- `packages/editor/src/intelligence/workflowDetector.test.ts` — 12 tests

**Files to modify:**
- `packages/editor/src/context.tsx:224-605` — `recordAction()` feeds into workflowDetector
- `packages/editor/src/Shell.tsx` — render `<WorkflowSuggestion />` toast when pattern detected
- `packages/editor/src/components/WorkflowSuggestion.tsx` — **NEW**

**TDD test spec:**
1. Sequence [select_frame, add_text, set_font, set_color] repeated 3 times → detected as pattern
2. Sequence repeated 2 times → not yet detected (threshold: 3)
3. Sequence with different parameters (set_color #FF0000 vs set_color #00FF00) → normalized as same pattern
4. Sliding window of size 4 actions → captures sub-patterns
5. Pattern length < 2 → ignored (too trivial)
6. 500-action rolling window in localStorage
7. Existing saved workflow with same pattern → not re-suggested
8. User saves pattern → creates named workflow entry
9. User runs saved workflow → executes action sequence
10. Pattern detection runs async (not blocking action dispatch)
11. Pattern with undo/redo in it → excluded (undo/redo are corrective, not workflow)
12. Multiple patterns detected → highest-frequency shown first

**Acceptance criteria:**
- [ ] After repeating a 4-action sequence 3 times, toast: "You've done this 3 times. Save as workflow?"
- [ ] Save → appears in QuickActionsBar (Ctrl+;) under "Workflows"
- [ ] Run via Ctrl+; or assigned shortcut
- [ ] Workflows stored in localStorage, exportable/importable as JSON
- [ ] Settings: "Workflow suggestions" (default: on)

### 6.2 Predictive Prefetch (Generic #6)

**New files:**
- `packages/editor/src/intelligence/prefetchPredictor.ts` — 1st-order Markov chain
- `packages/editor/src/intelligence/prefetchPredictor.test.ts` — 8 tests

**Files to modify:**
- `packages/editor/src/context.tsx:389` — `loadDocument()` records transition, triggers prefetch of predicted next documents

**TDD test spec:**
1. Transition sequence: A→B (5 times), A→C (2 times) → predicts B (highest probability)
2. First-ever transition → no prediction (cold start)
3. Prediction for document with no outgoing transitions → returns empty
4. Transition matrix persisted in localStorage
5. Top-3 predictions returned (not just #1)
6. Prediction computation <1ms for 500 documented transitions
7. Circular transitions (A→B→A→B) handled correctly
8. Document deleted → transitions involving it pruned on next access

**Acceptance criteria:**
- [ ] After opening Project A → Project B 3+ times, Project B preloads when Project A opens
- [ ] Prefetch only fetches metadata + thumbnail (not full asset data)
- [ ] Prefetch runs on `requestIdleCallback`
- [ ] No visual indicator (transparent to user)
- [ ] Disabled when on metered connection (if detectable)

### 6.3 Intelligent Defaults Engine (Generic #1)

**New files:**
- `packages/editor/src/intelligence/smartDefaults.ts`
- `packages/editor/src/intelligence/smartDefaults.test.ts` — 10 tests

**Files to modify:**
- `packages/home/src/HomeShell.tsx` — locale-aware date formatting, currency display
- `packages/editor/src/Shell.tsx` — locale-aware units, timezone display
- `packages/editor/src/context.tsx` — new document defaults from user locale

**Data sources (all free, no API keys):**
| Data | Source | Refresh |
|---|---|---|
| Country from IP | MaxMind GeoLite2 `.mmdb` (4MB bundled) | 30-day CI job |
| Locale | `navigator.language` (browser built-in) | Real-time |
| Timezone | `Intl.DateTimeFormat().resolvedOptions().timeZone` | Real-time |
| Currency | `Intl.NumberFormat()` locale inference | Real-time |
| Holidays | `date.nager.at` (cached 30 days) | On-demand |
| Forex rates | `frankfurter.app` (cached 1 hour) | On-demand |
| Measurement units | Locale-based: US→in, rest→mm | Real-time |

**TDD test spec:**
1. `navigator.language = 'ja-JP'` → date format YYYY/MM/DD, currency JPY
2. `navigator.language = 'de-DE'` → measurement unit mm, date DD.MM.YYYY
3. `navigator.language = 'en-US'` → measurement unit in, date MM/DD/YYYY
4. IP lookup → country DE → EUR currency, CET timezone display
5. Offline (no IP lookup) → falls back to navigator.language
6. Country with multiple languages (CH) → uses navigator.language preference
7. Explicit user setting overrides all auto-detection
8. Holiday check: date is Christmas in target country → flagged in date picker
9. Currency conversion: USD 100 → EUR using cached rate
10. Page size defaults: US→Letter, rest→A4

**Acceptance criteria:**
- [ ] New document defaults to correct page size, unit system, and date format
- [ ] Home screen shows dates in user's locale
- [ ] No network dependency for core defaults (IP→country is local)
- [ ] Settings → Region: shows auto-detected + manual override
- [ ] Timezone shown in collaboration features (if/when built)

### 6.4 Timezone-Aware Collaboration (Generic #9) — deferred

**Status:** Requires real-time collaboration infrastructure (not yet built in Strata). Deferred until CRDT/collaboration is implemented. Architecture notes preserved for future.

---

## Phase 7: ML Models & On-Device Intelligence (Priority: STRATEGIC, Effort: 10 days)

**Features:** S11 Per-User Design Fingerprint, S13 Offline-First ONNX Models

### 7.1 Per-User Design Fingerprint (S11)

**New files:**
- `packages/editor/src/intelligence/designProfile.ts` — fingerprint computation + similarity
- `packages/editor/src/intelligence/designProfile.test.ts` — 12 tests
- `packages/editor/src/intelligence/templateRecommender.ts` — template matching
- `packages/editor/src/intelligence/templateRecommender.test.ts` — 8 tests

**Fingerprint vector (76 dimensions):**
| Feature | Dimensions | Computation |
|---|---|---|
| Color distribution | 48 (16 hues × 3 channels in OKLCH) | Histogram of all fill colors across user's documents |
| Typography usage | 12 (6 font families × 2 properties: size bucket + weight) | Frequency of font usage across all text nodes |
| Layout patterns | 8 (flex ratio, grid ratio, spacing mean + stddev, alignment distribution) | Aggregate of layout decisions |
| Component usage | 8 (top-8 most-used component types) | Frequency by component category |

**Similarity computation:**
- Cosine similarity between user fingerprint and template fingerprint
- Template fingerprints pre-computed and shipped with templates
- Top-N templates by cosine similarity → recommendations

**TDD test spec:**
1. Empty profile (new user) → all dimensions 0
2. User creates 5 documents with blue-heavy palette → color histogram reflects blue dominance
3. User exclusively uses Inter font → typography vector shows Inter at 1.0
4. User A profile cosine-similar to Template X → X recommended
5. Profile updated on document save
6. Profile stored in localStorage (~2KB for 76 floats)
7. Fingerprint computation for 50 documents <100ms
8. User removes a document → profile recalculated (document not in profile)
9. Two identical documents → fingerprint identical
10. Two completely different documents → cosine similarity < 0.3
11. Template with no matching features → similarity 0, not recommended
12. Privacy: fingerprint cannot reconstruct original document data

**Acceptance criteria:**
- [ ] Templates gallery sorts by "Recommended for you" based on fingerprint
- [ ] Home screen shows "Based on your style" template section
- [ ] Fingerprint recomputes on each document save (debounced 5s)
- [ ] Settings: "Personalized recommendations" (default: on)
- [ ] "How does this work?" link explaining local-only fingerprint

### 7.2 Offline-First ONNX Models (S13)

**New files:**
- `packages/engine/src/ml/modelLoader.ts` — ONNX runtime loader with fallback
- `packages/engine/src/ml/imageClassifier.ts` — ResNet-18 quantized wrapper
- `packages/engine/src/ml/layoutClassifier.ts` — custom tiny CNN wrapper
- `packages/engine/src/ml/modelLoader.test.ts` — 10 tests
- `packages/engine/src/ml/imageClassifier.test.ts` — 8 tests
- `packages/engine/src/ml/layoutClassifier.test.ts` — 6 tests

**Models to source (pre-quantized, ONNX format):**
| Model | Size | Task | Source |
|---|---|---|---|
| ResNet-18 int8 | ~5MB | Image subject classification (10 classes: person, product, landscape, UI-screenshot, icon, text-document, chart, photo, illustration, other) | ONNX Model Zoo, quantize with onnxruntime quantization tools |
| Custom layout CNN | ~500KB | Frame layout classification (7 classes: nav, hero, card-grid, sidebar+content, footer, modal, other) | Train on synthetic data (generated from Strata templates), export to ONNX |

**Model delivery:**
- Models are NOT bundled in the app (they're ~5.5MB total)
- On first use of an ML feature, show "Download on-device model? (5MB, one-time)" dialog
- Downloaded once, cached in app data directory
- Fallback to heuristic rules when model isn't available

**TDD test spec (modelLoader):**
1. Model not downloaded → `isModelReady('imageClassifier')` returns false
2. Download model → `loadModel('imageClassifier')` returns ONNX inference session
3. Model cached → second load returns cached model (no re-download)
4. Download fails (network error) → retry 3 times with exponential backoff
5. Download fails all retries → feature falls back to heuristics, not crash
6. Model version mismatch → re-downloads
7. Two models can be loaded concurrently
8. Model unload frees memory
9. WebAssembly SIMD not available → uses WASM basic backend
10. ONNX runtime not available (very old browser) → all ML features use heuristics

**TDD test spec (imageClassifier):**
1. Photo of person → classifies as 'person' (>80% confidence)
2. Product shot on white → classifies as 'product'
3. Screenshot of app UI → classifies as 'ui-screenshot'
4. Icon (small, few colors) → classifies as 'icon'
5. Low confidence (<50%) → falls back to filename-based heuristic
6. Very small image (<32px) → skips classification, uses heuristics
7. Non-image input → handled gracefully
8. Classification <50ms for 224×224 input

**TDD test spec (layoutClassifier):**
1. Horizontal bar at top with links → classifies as 'nav'
2. Large centered content with CTA → classifies as 'hero'
3. Grid of equal-sized cards → classifies as 'card-grid'
4. Narrow sidebar + wide content area → classifies as 'sidebar+content'
5. Thin bar at bottom → classifies as 'footer'
6. Empty frame → classifies as 'other'

**Acceptance criteria:**
- [ ] First use of "Smart name" on image → "Download on-device model?" dialog
- [ ] Models download in background, show progress
- [ ] Once downloaded, all ML features work fully offline
- [ ] Heuristic fallback always available (never block UI on model download)
- [ ] Settings → "On-device models" panel: shows download status, model versions, delete option
- [ ] "On-device processing" badge/info in Settings (privacy marketing)

---

## Phase 8: Enterprise & Advanced (Priority: LOW, Effort: 8 days)

**Features:** Generic #7 Automatic Layout Suggestions, Generic #3 Document Health Monitoring (enhancement of S7)

### 8.1 Automatic Layout Suggestions (Generic #7)

**New files:**
- `packages/editor/src/intelligence/autoLayout.ts` — constraint solver
- `packages/editor/src/intelligence/autoLayout.test.ts` — 12 tests

**Files to modify:**
- `packages/editor/src/Menubar.tsx` — Arrange menu: "Auto-Layout Selected"
- `packages/editor/src/shortcuts/ShortcutManager.ts` — `autoLayout: { binding: { key: 'l', ctrl: true, alt: true }, label: 'Auto-Layout', category: 'Arrange' }`
- `packages/editor/src/context.tsx` — `autoLayoutSelected()` method

**Algorithm:**
1. Compute bounding box of all selected nodes
2. Determine flow direction: if nodes are wider than tall → horizontal, else vertical
3. Solve optimal columns: `cols = ceil(sqrt(n * (bbox.w / bbox.h)))`
4. Compute uniform gap from available space
5. Position nodes in grid with uniform spacing
6. Snap positions to nearest 8px grid

**TDD test spec:**
1. 6 equal-sized rects → 3×2 grid layout
2. 4 equal-sized rects in vertical arrangement → 2×2 grid
3. 3 nodes: row layout if roughly same height
4. 3 nodes: column layout if roughly same width
5. Mixed-size nodes → grid with uniform spacing
6. Single node → no change
7. Nodes already perfectly aligned → no-op
8. Nodes inside frame → laid out within frame bounds
9. 100 nodes → layout <50ms
10. Layout respects minimum gap (8px)
11. Layout overflow warning if nodes don't fit in container
12. Operation is undoable

**Acceptance criteria:**
- [ ] Ctrl+Alt+L → selected nodes snap into optimal grid
- [ ] "Auto-Layout Selected" in Arrange menu
- [ ] Preview shown before committing (ghost positions)
- [ ] User can press Esc to cancel preview
- [ ] Works with nested selections (nodes inside frames)

### 8.2 Document Health Monitoring (Generic #3)

**Note:** This extends S7 Design Debt Scanner with statistical anomaly detection.

**New files:**
- `packages/editor/src/intelligence/healthMonitor.ts` — statistical anomaly + baseline tracking
- `packages/editor/src/intelligence/healthMonitor.test.ts` — 10 tests

**Files to modify:**
- `packages/editor/src/intelligence/debtScanner.ts` — call healthMonitor for statistical checks

**Additional checks (beyond S7):**
1. **Node count anomaly:** current doc node count >2σ above user's historical mean → "Unusually large document"
2. **Color palette shift:** OKLCH color distribution this session differs >30% from user baseline → "New color palette detected"
3. **Layer depth anomaly:** max nesting depth >2σ above baseline → "Unusually deep nesting"
4. **Export size anomaly:** predicted export size >2σ above typical → "Large export — consider optimization"
5. **Session duration anomaly:** current session >2σ above typical → "Long session — consider saving"

**TDD test spec:**
1. User typically creates 50-node docs, current doc has 200 nodes → flagged
2. User typically uses blue palette, current doc uses all red → flagged
3. User typically nests 2-3 deep, current doc has 8-level nesting → flagged
4. Historical baseline requires 5+ documents to be meaningful
5. New user (<5 docs) → no statistical anomalies, only debt rules apply
6. Baseline recomputed on each save (incremental, not full recompute)
7. Mean and stddev computed per metric
8. Outliers at exactly 2σ → flagged
9. Outliers at 1.9σ → not flagged
10. Baseline stored in localStorage (~500 bytes)

**Acceptance criteria:**
- [ ] Statistical anomalies appear in Debt panel with "info" severity (not errors)
- [ ] Anomalies link to explanation: "Your typical document has 50 nodes. This one has 200."
- [ ] Baseline builds silently over first 5 documents
- [ ] "Reset baseline" button in Settings

---

## Dependency Graph

```
Phase 0 (Wire Scaffold) ─────────────────────────────────────────────────────┐
    │                                                                         │
    ▼                                                                         │
Phase 1 (Layout & Color: S1, S2, S4, S5, S8) ────────────────────────────────┤
    │                                                                         │
    ▼                                                                         │
Phase 2 (Naming & Semantic: S3, Gen#5, Gen#12) ──────────────────────────────┤
    │                                                                         │
    ▼                                                                         │
Phase 3 (Design System: S6, S7, S12) ────────────────────────────────────────┤
    │                                                                         │
    ├──► Phase 4 (Animation: S9, S10) ───────────────────────────────────────┤
    │                                                                         │
    ├──► Phase 5 (Personalization: Gen#2, #8, #10, #13) ─────────────────────┤
    │                                                                         │
    ├──► Phase 6 (Workflow: Gen#14, #6, #1, #9 deferred) ────────────────────┤
    │                                                                         │
    └──► Phase 7 (ML Models: S11, S13) ──────────────────────────────────────┤
              │                                                               │
              └──► Phase 8 (Enterprise: Gen#7, Gen#3 enhancement) ◄───────────┘
```

- Phase 0 blocks all others (must be first)
- Phases 1-3 are sequential (each builds on prior)
- Phases 4, 5, 6, 7 can be done in parallel after Phase 3
- Phase 8 depends on Phase 7 (needs ML models) and Phase 3 (needs debt scanner)

---

## File Manifest (All New Files)

```
packages/ai/src/
├── intelligenceRegistry.ts          (Phase 0)
└── intelligenceRegistry.test.ts     (Phase 0)

packages/editor/src/intelligence/
├── layoutScore.ts                   (Phase 1)
├── layoutScore.test.ts              (Phase 1)
├── wcagFix.ts                       (Phase 1)
├── wcagFix.test.ts                  (Phase 1)
├── spacingHarmonizer.ts             (Phase 1)
├── spacingHarmonizer.test.ts        (Phase 1)
├── exportAdvisor.ts                 (Phase 1)
├── exportAdvisor.test.ts            (Phase 1)
├── imageFitAdvisor.ts               (Phase 1)
├── imageFitAdvisor.test.ts          (Phase 1)
├── autoNamer.ts                     (Phase 2)
├── autoNamer.test.ts                (Phase 2)
├── clipboardAdapter.ts              (Phase 2)
├── clipboardAdapter.test.ts         (Phase 2)
├── semanticDiff.ts                  (Phase 2)
├── semanticDiff.test.ts             (Phase 2)
├── variantDetector.ts               (Phase 3)
├── variantDetector.test.ts          (Phase 3)
├── debtScanner.ts                   (Phase 3)
├── debtScanner.test.ts              (Phase 3)
├── crossDocConsistency.ts           (Phase 3)
├── crossDocConsistency.test.ts      (Phase 3)
├── linkSuggester.ts                 (Phase 4)
├── linkSuggester.test.ts            (Phase 4)
├── autoTween.ts                     (Phase 4)
├── autoTween.test.ts                (Phase 4)
├── adaptiveUI.ts                    (Phase 5)
├── adaptiveUI.test.ts               (Phase 5)
├── shortcutRecommender.ts           (Phase 5)
├── shortcutRecommender.test.ts      (Phase 5)
├── complexityProgression.ts         (Phase 5)
├── complexityProgression.test.ts    (Phase 5)
├── onboardingAdapter.ts             (Phase 5)
├── onboardingAdapter.test.ts        (Phase 5)
├── workflowDetector.ts              (Phase 6)
├── workflowDetector.test.ts         (Phase 6)
├── prefetchPredictor.ts             (Phase 6)
├── prefetchPredictor.test.ts        (Phase 6)
├── smartDefaults.ts                 (Phase 6)
├── smartDefaults.test.ts            (Phase 6)
├── designProfile.ts                 (Phase 7)
├── designProfile.test.ts            (Phase 7)
├── templateRecommender.ts           (Phase 7)
├── templateRecommender.test.ts      (Phase 7)
├── autoLayout.ts                    (Phase 8)
├── autoLayout.test.ts               (Phase 8)
├── healthMonitor.ts                 (Phase 8)
└── healthMonitor.test.ts            (Phase 8)

packages/engine/src/ml/
├── modelLoader.ts                   (Phase 7)
├── modelLoader.test.ts              (Phase 7)
├── imageClassifier.ts               (Phase 7)
├── imageClassifier.test.ts          (Phase 7)
├── layoutClassifier.ts              (Phase 7)
└── layoutClassifier.test.ts         (Phase 7)

packages/editor/src/components/
├── StatusBar/LayoutScoreIndicator.tsx        (Phase 1)
├── StatusBar/LayoutScoreIndicator.test.tsx   (Phase 1)
├── Inspector/sections/LayoutScoreSection.tsx (Phase 1)
├── Inspector/sections/ContrastIndicator.tsx  (Phase 1)
├── Inspector/DebtPanel.tsx                   (Phase 3)
├── Inspector/DebtPanel.test.tsx              (Phase 3)
├── Inspector/CrossDocConsistencyPanel.tsx    (Phase 3)
├── ShortcutToast.tsx                         (Phase 5)
└── WorkflowSuggestion.tsx                    (Phase 6)
```

**Total: 55 new files, 46 test files, ~310 tests**

---

## Verification Protocol (Per Phase)

After each phase completion, before marking it done:

```bash
pnpm format          # auto-format
pnpm typecheck       # 15/15 packages must pass
pnpm lint            # 0 new errors on new/modified files
pnpm test            # all tests pass (including new ones)
pnpm audit:tokens    # 93/93 WCAG-AA across 3 themes
pnpm audit:emoji     # zero violations
cargo test --workspace  # all Rust tests pass (if Rust files touched)
```

Run `just gate` after phases 0, 1, 3, and 7 (the phases most likely to affect broad code).

---

## Estimated Totals

| Metric | Count |
|---|---|
| Total features | 27 |
| Active features (non-deferred) | 26 |
| New files | 55 |
| New test files | 46 |
| Estimated new tests | ~310 |
| Estimated total effort | ~47 days |
| LLM dependencies | 0 |
| API key requirements | 0 |
| Recurring costs | $0 |
| Max added bundle size (ML models, lazy-loaded) | ~5.5MB |
| All computation | Client-side only |
