# AI Feature Strategy Report for Strata

**Prepared for:** Strata design suite
**Context:** Local-first, cross-platform vector/photo/motion/print design tool (Tauri 2 + Rust + React)
**Date:** 2026-07-21

---

## 1. Executive Summary

Strata already possesses one of the deepest offline AI/intelligence stacks of any independent design tool — **~24,000+ lines** of deterministic algorithms, a production-grade ONNX background-removal pipeline, and 29 complete intelligence modules. However, the codebase has a critical structural problem: **~18 of those 29 algorithms are fully implemented but orphaned from any UI surface**, and several high-value ONNX model verticals have preprocessing scaffolding with no model files bundled.

**The strategic imperative is not to build more AI — it's to ship what's already built and fill 2-3 high-leverage model gaps.** The competitive moat is "client-side craft assistance": color harmony, layout scoring, spacing harmonization, WCAG contrast fixes, auto-naming — the kind of features that work offline on CPU/WASM, cost $0/inference, and compound in value the longer a user works in Strata. Figma and Adobe spend $200M+/year on generative AI that users treat as a novelty; Strata should compete on deterministic intelligence that quietly makes every design better.

**Recommendation: A 3-phase execution plan:**
1. **Quick wins (2-4 weeks):** Wire orphaned algorithms to UI — ~18 algorithms need panels/buttons, not new code
2. **High-leverage model additions (4-8 weeks):** Bundle 3-4 small ONNX models (denoise, OCR, segmentation) that unlock entirely new workspace capabilities
3. **Strategic differentiation (8-16 weeks):** "Photo workspace" transformation — the only cross-platform design tool with a genuine offline photo-editing stack (denoise → upscale → sky replace → HDR merge)

---

## 2. Research Findings

### 2.1 Strata's Current AI Asset Inventory

| Layer | Assets | Status | Value State |
|-------|--------|--------|-------------|
| **Background removal** | u2netp FP32 (4.6MB), INT8 (1.3MB), IS-Net, BiRefNet pipeline | Production-shipped, native ONNX + WASM fallback | ✅ Mature, users can reach it |
| **Auto-trace** | Potrace-class contour tracing (Rust, 2,865 lines, rayon-parallel) | Implemented, wired to RefineMaskTool | ✅ Ship-ready |
| **Upscaling** | Real-ESRGAN Rust provider (tiled, alpha-aware, x4) | Rust code complete, no UI surface, no bundled model | 🚫 Blocked — invisible to users |
| **Inference platform** | Generic ONNX session manager, worker, manifest, provider chain | Scaffolding for 12+ model verticals exists | 🚫 8 verticals have no model files |
| **Adjustment engines** | Curves, levels, selective color, histogram, filter compositor, halftone, blur | All complete, wired to UI | ✅ Excellent |
| **Retouch tools** | Clone, heal, spot-heal, patch (NCC matching) | Complete with brush tools | ✅ Ship-ready |
| **Editor intelligence suite** | 29 deterministic algorithms (autoNamer, spacingHarmonizer, layoutScore, debtScanner, etc.) | All implemented, ~18 orphaned from any UI | 🚫 **Biggest gap** |
| **AI chat** | `packages/ai/src/` mock assistant | Completely stubbed | 🚫 Not real |

### 2.2 The Orphaned Intelligence Crisis

The single most actionable finding: **18 implemented algorithms have clean APIs, tests, and zero UI consumers**. This represents ~4,500 lines of complete, tested code providing $0 value because nobody can reach it:

| Algorithm | What It Does | Effort to Wire | User Value |
|-----------|-------------|----------------|------------|
| `autoLayoutSuggestor.ts` | Suggests row/column/gap for frames | Low — button in inspector | High |
| `layoutClassifier.ts` | Classifies layout type (7 categories) | Low — readout label | Medium |
| `prototypeFlowAnalyzer.ts` | Finds dead-ends, orphans, missing back-nav | Low — Issues panel | High (prototype mode) |
| `componentVariantDetector.ts` | Suggests variants from similar instances | Low — inspector chip | High |
| `styleDeduplicator.ts` | Deep-compares and suggests merging duplicate styles | Low — button in styles panel | High |
| `tokenAnalytics.ts` | Color/spacing/font token coverage % | Medium — dashboard | Medium |
| `workflowAnalyzer.ts` | N-gram pattern detection on action sequences | Medium — tips panel | Medium |
| `shortcutRecommender.ts` | "You do X manually N times, try shortcut Y" | Low — onboarding chip | Medium |
| `motionPresetRecommender.ts` | Matches timelines against saved presets | Low — timeline panel | High (motion mode) |
| `easingAdvisor.ts` / `transitionAdvisor.ts` | Property-aware easing + duration suggestions | Low — timeline inspector | High |
| `designFingerprint.ts` | Persisted design-pattern profile | Medium — onboarding | Medium |
| `cognitiveLoad.ts` | Miller's + Hick's complexity score | Indicator wired, panel missing | Medium |
| `adaptiveContrast.ts` | Backdrop-sampling contrast resolution | Low — patch the existing hook | High |
| `imageFitAdvisor.ts` | Aspect-ratio-aware fit suggestions | Low — image inspector | Medium |
| `crossDocScanner.ts` | Cross-document drift detection | Medium — home panel | Medium |

---

## 3. Competitor & Trend Analysis

### 3.1 What Competitors Ship — And What Actually Sticks

| Competitor | AI Feature | User Reception | Value Class |
|-----------|-----------|----------------|-------------|
| **Figma AI** | Rename layers, visual search, first-gen generative UI | Mixed — rename stays, generative search discontinued as "not sufficiently useful" | Craft assistance > generation |
| **Adobe Firefly** | Generative fill, generative expand, text-to-image | Strong in Photoshop (Generative Expand), weak in Illustrator | Image editing > vector design |
| **Adobe Sensei** | Auto-trace (Image Trace), content-aware crop, theme extraction | Used daily, invisible — works well, no marketing needed | Craft assistance |
| **Illustrator** | Retype (font recognition), recolor artwork | High utility, low fanfare | Craft assistance |
| **Sketch** | Minimal AI — mostly naming/layout suggestions | Niche | — |
| **Luminar Neo** | Sky replacement, portrait relight, denoise, upscale, HDR merge | Strong paid-upgrade driver — users pay $79-149 for this stack offline | **Photo editing stack** |
| **Topaz Photo AI** | Denoise + sharpen + upscale integrated pipeline | $299 one-time, high repeat purchase rate | **Photo editing stack** |
| **Affinity** | No AI features | — | — |
| **Penpot** | No AI features | — | — |

### 3.2 Key Insight: The "Offline Photo Stack" Is Uncontested in Design Tools

**Luminar ($79-149), Topaz ($299), ON1 ($99) — all sell essentially the same pipeline: denoise → upscale → sky replace → HDR merge → portrait relight. None of them are design tools. No design tool (Figma, Sketch, Illustrator, Penpot, Affinity) offers a meaningful offline photo-editing stack. This is a white-space intersection.**

Strata's Photo workspace (`Ctrl+Shift+I`) already has adjustment layers, curves, levels, selective color, histogram, retouching tools, blend modes, and background removal. It is **4 features away from a competitive offline photo stack**: (1) CNN denoise, (2) Real-ESRGAN upscale UI, (3) sky replacement via segmentation + color transfer, (4) HDR merge.

### 3.3 Models Available for Free/Apache/MIT Licensing

| Model | Size | License | Capability | Strata Fit |
|-------|------|---------|------------|-----------|
| **Real-ESRGAN compact** (realesr-general-x4v3) | ~46MB FP32 / ~12MB INT8 | BSD-3 | x4 super-resolution | Upscale UI |
| **SCUNet** (color denoise) | ~46MB | Apache 2.0 | Blind denoise (noise level 0-255) | Photo workspace |
| **PaddleOCR** (v4) | ~10MB (det) + ~5MB (rec) | Apache 2.0 | Multi-language OCR (80+ langs) | Vectorize text in images |
| **SAM2** (Tiny) | ~94MB | Apache 2.0 | Interactive/rigid object segmentation | Object selection, sky mask |
| **MobileNetV3-Small** | ~5.4MB | Apache 2.0 | Image classification (1000 labels) | Layout classifier model |
| **EfficientNet-Lite4** | ~15MB | Apache 2.0 | Image classification (better accuracy) | Scene-type detection |
| **ddcolor** | ~60MB | MIT | Auto colorization (B&W → color) | Photo enhancement |
| **LaMa** | ~160MB | MIT | Inpainting (remove objects) | Photo retouch |
| **RIFE** (x4) | ~23MB | MIT | Frame interpolation (2x-8x) | Motion export smoothing |

