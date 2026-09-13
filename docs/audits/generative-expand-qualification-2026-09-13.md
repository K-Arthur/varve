# Generative Expand qualification: prompt-free LaMa - 2026-09-13

## Decision

Prompt-free expansion through the existing LaMa inpainting model is a real,
usable local capability for bounded photographic backgrounds in the tested
categories. It preserves every retained source pixel byte-for-byte and fills
the full requested border including corners. It is not an all-content quality
guarantee: the visual review below records a clear dark-band failure on the
architecture top-expansion case, which remains limited and review-only.
The capability is therefore enabled as **Expand (promptless, local
reconstruction)** in the shared generative-edit surface, with the declared
content limits intact.

The existing **Remove** mode is the user-facing **Generative Subtract**
operation: marked source pixels are reconstructed from their surrounding
context, rather than deleted or made transparent. The persisted operation name
remains `remove` for document compatibility, and its source snapshot/undo
contract is shared with Expand.

Prompt-conditioned expansion remains unavailable. The pinned Stable Diffusion
1.5 Inpainting candidate is still unqualified (see the 2026-09-12 runtime
report), so no prompt field may be shown for a provider that cannot consume it.

LaMa is an inpainting model, not a dedicated outpainting model. It has no
language conditioning, cannot invent requested objects, and its continuation
quality falls as the requested border grows. Those limits are part of the
declared capability rather than hidden by the interface.

## Model and runtime identity

| Field | Value |
| --- | --- |
| Model id | `lama-inpainting` |
| Artifact | `lama_fp32.onnx` (Carve/LaMa-ONNX port of `saic-mdal/lama` big-lama) |
| SHA-256 | `1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6` |
| License | Apache-2.0 (code and weights) |
| Runtime | `varve-bgremove` `lama_inpaint` over ONNX Runtime, `ort-native`, CPU |
| Graph contract | two inputs `image [1,3,512,512]` + `mask [1,1,512,512]`, output `[1,3,512,512]` in 0-255 |
| Host | Linux x86_64, AMD Ryzen 3 5300U |

The model was downloaded from the manifest URL and verified against the pinned
SHA-256 before the run. No other artifact was substituted.

## Method

The qualification harness calls the same production `lama_inpaint` helper the
desktop app uses, with the same frame preparation the editor applies for
Expand:

1. The source is placed in the expanded output frame at `(left, top)` with no
   resampling.
2. New border pixels are filled with edge-clamped context and covered by a
   full-coverage mask including corners.
3. LaMa runs on the frame. The graph letterboxes the frame into its fixed
   512-pixel input and scales the result back to the frame size.
4. The authoritative source rectangle is copied back into the result, so
   provider changes inside protected pixels are discarded.

Fixtures are the public-domain photographic corpus documented in
`tests/e2e/fixtures/PROVENANCE.md`, downscaled to a 1024-pixel long side for
the run. The harness lives at
`crates/varve-bgremove/tests/lama_expand_qualification.rs`.

Two browser workflow lanes complement the native run:

- `tests/e2e/caf/expand-real-photo.spec.ts` drives the real dialog on a
  1632x1224 landscape with Fast quality and asserts the reviewed preview
  dimensions, the accepted record (mode, output frame, full-output asset kind),
  node identity and geometry, exact retained source pixels, independent PNG
  export dimensions/protection, undo/redo, reopening the accepted edit, and
  Restore Original. The final clean no-HMR Chromium run in an isolated
  validation worktree passed one test in 2.6 minutes on 2026-09-13. Its
  reviewed dialog and independently decoded 1664x1272 export are retained as
  `browser-expand-dialog-result.png` and `browser-expand-export.png`.
- The promptless reconstruction warning is visible in the review footer, so
  the provider boundary is disclosed at acceptance time.
- `tests/e2e/caf/caf.spec.ts` drives the real Remove workflow on the same
  photograph. The final clean no-HMR Chromium run passed one test in 2.8
  minutes; it records the `remove` recipe, `varve-content-aware` provider,
  bounded `region-overlay`, and now compares the canonical source asset bytes
  and source fill identity before and after acceptance. The dialog and applied
  scene are retained under
  `tests/e2e/fixtures/generative-evidence/subtract-2026-09-13/`.

The browser lanes used the Fast/PatchMatch local provider because the browser
WASM engine was unavailable in that isolated run and native LaMa is not a
browser capability. They prove the editor workflow, source-safe composition,
persistence/export plumbing, and fallback behavior; the native qualification
above is the model-backed quality evidence.

## Results

