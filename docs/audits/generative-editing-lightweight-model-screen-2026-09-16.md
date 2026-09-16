# Generative editing lightweight-model screen — 2026-09-16

Status: research screen and runtime decision. This record does not qualify a
provider for Varve or authorize a model download in the product. It records a
bounded investigation of local candidates for promptless object removal and
small-region reconstruction after the SD 1.5 and SDXL prompt-model probes
failed semantic/runtime review.

## Decision

No new model is enabled. The existing promptless PatchMatch and LaMa routes
remain the only supported local routes. Prompt-conditioned Fill, Replace, and
Expand remain unavailable because no local model has passed Varve's production
adapter, real-photograph, protected-pixel, cancellation, memory, and platform
gates.

MI-GAN is the most promising candidate for a future small “magic eraser”
provider. Its scope is deliberately limited to mask-guided promptless Fill and
Remove. It cannot provide natural-language Replace or Expand. Moebius is a
useful browser/WebGPU research candidate, but its fixed 512 × 512 three-graph
pipeline and roughly 1.24 GB fp32 graph set do not make it a 4 GB Chromebook
default. PowerPaint and FLUX.1-Fill-dev remain the candidates for future
prompt-conditioned four-mode qualification.

## Candidates screened

| Candidate | Local contract observed | Resource and runtime considerations | Decision |
| --- | --- | --- | --- |
| [Acly/MIGAN-GGUF](https://huggingface.co/Acly/MIGAN-GGUF) | MI-GAN inpainting; 7.37M parameters; official F16 GGUF is 14,758,080 bytes; mask-only, no text encoder. The model tensor uses keep-mask plus masked RGB; the official CLI accepts a white edit mask and flips it at the adapter boundary. | MIT model conversion for [vision.cpp](https://github.com/Acly/vision.cpp); fixed 512 model; upstream conversion performs its own resize and mask processing. An isolated Varve-side CPU build ran, but two real-photo edits failed visual review despite a zero-difference empty-mask control. Varve still has no product vision.cpp sidecar or GGUF runtime. | Register as research-only promptless Fill/Remove candidate; do not route from ordinary app flows |
| [litert-community/MI-GAN-512-Places2-LiteRT](https://huggingface.co/litert-community/MI-GAN-512-Places2-LiteRT) | Input is `[1,4,512,512] = concat(mask - 0.5, rgb * mask)`; white/one keeps and black/zero erases; output is RGB in `[-1,1]` | MIT; LiteRT/TFLite graph, not an ONNX or `diffusion-rs` artifact. The card reports 16.3 MB fp16 and 393 MB peak on a Raspberry Pi 5 CPU run, but those are upstream runtime measurements, not Varve evidence. | Good reference for a future mobile/ARM adapter; not a current desktop/browser provider |
| [simonw/Moebius-ONNX](https://huggingface.co/simonw/Moebius-ONNX) | Three static graphs: VAE encoder, UNet, and VAE decoder; 512 × 512; learned embedding table rather than natural-language text; custom DDIM loop | Apache-2.0; approximately 907 MB UNet + 137 MB encoder + 198 MB decoder; custom VAE scale `0.13025`; 19 effective steps in the documented 20-step example. CPU/WebGPU execution is possible in its reference pipeline, but the full graph set and working buffers require a measured memory budget. | Research-only promptless Fill/Remove comparison; no current adapter |

The model profiles record the exact MI-GAN repository revision
`6c410de2373fe94080e739642339b3e9f748b034`, the official GGUF SHA-256
`3e47592bf716d0dc306f8dc02d4476cfcdaf2c055fa3c3c8e0ced4db775eb64`, and the
Moebius ONNX repository revision `5bf1ef5d2861ec01a727183a3f95dc64f352120e`.
The profiles intentionally have no qualified backend or architecture, so the
central model-runnability check fails closed even when a research artifact is
present.

## Real-photograph diagnostic

The diagnostic source was the licensed
[`real-life-landscape.jpg`](../../tests/e2e/fixtures/real-life-landscape.jpg)
fixture used by the generative-editing visual lane. An ONNX conversion found
outside the repository was inspected with Node ONNX Runtime on the CPU using
two threads. The run took approximately 1.15 seconds at 512 × 512. The raw
network output is not a document result by itself: it changes the entire
frame. After applying the requested keep/erase composite, the unmasked
landscape pixels were byte-preserved and the masked repair looked plausible at
the review scale.

This is directional evidence only. The conversion had no trustworthy model
card or packaging provenance, was not the official GGUF, did not run through a
Varve adapter, and was not scored against the frozen 32-task corpus. It must
not be used as a marketing image, a qualification report, or a reason to
enable a product route.

The official MI-GAN GGUF was downloaded to temporary storage and hash-checked.
An isolated CPU build of the pinned vision.cpp revision was completed after
initializing its required external submodule; no product source or model
directory was changed. The real landscape run took about 2.67 seconds and
produced a dark rectangular repair around the selected region. The real
still-life run took about 2.33 seconds and produced an obvious orange/structural
artifact. An empty edit-mask control had an exact zero-pixel difference from
the source. The runtime therefore demonstrated correct mask consumption and
outside-region preservation, but failed Varve's visual quality bar and remains
research-only. No peak-memory, ARM64, Vulkan, or package qualification was
claimed from this disposable run.

## Adapter requirements before promotion

### MI-GAN

1. Build an allowlisted, separately supervised vision.cpp sidecar with the
   exact runtime revision and required submodules pinned.
2. Pass opaque model and image handles over IPC; do not pass arbitrary paths or
   model bytes through the renderer protocol.
3. Reproduce and test the official preprocessing: fixed 512 frame, keep-mask
   polarity, RGB normalization, alpha behaviour, and output composite. Use a
   shared aspect-preserving context policy rather than silently cropping a
   source object away.
4. Add real cancellation, bounded memory admission, CPU and Vulkan profiles,
   and ARM64 builds. The upstream Raspberry Pi number is a lead, not a Varve
   guarantee.
5. Run the frozen real-photo Remove and promptless Fill tasks, including
   boundaries, transparency, disconnected masks, expansion rejection, and
   source-placement preservation. Only a passing first-candidate/three-seed
   report may change the profile disposition.

### Moebius

1. Treat the three ONNX graphs and the JavaScript/native DDIM loop as one
   versioned provider. Pin the custom VAE scale, scheduler, learned embedding
   rows, and graph revisions together.
2. Keep it out of natural-language prompt controls. A category embedding is
   not a free-form prompt and does not satisfy Replace or Expand.
3. Add graph-level memory accounting and one-session admission. Test CPU and
   WebGPU independently, including WebGPU operator coverage and browser heap
   retention on constrained devices.
4. Verify numeric parity with the upstream reference before testing visual
   quality. The current Varve diffusion letterbox helper must not be reused
   unless the Moebius preprocessing contract is proven equivalent.

## Validation record

Commands and inspections for this screen:

- Hugging Face model cards and repository metadata were reviewed on
  2026-09-16.
- The official MI-GAN GGUF was downloaded to `/var/tmp`, and its size and
  SHA-256 were checked against the profile metadata.
- ONNX input/output metadata and one real-photograph diagnostic were inspected
  outside the product tree.
- The official vision.cpp CPU build and MI-GAN runs were completed in
  disposable `/var/tmp` locations. Empty-mask equality passed, while the
  landscape and still-life outputs failed visual review; no failed build or
  failed visual result is treated as provider qualification.

The existing browser visual lane remains the authoritative UI evidence. This
screen adds no screenshot baseline and makes no claim that the prompt models
or a new lightweight model have passed visual acceptance.

The current SD helper now serializes and validates its own
`image-and-mask`/`white-edit-black-preserve` contract at the native boundary.
That protects the shipped route from accidentally inheriting MI-GAN's
keep-mask tensor or Moebius's masked-latent tensor shape; each of those still
requires a separate adapter.