---

## 4. Ranked Feature Recommendations

### Tier 1 — Quick Wins (Wire What's Built)

#### 1.1. Orphaned Intelligence Wiring
- **What:** Surface 18 completed algorithms in UI panels/chips/buttons
- **User value:** High — immediately usable craft assistance (one-click merge duplicate styles, one-click auto-layout, prototype issue detection, motion preset matching)
- **Investor value:** High — "30 deterministic AI features, all offline" is a genuine differentiator vs Figma's LLM approach
- **Complexity:** Low — pure React UI wiring, no new algorithms, no new models
- **Cost:** $0 — all computation is deterministic TS running on main thread
- **Performance:** Negligible — most algorithms run <10ms on typical documents
- **Maintenance:** Low — algorithms are pure functions with existing test suites
- **Risks:** Hub-file budget on CanvasArea/Shell must be respected. Solution: add surface to Inspector/PropertiesPanel (already large, independent from CanvasArea)

#### 1.2. AI Chat Completion (4 Real Commands)
- **What:** Wire `AIPanel` to dispatch `check-contrast`, `scan-debt`, `suggest-names`, `harmonize-spacing` (already implemented in `intelligenceRegistry.ts`)
- **User value:** Medium-High — users can ask "fix contrast issues" and get deterministic results
- **Investor value:** Medium — "AI assistant" marketing surface with real, working commands
- **Complexity:** Low — registry exists, just needs UI dispatch
- **Cost:** $0

### Tier 2 — High-Leverage Model Additions (Bundle Small ONNX Models)

#### 2.1. Real-ESRGAN Upscale UI (Complete the Pipeline)
- **What:** Surface the existing Rust Real-ESRGAN provider in a dialog. Bundle `realesr-general-x4v3` INT8 (~12MB) as a bundled model.
- **User value:** High — users can upscale embedded images 2x-4x with quality. Critical for print production.
- **Investor value:** High — "AI super-resolution in a design tool" is a pitchable feature
- **Complexity:** Low-Medium — Rust provider exists, manifest registration exists; just need a dialog UI and model bundling
- **Cost:** $0 — model is BSD-3, inference is local via bundled onnxruntime
- **Infrastructure:** 12MB model bundled in app (~120KB/s download during install)
- **Performance:** ~5-15s for a 2MP image on CPU; native ONNX preferred
- **Scalability:** One-shot per image, no server

#### 2.2. SCUNet Denoise (Photo Workspace)
- **What:** Bundle SCUNet (~46MB) as a filter/adjustment in Photo workspace. Add as a new adjustment type or filter.
- **User value:** High — removes noise from low-light photos, restores old scans
- **Investor value:** High — differentiates from every design tool
- **Complexity:** Medium — model has preprocessing scaffolding. Need to: add to manifest, create UI, wire to photo workspace
- **Cost:** $0
- **Performance:** ~10-30s for 2MP image on CPU

#### 2.3. PaddleOCR Text Recognition
- **What:** Detect text in embedded images. Offer to convert to editable text nodes.
- **User value:** High — convert screenshots, scans, photos-of-text to editable vector text
- **Investor value:** Medium — "turn images into editable content"
- **Complexity:** Medium — PaddleOCR vertical has preprocessing scaffolding in `inference/models/paddleocr.ts`. Need to: bundle model, wire to UI, emit TextNodes
- **Cost:** $0 — Apache 2.0, 15MB total

#### 2.4. ddcolor Auto-Colorization
- **What:** Convert B&W photos to color. Add as an adjustment in Photo workspace.
- **User value:** Medium-High — restore old photos, creative colorization
- **Complexity:** Medium — model vertical needs manifest registration
- **Cost:** $0 — MIT license, ~60MB model

### Tier 3 — Strategic Differentiation Features

#### 3.1. Sky Replacement & Scene Relight
- **What:** Use SAM2 (or existing u2netp mask) → segment sky → replace with gradient/texture/photo → relight foreground to match new sky's color temp
- **User value:** High — Luminar's #1 selling feature
- **Investor value:** Very High — demonstrable, visual, pitch-deck-ready
- **Complexity:** High — multi-step pipeline (segment, extract, relight, composite)
- **Cost:** $0
- **Key components:**
  - Sky segmentation: SAM2 (94MB) or heuristic (color/position)
  - Sky library: generate gradient/photo sky presets locally (no model needed)
  - Relight: use existing curves/levels/histogram matching to transfer color stats

