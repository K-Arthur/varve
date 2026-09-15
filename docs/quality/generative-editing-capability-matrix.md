# Generative editing capability matrix

This is the qualification ledger for the local-first generative editing
workflow. “Implemented” means that the code path exists. “Automatically
verified” means a repeatable repository check passed. “Visually reviewed” is
reserved for an inspected output from the production provider; interface
screenshots and mocks do not qualify.

Last updated: 2026-09-15.

The frozen input gate can be checked offline with:

```bash
node scripts/quality/generative-qualification.mjs --json
```

That command validates the 24 photographic fixtures and 32 fixed tasks only;
it intentionally makes no model-quality claim. A real qualification run must
write a `report.json` in an evidence directory and pass the same gate with:

```bash
node scripts/quality/generative-qualification.mjs \
  --evidence-dir /path/to/qualification-evidence --json
```

The evidence report must retain all three frozen seeds per task, source and
mask representations, prepared context, raw candidate, composite, difference
map, 100% boundary crop, timing, measured peak memory, provider provenance,
and 0–4 review scores. Failed or missing candidates are errors in the gate;
they cannot count as successful generation. The gate also requires zero
protected-pixel deltas, source-placement preservation, alpha-safe compositing,
an acceptable candidate for at least 90% of tasks, and coverage of every
fixture category. It is an evidence-integrity check, not a replacement for
visual inspection or the native runtime qualification.

## Provider and platform status

The engine-level capability object records `available`, `ready`, supported
parameters, limits, and a stable `reasonCode` for every mode. “Available” means
the selected runtime has an implementation; “ready” additionally requires all
local model prerequisites. This distinction is reflected in the dialog before
the user starts a job.

