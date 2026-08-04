# Strata Intelligence Audit — Final Report & Implementation Plan

**Generated:** 2026-07-03 | **Methodology:** BMAD-lite + 6-Role Cascade Review + Adversarial Gimmick Check
**Status:** COMMITTED — use this document for implementation in a separate session

---

## I. Executive Summary

**Thesis:** Design tools compete on workflow speed and production correctness. Intelligence features that save 5-30 seconds per operation — or prevent a $2,000 reprint — compound into measurable user value. Strata's local-first architecture enables deterministic intelligence that works offline, with zero latency and zero ongoing inference cost. This is a moat that cloud-LLM-based competitors (Figma AI, Canva Magic, Claude Design) cannot easily copy.

**Strategic position:** The market is over-indexed on generative AI agents. The underserved, high-value space is *deterministic, local, structural intelligence*: real-time validation, design-system governance, production preflight, and data-driven prototyping. Strata already has the foundation for most of this — tokens, governance, color management, print preflight, and a prototype engine. The task is to surface these capabilities as a unified "Design Intelligence Layer" rather than invent new infrastructure.

**What survived the cascade:** 12 features evaluated across 6 roles (VC, Product, Architecture, ML, Growth, Due Diligence). 4 killed, 4 shipped with constraints, 4 shipped clean. Implementation plan: 6 phases, ~38 days, 12 primary features, 200+ tests, $0 recurring cost.

---

## II. BMAD-lite Planning

| Dimension | Hypothesis |
|-----------|------------|
| **Business** | Strata increases activation and retention by making design files production-ready faster. Intelligence features reduce rework and differentiate against Figma/Penpot in print, accessibility, and design-system governance. |
| **Market** | No competitor ships deterministic, offline-first design intelligence. Figma's AI is cloud-dependent; Penpot's ML is research-only; Adobe is expensive and legacy. Strata's whitespace is *correctness at design time*. |
| **Architecture** | Intelligence runs as local, pure-function modules in `@varve/scene`, `@varve/engine`, and `@varve/editor`. No external inference. Public APIs are optional, client-side, and cacheable. |
| **Delivery** | Incremental, test-first phases. Each phase ends with the full Cascade Review gate (`just gate`). No feature blocks canvas rendering. |

---

## III. Research Findings & Market Analysis

### Competitive Landscape (2025-2026)

| Tool | Intelligence Strategy | LLM Dependency | Local-First | Print/Production |
|------|----------------------|----------------|-------------|------------------|
| **Figma** | LLM agents, generative plugins, MCP connectors | High (cloud inference) | No | No |
| **Sketch** | MCP server + on-device ML (Apple Vision) | Low | Partial | No |
| **Penpot** | Token-first design, plugin ecosystem | None | Partial (self-hosted) | No |
| **Canva** | Proprietary foundation model + Magic suite | High | No | Limited |
| **Adobe** | Multi-model (Firefly/Gemini) + legacy heuristics | High | No | Strong |
| **LintPDF / print-check-cli** | Deterministic preflight, self-hostable | None | Yes | Yes |

**Key insight:** Adobe owns the production/print workflow, but it is cloud-dependent and expensive. Strata's local-first Rust + print pipeline gives it a unique position to ship deterministic production intelligence without the cloud cost.

### Strata Current State (from audits)

| Foundation | Status | Evidence |
|------------|--------|----------|
| Typography preflight | Built | `@/packages/scene/src/typographyPreflight.ts` |
| Design governance | Built | `@/packages/scene/src/governance.ts` |
| Color management | Phase 1-4 complete | `@/packages/scene/src/colorManagement.ts`, `printPreflight.ts` |
| Print export | Built | `@/crates/strata-print` |
| Prototype engine | Built | `@/packages/prototype` |
| Variable system | Built | `@/packages/prototype/src/variables.ts` |
| Motion timeline | Phase 1 complete | `@/packages/editor/src/timeline/TimelineSampler.ts` |
| Design tokens / WCAG audit | Built | `pnpm audit:tokens` |

**Critical gap:** These capabilities are fragmented. They need a unified UI surface and a shared audit runner.

### Adjacent Industry Patterns