#### 3.2. HDR Merge
- **What:** Merge N exposure-bracketed images into a single HDR tonemapped image
- **User value:** Medium — photographers and 3D artists
- **Investor value:** Medium
- **Complexity:** Medium — Debevec-Malik or Mertens fusion (deterministic, no ML needed)
- **Cost:** $0 — zero models, pure CV algorithm

#### 3.3. Content-Aware Crop / Seam Carving
- **What:** Resize images without distortion by removing/inserting low-energy seams
- **User value:** Medium — classic, proven feature (Photoshop Content-Aware Scale)
- **Complexity:** Low-Medium — deterministic algorithm, well-documented
- **Cost:** $0
- **Performance:** Fast on CPU

#### 3.4. Style Transfer (AdaIN)
- **What:** Apply the color/texture style of one image to another
- **User value:** Medium — creative effect, marketing material
- **Complexity:** Medium — AdaIN is small (~10MB), perceptual-loss based
- **Cost:** $0 — MIT license

---

## 5. Quick Wins (Implement First — 2-4 Weeks)

| # | Feature | Effort | Team Size | Expected Impact |
|---|---------|--------|-----------|-----------------|
| QW1 | Wire 5 highest-value orphaned algorithms (autoLayoutSuggestor, prototypeFlowAnalyzer, styleDeduplicator, motionPresetRecommender, adaptiveContrast) | 2-3 days | 1 dev | **Highest ROI in codebase** — pure UI, zero new code |
| QW2 | Add "Merge Duplicate Styles" button to Styles section | 0.5 days | 1 dev | Solves real cleanup pain |
| QW3 | Add "Detect Prototype Issues" panel/tab | 1 day | 1 dev | Catches broken flows before presentation |
| QW4 | Wire AI contrast check to AIPanel dispatch | 0.5 days | 1 dev | Gives AI chat a real command |
| QW5 | Add Real-ESRGAN dialog to Image inspector or Photo workspace | 2-3 days | 1 dev | Completes existing Rust pipeline |
| QW6 | Fix `mlModelRegistry.ts` dead declarations | 0.5 days | 1 dev | Remove dead code or connect to real models |

**Total quick win investment: ~7-11 dev days. Expected outcome: 5 new working AI features + 1 completed pipeline + dead code cleanup.**

---

## 6. High-Impact Strategic Opportunities (4-16 Weeks)

### 6.1. "Photo Stack" Complete Pipeline (The Luminar/Topaz Feature Set)

**Vision:** Strata becomes the only cross-platform design tool with a genuine offline photo-editing stack. A designer imports a photo, removes background (✅), denoises (SCUNet), upscales (Real-ESRGAN), replaces sky (SAM2 + color transfer), adjusts (existing curves/levels/histogram), and exports for print (existing CMYK/PDF-X) — all locally, all without a subscription.

**Components:**
| Feature | Model/Algorithm | Size | Status |
|---------|----------------|------|--------|
| Background removal | u2netp/BiRefNet | 4.6-224MB | ✅ Shipped |
| Denoise | SCUNet | ~46MB | 🚫 Need model + UI |
| Upscale | Real-ESRGAN compact | ~12MB INT8 | 🚫 Need UI + bundled model |
| Sky replace | SAM2 Tiny + color transfer | 94MB | 🚫 Need pipeline |
| HDR merge | Mertens fusion (deterministic) | 0 | 🚫 Need UI |
| Style transfer | AdaIN | ~10MB | 🚫 Optional |

**Total new bundling: ~160MB (fits comfortably in Tauri bundle). Total new inference cost: $0 (all local).**

### 6.2. "OCR to Editable" Workflow
**Vision:** Drop a screenshot or photo of text → PaddleOCR detects text regions → convert to editable TextNodes with font matching (existing FontRegistry). The designer has just made any document editable in seconds.

**Pipeline:** Image → PaddleOCR (det+rec) → bounding boxes + text → TextNodes → auto-name → font classification (MobileNetV3 on text region → FontRegistry.match)

