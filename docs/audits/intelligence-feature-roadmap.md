# Intelligence Feature Roadmap — Strata Design Suite

**Date:** 2026-07-21  
**Method:** Codebase audit (Packages/TS + crates/Rust) × competitive landscape survey (Figma, Sketch, Illustrator, Affinity, Framer, Canva, Penpot, InVision) × adversarial gate (useful / defensible / cost-effective / maintainable / fast / noticeable)

---

## 0. Executive Summary

Strata already has **~30 intelligence modules** (`packages/editor/src/intelligence/`), a
background-removal ML pipeline, colorization, audit, debt scanning, layout scoring, and a
command palette that surfaces 4 of them. **The #1 finding: the distribution channel is the
bottleneck, not the algorithms.** Most built intelligence is unreachable from deliberate
menus, toolbar buttons, or keyboard shortcuts — it only fires from the IntelligencePanel
that takes 3+ clicks to open.

Of 25+ candidate features researched against competitors, **6 survived the adversarial
gate** — each is genuinely useful (user notices within 5 minutes), defensible (builds on
Strata's existing immutable scene-graph + scanner infrastructure), cost-effective (no new
ML models, no external APIs, pure TS), maintainable (follows `debtScanner.ts` patterns),
and a net-new capability users don't currently have.

**Three are recommended for immediate build.** Three are deferred with reasons.

---

## 1. Eliminated Candidates (and why)

| Candidate | Eliminated because |
|---|---|
| Workflow pattern mining (`workflowAnalyzer.ts`) | Accuracy ceiling ~60%; users won't trust suggestions (gimmicky). Already built — ship only if action-tracking data proves >80% pattern reliability. |
| Motion preset recommender | Default easings cover 80% of cases; user won't notice difference. Already built. |
| Semantic search (`semanticSearch.ts`) | No meaningful corpus to search; returns vacuous results. |
| Template recommendation | Strata is blank-canvas-first; no template gallery to match against. |
| Content-aware resize / seam carving | Wrong domain (print, not UI/UX). Illustrator niche. |
| Merge conflict detection | Blocked on collab infrastructure Strata doesn't have. |
| Multi-platform magic resize | Canva domain (marketing), not Strata's UI/UX target. |
| Font detection from photo | CNN-heavy; designers have font files, not just photos. |
| Property "same type" selection | **Already exists.** |
| Auto-layout Apply button | **Already exists** in LayoutSection.tsx. |

---

## 2. Recommended Features (adversarial-passing)

---

### 2.1. Pre-Export Quality Gate

#### Problem solved
Designers routinely export assets with broken fonts, low-contrast text, unnamed layers,
orphaned components, and unapplied tokens —这些问题 only get discovered by the developer
or client after handoff. Figma's "ready for dev" is a manual judgment. Strata already has the
scanners; it just doesn't run them at the moment that matters.

#### User benefit
A single checklist dialog before every export/SVG/PNG/PDF, grouping issues by severity:
**Errors** (broken font references, contrast failures) → block export. **Warnings** (untokenized
colors, unnamed layers, missing alt text) → require explicit skip. **Info** (opportunities,
not problems) → surface but don't block. One click opens the relevant IntelligencePanel
sub-tab to fix it.

#### Investor narrative
*"Strata is the first design tool that refuses to let you ship broken work."* This is a
ship-quality story — Figma, Sketch, Canva all let you export garbage. For enterprise buyers,
it reduces design-system drift and accessibility liability. For agencies, it reduces rework
cycles. Measurable: track issues-caught-per-export as a product metric.

#### Technical approach
- Wrap existing `runDebtScan()` + `runIntelligenceAudit()` into a single
  `runPreExportGate(doc, options)` returning `{ errors, warnings, info }` (pure function,
  same pattern as the existing scanners).
- Gate `ExportDialog.tsx`: when the user clicks "Export", run the gate. If errors > 0, show
  the gate dialog. Warnings require a "Skip and export" click. Info is collapsed by default.
- Each item links to the relevant fix: contrast → Audit tab; font → Typography section; name
 → Layers inline rename; token → swatch picker.