| Pattern | Source | Adaptability |
|---------|--------|-------------|
| WCAG contrast checking | axe-core / Stark | High — math already exists in `audit:tokens` |
| Median-cut color extraction | ImageMagick / Photoshop | High — fits OKLCH pipeline |
| Constraint solving (Cassowary) | iOS Auto Layout | Medium — extends existing flex layout |
| Deterministic preflight | LintPDF / callas pdfToolbox | High — map to existing Rust PDF pipeline |
| Public data enrichment | Frankfurter / Open-Meteo / Geocoded | High — bind to variable system |
| Structural fingerprinting | Git / content-addressable | Low — too noisy for design files |

### Verification Notes (Knowledge Cutoffs)

- Figma Agent pricing and capabilities may have changed post-June 2026.
- Pantone/RAL/NCS licensing terms must be verified before shipping spot-color libraries.
- Public API rate limits (Frankfurter, NordAPI, Geocoded) should be confirmed before wide release.
- `lcms2` integration status for true ICC-based conversion is a future Rust dependency; Phase 1-2 here avoid it.

---

## IV. Ranked Feature Recommendations

### TIER 1: Ship Clean (passed all 6 roles + adversarial check)

---

#### 1. WCAG Contrast & Target Audit

| Attribute | Detail |
|-----------|--------|
| **Problem Solved** | Designers discover accessibility failures late, incurring 10-30 min fixes each. Legal risk from inaccessible designs. |
| **User Benefit** | Real-time contrast ratio badges on every fill swatch. One-click auto-fix shifts color minimally via OKLCH lightness binary search. Touch target size warnings for mobile output. |
| **Investor Narrative** | "Strata catches accessibility failures at design time, not ship time. Built-in WCAG 2.2 AA compliance — no plugin subscription required." Enterprise buyers (defense, healthcare, gov) require this. |
| **Technical Approach** | Heuristic + math. Relative luminance formula (WCAG 2.1). Contrast ratio = (L1+0.05)/(L2+0.05). Auto-fix via binary search in OKLCH lightness axis bounded by ΔEOK < 5. Background = parent frame fill or white. |
| **Estimated Complexity** | Low-Medium (3 days) |
| **Cost Profile** | $0 — pure math on existing color pipeline |
| **Scalability** | O(1) per contrast pair. O(N) for full document scan. <1ms for 500 nodes. |
| **Risks & Edge Cases** | Transparent backgrounds: warn "can't verify". Gradient fills: check worst-case stop. Gradients over images: warn "depends on background". Multiple fills: check topmost visible. |
| **TDD Guard** | 12 tests: solid/gradient/transparent/text/edge cases, auto-fix ΔEOK bounds, AA vs AAA thresholds |

**Existing infrastructure:** `colorConversion.ts`, `audit:tokens` (93 WCAG-AA pairs), `ManagedColor` type system.

---

#### 2. Content-Aware Smart Spacing Harmonizer

| Attribute | Detail |
|-----------|--------|
| **Problem Solved** | Designers manually eyeball spacing. Inconsistent gaps (8px, 12px, 16px mixed) are the #1 visual quality issue in design reviews. |
| **User Benefit** | One-click "Harmonize Spacing" equalizes gaps to the statistical mode. Detects base spacing unit (e.g., 8px grid) and snaps to multiples. |
| **Investor Narrative** | "Strata detects your spacing system automatically and enforces consistency. No other design tool does this without manual grid setup." |
| **Technical Approach** | Algorithmic. Pairwise edge distances → histogram into 4px bins → sliding-window mode detection. Confidence threshold: >80% fit before suggesting. O(N²) on selection, bounded by typical selection <50 nodes. |
| **Estimated Complexity** | Low (2 days) |
| **Cost Profile** | $0 — pure math |
| **Scalability** | O(N²) where N = selected nodes. For N=50: 2500 pairs, <1ms. |
| **Risks & Edge Cases** | Mixed spacing systems (8px + 12px): conservative mode detection rejects ambiguous patterns. Overlapping nodes: filter out. Rotated elements: use axis-aligned bounds. |
| **TDD Guard** | 10 tests: even/uneven spacing, mode detection confidence, single-node edge case, rotated elements |