### 6.3. "Smart Selection" via SAM2
**Vision:** Click an object in an image → SAM2 segments it → becomes a selectable, editable region. Replaces the current RefineMaskTool with a state-of-the-art segment model.

---

## 7. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Hub-file budget breach** — Adding imports to CanvasArea.tsx (82 imports, 0.95 I) | HIGH | Add new surface to InspectorPanel, IntelligencePanel, or create new standalone panels. Never add to CanvasArea or Shell. |
| **Model bundle bloat** — Adding 160MB of models to app bundle | MEDIUM | Make models lazy-download on first use (existing IndexedDB pattern). Only bundle u2netp INT8 by default. |
| **ONNX WASM memory ceiling** — WASM crashes at 4GB on complex models | HIGH (already solved) | Native ONNX Runtime dylib already preferred for `ai-quality`. Use native for all heavy models. |
| **Deterministic algorithm false positives** — layoutScore, tokenAnalytics might annoy | LOW | Make all intelligence **suggestions**, never auto-apply. Show as chips/badges with "Apply" / "Dismiss" |
| **OCR accuracy on stylized text** — PaddleOCR struggles with display fonts, low contrast | MEDIUM | Downscale to 2x before OCR, confidence threshold, offer manual correction |
| **Performance on large images** — SCUNet/SAM2 on 20MP photos | MEDIUM | Preview downscale (existing 2048px cap pattern), process full-res on commit |
| **Investor perception of "AI washing"** — Claiming AI features that are heuristics | LOW | Be transparent: call it "deterministic intelligence," not "AI." Strata already differentiates on this honestly. |
| **Competitor response** — Figma could add offline features | LOW | Figma is architecturally cloud-first; local-first is a structural advantage they can't copy quickly |

---

## 8. Implementation Roadmap

### Phase 1: Wire What's Built (Weeks 1-4)
- [ ] Wire `autoLayoutSuggestor` + `styleDeduplicator` + `prototypeFlowAnalyzer` to inspector/prototype panels
- [ ] Wire `motionPresetRecommender` + `easingAdvisor` to timeline panel
- [ ] Add "Detect Issues" tab to prototype flow view
- [ ] Add "Merge Duplicate Styles" button
- [ ] Fix `adaptiveContrast.ts` hook to actually patch
- [ ] Wire AI Panel commands (`check-contrast`, `scan-debt`) to real dispatch
- [ ] Clean up `mlModelRegistry.ts` dead declarations

### Phase 2: Activate Inference Pipeline (Weeks 4-8)
- [ ] Bundle `realesr-general-x4v3` INT8 (~12MB) into Tauri resources
- [ ] Register in `manifest.ts` as a bundled model
- [ ] Build Upscale dialog UI (scale 2x/4x, output node/image toggle)
- [ ] Enable `ai` feature in `strata-upscale` crate's own Cargo.toml
- [ ] Bundle SCUNet (~46MB), register in manifest
- [ ] Add "Denoise" adjustment to Photo workspace
- [ ] Bundle PaddleOCR v4 (~15MB), register in manifest
- [ ] Add "Recognize Text" feature to Image inspector/shell

### Phase 3: Strategic Photo Stack (Weeks 8-16)
- [ ] Build sky segmentation pipeline (SAM2 Tiny, 94MB)
- [ ] Build sky library (gradient/photo presets, no model)
- [ ] Build foreground relight via color-transfer (existing curves + stats)
- [ ] Add "Sky Replace" overlay to Photo workspace
- [ ] Implement HDR merge (Mertens fusion, deterministic)
- [ ] Integrate all photo features into Photo workspace mode

### Phase 4: Long-Term Bets (Weeks 16+, conditional)
| Bet | When to Build | Why |
|-----|--------------|-----|
| Style transfer (AdaIN) | If photo stack gets adoption | Creative, marketable |
| LaMa inpainting | If retouch tool usage is high | Completes retouch stack |
| Content-aware crop | If users request it | Classic feature |
| On-device LLM (Qwen2.5-1.5B) | NEVER unless user explicitly chooses | Recurring cost, privacy risk, marketing gimmick |

---

## 9. Final Prioritized Shortlist

**The most investor-attractive and genuinely useful features, in order of implementation priority:**

