# AI Competitor Intelligence Report — Design & Creative Software (2026-07)

Research basis: Adobe Firefly capabilities (Wikipedia, Adobe MAX 2025/2026),
Figma blog posts + Wikipedia + Config 2025/2026 announcements, Affinity/Canva
positioning, Luminar Neo feature matrix, DaVinci Resolve Neural Engine, Topaz
Labs product catalog, Sketch public materials, GitHub Copilot patterns.

---

## 1. Figma AI

### Shipped features (status as of 2026-07)

| Feature | Status | Notes |
|---------|--------|-------|
| Visual Search | **Live** | Text/image input → visually similar frames from team files |
| Asset Search (semantic) | **Live** | NLP understanding of component intent ("primary button" finds `btn_large`) |
| Rename Layers | **Live** | AI-suggested contextual names; widely praised as genuine time-saver |
| Make Prototype | **Live** | Static frames → interactive prototypes with one click |
| Background Removal | **Live** | In-canvas, no tool switching |
| Text tools (rewrite/shorten/translate) | **Live** | Iterates copy without leaving canvas |
| Realistic content generation | **Live** | Populates lorem-ipsum/mock data with generated text+images |
| **First Draft** (Make Designs → relaunched) | **Live** | Text prompt → UI layout draft; now inside Figma Sites |
| **Figma Make** | **Live** | Prototype + code generation, powered by Claude 3.7/4.7 |
| **Figma Sites** (Beta) | **Beta** | AI-driven website builder with CMS |
| **Figma Buzz** (Beta) | **Beta** | AI-generated marketing content for brands |
| **Figma Weave** (acquired Weavy Oct 2025, >$200M) | **Building** | R&D center in Tel Aviv; AI image/video editing tools |
| **MCP integrations** (Claude Code + OpenAI Codex) | **Live 2026-02** | Bidirectional design↔code via Model Context Protocol |
| **Figma Draw** | **Live** | Advanced vector brushes/illustration; rivals Illustrator |

### Discontinued / renamed
- "Make Designs" renamed to **"First Draft"** then absorbed into Figma Sites / Figma Make
- No discontinuations to date — Figma has only expanded the AI suite (Wavy acquisition signals commitment)

### User reception
- **Praised**: Rename Layers ("saves hours"), Visual Search ("needle in haystack solved"), Asset Search (semantic design-system lookup)
- **Mixed/criticized**: Generative output quality lags Midjourney/DALL-E, more useful for "first drafts" than final output; credit limits introduced post-free-beta angered some
- **Privacy concern**: June 2024 admin toggle for "AI content training" — opted in by default on paid tiers, prompted backlash from enterprise security teams; large orgs now opt-out by default
- **Market positioning**: Figma frames AI as "new creative starting line" — generation is the feature, not the polish

### Architecture notes for Strata
- **First-party signals**: Figma AI relies on third-party models (Anthropic Claude, OpenAI), not in-house generative models; only search was fine-tuned on Figma community images (public files)
- **Web-native = wiring complexity**: All Figma AI calls go through a cloud round-trip; no local inference
- **MCP protocol** is the seam between design and code — a competitor can replicate this with LSP-style bridges

---

## 2. Adobe Illustrator / Photoshop / Creative Cloud

### Adobe Firefly (core engine)
- **Modalities**: text-to-image, text-to-image, text-to-video, image-to-video, text-to-speech, text-to-vector, text-to-music, sound-effect generation, speech enhancement
- **Firefly Image 5** (Oct 2025): improved coherence, typography rendering
- **Integrations**: hosted partially on Nvidia Picasso; models from Google (Gemini, Veo, Imagen), OpenAI, ElevenLabs alongside Adobe's own
- **Feeds**: Generative Fill in Photoshop, Remove Tool in Illustrator, Premiere Pro text-based editing, InDesign vectors, Soundtrack generation in Premiere, Content-Audio cleanup

