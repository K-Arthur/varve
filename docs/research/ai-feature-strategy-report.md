# AI Feature Strategy: Strata
**Date:** July 21, 2026
**Context:** Local-first, cross-platform design suite. Tauri desktop + WASM web. Rust engine, TypeScript editor.

---

## Executive Summary

Strata already has **54 intelligence modules** across 3 packages with a surprisingly mature client-side AI infrastructure — ONNX runtime (bundled + native), heuristic rules engines, user behavior tracking, and 340+ background-removal tests. The opportunity is not "what AI should we build?" but **"how do we surface existing intelligence and fill strategic gaps?"**

**Key findings:**

1. **~23 of 29 editor intelligence modules have no user-facing UI** — built in Session 50, never wired. The highest-ROI work is connecting existing modules, not building new ones.

2. **Strata's unique competitive opening is non-LLM, client-side design intelligence.** While Figma/Canva/Adobe chase cloud diffusion models, Strata can own the local-first, privacy-preserving, always-available intelligence space — **design linting, heuristics, optimization algorithms, and parametric constraints** that work offline with zero recurring cost.

3. **Three genuinely differentiated strategic bets:**
   - **Design Linter** (like ESLint for design) — codified design rules that audit for consistency, accessibility, and best practices. Exists as `debtScanner.ts` + `governanceRules.ts` but needs surfacing.
   - **Constraint-Based Layout Engine** — geometric constraints between vector shapes (equal radius, tangent, align) via `kiwi.js` Cassowary solver. No competitor does this well.
   - **Parametric Geometry** — variable bindings that drive shape dimensions (not just fills). Extends existing `PropertyBinding` to `w/h/x/y`. Niche but powerful.

4. **Cloud dependency is not required** for any high-impact recommendation. All proposed features work fully offline.

---

## 1. Research Findings: Existing Intelligence Infrastructure

### What's Already Built (and Working)

| Category | Modules | Wired? |
|----------|---------|--------|
| **Design audit** | WCAG contrast, layout score, cognitive load, debt scanner, governance rules, prototype flow analyzer | Partially (IntelligencePanel tabs) |
| **Naming** | autoNamer (14-rule decision tree), batch rename | Partially (not wired into node creation) |
| **Spacing** | spacingHarmonizer, autoLayoutSuggestor | Yes (QuickActionsBar, IntelligencePanel) |
| **Detection** | componentDetector, variantDetector, styleDeduplicator | Mostly (Components tab, not variant tab) |
| **Analytics** | actionTracker, commandRanker, workflowAnalyzer, tokenAnalytics, shortcutRecommender, designFingerprint | No (modules exist, no UI) |
| **Advisors** | exportAdvisor, imageFitAdvisor, easingAdvisor, transitionAdvisor, smartDefaults, progressiveComplexity, cognitiveLoad | Partial (exportAdvisor wired) |
| **AI Assistant** | @varve/ai chat with 4 keyword-dispatch commands | Yes (AIPanel, keyboard shortcuts) |
| **ML Infrastructure** | ONNX inference (3 backends), model loading/downloading, environment capability detection | Yes (bg-removal pipeline) |

### What's Not Yet Built (Gaps)

| Gap | Priority | Current state |
|-----|----------|--------------|
| Wire autoNamer into node creation | **P0** | autoNamer exists, called occasionally, not at every createShapeAt |
| Wire ActionTracker globally | **P0** | recorded sporadically, not from tools/menus |
| Connect registry.ts to IntelligencePanel | **P1** | registry.ts exists but registerFeature() never called |
| Unify contrast checking | **P2** | 3 parallel implementations (audit.ts, wcagFix.ts, debtScanner.ts) |
| Unified search index | **P2** | semanticSearch.ts does structural matching only; no inverted index |

---

## 2. Competitor Analysis

### Feature Coverage Matrix