**Existing infrastructure:** `nodeWorldBounds`, `distributeSelected`, `computeFlexLayout`, `pointToSegmentDistSq`.

---

#### 3. Path Simplification & Smoothing

| Attribute | Detail |
|-----------|--------|
| **Problem Solved** | Pencil/freehand drawing produces thousands of jagged points. Paths are heavy, uneditable, and visually rough. |
| **User Benefit** | Post-draw RDP simplification reduces point count while preserving shape. Bezier curve fitting converts strokes into smooth, editable curves. User-controlled threshold. |
| **Investor Narrative** | "Strata's pencil tool produces production-ready vector paths, not rough sketches." |
| **Technical Approach** | RDP (Ramer-Douglas-Peucker) for simplification: O(N log N). Least-squares cubic bezier fitting: O(N) tridiagonal solve. `simplifyPoints()` in PencilTool is the integration point. |
| **Estimated Complexity** | Low (2 days) |
| **Cost Profile** | $0 — pure math, existing bezier infrastructure in `@varve/shared/bezier.ts` |
| **Scalability** | O(N log N) for RDP, O(N) for bezier fit. <2ms for 1000-point path. |
| **Risks & Edge Cases** | Over-simplification destroys detail: user-controlled epsilon threshold. Sharp corners: detect angle threshold before simplifying. Complex silhouettes: offer preview. |
| **TDD Guard** | 8 tests: simple path simplification, bezier fitting accuracy, sharp corner preservation, threshold bounds |

**Existing infrastructure:** `simplifyPoints` in PencilTool, `cubicBezierPoint`/`cubicBezierSplit` in `@varve/shared/bezier.ts`.

---

#### 4. Color Palette Extraction & Harmony

| Attribute | Detail |
|-----------|--------|
| **Problem Solved** | Designers manually extract colors from brand photos. No way to generate harmonious palettes from a seed color. |
| **User Benefit** | "Extract Palette" on any image produces 5-8 dominant colors. "Generate Harmony" creates complementary/analogous/triadic/split-complementary palettes in OKLCH. One-click apply as document swatches. |
| **Investor Narrative** | "Strata turns any brand photo into a design system — offline." |
| **Technical Approach** | Median-cut quantization on 64×64 downsampled image (~5ms). Harmony generation via OKLCH hue rotation: complementary (180°), triadic (±120°), analogous (±30°), split-complementary (150°/210°). Gamut mapping ensures displayable colors. |
| **Estimated Complexity** | Low-Medium (2.5 days) |
| **Cost Profile** | $0 — median-cut is ~200 lines of JS, no external deps |
| **Scalability** | O(N log K) where N = 4096 (64×64), K = color count. <5ms. |
| **Risks & Edge Cases** | Photographs with thousands of similar colors: user picks color count. Low-contrast images: warn "limited palette range". Transparent images: ignore alpha. |
| **TDD Guard** | 10 tests: quantization accuracy, harmony math, gamut boundary, edge cases (grayscale, transparent) |

**Existing infrastructure:** `ImageCache`, `CompositeCanvas`, `addSwatch`/`removeSwatch`, OKLCH pipeline, `histogram.ts`.

---

#### 5. Prototype Interaction Validation

| Attribute | Detail |
|-----------|--------|
| **Problem Solved** | Prototype links break, screens become unreachable, and flows have dead ends. These are caught only during manual testing. |
| **User Benefit** | Live graph validation: unreachable screens, broken targets, missing start screen, orphan interactions. |
| **Investor Narrative** | "Strata validates your prototype graph before anyone clicks through it." |
| **Technical Approach** | Graph traversal (BFS/DFS) on the interaction graph in `packages/prototype/src/runtime.ts`. Deterministic, O(nodes + interactions). |
| **Estimated Complexity** | Low (2 days) |
| **Cost Profile** | $0 |
| **Scalability** | O(N + E) per check. <1ms for typical prototypes. |
| **Risks & Edge Cases** | Conditional interactions may create false dead-end warnings. Must support all 14 trigger types in the prototype engine. |
| **TDD Guard** | 10 tests: unreachable screen, broken target, dead end, conditional flow, multi-start-screen |

**Existing infrastructure:** `packages/prototype/src/runtime.ts`, `VariableStore`.