| Case | Fixture | Source | Output | Margin (T/R/B/L) | Provider ms | Border changed | Border luminance stddev | Mean seam gradient (0-255) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| landscape-right-bottom | real-life-landscape.jpg | 1024x768 | 1184x888 | 0/160/120/0 | 59616 | 99.7% | 47.4 | 2.1 |
| portrait-left-right | real-life-braided-portrait.jpg | 825x1024 | 1145x1024 | 0/160/0/160 | 17222 | 100.0% | 51.2 | 2.9 |
| architecture-top | real-life-brookings-hall.jpg | 1024x810 | 1024x950 | 140/0/0/0 | 19099 | 100.0% | 66.3 | 3.2 |
| seascape-all-sides | real-life-seascape-sunset.jpg | 768x1024 | 928x1184 | 80/80/80/80 | 17004 | 99.9% | 83.3 | 11.1 |

Source protection is asserted for every case: after composition, every retained
pixel equals the source pixel exactly, including alpha. The border-changed and
luminance metrics confirm the new area is generated rather than a copy of the
edge-clamped context.

The first case includes cold model load. Warm runs are 20-21 s on this CPU for
a 512-pixel model frame. The effective generated detail is at most 512 pixels
on the long side before enlargement; a 1184-pixel output therefore has
approximate detail in the new border. The review surface must state this, which
`estimateExpandGenerationResolution` does.

## Visual review

Reviewed by inspecting full frames and the retained evidence images:

- **Landscape (right and bottom):** sky gradient and dark foreground continue
  plausibly; the far-right band is slightly darker than the source, producing a
  faint vertical tonal transition. Usable for backgrounds; a reviewer would
  likely crop or accept.
- **Portrait (left and right):** studio backdrop continuation is clean; the
  near-black surround is extended without inventing subjects. Best-case
  category.
- **Architecture print (top):** source pixels remain exact, but the generated
  outer band develops a visibly dark/black strip despite the light source
  surround. This is a structural quality failure that the seam-gradient score
  does not catch; treat this category as limited, inspect at 100%, and discard
  or use Fast/another crop when the band is visible.
- **Seascape (all sides):** wave texture and sunset gradient continue across
  the new border; the seam gradient is the highest measured (11.1), consistent
  with the strong horizontal wave edge crossing the boundary. The generated
  water is softer than the source but structurally coherent.

No case produced a hallucinated object, duplicated subject, or protected-pixel
drift.

## Declared content categories

| Category | Support | Notes |
| --- | --- | --- |
| Photographic backgrounds: sky, gradients, water, grass, soft interiors | Supported | Best measured results; largest tested category |
| Scanned prints with plain surround | Supported | Faithful continuation of plain borders |
| Textured repeating surfaces | Limited | Texture scale softens; review at 100% |
| Architecture with strong perspective | Limited / review-only | The tested top expansion produced a dark outer band; no protected pixels drifted, but the result is not a reliable architecture continuation |
| Faces, hands, or subjects crossing the boundary | Limited | Continuation of existing subject matter is not semantic reconstruction |
| Text, logos, diagrams, pixel art, UI screenshots | Unsuitable | Raster continuation can corrupt legibility; not evaluated as a supported category |
| Transparent cutouts | Limited | New pixels are opaque; generating a background behind a cutout is a separate choice |
| Animation or video | Unsupported | Still-image milestone only |

## Resource behavior

- Model file 208 MB; measured peak reservation ~850 MB is already recorded in
  the native model manifest.
- Generation is admitted through the shared heavy-inference lease and the
  native resource preflight, so it cannot run concurrently with another heavy
  model job.
- Cancellation uses the request-scoped token; the helper checks it before and
  after inference.
- The generated result is bounded by the existing 8192-pixel dimension and
  33.5-megapixel plan limits before any frame is allocated.

## Evidence

Retained under
`tests/e2e/fixtures/generative-evidence/expand-2026-09-13/`:

- `qualification-report.json` - machine-readable per-case metrics.
- `manifest.json` - SHA-256 for every retained artifact.
- Per case: `-source.png`, `-frame.png`, `-provider.png` (raw model output),
  `-accepted.png` (source restored). Review copies are bounded to a 640-pixel
  long side; all metrics were computed at full resolution.
- `browser-expand-dialog-result.png` and `browser-expand-export.png` are the
  reviewed browser acceptance and independent PNG export captures.

`tests/e2e/fixtures/generative-evidence/subtract-2026-09-13/` contains the
real-photo Remove / Generative Subtract dialog and applied-scene captures,
plus a hash manifest. The accepted operation remains named `remove` in the
document schema for compatibility, while the inspector, docs, and marketing
surface describe its user-facing meaning as Generative Subtract.

Reproduce with:

```bash
VARVE_LAMA_QUALIFICATION=1 cargo test -p varve-bgremove --features ai \
  --test lama_expand_qualification -- --nocapture
```

The test requires the pinned model at the native model path and the staged
ONNX Runtime dylib; it is skipped unless `VARVE_LAMA_QUALIFICATION=1` is set.