### Discrete AI features (Photoshop)
| Feature | What it does | User value rating |
|---------|-------------|-------------------|
| **Generative Fill** | Diffusion-based region fill; object add/remove/extent | ★★★★★ — genuine daily use |
| **Neural Filters** | Skin smoothing, expression transfer, depth haze, style transfer | ★★★ — niche, occasional |
| **Content Credentials** | C2PA provenance metadata embedded in output | ★★★★ — legal/enterprise value |
| **Expand Image** (Generative Expand) | Outpaint canvas with AI | ★★★★★ — very useful |
| **Select Subject / Object Selection** | CNN-based foreground extraction | ★★★★★ — foundational |
| **Adjustments (auto tone/color/levels)** | Heuristic histogram analysis | ★★★ — decades-old, reliable |
| **Retype** (Beta) | Edit rasterized text as if live | ★★★ • limited font coverage |

### Discrete AI features (Illustrator)
| Feature | What it does | User value rating |
|---------|-------------|-------------------|
| **Generative Recolor** | AI palette variations from text | ★★ — novelty |
| **Retype** | Convert outlined text to editable | ★★★ — niche |
| **Mockup 3D** (Beta) | Smart-object-like 3D packaging mockups | ★★★ — specific use case |
| **Image Trace** (traditional ML) | Auto-vectorize raster→paths | ★★★★ — classic, works |

### What's useful vs. marketing
- **Actually useful**: Generative Fill, Expand Image, Select Subject, Object Selection, Content-Audio cleanup, Content Credentials
- **Mixed**: Recolor, Retype, Mockup 3D
- **Marketing**: Most Firefly web-app generation (Midjourney/DALL-E are preferred for actual creation)
- **Privacy/legal edge**: "Commercially safe" training — but revealed to be trained on Midjourney outputs, undercutting the marketing claim

### Architecture notes for Strata
- Adobe's AI is **diffusion + CNN hybrid in browser**, heavy CUDA services behind the curtain
- Content Credentials is a trust signal, not a creativity feature — implement as optional C2PA metadata on export
- Adobe's multi-model strategy (Picasso, Google, OpenAI, ElevenLabs, internal) = high per-query cost; they monetize via credit packs

---

## 3. Sketch AI

**Status**: Sketch has shipped very little native AI as of 2026-07.

- No generative UI/make-features equivalent to Figma AI
- Smart Layout (auto-resize) is rule-based, not AI
- Variable fonts support (typographic)
- Data plugins populate mock data (not generated)
- No "rename layers", no background removal built in (uses plugins/macOS APIs)
- **Positioning**: conservative, "pro craft first"; no aggressive AI roadmap announced
- Community plugins fill some gaps (e.g., Magicul, Anima for AI-assisted prototyping)

**User reception**: Mixed — pros prefer the deliberate pace of AI adoption, but are losing enterprise customers to Figma's AI-rich tooling. Sketch's 2026 beta program teased "AI workflows" but no ship date.

**Architecture notes**: Sketch's smart-layout is CSS Grid-like, not ML. Their AI features = macOS Image Analysis APIs (Vision, CoreML frameworks). Strata leapfrogs both.

---

## 4. Affinity (now owned by Canva, 2026)

**Status**: No proprietary AI. Affinity's strategy is "AI via Canva" — users on Canva Premium plans unlock Canva's AI tools (Magic Fill, generative AI, background removal, image/vector generation) while working in Affinity.

Features Affinity retains in-house:
- **Image Trace** (auto-vectorize): traditional potrace-style contour tracing, works locally
- Smart Master Pages (page layout, not AI)
- Data merge (spreadsheet/publishing)

**Positioning**: "AI that respects your craft — we can't access local files." The Canva integration is opt-in via subscription; Affinity core stays free.

**Architecture notes**: Affinity chose not to build AI — they rely on Canva's ecosystem. Image Trace (potrace-style) is entirely CPU-based and works locally. This is the model of "offline-first traditional ML".

---

## 5. Penpot, Lunacy, Vectr

| Tool | AI features | Notes |
|------|-------------|-------|
| **Penpot** | None | Open-source, focuses on design-system collaboration; no AI roadmap announced |
| **Lunacy** (Icons8) | AI-assisted: background removal, image generator (via Icons8), avatar generator, AI upscaler | Relies on Icons8's API/Lunacy cloud |
| **Vectr** | None | Very basic vector editor; minimal ML |