| Feature | Figma | Adobe/PS | Canva | Sketch | Penpot | **Strata** |
|---------|-------|----------|-------|--------|--------|-----------|
| Background removal | Cloud | Local+Cloud | Cloud | — | — | **Local** (4 providers) |
| Generative fill | Cloud | Cloud | Cloud | — | — | — |
| AI layer naming | Cloud | — | — | — | — | **Heuristic** (autoNamer) |
| WCAG audit | — | — | Basic | — | — | **OKLCH binary search** |
| Design linting | — | — | — | — | — | **15-rule debt scanner** |
| Component detection | — | — | — | — | — | **Structure matching** |
| Spacing harmonizer | — | — | — | — | — | **Histogram equalization** |
| Layout scoring | — | — | — | — | — | **0-100 score** |
| Auto export advise | — | — | — | — | — | **Content-based format** |
| Screenshot → Design | — | — | — | — | — | **Uses SVG parser** |
| MCP Server (agent API) | ✓ | — | — | ✓ | ✓ | — |
| On-device neural filters | — | ✓ | — | ✓ (Affinity) | — | **ONNX pipeline** |
| On-device upscaling | — | — | — | ✓ | — | **Bundled Real-ESRGAN** |

### Key Insight
Strata has **more non-LLM intelligence features than any competitor** — but most are invisible to users. The features themselves (naming, audit, component detection, spacing) outperform or match cloud alternatives for core design workflows while costing $0 to operate. **The gap is surfacing, not capability.**

---

## 3. Trends & Adjacent-Industry Analysis

### Cross-Domain Adaptations with Highest Signal

| Source Domain | Adapted Feature | Strata Fit | Effort |
|--------------|----------------|------------|--------|
| **CAD** | Geometric constraint solver (Cassowary) | High — vector tool with no constraints | 5 days |
| **CAD** | Parametric geometry (variables drive dimensions) | High — PropertyBinding exists but only covers fills/opacity | 3 days |
| **GIS** | Force-directed label placement | High — maps/flowcharts/diagrams in design | 2 days |
| **Photography** | Auto-straighten on import | Medium — Sobel+Hough on image insert | 0.5 day |
| **Video editing** | Auto-scene/page break detection | Medium — density-gap analysis for multi-page docs | 1 day |
| **Game dev** | Auto-variant generation from user fingerprint | Medium — already have the data (designFingerprint) | 2 days |
| **Audio production** | Beat/rhythm detection for spacing | Medium — autocorrelation of element x-positions | 1 day |
| **3D/VFX** | Procedural fill patterns (simplex noise) | High — no-code organic textures | 1 day |
| **Medical imaging** | Foreground object selection via BiRefNet | High — reuses existing ONNX model | 3 days |
| **Data viz** | Accessible palette generator (OKLCH) | High — protects against color blindness | 1 day |
| **E-commerce** | Visual similarity search (phash) | Medium — find duplicate layers | 2 days |
| **A11y tech** | Focus order + touch target audit | High — critical for spec handoff | 1 day |

### Patterns from Competitors That Strata Should NOT Copy

| Trend | Why avoid |
|-------|-----------|
| Cloud diffusion image generation (Firefly, Canva Magic) | High recurring cost, offloads user IP, no local-first ethos, expensive inference hardware, already commoditized |
| LLM-powered chat agents (Figma AI Agent) | Requires proprietary LLM, expensive per-user inference, local-first mandate prohibits mandatory cloud dependency |
| AI plugin generation (Figma Generative Plugins) | Requires LLM codegen capability, massive scope, unclear actual user value beyond demos |
| AI video/animation (Canva Magic Animate) | Canva's mass-market user base wants this; Strata's power-user base values control over automation |
| Beat sync / audio-reactive design | Niche to the point of gimmick, complex implementation, unclear design tool UX |

### What Competitors Do That Strata SHOULD Match

| Table-stakes feature | Implementation | Effort |
|---------------------|---------------|--------|
| Select by fill color | Existing: walk nodes + Oklab ΔE | 3h |
| Select by font | Existing: walk text nodes | 2h |
| Select by effect | Existing: walk effects array | 1h |
| Full-text layer search | New: inverted index | 12h |
| On-import background removal | Auto-detect, one-click apply | 4h (wraps existing pipeline) |
| Smart layout suggestions | Existing: autoLayoutSuggestor.ts | 4h (wire into UI) |
| Auto color harmony from hero image | Existing: paletteExtractor.ts + apply | 8h |