---

### TIER 2: Ship with Constraints (conditional pass)

---

#### 6. Content-Aware Layer Naming

| Attribute | Detail |
|-----------|--------|
| **Problem Solved** | "Rectangle 47" / "Frame 12" debt makes handoff painful. New users don't know naming conventions. |
| **User Benefit** | Decision-tree classification: text with "Submit" → "Button: Submit", large centered text → "Heading: ...", frame with component → "ComponentName instance". Ghost text suggestion in rename field. |
| **Investor Narrative** | "Strata names layers semantically, not sequentially." |
| **Technical Approach** | Decision tree (14 ordered rules, first match wins). Pure heuristics on node properties (kind, text content, fontSize, textAlign, childCount, componentId). O(1) per node. |
| **Estimated Complexity** | Low (2 days) |
| **Cost Profile** | $0 |
| **Scalability** | O(N) for batch rename. <1ms for 500 nodes. |
| **Risks & Edge Cases** | Overly generic names ("Interactive Element"): scope to concrete patterns. Domain-specific names ("Primary CTA"): defer until design system context model exists. |
| **TDD Guard** | 14 tests: one per decision rule, boundary cases, custom name preservation |

**Constraint:** Ship as rule-based only. Do NOT attempt ML classification.

---

#### 7. Live Design-System Governance

| Attribute | Detail |
|-----------|--------|
| **Problem Solved** | Design files drift from the system — untokenized colors, inline values, duplicate styles, orphan components, missing fonts. |
| **User Benefit** | Real-time rules panel: colors must match swatches, spacing must use tokens, components must follow naming conventions, orphans are flagged. |
| **Investor Narrative** | "Strata enforces design-system invariants at design time. No drift, no debt, no handoff surprises." |
| **Technical Approach** | Extend `packages/scene/src/governance.ts` into a real-time rule engine. Rules are deterministic pure functions on the document model. |
| **Estimated Complexity** | Medium (5 days) |
| **Cost Profile** | $0 |
| **Scalability** | O(nodes × rules) per document. Dirty tracking per node keeps 10× growth manageable. |
| **Risks & Edge Cases** | False positives from intentional one-off designs. Rule set proliferation. UI lag without caching. |
| **TDD Guard** | 18 tests: token color rule, spacing rule, naming rule, orphan rule, font rule, false positive cases |

**Constraint:** Start with 5 core rules. Do not ship a generic rule language until the basics are validated.

---

#### 8. Design Debt Scanner

| Attribute | Detail |
|-----------|--------|
| **Problem Solved** | Design system drift, orphaned styles, inconsistent naming, unused components accumulate silently. Manual audits take 30-60 min per cycle. |
| **User Benefit** | "Debt" tab in inspector with categorized issue list. StatusBar badge. Click issue → selects node. "Fix all" for批量 issues. |
| **Investor Narrative** | "Strata scans your design system health automatically. SonarQube for design." |
| **Technical Approach** | 15 named pure functions. Reuses `validateNamingConventions`, `findOrphanedStyles`, `findUnusedComponents`, `generateStyleUsageReport`. |
| **Estimated Complexity** | Medium (5 days) |
| **Cost Profile** | $0 |
| **Scalability** | O(N) per check, 15 checks. Runs on `requestIdleCallback` with 50ms budget per chunk. 5000-node document → <200ms. |
| **Risks & Edge Cases** | Composite score becomes vanity metric: ship individual checks first. Weight misconfiguration: make weights transparent. |
| **TDD Guard** | 20+ tests: one per check, false positives, batch fix operations |

**Constraint:** Ship individual checks as a dashboard. Defer the composite "health score" until weights are validated.

---

#### 9. Production Preflight Dashboard