**Architecture notes**: Small tools like Lunacy piggyback on third-party APIs (Icons8, remove.bg-style upscaling). Strata's built-in Rust/WASM background removal (u2netp, BiRefNet) is far more self-contained.

---

## 6. Adjacent industries — proven AI wins

### Photo editing (Luminar Neo, Topaz, ON1)
| Feature | What works | Strata relevance |
|---------|-----------|-----------------|
| **Sky Replacement** (SkyAI, Luminar) | Detects sky horizon, composites new sky, relights foreground to match | High — "relight document" feature |
| **Denoising** (Noiseless AI, Topaz DeNoise, DxO PureRAW) | Removes luminance/chroma noise while preserving detail | High — Strata has retouch ops; add denoise filter |
| **Upscaling** (Upscale AI, Topaz Gigapixel, Real-ESRGAN) | 2-6× resolution increase from learned image priors | High — Strata already has upscale crate; real-time preview is the differentiator |
| **Sharpen AI** (Topaz) | Motion blur + misfocus recovery | Medium — deconvolution filter |
| **StructureAI** (Luminar) | Texture enhancement without affecting edges | High — edge-aware content filter |
| **BodyAI / PortraitAI** | Skin smoothing, geometry-aware body/face retouching | Medium — retouch has clone/heal/patch; "auto skin smooth" is the gap |
| **Relight AI** | Fixes underexposure, directional relighting | High — exposure/levels/Y-curves already in engine |
| **Enhance AI** (one-slider) | Maps ~12 controls to a single perceptual slider | Medium — "auto-adjust" color correction |
| **Generative Erase / GenErase** | Removes objects; fills background intelligently (2024+) | Medium — content-aware fill is in roadmap |
| **GenSwap** (replaces object with text-prompted object) | GenAI-based replacement | Low — requires diffusion model |

### Video editing (DaVinci Resolve)
| Feature | What works | Strata relevance |
|---------|-----------|-----------------|
| **Magic Mask** (Neural Engine) | Rotor-sculling/masking by drawing scribbles; tracks across frames | Medium — motion mask path masks in timeline |
| **Object Removal** | Neural tracking-based remove | Low — out of current scope |
| **Speed Warp** (optical-flow retime) | Optical flow frame interpolation | Medium — could be useful for timeline preview |
| **Super Scale** | 2-4× upscale for archival/SD footage | Medium — upscale already in engine |
| **Depth Map** | Stereo/depth-from-monocular estimation | Low — 3D features not current scope |
| **Face refinement** | Beauty/facial retouch in video | Low — video not current scope |
| **Relight** (2025+) | 3D-keyed relighting in post | Low |

### 3D tools
| Feature | What works | Strata relevance |
|---------|-----------|-----------------|
| **Texture generation** (Substance 3D AI, Blender Stable Diffusion add-on) | PBR texture sets from text | Low — 3D not current scope |
| **Mesh optimization** (InstaLOD, Simplygon) | Auto-retopology, LOD generation | Low |
| **Material generation** (Armorpaint, Substance) | PBR from photo | Low |
| **HDR lighting from HDRI** | Dynamic range lighting estimation | Low |

### Developer tools (GitHub Copilot patterns → design tool translations)
| Copilot pattern | Design tool translation | Strata fit |
|-----------------|----------------------|------------|
| **Code completion** | Property/completion suggestions in inspector (e.g., typography preview) | High — Strata has typography/property inspector |
| **Code review / linting** | Design linting (naming, constraint, hierarchy consistency) | High — Strata already has WCAG contrast, naming audit |
| **Test generation** | Preview/test pattern generation for every frame | Medium |
| **Documentation** | Auto-generated spec/documentation | Medium — Strata has spec/codegen; AI can improve explanations |
| **Template/repository** | Design system template suggestions | High — component/variant system exists; AI could suggest new components |
| **Chat assistant (Claude-style)** | Design advisor chat (contextual to document) | Medium —opilot-styleStrata has AIPanel; can expand intent coverage |

---

## 7. Traditional AI/ML that works without LLMs

These are the highest-ROI features for an offline-first, privacy-preserving suite
like Strata. All run locally on CPU/GPU, no API calls, no LLM cost.