| # | Feature | Why It Wins | Phase |
|---|---------|-------------|-------|
| **1** | Wire orphaned algorithms (18 → 0 orphaned) | Pure ROI — code exists, tested, provides $0 cost value. "30 deterministic AI features" is a pitch-ready differentiator. | Immediate |
| **2** | Real-ESRGAN upscale UI | Completes a pipeline where Rust code already exists. 12MB model, $0 inference, universally understood value proposition. | Immediate |
| **3** | SCUNet denoise + ddcolor in Photo workspace | First design tool with a genuine offline photo stack. Direct Luminar/Topaz competitor feature at $0 cost. | Short-term |
| **4** | PaddleOCR "image text → editable text" | Transforms a universal workflow (screenshots, mocks, scans). High perceived value. Competition has nothing equivalent. | Short-term |
| **5** | SAM2 "Smart Selection" | Background removal already shipped — extends the same interaction model to any object. Exponential value multiplier for Photo workspace. | Medium-term |
| **6** | Sky replace + HDR merge | Complete the photo stack. Makes Strata the only tool where a designer can do background removal → denoise → upscale → sky replace → retouch → CMYK print export, entirely offline, without a subscription. | Medium-term |

### What to Explicitly NOT Build

| Rejection | Reason |
|-----------|--------|
| LLM chat assistant (Claude/GPT integration) | $0.002-0.01/query recurring cost. Strata's entire positioning is local-first. AIPanel can remain deterministic. If user wants LLM, Ollama integration (user-hosted) — never Strata-hosted. |
| Text-to-image generation | Midjourney/Flux/DALL-E are better at it. Users don't want to generate, they want to design. Strata's correct position: import → edit → export, not prompt → generate. |
| Generative UI layout | Noisy output, heavy post-edit, novelty-week adoption cliff. Strata's `autoLayoutSuggestor` + existing flex/grid engine is the right answer. |
| Visual/semantic search | Only valuable at org scale with massive asset libraries. Strata is local-first. |
| On-device LLM (llama.cpp / Qwen) | Marketing gimmick. Nothing a deterministic algorithm can't do better, cheaper, faster for design-tool use cases. |

---

## Appendix: Key Code References for Implementation

| What to Touch | File | Why |
|---|---|---|
| Orphaned algorithm wiring entry point | `packages/editor/src/intelligence/registry.ts` | Central registry — wire here first |
| AI Panel command dispatch | `packages/ai/src/intelligenceRegistry.ts` | 4 existing commands need UI |
| Background removal provider pattern | `packages/engine/src/backgroundRemoval/dispatch.ts` | Template for all new model providers |
| ONNX manifest registration | `packages/engine/src/inference/manifest.ts` | Where new models get registered |
| Inference model vertical template | `packages/engine/src/inference/models/scunet.ts` | Copy pattern for SCUNet/PaddleOCR/SAM2 |
| Native upscale Rust code | `crates/strata-upscale/src/ai.rs` | Already exists, needs TS facade |
| Photo workspace UI | `packages/editor/src/components/Inspector/sections/AdjustmentSection.tsx` | Where to add denoise panel |
| Hub-file budget awareness | `packages/editor/src/CanvasArea.tsx` (DO NOT add imports) | Respect 82-import hard cap |
| Worker provider pattern | `packages/engine/src/backgroundRemoval/workerProvider.ts` | Template for heavy-model inference |

---

## Research Sources

- Codebase exploration: `packages/editor/src/intelligence/`, `packages/engine/src/`, `packages/ai/src/`, `crates/strata-trace/`, `crates/strata-upscale/`
- Competitor analysis: `docs/architecture/ai-competitor-intelligence-2026.md` (generated companion report)
- Model research: [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN), [ONNX Model Zoo](https://github.com/onnx/models)
- Architecture constraints: AGENTS.md (hub-file budgets, circular dependency rules, cascade review protocol)

---

**Bottom line:** Strata's AI strategy should be "finish what's built, then fill the photo stack." The codebase has an unusually high ratio of completed-but-orphaned intelligence — wiring those 18 algorithms is the highest-ROI work available. After that, the Real-ESRGAN pipeline is literally one dialog away from shipping, and the photo feature stack (denoise + upscale + sky replace + HDR) represents an uncontested market position that no other design tool offers. All of it runs on $0 recurring infrastructure, which is the moat.