---

## 4. Free / Public API Opportunities

### Tier 1: Default-on with offline fallback

| API | Value | Why default-on |
|-----|-------|---------------|
| **Google Fonts API** | Font browser with full family/axis metadata | Essential for typography; snapshot file works offline |
| **Iconify API** | 300k+ open-source icons in design tool | Massive value; cache first N popular sets locally |
| **The Color API** | Color naming, scheme generation | No key required; cache results per color |
| **Simple Icons** (bundled) | 3000+ brand SVG logos (GitHub, Slack, etc.) | Bundle as data file (~500KB), no API call needed |
| **Unicode/Emoji data** (bundled) | Emoji picker with search | Bundle as JSON (~300KB) |

### Tier 2: Opt-in with clear offline degradation

| API | Value | Caveat |
|-----|-------|--------|
| **Frankfurter** (currency, no key) | Live rates for data-viz mockups | Free unlimited, no key, trivial HTTP fetch |
| **Open-Meteo** (weather, no key) | Real weather for contextual mockups | Free, no rate limit for typical use |
| **World Bank API** | Live economic data for infographic mockups | Unique differentiator for data-design workflow |
| **QuickChart.io** | Server-rendered charts from URL parameters | Generates PNG/SVG charts on the fly |
| **LibreTranslate** | In-app text translation (self-host or public) | Self-hostable, or use public instances |
| **Hugging Face Inference API** | Configurable AI inference backend | User brings their own API key; free tier available |

### Tier 3: Skip

| API | Why skip |
|-----|----------|
| Unsplash | Attribution required, API quota, competing with Pixabay (better terms) |
| OpenWeatherMap | Credit card required even for free tier |
| OpenAI/Claude free tiers | Rate-limited, requires user accounts, conflicts with local-first ethos |
| Wolfram Alpha | Too niche, low quota, complex integration |
| ExchangeRate-API | Frankfurter is better (no key, unlimited) |

---

## 5. Ranked Feature Recommendations

### Tier 0: Zero-Effort Wins (Already Built, Just Need Wiring)

These require **no new algorithms, no new infrastructure, no new APIs**. Only UI connections.

| # | Feature | What to do | Effort | Impact | Existing Module |
|---|---------|-----------|--------|--------|-----------------|
| 0.1 | Auto-name layers on creation | Call `suggestName()` in `createShapeAt`/`createTextNodeAt` | 4h | Very High | `autoNamer.ts` |
| 0.2 | ActionTracker global wiring | Call `record()` from all tool handlers, menu items, shortcuts | 6h | High (enables 6+ downstream features) | `actionTracker.ts` |
| 0.3 | Cognitive load → IntelligencePanel | Add "Complexity" tab showing node/web count, depth, blend diversity | 4h | Medium | `cognitiveLoad.ts` |
| 0.4 | Command ranker → Dynamic toolbar | Reorder toolbar by `rankCommands()` | 8h | Medium-High | `commandRanker.ts` |
| 0.5 | Registry → IntelligencePanel | Hook `registerFeature()` into actual tab rendering | 6h | Medium (enables pluggable features) | `registry.ts` |
| 0.6 | Smart defaults → New document | Pre-fill frame size, spacing, font from `getSmartDefaults()` | 4h | Medium | `smartDefaults.ts` |
| 0.7 | Prototype flow analysis → IntelligencePanel | Add "Prototype" tab showing dead-end screens, orphans | 4h | Medium | `prototypeFlowAnalyzer.ts` |

**Total: ~36h for 7 visible features, all reusing existing code.**

### Tier 1: Quick Wins (1-2 days each, purely heuristic)