| Feature | Algorithm | Maturity | Strata status |
|---------|-----------|----------|---------------|
| **Background removal** | U2-Net, BiRefNet (CNN); rembg-style | Production | ✅ Built |
| **Auto-trace / image vectorization** | Potrace, VTRACER, OpenCV contour tracing | Production | ✅ Built |
| **Color palette extraction** | Median-cut / OKLAB k-means | Production | ✅ Built |
| **Color harmony suggestions** | Hue-rotation in OKLCH space (complementary/triadic/etc) | Production | ✅ Built |
| **Auto-naming layers** | Heuristic rule tree (kind + dimensions + text content) | High | ✅ Built |
| **WCAG contrast audit** | Relative luminance math, OKLCH auto-fix | High | ✅ Built |
| **Layout suggestion / flex | Taffy-based grid + heuristics | High | ✅ Partial (flex/grid exist) |
| **Content-aware crop / seam carving** | Dynamic-programming seam removal | Medium | ❌ Not built |
| **Super-resolution** | Real-ESRGAN / Strata upscale crate | Production | ✅ Built |
| **Style transfer** | AdaIN / WCT neural style transfer | Medium | ❌ Not built |
| **OCR** | Tesseract / Vision framework | High | ❌ Not built (low priority) |
| **Font identification** | WhatTheFont API / local classifier | Medium | ❌ Not built |
| **Smart selection (magic wand)** | Region-growing / graph-cut segmentation | Medium | ✅ Spatial index improves hit-testing |
| **Edge-aware sharpen/unsharp** | Unsharp mask + bilateral filter | High | ✅ Built in filter pipeline |
| **Image harmonization** | Poisson blending / gradient-domain compositing | Medium | ❌ Not built |
| **Panorama stitching** | Feature-point homography (SIFT/ORB) | High | ❌ Not built |
| **Noise reduction** | Non-local means / BM3D-style | Medium | ❌ Not built (gaps vs. Topaz) |
| **HDR merge exposure fusion** | Mertens/Debevec exposure fusion / tonemap | Medium | ❌ Not built |
| **Perspective correction** | Vanishing-point Hough / CNN rectification | Medium | ❌ Not built |
| **QR/barcode decode** | ZBar/ZXing | Low | ❌ Not built |

### Priority tiers for Strata

**Tier 1 (ship first — clear user value, offline, no LLM)**
1. Content-aware crop / seam carving (resize without distortion)
2. Sky/background-aware relight for composited scenes
3. Noise reduction (CNN-style, denoise filter)
4. Style transfer (one-click "apply this artwork's style to that one")
5. Image harmonization (paste one image into another; auto-match lighting/color)
6. Perspective correction (auto-straighten architectural photos)

**Tier 2 (ship second — moderate complexity)**
1. Font identification/match (run local font similarity classifier; match against Adobe Fonts / Google Fonts)
2. OCR (Tesseract WASM build; limited value for design tool but needed for accessibility)
3. Panorama stitching (for photo/draw mode content creation)
4. Auto-white-balance / color temp from scene content

**Tier 3 (deferred — heavy models, niche)**
1. 3D normal/depth map (CNN depth estimation)
2. Hand-drawing beautification (vectorize sketch + smooth + close paths)
3. Video timeline effects (optical flow, frame interpolation)

---

## 8. Free / accessible APIs for image processing & analysis

### Offline-first (no network, no cost)

| Library | What | License | WASM? |
|---------|------|---------|-------|
| **Tesseract.js** | OCR (text recognition) | Apache 2.0 | ✅ Yes |
| **OpenCV.js** | 2000+ CV algorithms (contour, features, color, segmentation) | Apache 2.0 | ✅ Yes |
| **onnxruntime-web** | Inference for any ONNX model in browser/worker | MIT | ✅ Yes |
| **u2net.onnx (bundled already)** | Background removal | Custom (free) | ✅ Built-in |
| **BiRefNet-Lite onnx** | High-quality matting | Apache 2.0 | ✅ Built-in |
| **Real-ESRGAN compact onnx** | 4× super-resolution | BSD | ✅ Could bundle |
| **rustybuzz** (already used) | Text shaping | MIT | ✅ Native |
| **potrace (Rust port)** | Auto-trace | GPL/MIT ports | ✅ Native |
| **vtracer (Rust)** | Color image -> SVG | MIT | ✅ Native |
| **Palette (Rust)** | Image color extraction | MIT | ✅ Native |
| **ab_glyph** (already used) | Font outlining | Apache 2.0 | ✅ Native |
| **kurbo** (already used) | Bézier primitives | Apache 2.0 | ✅ Native |