- No new scanning logic required — purely surface + wire existing 15-check debt scanner +
  contrast audit.

#### Estimated complexity
**Low-Medium.** ~300 lines: one new pure function in `packages/scene/src/integration/`,
gate UI component, wire into ExportDialog. Uses `runDebtScan` and `runIntelligenceAudit`
that are already tested (608 + 134 lines of scanner logic). No new algorithms.

#### Cost profile
**$0.** No external APIs, no ML inference, no WASM. Pure TS over existing scanner output.

#### Scalability profile
**O(n)** scan of the scene-graph once per export. Runs in <100ms for typical documents.
No background work. No storage.

#### Risks
- **False-positive fatigue**: if the gate is too noisy, users click "Skip" reflexively.
  Mitigation: start strict (errors block) + high-signal warnings only. Tune severity
  thresholds after measuring real patterns.
- **Scanner coverage debt**: current `runDebtScan` focuses on design-system hygiene. Will need
  export-specific additions (missing alt text, oversized raster assets, bleed/safe-area
  violations in print mode) — each is a small independent rule in the existing pattern.

#### Edge cases
- Export of a single selected node vs. whole doc → scope scanner to the selected subtree.
- Batch export → run gate once; apply results to all jobs.
- "Emergency bypass" for force-export → Cmd+Shift+Enter shortcut bypasses the gate (power
  users).
- Empty result → gate doesn't appear, export proceeds normally.