| Capability | Browser | Desktop Linux CPU | Desktop Vulkan/Metal | Qualification evidence |
|---|---|---|---|---|
| Fill without a prompt | Implemented; automatically verified with deterministic tests | Implemented through the shared pipeline | Not separately qualified | `packages/engine/src/generativeEdit/generativeEdit.test.ts`, `tests/e2e/caf/caf.spec.ts` |
| Remove without a prompt | Implemented; automatically verified with deterministic tests | Implemented through the shared pipeline | Not separately qualified | `packages/engine/src/generativeEdit/generativeEdit.test.ts`, `tests/e2e/caf/caf.spec.ts` |
| Expand without a prompt | Unavailable; the Fast/PatchMatch edge continuation produced visible striping on the real-photo review and is no longer exposed | Implemented; LaMa model-backed when the pinned local model is installed, deterministic reconstruction otherwise. Source pixels are copied through exactly; the full requested border including corners is generated; effective generated detail is bounded by the model frame and disclosed in review. Architecture continuation remains limited/review-only | Linux x86_64 CPU only; Windows, macOS, ARM, and constrained package evidence pending | [Expand qualification 2026-09-13](../audits/generative-expand-qualification-2026-09-13.md), `crates/varve-bgremove/tests/lama_expand_qualification.rs`, `packages/engine/src/generativeEdit/expandPlan.test.ts`, `packages/engine/src/generativeEdit/expandFallback.test.ts`, `tests/e2e/caf/expand-real-photo.spec.ts` |
| Expand frame controls | Visible for capability explanation, but Generate is disabled until a browser provider qualifies | Shared dialog path converts only containing frames to margins; no crop or source resampling | Desktop pointer/keyboard coverage and package qualification pending | `packages/editor/src/components/ContentAwareFill/expandControls.test.ts`, `tests/e2e/caf/expand-real-photo.spec.ts` |
| Prompt-conditioned Fill | Unavailable by design; no remote fallback | Candidate adapter exists, but no model is qualified after the SD 1.5 and SDXL real-photo probes | Not verified | [SDXL probe](../audits/generative-editing-sdxl-probe-2026-09-15.md); [runtime qualification report](../audits/generative-editing-runtime-qualification-2026-09-12.md) |
| Prompt-conditioned Replace | Unavailable by design | Candidate adapter exists, but no model is qualified after the SD 1.5 and SDXL real-photo probes | Not verified | [SDXL probe](../audits/generative-editing-sdxl-probe-2026-09-15.md); [runtime qualification report](../audits/generative-editing-runtime-qualification-2026-09-12.md) |
| Prompt-conditioned Expand | Unavailable by design | Contract and candidate adapter exist, but no model is qualified after the SD 1.5 and SDXL real-photo probes; the promptless local path is a separate row | Not verified | `packages/editor/src/components/ContentAwareFill/expandCanvas.test.ts`; [SDXL probe](../audits/generative-editing-sdxl-probe-2026-09-15.md) |
| Mask editing and refinement | Implemented; automatically verified, including Edit mask on reopen and Background Removal preview import on a 33 MP photograph. The dialog now reports coverage, bounds, connected regions, edge contact, and soft-only coverage; empty/tiny masks and source-geometry mismatches are blocked before inference. Brush strokes interpolate between sparse pointer events and preserve the selected mask operation across the complete gesture. | Shared implementation | Shared implementation | `packages/editor/src/components/ContentAwareFill/maskOperations.test.ts`, `packages/editor/src/components/ContentAwareFill/selectionHealth.test.ts`, `tests/e2e/caf/object-selection-mask-source.spec.ts`, `tests/e2e/caf/caf.spec.ts` real-photo Remove lane |
| Object Selection → Generative Edit mask | Implemented; workflow-wired and automatically verified; full-resolution SAM2 allocation is safe-peak preflighted. Candidates are source-locator guarded, remain reviewable, and stale proposals are discarded when the image changes in place. Automatic foreground proposals now keep the overlay visible after candidate preview but require an explicit review confirmation; switching candidates clears it. The decoder removes encoder letterbox padding before restoring source geometry. After decoding, candidates must contain include points, exclude background points, and overlap a supplied box; rejected candidates are removed from cycling and the separate prompt-match score is shown alongside predicted IoU. | Shared implementation; confirmed candidate only; native OS/cgroup snapshot used when available, package qualification pending | Shared implementation; confirmed candidate only; package qualification pending | `tests/e2e/caf/object-selection-mask-source.spec.ts`, `tests/e2e/canvas/object-selection-real-model.spec.ts`, `packages/editor/src/context/promptedSegmentationProvider.test.ts`, `packages/editor/src/context/useSam2Segmentation.test.tsx`, `packages/editor/src/components/Inspector/SelectionSourcesPanel.subject.test.tsx`, `packages/engine/src/inference/resourcePolicy.test.ts`; [selection/model audit](../audits/generative-editing-selection-model-audit-2026-09-14.md); SAM2 quality remains a separate real-model gate |
| Native low-memory preflight | Browser hints only; provider safe-peak gate remains required | Dimensions-only preflight before renderer canvas/PNG allocation, then OS-level available-memory check before runtime/model loading and repeated before native session checkout for diffusion and ONNX LaMa/background removal/denoise, including Linux cgroup/Crostini limits; measured native peaks and one-session admission; unknown native memory is refused closed with an architecture/platform-specific recovery message | Windows/ARM and macOS/Apple Silicon code paths compile-targeted; package qualification pending | `apps/desktop/src-tauri/src/generative_resources.rs`, `apps/desktop/src-tauri/src/lib.rs`, `crates/varve-bgremove/src/model.rs`, `crates/varve-bgremove/src/session_pool.rs`, `packages/engine/src/backgroundRemoval/__tests__/tauriProvider.test.ts`; desktop package matrix pending |
| Browser source-buffer preflight | Implemented; automatically verified | The browser/WebView safe peak includes resident source and temporary preparation buffers before AI background-removal allocation; an unready native model deliberately falls through this same gate; explicit hints refine the tier, while unknown hints use the conservative runtime budget and Quick fallback | Shared browser path; physical Chromebook/ARM package qualification pending | `packages/engine/src/backgroundRemoval/__tests__/sourceMemoryPreflight.test.ts`, `packages/engine/src/inference/resourcePolicy.test.ts`, `packages/engine/src/generativeEdit/resourcePolicy.test.ts` |
| Region-first source preparation | Bounded preview, source-rectangle decode, tiered working-pixel cap, source-resolution streaming mask persistence, and transparent bounded overlay acceptance | Shared browser/desktop adapter for Fill/Remove; Expand uses the validated full-frame plan with an exact protected-source restore | Expand uses its own full-frame plan with output-frame acceptance and exact source protection; effective generated resolution is disclosed | `packages/editor/src/components/ContentAwareFill/generationRaster.test.ts`, `packages/engine/src/generativeEdit/expandPlan.test.ts`; `tests/e2e/caf/caf.spec.ts` (33 MP portrait), `tests/e2e/caf/expand-real-photo.spec.ts` |
| Bounded variation storage and reopen | Implemented; inactive cards use persisted thumbnails and full candidates are loaded only for the active preview | Shared implementation | Shared implementation; device-package memory evidence pending | `packages/scene/src/__tests__/assets.test.ts`, `packages/scene/src/documentCodec.test.ts`, `tests/e2e/caf/caf.spec.ts` |
| In-place acceptance and Restore Original | Implemented; automatically verified | Shared implementation | Shared implementation | `packages/editor/src/imageOperations.test.ts` and scene persistence tests |
| Save/reopen, clipboard, package export | Implemented paths | Implemented paths; repeated-edit lineage and bounded overlay markers are remapped on import | Shared implementation | Document codec, closure, and clipboard tests; generative package evidence pending |

