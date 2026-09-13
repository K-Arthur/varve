# Generative inpainting model comparison — 2026-09-13

## Decision

The `genai-archive/stable-diffusion-inpainting-gguf` Q4_0 artifact is not
qualified for Varve's prompt-conditioned editing workflow. It loaded and
completed a real CPU inpainting run through an isolated `diffusion-rs` probe,
but the inspected result did not follow the prompt. It must not replace the
currently gated product profile or be presented as marketing evidence.

This is a model-quality failure, not a compositing failure. The final
composite preserved the source outside the effective mask exactly.

## Frozen comparison task

- Source: the public-domain Wikimedia landscape fixture documented in
  [`tests/e2e/fixtures/PROVENANCE.md`](../../tests/e2e/fixtures/PROVENANCE.md).
- Working frame: `512 × 512`, the same normalized photographic source used by
  the existing Stable Diffusion qualification lane.
- Mask: white means edit and black means preserve; the center rectangular edit
  region is the fixed qualification mask.
- Prompt: `a red canoe on a calm lake, realistic outdoor photography`.
- Negative prompt: the probe's fixed `text, watermark, blurry, distorted,
  duplicate objects` list.
- Seed: `271828`.
- Settings: 20 steps, CFG 7, strength 0.75, CPU, one candidate.

## Candidate and runtime

| Field | Value |
| --- | --- |
| Artifact | `genai-archive/stable-diffusion-inpainting-gguf/sd-v1-5-inpainting.q4_0.gguf` |
| Repository revision | `6eb5015` |
| Size | `2,920,783,488` bytes |
| SHA-256 | `ababf34dbf33f8b23d1401afeaa719167ff6a95b16389c61a08d83e8503a1b4d` |
| License | CreativeML OpenRAIL-M |
| Rust binding | `diffusion-rs 0.1.20` |
| Probe runtime | `diffusion-rs` commit `5ed8d4057d911513490623b0b18f98427909c594` |
| C++ runtime submodule | `stable-diffusion.cpp` commit `6b3edaaf32cc19e5bb2d819c788bd557eddc8eba` |
| Host/backend | Linux x86_64, CPU |

The artifact was downloaded outside the repository and its checksum was
verified before execution. No model bytes or temporary paths were added to a
portable document.

## Observed result

The candidate loaded successfully and reached all 16 reported sampler units.
The generated region became a bright, rectangular building/sign-like object.
It did not depict a red canoe, did not read as a natural continuation of the
lake, and failed the photographic plausibility and prompt-adherence criteria.
The raw output, final composite, difference map, and 100% boundary crop are
retained here:

- `genai-archive-q4-cpu-512.png` — raw candidate.
- `genai-archive-q4-cpu-512-composited.png` — source outside the mask with
  the candidate composited inside it.
- `genai-archive-q4-cpu-512-difference.png` — source/composite difference.
- `genai-archive-q4-cpu-512-boundary.png` — 100% boundary inspection crop.

The final composite was checked with an inverse, thresholded mask. The exact
outside-region result was `mean=0` and `max=0`; therefore no preserved source
pixel changed. Differences visible in the non-thresholded edge diagnostic are
soft mask coverage at the intended boundary, not leakage into the protected
region.

## F16 follow-up

The official GenAI Archive F16 artifact was run through the current upstream
`stable-diffusion.cpp` CPU CLI as a higher-precision comparison. It also failed
the frozen task. The output was visually inspected at full-frame and 100%
boundary views: the landscape remained largely unchanged, with no readable
red canoe and no convincing prompt-conditioned insertion.

| Field | Value |
| --- | --- |
| Artifact | `genai-archive/stable-diffusion-inpainting-gguf/sd-v1-5-inpainting.f16.gguf` |
| Repository revision | `6eb5015` |
| Size | `2,137,695,552` bytes |
| SHA-256 | `0b7b90975c06f7a67f03c8921cd1011b0753d5d520338597b913d3761b01da6e` |
| Runtime | `stable-diffusion.cpp` submodule `6b3edaaf32cc19e5bb2d819c788bd557eddc8eba` |
| Settings | 20 steps, CFG 7, strength 0.75, seed 271828, 4 CPU threads |
| Measured run | about 1,032 seconds total; about 2.3 GiB resident memory |
| Decision | **not qualified** |

The F16 evidence is retained beside the Q4 evidence:

- `genai-archive-f16-cpu-512.png` — raw candidate.
- `genai-archive-f16-cpu-512-composited.png` — protected-source composite.
- `genai-archive-f16-cpu-512-difference.png` — visual difference map.
- `genai-archive-f16-cpu-512-boundary.png` — 100% boundary inspection crop.

The F16 run reinforces the product decision: increasing numerical precision
does not compensate for an unqualified artifact/runtime or establish useful
prompt adherence. The profile remains unsuitable for automatic exposure.

## Compatibility finding

The official SD 1.5 inpainting repository also exposes separate Diffusers
UNet, CLIP, and VAE files. Passing those raw component files directly to the
standalone runtime caused a process fault before an image was produced. They
are not converted standalone tensors, so file presence and model-card
compatibility do not establish runtime compatibility. The raw-component path
is rejected until a supervised conversion step and a fresh qualification run
are available.

## Supervised conversion follow-up

The three official component files were converted with the pinned
`stable-diffusion.cpp` `6b3edaa` CLI in an isolated `/var/tmp` workspace. The
streaming conversion completed successfully in 22.15 seconds and produced a
2,132,618,336-byte F16 GGUF (SHA-256
`6ca6a1830652f2af65abb10a6c3d033cf4fea3655b5f8497e61b4086b1f840ff`). A first
load attempt failed before inference because the standalone converter emitted
the `text_encoders.clip_l.*` component namespace without the architecture
metadata/name form required by the SD 1.5 loader (`get sd version from file
failed`). A temporary loader adjustment was prepared to force the known SD 1.5
inpainting architecture and canonicalize the CLIP prefix, but the rebuild was
stopped when concurrent repository validation jobs reduced the host to about
1 GiB available memory. No prompt-quality conclusion is drawn from this
partial conversion follow-up, and the artifact remains outside the repository.

## Product consequence

Prompt-conditioned Fill, Replace, and Expand remain capability-gated. The
existing promptless PatchMatch/LaMa routes remain the honest default for
local cleanup and reconstruction. This candidate may be revisited only after
an alternative runtime or conversion produces acceptable real-photograph
results across the fixed multi-seed corpus, with memory, cancellation,
persistence, and platform evidence.