| Attribute | Detail |
|-----------|--------|
| **Problem Solved** | Print/PDF export fails late because bleed, color mode, resolution, or font issues are only caught at export. |
| **User Benefit** | Continuous production readiness score. Errors surfaced before export, preventing costly reprints. |
| **Investor Narrative** | "Strata is the professional print-ready design tool. Figma and Sketch cannot compete here." |
| **Technical Approach** | Extend `packages/scene/src/printPreflight.ts` into a live panel. Checks: bleed/trim/safe-area, color space, low-res images, missing fonts, TAC. |
| **Estimated Complexity** | Medium (5 days) |
| **Cost Profile** | $0 — local computation |
| **Scalability** | Bounded by document size. Dirty tracking to only re-check mutated nodes. |
| **Risks & Edge Cases** | False warnings for intentional design choices. Profile-specific thresholds vary by printer. |
| **TDD Guard** | 15 tests: bleed violation, untagged colors, low-res image, missing font, TAC overflow |

**Constraint:** Wire `NewFileDialog` to persist `colorMode`, `unit`, `bleed`, `dpi` into `Document` first (per color-management audit Phase 1). Without this, preflight has no document state to validate.

---

#### 10. Cross-Platform Codegen Optimization

| Attribute | Detail |
|-----------|--------|
| **Problem Solved** | Current codegen produces syntactically correct but unoptimized output for Flutter/SwiftUI/React. |
| **User Benefit** | Post-processing pass applies platform-specific optimization rules. "Verbose mode" toggle. |
| **Investor Narrative** | "Strata's codegen guarantees pixel-perfect, idiomatic output across platforms." |
| **Technical Approach** | Rule-based AST rewriting. Each platform has ~20 optimization rules. Fallback path: if optimized output might be broken, emit verbose correct code. |
| **Estimated Complexity** | Medium (3 days) |
| **Cost Profile** | $0 — deterministic rules, no inference |
| **Scalability** | O(nodes) per rule application. <50ms for typical component. |
| **Risks & Edge Cases** | Optimizations that break on edge cases: every rule must have a fallback. Complex gradients/nested transforms: emit verbose code. |
| **TDD Guard** | 12 tests: per-platform optimization correctness, fallback paths, verbose mode parity |

**Constraint:** Every optimization MUST have a "fallback" path. Ship with "verbose mode" toggle.

---

#### 11. Public-Data Variable Feeds

| Attribute | Detail |
|-----------|--------|
| **Problem Solved** | Prototypes and mockups use stale or fake data (currency, weather, dates, locations). |
| **User Benefit** | Realistic, localized content in prototypes without manual updates. |
| **Investor Narrative** | "Strata's prototypes use real-world data — with zero backend." |
| **Technical Approach** | Bind `VariableStore` to free public APIs: **Frankfurter** (exchange rates), **Open-Meteo/NordAPI** (weather), **Geocoded** (country/city/currency). Client-side caching (15 min TTL). Offline fallback values. |
| **Estimated Complexity** | Low (2 days) |
| **Cost Profile** | Free public APIs. No hosting. |
| **Scalability** | 10× growth means more API calls; caching and throttling prevent issues. |
| **Risks & Edge Cases** | API downtime/deprecation. CORS in web/WASM builds. IP geolocation privacy leak. Stale data in financial/medical contexts. |
| **TDD Guard** | 10 tests: mock API responses, fallback values, caching TTL, offline behavior |

**Constraint:** All feeds are opt-in per variable. Display prominent "data may be stale" warning for financial/medical use cases.

---

#### 12. Print Cost Estimator

| Attribute | Detail |
|-----------|--------|
| **Problem Solved** | Designers and print buyers don't know the cost impact of page count, color coverage, paper, and bleed. |
| **User Benefit** | Rough cost estimate before sending to a printer. |
| **Investor Narrative** | "Strata estimates print cost before you commit to production." |
| **Technical Approach** | Estimate ink coverage from the IR. User-configurable settings (paper, quantity, color mode). Formula: `coverage × area × ink_rate × quantity`. |
| **Estimated Complexity** | Low (2 days) |
| **Cost Profile** | $0 — local heuristic, optional public commodity index |
| **Scalability** | O(pages) per estimate. |
| **Risks & Edge Cases** | Accuracy is approximate; label as "estimate". Regional price variation. Spot colors/varnishes not captured. |
| **TDD Guard** | 8 tests: solid-black vs white page, multi-page, spot color flag, quantity scaling |

---

### TIER 3: Defer (killed or blocked by prerequisites)

