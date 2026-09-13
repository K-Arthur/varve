# Generative editing capability matrix

This is the qualification ledger for the local-first generative editing
workflow. “Implemented” means that the code path exists. “Automatically
verified” means a repeatable repository check passed. “Visually reviewed” is
reserved for an inspected output from the production provider; interface
screenshots and mocks do not qualify.

Last updated: 2026-09-13.

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
| Expand without a prompt | Implemented; Fast/PatchMatch texture continuation, not model-backed | Implemented; LaMa model-backed when the pinned local model is installed, deterministic PatchMatch otherwise. Source pixels are copied through exactly; the full requested border including corners is generated; effective generated detail is bounded by the model frame and disclosed in review | Not separately qualified | [Expand qualification 2026-09-13](../audits/generative-expand-qualification-2026-09-13.md), `crates/varve-bgremove/tests/lama_expand_qualification.rs`, `packages/engine/src/generativeEdit/expandPlan.test.ts`, `packages/engine/src/generativeEdit/expandFallback.test.ts`, `tests/e2e/caf/expand-real-photo.spec.ts` |
| Expand frame controls | Four source-pixel margins, target size/aspect-ratio presets, and source anchors (center, sides, corners) are implemented and unit-tested | Shared dialog path converts only containing frames to margins; no crop or source resampling | Pointer/keyboard browser coverage pending the next real-photo run | `packages/editor/src/components/ContentAwareFill/expandControls.test.ts`, `tests/e2e/caf/expand-real-photo.spec.ts` |
| Prompt-conditioned Fill | Unavailable by design; no remote fallback | Candidate adapter exists, but no model is qualified after the 2026-09-12 real-photo run | Not verified | [Runtime qualification report](../audits/generative-editing-runtime-qualification-2026-09-12.md) |
| Prompt-conditioned Replace | Unavailable by design | Candidate adapter exists, but no model is qualified after the 2026-09-12 real-photo run | Not verified | [Runtime qualification report](../audits/generative-editing-runtime-qualification-2026-09-12.md) |
| Prompt-conditioned Expand | Unavailable by design | Contract and candidate adapter exist, but no model is qualified after the 2026-09-12 real-photo run; the promptless local path is a separate row | Not verified | `packages/editor/src/components/ContentAwareFill/expandCanvas.test.ts`; [runtime qualification report](../audits/generative-editing-runtime-qualification-2026-09-12.md) |
| Mask editing and refinement | Implemented; automatically verified, including Edit mask on reopen | Shared implementation | Shared implementation | `packages/editor/src/components/ContentAwareFill/maskOperations.test.ts`, CAF browser E2E (paint/source controls) |
| Object Selection → Generative Edit mask | Implemented; workflow-wired and automatically verified; full-resolution SAM2 allocation is safe-peak preflighted | Shared implementation; confirmed candidate only; native OS/cgroup snapshot used when available, package qualification pending | Shared implementation; confirmed candidate only; package qualification pending | `tests/e2e/caf/object-selection-mask-source.spec.ts`, `packages/engine/src/inference/resourcePolicy.test.ts`; SAM2 quality remains a separate real-model gate |
| Native low-memory preflight | Browser hints only; provider safe-peak gate remains required | Dimensions-only preflight before renderer canvas/PNG allocation, then OS-level available-memory check before runtime/model loading and repeated before native session checkout for diffusion and ONNX LaMa/background removal/denoise, including Linux cgroup/Crostini limits; measured native peaks and one-session admission; unknown native memory is refused closed with an architecture/platform-specific recovery message | Windows/ARM and macOS/Apple Silicon code paths compile-targeted; package qualification pending | `apps/desktop/src-tauri/src/generative_resources.rs`, `apps/desktop/src-tauri/src/lib.rs`, `crates/varve-bgremove/src/model.rs`, `crates/varve-bgremove/src/session_pool.rs`, `packages/engine/src/backgroundRemoval/__tests__/tauriProvider.test.ts`; desktop package matrix pending |
| Browser source-buffer preflight | Implemented; automatically verified | The browser/WebView safe peak includes resident source and temporary preparation buffers before AI background-removal allocation; an unready native model deliberately falls through this same gate; explicit hints refine the tier, while unknown hints use the conservative runtime budget and Quick fallback | Shared browser path; physical Chromebook/ARM package qualification pending | `packages/engine/src/backgroundRemoval/__tests__/sourceMemoryPreflight.test.ts`, `packages/engine/src/inference/resourcePolicy.test.ts` |
| Region-first source preparation | Bounded preview, source-rectangle decode, tiered working-pixel cap, source-resolution streaming mask persistence, and transparent bounded overlay acceptance | Shared browser/desktop adapter for Fill/Remove; Expand uses the validated full-frame plan with an exact protected-source restore | Expand uses its own full-frame plan with output-frame acceptance and exact source protection; effective generated resolution is disclosed | `packages/editor/src/components/ContentAwareFill/generationRaster.test.ts`, `packages/engine/src/generativeEdit/expandPlan.test.ts`; `tests/e2e/caf/caf.spec.ts` (33 MP portrait), `tests/e2e/caf/expand-real-photo.spec.ts` |
| Bounded variation storage and reopen | Implemented; inactive cards use persisted thumbnails and full candidates are loaded only for the active preview | Shared implementation | Shared implementation; device-package memory evidence pending | `packages/scene/src/__tests__/assets.test.ts`, `packages/scene/src/documentCodec.test.ts`, `tests/e2e/caf/caf.spec.ts` |
| In-place acceptance and Restore Original | Implemented; automatically verified | Shared implementation | Shared implementation | `packages/editor/src/imageOperations.test.ts` and scene persistence tests |
| Save/reopen, clipboard, package export | Implemented paths | Implemented paths; repeated-edit lineage and bounded overlay markers are remapped on import | Shared implementation | Document codec, closure, and clipboard tests; generative package evidence pending |