| # | Feature | Approach | Effort | Impact |
|---|---------|----------|--------|--------|
| 1.1 | Select by fill color | Walk nodes, compare fills via Oklab ΔE < threshold | 3h | High |
| 1.2 | Select by font family | Walk text nodes, index + filter | 2h | High |
| 1.3 | Select by effect type | Walk nodes, filter by effect type presence | 1h | Medium |
| 1.4 | Zero-size / off-canvas layer detection | Add 2 checks to debtScanner | 2h | High (finds "lost" layers) |
| 1.5 | Auto-straighten on image import | Sobel edge → Hough → auto-rotate | 4h | Medium |
| 1.6 | Dehaze adjustment formula | `output = (input - haze) / (1 - haze)` | 4h | Medium (photography niche) |
| 1.7 | Touch target size audit | Find < 44×44px interactive elements | 3h | High (a11y compliance) |
| 1.8 | Focus order visualization | Numbered overlay of tab sequence | 4h | High (spec handoff) |
| 1.9 | Empty frame/group detection | Walk containers with 0 visible children | 1h | Medium |
| 1.10 | Accessible palette generator | OKLCH hue spread + color-blind filter | 6h | Medium-High |

**Total: ~30h for 10 features. All heuristics, no ML.**

### Tier 2: Strategic Differentiators (3-5 days each)

| # | Feature | Approach | Effort | Impact | Risk |
|---|---------|----------|--------|--------|------|
| 2.1 | **Parametric geometry** | Extend PropertyBinding to node w/h/x/y. Variables drive shape dimensions. | 3 days | ★★★★★ | Low — extends existing system |
| 2.2 | **Auto-arrange (grid/circle/flow)** | Given N nodes + layout kind, compute target transforms via closed-form math | 4 days | ★★★★★ | Low — linear algebra |
| 2.3 | **Full-text layer search** | Inverted index (Map<token, NodeId[]>) + fuzzy matching | 3 days | ★★★★☆ | Low — well-understood pattern |
| 2.4 | **Smart label placement** | Force-directed layout with overlap avoidance potential fields | 2 days | ★★★★☆ | Medium — convergence edge cases |
| 2.5 | **Auto-color harmony from hero** | paletteExtractor → fill replacement via nearest-OKLCH | 2 days | ★★★★☆ | Low — existing building blocks |
| 2.6 | **Procedural fill patterns** | WebWorker + simplex/perlin noise → pattern FillIR | 2 days | ★★★☆☆ | Low — pure math |
| 2.7 | **Auto-responsive constraints** | Analyze child positions relative to frame edges → suggest pins/scale | 4 days | ★★★★☆ | Medium — heuristics can be wrong |
| 2.8 | **Batch rename with regex** | `renameSelected(pattern, replacement)` with capture groups | 2 days | ★★★☆☆ | Low |
| 2.9 | **Color blindness simulation** | Brettel 1997 LMS transform matrix on canvas render | 2 days | ★★★☆☆ | Low — math, no ML |
| 2.10 | **Recovery points at major ops** | Create recovery point before any >3-node mutation | 1 day | ★★★★☆ | Low |

**Total: ~26 days for 10 features.**

### Tier 3: ML-Enhanced Features (use existing ONNX infrastructure)

| # | Feature | Approach | Effort | Impact | Risk |
|---|---------|----------|--------|--------|------|
| 3.1 | **Foreground object selection** | Repurpose BiRefNet for click-based segmentation | 3 days | ★★★★★ | Medium — reuses existing model |
| 3.2 | **Visual similarity search** | PERCEPTUAL hash on 16×16 thumbnails → hamming distance | 2 days | ★★★☆☆ | Low — no model needed |
| 3.3 | **Auto-variant generation** | Combine designFingerprint + componentDetector → generate N plausible variants | 2 days | ★★★★☆ | Medium — quality varies |
| 3.4 | **Smart image upscale on export** | Real-ESRGAN (already bundled) triggered when export > source resolution | 2 days | ★★★☆☆ | Low — model exists |
| 3.5 | **Depth-aware effects** | Depth-Anything model → apply blur/intensity by depth | 4 days | ★★★☆☆ | Medium — 27MB download |

**Total: ~13 days for 5 ML features, all reusing existing ONNX/worker infrastructure.**