### Online / free-tier cloud APIs

| API | Free tier | Best for |
|-----|-----------|----------|
| **remove.bg API** | 50 req/month | Background removal (marginally better than u2netp) |
| **WhatTheFont (MyFonts)** | Rate-limited | Font identification from image |
| **Google Cloud Vision** | 1000 req/month | OCR, object detection, label/safe-search |
| **Azure Computer Vision** | 5000 req/month | OCR, spatial analysis, dense captioning |
| **Cloudmersive** | 800 req/month | OCR, image-to-PNG/resize |
| **Resemble.ai** | Demo only | Voice cloning |
| **ElevenLabs** | 10k chars/month | Speech synthesis |
| **Replicate / HuggingFace Inference** | Community-hosted | Any open model (Stable Diffusion, etc) |

### Recommendation for Strata
- **Stay offline-first** — the whole value prop of Strata is native, WASM, no cloud dependency
- Use **onnxruntime-web** as the runtime; bundle models as described in ADR-0005
- Add **Real-ESRGAN compact** for 4× upscaling (better than current upscale crate)
- Add **OpenCV.js** for feature-point homography, perspective correction, image alignment
- **Tesseract.js** for OCR when accessibility requires it
- Skip the LLM-as-default pattern entirely; use LLMs only for the AIPanel chat interface where the user explicitly opts in

---

## Summary — What genuinely provides value

### Winners (where AI actually helps)
1. **Background removal** — Strata already has this. Win.
2. **Generative Fill / Expand (Photoshop)** — outperforms copy-paste; offline approximation via diffusion model on specific strata is feasible
3. **Rename layers / auto-naming** — Strata already has this. Win.
4. **Sky replacement + relight** — offline via segmentation + color transfer; medium effort
5. **Super-resolution** — Strata already has this; Real-ESRGAN compact would be an upgrade
6. **Search (semantic / visual)** — Figma's biggest win; embeddings-based design-system search is overkill for single-user docs; defer
7. **Content-aware crop** — classic, easy to implement, high utility
8. **Noise reduction (CNN denoise)** — Topaz-proven feature; bundles well with photo/retouch tools

### Losers (marketing > utility)
- **Generative UI layouts** — output is mediocre, requires heavy review/edit afterwards; trust issue
- **Vector generation from prompt** (Figma Make) — noisy, needs significant post-edit
- **Text-to-image** — Midjourney/DALL-E/Flux are better; integration > building
- **Layer semantic search** (Visual Search) — only valuable at scale (large orgs); not for local-first tools
- **"Make prototype" auto-generation** — interaction intent too complex for reliable AI output
- **GenSwap (replacing objects with prompt-driven alternatives)** — deep-diffusion required, niche

### The Strata strategic position
- **Don't race Figma/Adobe on generative modeling** — they have $200M+ AI R&D and partnerships with Anthropic/OpenAI/Google. Strata's value is **privacy, offline-first, local-first, cross-platform native**.
- **Compete on "craft assistance"**: color harmony, contrast fixes, spacing harmonization, auto-naming, path simplification, layout scoring — traditional ML that works on CPU/WASM with no network dependency.
- **Integrate generative AI as a plugin** (when user opts in): let the AIPanel dispatch to local LLM (Ollama/LM Studio) or chosen cloud API for text-to-image, but never as the default.
- **Own the offline photo-editing stack**: denoise, upscale, deblur, sky replacement, HDR merge, perspective correction, relight, auto-white-balance — this is the Luminar/Topaz feature set, and nobody has it built into a cross-platform vector/photo/text/page-layout suite like Strata.
- **Skip font identification / OCR for now** — edge-case value for design tools.