## Pinned desktop model profile

The explicit download profile is Stable Diffusion 1.5 Inpainting Q4_0 from
the `gpustack/stable-diffusion-v1-5-inpainting-GGUF` repository. The artifact is
pinned to the `21491e4` repository revision, is 1,747,219,584 bytes, and has
SHA-256:

```text
d157ce24483f0c999062da140eacebe8f3ed015e652723e31f6d39119b800c16
```

The model card identifies the artifact as CreativeML OpenRAIL-M and warns that
the GGUF is experimental for a patched runtime. Varve therefore performs a
masked production-helper qualification after installation; a matching file
hash alone does not make the provider ready. The pinned candidate failed the
2026-09-12 semantic/runtime inspection and remains unqualified. See the
[model card](https://huggingface.co/gpustack/stable-diffusion-v1-5-inpainting-GGUF),
[stable-diffusion.cpp runtime](https://github.com/leejet/stable-diffusion.cpp),
and [qualification report](../audits/generative-editing-runtime-qualification-2026-09-12.md).

Qualification metadata is bound to the exact helper runtime, target OS,
execution backend, and CPU architecture. A model qualified on x86_64 is not
treated as ready on ARM64, Windows, macOS, ChromeOS Linux, or a changed helper
build until that target runs its own masked qualification.

The pinned Rust binding is `diffusion-rs = 0.1.20`. The helper is supervised in
a separate process, and the webview receives only an opaque qualified handle.
Weights are not stored in the repository or in portable documents.

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
- Vulkan on Linux/Windows, Metal on macOS, constrained 4-GB behaviour, cold and
  warm timings, cancellation latency, and package-level reopening evidence
  remain outstanding.

The renderer-side cancellation races are covered by the native-provider unit
lane: abort rejects active prompt generation and LaMa requests immediately and
forwards each opaque request id to its desktop cancellation command. The
desktop LaMa command now owns a request-scoped cooperative token and serialized
execution gate; the native helper termination and cross-platform latency
measurements still require native package evidence.

This ledger deliberately records gaps rather than converting an enabled
control or a passing mock into a capability claim.