---

## 6. Quick Wins (Shippable in 1-2 Sessions)

### Session 1: "AI That Actually Works" (2-3 days)
1. Wire `autoNamer` into `createShapeAt` / `createTextNodeAt` — every node created with a sensible name
2. Add "Select by fill/font/effect" context methods — Ctrl+Shift+F opens color swatch picker for selection
3. Add `checkHiddenLayers` / `checkZeroSizeLayers` to debt scanner — surfacing in Debt tab
4. Wire `ActionTracker.record()` into 20 key action points — enables all downstream analytics

**Visible result:** Users immediately see named layers, can select by property, debt badge catches real issues. Zero new concepts to learn.

### Session 2: "Design Linter MVP" (2-3 days)
1. Surface `cognitiveLoad.ts` in IntelligencePanel as "Complexity" tab
2. Add focus order visualization overlay (Ctrl+Shift+F)
3. Add touch target audit to debt scanner
4. Wire `smartDefaults.ts` into new document creation
5. Add empty container detection

**Visible result:** Strata becomes the only design tool with a built-in design linter. Investor-ready demo: "Select a layer, see its issues, one-click fix."

---

## 7. High-Impact Strategic Opportunities

### Opportunity A: Design Linter (Strata's Moat)

**What:** Rule-based design consistency engine. 15+ checks (and growing) codifying design best practices:
- Color token compliance (using shared swatches vs hardcoded values)
- Spacing grid alignment (elements snapped to 4px/8px grid)
- Typography consistency (font count, size rhythm, baseline alignment)
- Accessibility (WCAG AA contrast, touch targets, focus order)
- Layer hygiene (empty groups, zero-size, off-canvas, hidden-behind-opaque)
- Component discipline (not-detected components, style reuse)
- Performance (over-nesting, excessive effects, large images)