#### Adversarial pass
| Gate | Pass? | Why |
|------|-------|-----|
| Useful? | YES | Every export is a handoff. Catching problems at export is when it matters most. |
| Defensible? | YES | No competitor runs scene-graph-level pre-export checks at this depth (Figma's pre-export is viewport-only: resolution, suffix). |
| Cost-effective? | YES | Wires existing scanners — algorithm development = $0. |
| Maintainable? | YES | Follows `runDebtScan` rule pattern: each check is an independent function returning a structured issue. Adding a rule = 1 function. |
| Faster? | YES | Automates a manual self-check that takes 5-10 minutes of opening each layer, reading each color. |
| Noticeable? | YES | Blocks or warns exactly when the user is trying to ship — the most motivated moment. |

---

### 2.2. Recolor Artwork (Palette Mapping)

#### Problem solved
Re-theming a design (e.g., rebranding, dark-mode conversion, seasonal palette) is one of the
most tedious tasks: select each shape, note its current color, look up the replacement, apply.
Illustrator's Recolor Artwork is universally used because it preserves visual hierarchy while
swapping an entire palette at once. Strata's palette **extraction** exists; palette
**application** does not.

#### User benefit
Select a set of nodes (or whole document), invoke Recolor, choose a target palette (extracted,
built-in, or imported). Strata maps current → target by perceptual order: darkest current →
darkest target, preserving luminance relationships (so headers stay headers, backgrounds stay
backgrounds). WCAG contrast check runs live as a preview; one click applies. Use cases:
rebranding, dark mode conversion, accessibility pass, A/B theme variants.

#### Investor narrative
*"Re-theme an entire app design in one click — while preserving accessibility."* Demo-magic
feature that's also genuinely useful. Illustrator has it; Figma doesn't (manual only). For
enterprise rebranding workflows, it collapses hours into seconds.

#### Technical approach
- New pure function in `packages/scene/src/intelligence/`: `mapColorsToPalette(doc, nodeIds, targetPalette): Document`.
  - Step 1: Extract current palette via existing palette extraction (median-cut in OKLCH —
    already in `packages/engine/src/paletteExtractor.ts`).
  - Step 2: Sort both palettes by relative luminance (WCAG luminance math — already in
    `packages/shared/src/contrast.ts`).
  - Step 3: Map darkest→darkest, second→second, etc. Preserve hue family when possible
    (OKLCH hue distance).
  - Step 4: Replace solid fills on affected nodes while preserving opacity and blendMode.
- Live preview via `updateDoc` on a draft state (non-destructive until applied).
- UI: invoke from Object menu or `extractPalette` action → "Apply to selection" opens palette
  picker (same ColorPicker component Strata already has, extended with palette-mode).
- Reuse existing `ColorConversionService` (OKLCH math) for perceptual ordering.

#### Estimated complexity
**Medium.** ~500 lines: mapping algorithm (200), preview integration (100), picker UI (200).
Leverages existing: `extractPalette`, `ColorConversionService`, `contrast.ts`, ColorPicker
component.

#### Cost profile
**$0.** OKLCH perceptual math — no models, no APIs. Pure TS on Strata's existing color
infrastructure.

#### Scalability profile
**O(n)** where n = selected nodes' fills. Single-pass luminance sort on the palette
(typically <20 colors). Runs in <1ms. Preview is incremental — only replaced fills change.

#### Risks
- **Color-count mismatch**: source has 7 unique colors, target has 4. Solution: closest-match
  bucketing (k-means with k=target-palette-size) for the unmatched remainder.
- **Perceptual ordering failures**: luminance ties or inverted relationships. Mitigation:
  expose a manual drag-to-map fallback (reorder source→target rows) for power users.
- **Gradient fills**: mapping gradients = mapping each stop independently. Handle as separate
  case (sort stops by position, map each).

#### Edge cases
- Image fills → skip (no color to remap) or offer "tint overlay" option.
- Gradient fills → map each stop independently.
- Pattern fills → skip.
- Nodes with multiple fills → map each fill independently.
- "Preserve contrast" mode → after mapping, run contrast check; if any text fails WCAG,
  auto-adjust lightness (existing `wcagFix.ts` binary search) to pass.

#### Adversarial pass
| Gate | Pass? | Why |
|------|-------|-----|
| Useful? | YES | Re-theming is a daily task for brand/design-system designers. Currently manual. |
| Defensible? | YES | Illustrator has it; Figma doesn't. Strata's OKLCH infrastructure makes the mapping perceptually superior to Illustrator's HSL approach. |
| Cost-effective? | YES | ~500 lines, zero new dependencies, reuses existing color infrastructure. |
| Maintainable? | YES | Pure function `(doc, ids, palette) => doc`. Immutable. Testable. |
| Faster? | YES | Manual re-theming = 30+ min for a 20-screen design. This = 2 clicks + 1 review. |
| Noticeable? | YES | The before/after is visually dramatic — the entire design changes color in one click. |

---

### 2.3. Property-Based Selection Expansion

#### Problem solved
Strata currently supports "select all with same type" and "same layer color" — but designers
frequently need "select all with same stroke," "same font," "same font size," "same opacity,"
"same blend mode," "same corner radius." These are universal micro-efficiencies in Figma
(Select → Select all with same…) that Strata lacks.

#### User benefit
Select one text node → "Select all with same font" → every node using Inter Bold 16px is
selected → change them all at once. Eliminates the manual hunt-and-click that dominates
cleanup workflows. 6 new matchers × every design session = hundreds of micro-saves.

#### Investor narrative
*"Figma's most-used selection shortcuts, in Strata."* Not glamorous, but these micro-features
are what daily users remember. They compound: 6 matchers × 50 uses/day × 1 second saved =
5 minutes/day/user. Across 10K users, that's 830 hours/day of collective time saved.

#### Technical approach
- Extend existing `SelectionContext.tsx` (which already has `selectAllWithSameType`,
  `selectAllWithSameFill`, `selectAllWithSameLayerColor`) with 6 new methods:
  `selectAllWithSameStroke`, `selectAllWithSameFont`, `selectAllWithSameFontSize`,
  `selectAllWithSameOpacity`, `selectAllWithSameBlendMode`, `selectAllWithSameCornerRadius`.
- Each is a filter over `walkNodes(state.document)` comparing the relevant property — same
  pattern as existing `selectAllWithSameFill` (which uses `JSON.stringify` comparison).
- Add to Layers panel context menu (where the existing 2 matchers live).
- Add to Edit menu: "Select All with Same →" submenu.
- Add keyboard shortcuts: Cmd+Alt+1 through 6 (or similar) for the most common matchers.

#### Estimated complexity
**Low.** ~200 lines. Each matcher is a 10-line filter function. UI wiring is the bulk.

#### Cost profile
**$0.** Pure TS filter over the scene-graph.

#### Scalability profile
**O(n)** single walk of the scene-graph. <10ms for typical documents.

#### Risks
- **Matcher ambiguity**: "same font" — does it include weight? size? Solution: expose
  granular matchers (family only, family+weight, family+weight+size) — but start with
  family-only as the default and add granularity only if users ask.
- **Empty result**: no other nodes match → selection unchanged, brief toast "No matches."

#### Edge cases
- Mixed selection (multiple node types) → matcher applies only to nodes of the same kind
  (can't match font on a rectangle).
- Rich text nodes with per-run fonts → match if ANY run uses the target font.
- Component instances → match against the instance's resolved properties (including overrides).

#### Adversarial pass
| Gate | Pass? | Why |
|------|-------|-----|
| Useful? | YES | Universal micro-efficiency. Figma users trigger these 100+ times/session. |
| Defensible? | YES | Figma has them; Strata doesn't. Pure utility — no one "owns" this space, but absence is felt. |
| Cost-effective? | YES | 200 lines, zero dependencies. |
| Maintainable? | YES | Each matcher is an independent 10-line function. No shared state. |
| Faster? | YES | Manual hunt-and-click = 10-30 seconds per change. This = 1 click. |
| Noticeable? | YES | The selection visibly expands across the canvas — immediate visual feedback. |

---

## 3. Deferred Features (adversarial-passing but not immediate)

These pass the gate but are lower-ROI than the three above. Build in a later sprint.

---

### 3.1. Token Clustering & Suggestion

**What:** Detect colors, spacing values, and font sizes that cluster within a perceptual
threshold and suggest creating a design-token for them. E.g., "You have 3 blues within ΔE 5 —
create a `color.blue` token?"

**Why deferred:** Requires a clustering UI (suggest → accept → name → apply) that's a larger
surface than the algorithm. The algorithm itself is simple (hierarchical clustering on OKLCH
distance), but the UX of "should we merge these into a token?" needs careful design to avoid
being annoying. Build after the pre-export gate proves users engage with intelligence
suggestions.

**Complexity:** Medium (~400 lines). **Cost:** $0.

---

### 3.2. WCAG 2.2 / APCA Contrast Upgrade

**What:** Strata's contrast audit uses WCAG 2.1 AA (relative luminance ratio). WCAG 2.2 and
APCA (Accessible Perceptual Contrast Algorithm) are the emerging standards. APCA is more
accurate for colored text and large text.

**Why deferred:** WCAG 2.1 AA is still the legal standard in most jurisdictions. APCA is a W3C
working draft, not yet a compliance requirement. The upgrade is a ~100-line math swap, but
it's only worth shipping when enterprise buyers start asking for it. Monitor the spec.

**Complexity:** Low (~100 lines). **Cost:** $0.

---

### 3.3. Font Matching via Google Fonts Metadata

**What:** "Find fonts similar to this one" using Google Fonts API axis metadata (serif/sans,
weight range, width range, x-height, contrast). No CNN needed — pure metadata matching.

**Why deferred:** Requires a Google Fonts API integration (free, but external dependency).
Strata's font system is already mature (variable axes, OpenType features). Font matching is
a "nice to have" that doesn't block any workflow — designers can browse fonts manually. Build
only if user research shows font-hunting is a top-5 friction.

**Complexity:** Medium (~300 lines + API integration). **Cost:** $0 (free tier).

---

## 4. Prioritized Roadmap

Ranked by **business impact ÷ implementation effort**:

| # | Feature | Impact | Effort | ROI | Sprint |
|---|---------|--------|--------|-----|--------|
| 1 | **Pre-Export Quality Gate** | High (ship-quality story, enterprise value) | Low-Med (~300 lines) | **Highest** | **Sprint 1** |
| 2 | **Property-Based Selection Expansion** | High (daily micro-efficiency) | Low (~200 lines) | **Very High** | **Sprint 1** |
| 3 | **Recolor Artwork** | High (demo-magic, re-theming workflow) | Medium (~500 lines) | **High** | **Sprint 2** |
| 4 | Token Clustering & Suggestion | Medium (design-system maturity) | Medium (~400 lines) | Medium | Sprint 3 |
| 5 | WCAG 2.2 / APCA Upgrade | Low-Med (future-proofing) | Low (~100 lines) | Low-Med | Sprint 4+ |
| 6 | Font Matching (Google Fonts) | Low-Med (nice-to-have) | Medium (~300 lines + API) | Low | Sprint 4+ |

---

## 5. Implementation Notes

### Architecture fit
All three Sprint 1-2 features follow Strata's established patterns:
- **Pure functions** in `packages/scene/src/intelligence/` (immutable, testable)
- **Context methods** in `EditorContextValue` (wired via `updateDoc`)
- **UI components** in `packages/editor/src/components/` (token-styled, CSS custom properties)
- **ActionRegistry** entries (discoverable via QuickActionsBar Ctrl+;)
- **Menu items** in `Menubar.tsx` (with `SHORTCUT_DEFS` bindings)

### TDD sequence
1. Write failing tests for the pure function (e.g., `mapColorsToPalette` returns expected
   mapping for a 3-color doc → 3-color palette).
2. Implement the pure function.
3. Write failing tests for the context method.
4. Wire the context method.
5. Write failing component tests for the UI.
6. Build the UI.
7. Run full regression: `pnpm test` + `pnpm typecheck` + `pnpm lint` + `pnpm audit:tokens`
   + `pnpm audit:emoji`.

### Hub file budget
- `context.tsx` (6941 lines, I=0.36) — adding 3-4 methods is acceptable but monitor.
- `ExportDialog.tsx` (867 lines) — gate logic should live in a separate component
  (`ExportGateDialog.tsx`) to avoid bloating the existing dialog.
- `SelectionContext.tsx` (175 lines) — adding 6 matchers is well within budget.

### No new dependencies
All features use existing infrastructure:
- `@varve/scene` (document model, scanners)
- `@varve/shared` (color math, contrast)
- `@varve/ui` (ColorPicker, Dialog, Button)
- `@varve/engine` (palette extraction)

---

## 6. Success Metrics

| Feature | Metric | Target |
|---------|--------|--------|
| Pre-Export Gate | Issues caught per export | > 1.0 (meaning users find it useful) |
| Pre-Export Gate | False-positive skip rate | < 30% (gate isn't too noisy) |
| Property Selection | Uses per session | > 5 (daily utility) |
| Recolor Artwork | Re-theming time | < 30 seconds for a 20-screen design |
| All | IntelligencePanel open rate | > 2 sessions/week (discoverability) |

---

## 7. Appendix: What Strata Already Has (for context)

Strata's existing intelligence infrastructure is **extensive** — 31 modules in
`packages/editor/src/intelligence/`, scene-level audit/debt scanners, ML background removal,
colorization, and a command palette. The gap is **distribution**, not capability. This roadmap
focuses on surfacing and extending what exists, not building net-new intelligence from
scratch.

**Key existing modules referenced:**
- `packages/scene/src/intelligence/debtScanner.ts` (608 lines, 15 checks)
- `packages/scene/src/intelligence/audit.ts` (134 lines, WCAG 2.1 AA)
- `packages/editor/src/intelligence/autoLayoutSuggestor.ts` (178 lines)
- `packages/editor/src/intelligence/paletteExtractor.ts` (median-cut in OKLCH)
- `packages/editor/src/intelligence/layoutClassifier.ts` (7 layout types)
- `packages/editor/src/intelligence/wcagFix.ts` (binary-search OKLCH lightness)
- `packages/editor/src/intelligence/autoNamer.ts` (14-rule decision tree)
- `packages/editor/src/intelligence/spacingHarmonizer.ts` (edge-distance histogram)
- `packages/shared/src/contrast.ts` (WCAG luminance + ratio)
- `packages/shared/src/colorConversion.ts` (OKLCH math)
- `packages/engine/src/paletteExtractor.ts` (quantization engine)