## Failure modes observed in other products

The product decisions above are a direct response to reported failures in
generative expand tools. These are user reports and vendor documentation, not
prevalence estimates; they identify the failure mode, and each has a concrete
answering behavior in Varve.

| Reported failure | Source | Varve response |
| --- | --- | --- |
| Generated expansion rewrites or invents content inside the original image; users ask for expansion "fundamentally different from Generative Fill" that stays faithful to the source | [Adobe community: expand in all directions problems](https://community.adobe.com/t5/photoshop-ecosystem-ideas/generative-expand-in-all-directions-problems/idi-p/14364407) | The retained rectangle is drawn from the authoritative source through a border clip; provider output cannot touch it, and the native qualification asserts byte-exact protected pixels |
| Visible border/tonal seam between original and generated area, especially on dark or smooth images | [Adobe community: expand issue](https://community.adobe.com/questions-700/generative-expand-issue-671957), [Reddit: removing seams](https://www.reddit.com/r/photoshop/comments/1ewrvbd/how_do_i_remove_these_seems/) | One-pass full-border generation with edge-clamped context (no separately generated sides), per-case seam-gradient measurement, and 1:1 review before acceptance |
| A smooth seam score hides a structural failure farther into the generated band; the architecture case produced a dark outer strip even though the immediate seam was close | This qualification's independently inspected `architecture-top` evidence | Keep the full-frame review and 100% boundary inspection in the acceptance path; classify the result as limited and offer discard/Fast rather than claiming a successful continuation |
| Generated result drifts from "continue the scene" toward random inserted objects | [Reddit: generative extend changed](https://www.reddit.com/r/Adobe/comments/1u0b5rj/has_something_changed_on_generative_extend_in/) | A promptless provider is used as promptless; no ignored prompt text, no fabricated "creative variation" labels, and LaMa is documented as continuation, not semantic invention |
| Gaps around the outside edge after expansion | [Adobe community: expand in all directions problems](https://community.adobe.com/t5/photoshop-ecosystem-ideas/generative-expand-in-all-directions-problems/idi-p/14364407) | The coverage mask marks the entire new border including corners, and the accepted output is the full requested frame |
| Inpaint checkpoints change unmasked pixels unless the unmasked area is explicitly overlaid back | [Diffusers inpainting guide](https://huggingface.co/docs/diffusers/using-diffusers/inpaint) | Varve composites the source over the provider result and separately restores the authoritative rectangle; the qualification measures provider change in the protected area |
| Failed or slow generations consume credits or allowances, and reliability failures block ordinary work | [Adobe community: unreliable expand](https://community.adobe.com/questions-712/generative-expand-doesn-t-work-glitchy-and-unreliable-1183575), [Canva review](https://litmustools.com/review/canva/) | Expansion is local, free per attempt, cancellable, and never uploads; the heuristic path works without any model |
| Outpainting seams, discontinuities, and overpainting outside the mask in local diffusion workflows | [InvokeAI issue 1319](https://github.com/invoke-ai/InvokeAI/issues/1319) | The mask contract is enforced at composition, and higher seam strength is not simulated by hidden blur |
| Iterative expansion degrades quality; each pass should build on the accepted result | [Canva Magic Expand guide](https://artificial-intelligence-wiki.com/ai-tools/ai-design-tools/canva-magic-expand/), [Canva after-crop report](https://www.reddit.com/r/canva/comments/1ggk3o2/magic_expand_after_cropping/) | The next expansion starts from the accepted asset and protects it the same way; the original snapshot and output frame keep Restore Original available |
| Model output is only valid within the model's trained resolution; enlarged output must not be presented as native detail | [LaMa paper](https://arxiv.org/abs/2109.07161), [outpainting comparison paper](https://openaccess.thecvf.com/content/CVPR2022W/NTIRE/papers/Cipolina-Kun_Comparison_of_CoModGANs_LaMa_and_GLIDE_for_Art_Inpainting_Completing_CVPR2022_paper.pdf) | `estimateExpandGenerationResolution` states the effective synthesized resolution in the expansion controls before generation |
| Browser runtimes cannot serve arbitrarily large model graphs | [ONNX Runtime Web: large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html) | The browser path uses PatchMatch texture continuation; model-backed expansion is desktop-only with a pinned 208 MB graph and a measured memory reservation |

## Remaining gaps

- Browser PatchMatch expansion is implemented as the offline heuristic path and
  is not model-backed. Its quality boundary is texture continuation, not scene
  understanding.
- Cross-platform package qualification (Windows, macOS, ARM, constrained
  memory) is pending; the measurements above are Linux x86_64 CPU only.
- The full 24-photo/32-task corpus and multi-seed repetition have not been run
  for expansion specifically.
- Prompt-conditioned expansion remains gated on a future qualified
  prompt-capable model.