**Why it's a moat:**
- No design tool has a comprehensive linter (Figma has "design-lint" plugin; it's third-party, basic)
- Adobe has no equivalent at all
- Canva is consumer-focused and doesn't target professional consistency workflows
- This is inherently client-side (no cloud needed) — aligns with Strata's architecture
- Grows more valuable as the rule set expands — network effects for the rule ecosystem

**Investor narrative:** "ESLint for design. Every professional design team has style guides they manually enforce. Strata automates this with zero cloud cost. As rules accumulate, switching costs increase."

**Complexity:** Low to Medium. 60% of the rules already exist in `debtScanner.ts`, `governanceRules.ts`, `cognitiveLoad.ts`, and `wcagFix.ts`. The work is integration and surfacing, not invention.

### Opportunity B: Parametric + Constraint-Based Design

**What:** Variables drive geometry (not just fills). Geometric constraints between shapes (equal radius, tangent, align, fixed distance).

**Why strategic:**
- Fully differentiates from Figma/Sketch (which have basic constraints but not geometric)
- Serves the technical designer / engineer-in-design niche — growing demographic
- Integrates with existing `VariableStore` and `PropertyBinding` systems
- No cloud dependency — Cassowary solver is ~15KB, pure TS
- Natural extension for responsive design workflows

**Investor narrative:** "Strata is the first design tool that treats dimensions as programmable variables. Designers who think in systems, not pixels."

**Complexity:** Medium. Requires new UI surfaces (constraint inspector, variable-typed dimensions).

### Opportunity C: Privacy-Preserving Analytics & Personalization

**What:** The `ActionTracker` system logs user actions locally (never exfiltrated). Feed into:
- Command ranking (reorder toolbar by usage)
- Workflow detection (trigram patterns → "Did you know you can use duplicate?")
- Shortcut adoption nudges ("You've used Align 12 times — try Ctrl+Shift+A")
- Smart defaults (inferred preferred frame size, spacing, font)
- Undo friction analysis (which operations get undone most often → UI improvement targets)

**Why strategic:**
- Every competitor does cloud-based analytics (loss of privacy, requires connectivity)
- Zero infrastructure cost — runs in localStorage
- Personalization improves over time without any cloud investment
- Provides product team with genuine usage data (opt-in anonymized aggregate)

**Investor narrative:** "Personalization that respects privacy. The app gets smarter the more you use it, and none of your data leaves your machine."

**Complexity:** Low. All modules exist, just need `ActionTracker.record()` wiring.

---

## 8. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-----------|--------|-----------|
| ONNX model inference blocks main thread | Low | High | All inference must go through Worker. `inferenceWorkerHost.ts` exists. Enforce via code review. |
| Heuristic analysis O(n²) on large docs | Medium | Medium | Profile all new heuristics against 10K node benchmark. Set <200ms budget. |
| CanvasArea import budget exceeded | High | High | No new imports into CanvasArea. All AI overlays as React components. Adapter modules for canvas hooks. |
| LocalStorage quota exceeded by ActionTracker | Low | Medium | 30-day pruning, capped at 10K entries. Already implemented. |

### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-----------|--------|-----------|
| Features perceived as "not real AI" | Medium | Medium | Never market heuristics as "AI" — market as "Design Intelligence" (factual: analysis, suggestion, automation). Reserve "AI" for actual ML features (bg removal, upscale, object select). |
| Design linter false positives anger users | Medium | High | All debt scanner issues are suggestions, not errors. "Dismiss" action on each. Never auto-fix without preview. |
| Competitors copy features | High | Low | Heuristic features are easy to copy, but Strata's lead is integrating them into the local-first architecture. Figma's cloud-first approach can't match offline availability. |
| Variable-driven geometry confuses non-technical users | Medium | Medium | Progressive disclosure: variable binding appears only when user creates a variable or edits a binding. Default experience is unchanged. |

### Privacy / Security Risks

| Risk | Probability | Impact | Mitigation |
|------|-----------|--------|-----------|
| User design data sent to cloud APIs | Low | Critical | No cloud API is called without explicit user opt-in and clear indication of what data is sent. All Tier 1-2 features work fully offline. |
| LocalStorage ActionTracker data accessible by other apps | Low | Low | ActionTracker stores anonymous action names and timestamps only — no design content, no images, no text strings. |

### Adoption Risks

| Risk | Probability | Impact | Mitigation |
|------|-----------|--------|-----------|
| Users don't discover intelligence features | High | High | Surface via StatusBar (DebtBadge, LayoutScore already there), onboarding tips, pulsing indicator on first debt detected, IntelligencePanel badge count. |
| Overwhelming users with suggestions | Medium | Medium | Progressive complexity: pro users see full panel; beginners see only StatusBar badge. IntelligencePanel defaults to collapsed. Rate-limit toast suggestions to 1 per 15min. |

---

## 9. Implementation Roadmap

The recommended approach: **surface first, extend second, ML third.**

```
Phase 1 (Session 2026-07-22): "Make Existing AI Visible"
├── Wire autoNamer into createShapeAt/createTextNodeAt (4h)
├── ActionTracker global wiring: 20 insertion points in tools/menus/shortcuts (6h)
├── Select by fill/font/effect context methods + UI (6h)
├── Hidden layer / zero-size checks in debtScanner (2h)
├── Focus order visualization overlay (4h)
├── Touch target audit (3h)
└── Empty container detection (1h)
    Total: ~26h (~3-4 days)
    Visible changes: Every node named, select-by-property works, debt badge finds real issues

Phase 2 (Session 2026-07-24): "Design Linter Ship"
├── Cognitive load → Complexity tab in IntelligencePanel (4h)
├── Registry wiring: registerFeature() → tab rendering (6h)
├── Smart defaults → new document pre-fill (4h)
├── Accessible palette generator (6h)
├── Auto-straighten on image import (4h)
├── Auto-arrange grid/circle/hug (16h)
└── Full-text layer search index + UI (12h)
    Total: ~52h (~6-7 days)
    Visible changes: Design linter panel, complexity tab, auto-arrange, search

Phase 3 (Session 2026-07-28): "Parametric & Differentiators"
├── Parametric geometry: PropertyBinding → w/h/x/y (3 days)
├── Auto-color harmony from hero image (2 days)
├── Force-directed label placement (2 days)
├── Color blindness simulation mode (2 days)
├── Procedural fill patterns (2 days)
├── Recovery points at major ops (1 day)
└── Auto-responsive constraints (4 days)
    Total: ~16 days
    Visible changes: Variables drive shape dimensions, label auto-placement, color sim

Phase 4 (Ongoing): "ML-Enhanced Features"
├── Foreground object selection from BiRefNet (3 days)
├── Smart image upscale on export (2 days)
├── Auto-variant generation from fingerprint (2 days)
├── Visual similarity search (2 days)
├── Depth-aware effects (4 days)
└── On-import background removal auto-detect (1 day)
    Total: ~14 days
```

---

## 10. Final Prioritized Shortlist

### Investor Pitch: Top 5 Features

| # | Feature | Investor Hook | Effort | Offline? |
|---|---------|--------------|--------|---------|
| 1 | **Design Linter** | "ESLint for design. The first built-in design consistency engine in any tool." | 4 days | ✓ |
| 2 | **Parametric Geometry** | "Treat dimensions as variables — the only design tool with programmable geometry." | 3 days | ✓ |
| 3 | **Local-First Intelligence** | "All analysis runs on-device. Privacy-preserving personalization. Zero cloud cost." | 6 days (ActionTracker wiring) | ✓ |
| 4 | **Smart Layout & Auto-Arrange** | "One-click layout from any selection. Heuristic, not AI-washing." | 4 days | ✓ |
| 5 | **Accessibility-First Design** | "Built-in WCAG auditing, focus order, touch targets, color blind simulation. Differentiator for enterprise sales." | 3 days | ✓ |

### User Value: Top 5 Features

| # | Feature | Why users care |
|---|---------|---------------|
| 1 | Auto-name layers on creation | Every node has a sensible name immediately. Eliminates manual renaming. |
| 2 | Select by fill/font/effect | "Select all blue circles" in one command. Power-user time saver. |
| 3 | Full-text layer search | Ctrl+F searches all layer names and text content. Table-stakes in 2026. |
| 4 | Auto-arrange grid/circle | One-click organization of selected elements. Replaces manual align-then-distribute. |
| 5 | Design debt detection | Catches real problems before export: invisible layers, off-canvas elements, contrast failures. |

### Highest ROI Per Development Day

| Rank | Feature | Dev Days | User Impact | Differentiation | Investor Appeal |
|------|---------|----------|-------------|----------------|-----------------|
| 1 | Auto-name on creation | 0.5 | ★★★★★ | ★★ | ★★ |
| 2 | Select by fill/font/effect | 0.75 | ★★★★ | ★★★ | ★★ |
| 3 | Hidden layer / zero-size check | 0.25 | ★★★★ | ★★★★ | ★★★ |
| 4 | ActionTracker global wiring | 1 | ★★★ (enables others) | ★★★★ | ★★★★★ |
| 5 | Focus order visualization | 0.5 | ★★★ | ★★★★★ | ★★★★ |
| 6 | Touch target audit | 0.4 | ★★★ | ★★★★★ | ★★★★ |
| 7 | Design Linter surfacing | 3 | ★★★★★ | ★★★★★ | ★★★★★ |
| 8 | Auto-arrange | 2 | ★★★★★ | ★★★ | ★★★ |
| 9 | Full-text search | 1.5 | ★★★★★ | ★★★ | ★★ |
| 10 | Parametric geometry | 3 | ★★★★ | ★★★★★ | ★★★★★ |

### Summary Verdict

**Do not chase LLMs, diffusion models, or cloud AI.** Strata's competitive advantage is **local-first design intelligence** — heuristics, optimization algorithms, rules engines, and parametric systems that work offline with zero recurring cost. The 54 existing intelligence modules provide a 2-3 year head start over any competitor who would need to build this capability from scratch. The immediate task is not invention — it's **wiring, surfacing, and messaging.**

**The single highest-leverage action:** Wire the existing intelligence modules into the UI. Everything else is additive.