| Feature | Verdict | Reason |
|---------|---------|--------|
| Auto-Layout Suggestion | **FAIL** | Heuristic accuracy too low (est. 60%) for trust threshold. Defer until `layoutStyle` usage data can train heuristics. |
| Component Detection (Merkle hash) | **FAIL** | Structural hashing catches exact duplicates only. Real files have noise. Need visual similarity instead. |
| Smart Renaming (ML classifier) | **FAIL** | Review/correction overhead consumes time saved. ROI negative. |
| Constraint Inference | **FAIL** | Underdetermined from a single static frame. Needs behavioral observation. |
| Auto-Layout Suggestion (revisit) | **DEFER** | Revisit after Phase 1-2 ships. |
| Design Branching (Git for Design) | **DEFER** | Requires CRDT scene graph infrastructure. |
| Predictive Layout Intelligence | **DEFER** | Requires 3+ months of usage data. Ship action recording first. |
| Animation Contract Engine | **DEFER** | Existing prototype engine handles this partially. Full compositional animation is Phase 2+. |
| True ICC-Based Color Conversion | **DEFER** | Requires `lcms2` Rust integration. Architecture ready, but not in this plan. |

---

## V. Quick Wins vs. Strategic Opportunities

### Quick Wins (1-3 days each, immediate impact)

| Feature | Days | Why Quick |
|---------|------|-----------|
| WCAG Contrast Audit | 3 | Math exists in `audit:tokens` |
| Smart Spacing Harmonizer | 2 | Pure math on `nodeWorldBounds` |
| Path Simplification | 2 | `simplifyPoints()` already in PencilTool |
| Color Palette Extraction | 2.5 | Median-cut + OKLCH pipeline exists |
| Content-Aware Naming | 2 | Decision tree on existing node properties |
| Prototype Interaction Validation | 2 | Graph already exists in `runtime.ts` |
| Public-Data Variable Feeds | 2 | VariableStore already exists |
| Print Cost Estimator | 2 | IR-based coverage heuristic |

### Strategic Opportunities (3-5 days each, moat-building)

| Feature | Days | Why Strategic |
|---------|------|---------------|
| Live Design-System Governance | 5 | Reuses governance module; creates invariant enforcement |
| Production Preflight Dashboard | 5 | Defines Strata's print-production differentiation |
| Design Debt Scanner | 5 | Creates "SonarQube for design" category |
| Cross-Platform Codegen Optimization | 3 | Unique platform-specific output differentiator |
| Action Recording Infrastructure | 2 | Foundation for future personalization |

---

## VI. Risk Assessment & Validation Checklist

### Overarching Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Performance regression** | Medium | All features <16ms real-time or `requestIdleCallback`. No canvas blocking. |
| **False positive fatigue** | Medium | Confidence threshold >80% before suggesting. Easy dismiss. |
| **Privacy violation** | High | No document data transmitted. Public APIs client-side only. |
| **API availability** | Medium | Cache responses; graceful fallbacks. |
| **Bundle size bloat** | Low | No ML models. Pure TS/math. Estimated <60KB total. |
| **Scope creep** | High | Reject any feature requiring LLM inference or cloud hosting. |
| **Maintenance burden** | Low | Each feature is a pure function module. |

### Post-Implementation Validation Checklist

For EACH feature, verify:

- [ ] `pnpm typecheck` — 15/15 packages pass
- [ ] `pnpm test` — all new + existing tests pass
- [ ] `pnpm lint` — 0 new errors on modified files
- [ ] `pnpm audit:tokens` — 93/93 WCAG-AA
- [ ] `pnpm audit:emoji` — zero violations
- [ ] `cargo test --workspace` — if Rust files touched
- [ ] `just gate` — full Cascade Review gate
- [ ] Performance: real-time <16ms, on-demand <500ms, batch <2s
- [ ] Accessibility: new UI uses tokens, aria labels, keyboard accessible
- [ ] Reduced motion: all animations respect `prefers-reduced-motion`
- [ ] Cross-platform: Linux, macOS, Windows, web (WASM)
- [ ] Offline: no feature requires network connectivity
- [ ] Undo: all intelligence actions are single-undo-step reversible

---

## VII. Prioritized Implementation Roadmap

### Phase 0: Foundation (3 days)