Model download cancellation is covered by
`packages/engine/src/generativeEdit/nativeModel.test.ts`: an already-aborted
request never starts Tauri work, progress is request-scoped, and an active
download rejects immediately while forwarding the native cancellation command.
This is renderer lifecycle evidence; native cancellation latency and the
post-download install race still require desktop-package evidence.

## Historical desktop model profile

The historical candidate is Stable Diffusion 1.5 Inpainting Q4_0 from the
`gpustack/stable-diffusion-v1-5-inpainting-GGUF` repository. The artifact is
pinned to the `21491e4` repository revision, is 1,747,219,584 bytes, and has
SHA-256:

```text
d157ce24483f0c999062da140eacebe8f3ed015e652723e31f6d39119b800c16
```

The model card identifies the artifact as CreativeML OpenRAIL-M and warns that
the GGUF is experimental for a patched runtime. Varve therefore performs a
masked production-helper qualification after installation; a matching file
hash alone does not make the provider ready. The pinned candidate failed the
2026-09-12 semantic/runtime inspection and remains unqualified. It is retained
for diagnostic provenance but is no longer offered as a download because the
published runtime requirement does not match Varve's `diffusion-rs` helper.
Users may still import a separately obtained safe-format model, but it must
pass the same runtime, real-photo, memory, cancellation, and platform gates
before prompt modes can become ready. See the
[model card](https://huggingface.co/gpustack/stable-diffusion-v1-5-inpainting-GGUF),
[stable-diffusion.cpp runtime](https://github.com/leejet/stable-diffusion.cpp),
and [qualification report](../audits/generative-editing-runtime-qualification-2026-09-12.md).

Qualification metadata is bound to the exact helper runtime, target OS,
execution backend, and CPU architecture. A model qualified on x86_64 is not
treated as ready on ARM64, Windows, macOS, ChromeOS Linux, or a changed helper
build until that target runs its own masked qualification.

The pinned Rust binding is `diffusion-rs = 0.1.20`, vendored with Varve's safe
separate-image-guidance field and identified at runtime as
`diffusion-rs-0.1.20-varve-image-cfg-v1`. The helper is supervised in a
separate process, and the webview receives only an opaque qualified handle.
Weights are not stored in the repository or in portable documents. The
[native boundary probe](../audits/generative-editing-native-probe-2026-09-14.md)
confirms that the corrected image CFG value reaches the production helper, but
both locally tested semantic candidates remain rejected by visual review. This
fixes the request/runtime configuration boundary; it does not promote a
model-quality candidate.

## Evidence state

- The repository currently contains the complete 24-photo/32-task frozen
  qualification corpus: eleven original browser-surface fixtures plus thirteen
  licensed additions. The [fixture provenance](../../tests/e2e/fixtures/PROVENANCE.md)
  page and [corpus manifest](../../tests/e2e/fixtures/generative-evidence/photo-corpus-2026-09-12.json)
  record the source page, creator, license, derivative URL, dimensions, and
  checksum for each image. The corpus is frozen input evidence; it does not
  imply that every model or mode has passed quality qualification.
- The downloaded Q4_0 artifact was verified against the pinned hash in a
  temporary test location. A real masked CPU inference run completed, but its
  inspected output failed prompt adherence and photographic plausibility. The
  Vulkan diagnostics likewise failed runtime integrity or semantic quality;
  all retained outputs and hashes are listed in the [qualification report](../audits/generative-editing-runtime-qualification-2026-09-12.md).
  The full task corpus is not yet run, so the prompt modes remain gated for
  release claims.
- A corrected production-helper rerun on a real coastal photograph also
  rejected the SD 1.5 Q4_0 and SD 2 F16 candidates after confirming image CFG
  provenance. See the [native boundary probe](../audits/generative-editing-native-probe-2026-09-14.md).
- Vulkan on Linux/Windows, Metal on macOS, constrained 4-GB behaviour, cold and
  warm timings, cancellation latency, and package-level reopening evidence
  remain outstanding.

## Visual validation checkpoint — 2026-09-13

The real-browser visual lane has been run against photographic sources, not
synthetic canvases:

- The promptless Fill case used `real-life-still-life.jpg`, painted the mask
  with pointer events, applied the result, and independently decoded the
  retained overlay. The result was inspected at the dialog scale.
- The real-photo Remove/in-place case used `real-life-landscape.jpg` and
  checked the retained source recipe, source-layer identity, and applied
  result. A fast pointer drag initially exposed a 92 × 92 endpoint-only mask;
  after stroke interpolation the same interaction produced a 748 × 92 frame
  and passed the substantive-output colour-diversity gate. The 33 MP portrait
  case exercised bounded source preparation and was inspected after Apply.
- The browser Expand case used the same landscape photograph and was checked
  at the real dialog surface. The previous browser output was inspected at
  full composition and 100% output/export scale and showed repeated/striped
  texture at the edges; the current browser capability test therefore verifies
  that Generate is unavailable with an explicit explanation. Desktop LaMa
  qualification remains a separate, limited reconstruction result and is not
  evidence of semantic outpainting.
- The website visual suite passed on the GitHub Pages base path for desktop
  feature, mobile feature, and dark documentation views. The reviewed
  before/after photographs and the narrow layout were inspected without
  snapshot updates.

These checks establish that real output reaches the review, acceptance,
storage, and export surfaces. They do not qualify prompt-conditioned Fill,
Replace, or Expand; those modes remain gated until a model/runtime passes the
photographic quality corpus.

The renderer-side cancellation races are covered by the native-provider and
native-model unit lanes: abort rejects active prompt generation, LaMa, model
download, and qualification requests immediately, and forwards each opaque
request id to its desktop cancellation command. The desktop LaMa and diffusion
commands own request-scoped cancellation tokens; closing or cancelling the
editor also invalidates an in-flight qualification response before it can
update a later session. Native helper termination latency for qualification
and cross-platform timing measurements still require native package evidence.

This ledger deliberately records gaps rather than converting an enabled
control or a passing mock into a capability claim.
