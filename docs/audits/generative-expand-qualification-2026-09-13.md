# Generative Expand qualification: prompt-free LaMa - 2026-09-13

## Decision

Prompt-free expansion through the existing LaMa inpainting model is a real,
usable local capability. It preserves every retained source pixel byte-for-byte,
fills the full requested border including corners, and produces plausible
continuation for photographic backgrounds in the tested categories. The
capability is therefore enabled as **Expand (promptless, local reconstruction)**
in the shared generative-edit surface.

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
| SHA-256 | `1faef5301d78db7dda502fe59966957ec4b79d64e16f03ed96913c7a4eb68d6` |
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

## Results

| Case | Fixture | Source | Output | Margin (T/R/B/L) | Provider ms | Border changed | Border luminance stddev | Mean seam gradient (0-255) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| landscape-right-bottom | real-life-landscape.jpg | 1024x768 | 1184x888 | 0/160/120/0 | 58488 | 99.7% | 47.4 | 2.1 |
| portrait-left-right | real-life-braided-portrait.jpg | 825x1024 | 1145x1024 | 0/160/0/160 | 19917 | 100.0% | 51.2 | 2.9 |
| architecture-top | real-life-brookings-hall.jpg | 1024x810 | 1024x950 | 140/0/0/0 | 20995 | 100.0% | 66.3 | 3.2 |
| seascape-all-sides | real-life-seascape-sunset.jpg | 768x1024 | 928x1184 | 80/80/80/80 | 19742 | 99.9% | 83.3 | 11.1 |

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
- **Architecture print (top):** the dark emulsion border above the building is
  continued faithfully. No repeated architecture or invented objects.
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
| Architecture with strong perspective | Limited | Straight edges may soften; no invented structures observed but not a large sample |
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

Reproduce with:

```bash
VARVE_LAMA_QUALIFICATION=1 cargo test -p varve-bgremove --features ai \
  --test lama_expand_qualification -- --nocapture
```

The test requires the pinned model at the native model path and the staged
ONNX Runtime dylib; it is skipped unless `VARVE_LAMA_QUALIFICATION=1` is set.

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