| Day | Task | Files |
|-----|------|-------|
| 0a | Shared audit infrastructure | `packages/scene/src/intelligence/audit.ts` + test |
| 0b | WCAG math utilities | `packages/shared/src/contrast.ts` + test |
| 0c | Intelligence panel shell | `packages/editor/src/panels/IntelligencePanel.tsx` + test |

**Gate:** `just gate`.

---

### Phase 1: Quick Wins (9 days)

| Day | Feature | Files |
|-----|---------|-------|
| 1.1 | WCAG Contrast Auto-Fix (3d) | `intelligence/wcagFix.ts` + test + `ContrastIndicator.tsx` |
| 1.2 | Smart Spacing Harmonizer (2d) | `intelligence/spacingHarmonizer.ts` + test |
| 1.3 | Path Simplification (2d) | `intelligence/pathSimplifier.ts` + test |
| 1.4 | Prototype Interaction Validation (2d) | `intelligence/prototypeValidator.ts` + test + panel integration |

**Gate:** `just gate`.

---

### Phase 2: Design System & Color (9.5 days)

| Day | Feature | Files |
|-----|---------|-------|
| 2.1 | Color Palette Extraction (2.5d) | `intelligence/paletteExtractor.ts` + test |
| 2.2 | Content-Aware Layer Naming (2d) | `intelligence/autoNamer.ts` + test |
| 2.3 | Live Design-System Governance (5d) | `intelligence/designSystemRules.ts` + test + rules UI |

**Gate:** `just gate`.

---

### Phase 3: Production Intelligence (7 days)

| Day | Feature | Files |
|-----|---------|-------|
| 3.1 | Wire `NewFileDialog` → `Document` (1d) | `packages/home/src/NewFileDialog.tsx`, `packages/scene/src/document.ts` |
| 3.2 | Production Preflight Dashboard (4d) | Extend `printPreflight.ts` + panel + canvas bleed/trim guides |
| 3.3 | Print Cost Estimator (2d) | `intelligence/printCostEstimator.ts` + test + export dialog |

**Gate:** `just gate`.

**Note:** Phase 3 depends on color-management Phase 1-4 already being complete (which it is, per memory).

---

### Phase 4: Debt & Codegen (8 days)

| Day | Feature | Files |
|-----|---------|-------|
| 4.1 | Design Debt Scanner (5d) | `intelligence/debtScanner.ts` + test + `DebtPanel.tsx` + `DebtBadge.tsx` |
| 4.2 | Cross-Platform Codegen Optimization (3d) | `packages/codegen/src/optimizers/*.ts` + test |

**Gate:** `just gate`.

---

### Phase 5: Public Data & Personalization (5 days)

| Day | Feature | Files |
|-----|---------|-------|
| 5.1 | Public-Data Variable Feeds (2d) | `packages/prototype/src/variables/publicData.ts` + test + `VariablePanel` integration |
| 5.2 | Action Recording Infrastructure (3d) | `intelligence/actionTracker.ts` + test |

**Gate:** `just gate`.

---

### Phase 6: Deferred Revisit (post-data)

| Feature | Prerequisite |
|---------|-------------|
| Adaptive Toolbar / Shortcut Recommender | 3+ months of action recording data |
| Auto-Layout Suggestion | `layoutStyle` usage data |
| Predictive Layout Intelligence | action recording + usage data |
| True ICC-Based Conversion | `lcms2` Rust integration |

---

## Summary

| Metric | Value |
|--------|-------|
| Total primary features | 12 |
| Estimated effort | ~38 days |
| New source modules | ~22 |
| Estimated new tests | ~200 |
| LLM dependencies | 0 |
| Required API keys | 0 |
| Recurring costs | $0 |
| Added bundle size | <60KB (no ML models) |
| All computation | Client-side only |
| Features killed | 4 (Auto-Layout, Merkle Detection, ML Renaming, Constraint Inference) |
| Features shipped with constraints | 6 (Naming, Governance, Debt Scanner, Preflight, Codegen, Public Data) |
| Features shipped clean | 6 (WCAG, Spacing, Path Simplification, Palette Extraction, Prototype Validation, Print Cost) |

---

## Committed plan — use this document for implementation in a separate session.
