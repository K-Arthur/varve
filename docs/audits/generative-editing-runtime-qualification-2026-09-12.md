# Generative editing runtime qualification — 2026-09-12

## Decision

No prompt-conditioned local model qualifies for release at this checkpoint.
The desktop adapter can load and execute candidate Stable Diffusion inpainting
artifacts, but the inspected outputs failed the semantic-quality or runtime
integrity gate. Prompt-conditioned Fill, Replace, and Expand must therefore
remain unavailable. The existing promptless PatchMatch/LaMa Fill and Remove
paths are unaffected.

This is a qualification failure, not a UI failure. The model was never marked
ready, and no output below is suitable as product or marketing proof.

## Frozen task

- Source: `tests/e2e/fixtures/real-life-landscape.jpg`, a public-domain
  Wikimedia Commons photograph documented in
  [`tests/e2e/fixtures/PROVENANCE.md`](../../tests/e2e/fixtures/PROVENANCE.md).
- Working frame: 512 × 512 PNG, center-cropped with aspect-preserving source
  preparation.
- Primary mask: white edit rectangle, x=196..316 and y=196..316; black means
  preserve. A second lake-area mask was used only to check an appropriate
  placement for the requested object.
- Prompt: `a small red canoe floating on the lake, natural dusk light,
  realistic photograph`.
- Negative prompt: `text, watermark, blurry, distorted, duplicate objects`.
- Seed: 417. Target settings: 20 steps, CFG 7, strength 0.75.

The full-resolution task source is intentionally retained separately from the
model frame. All inspected candidates and their hashes are retained in
[`tests/e2e/fixtures/generative-evidence/qualification-2026-09-12/`](../../tests/e2e/fixtures/generative-evidence/qualification-2026-09-12/).

## Runtime environment

- Host: Linux x86_64, AMD Ryzen 3 5300U with integrated AMD Radeon Graphics
  (RADV RENOIR), Vulkan 1.4.
- Rust production helper: `diffusion-rs 0.1.20`, CPU feature build.
- Upstream Vulkan smoke runtime: `stable-diffusion.cpp` release
  `master-859-7f410a3`, commit `7f410a3`.
- Additional diagnostic runtime: `llama-box v0.0.171`, commit `437e804`,
  bundled stable-diffusion.cpp `adbed8f`.

The upstream runtime documentation describes the SD CLI as accepting an init
image and mask, while the candidate GPUStack card identifies its GGUF as an
experimental artifact for a patched runtime. Those facts make runtime/model
compatibility a qualification requirement; they do not establish output
quality. See the [stable-diffusion.cpp CLI documentation](https://github.com/leejet/stable-diffusion.cpp/blob/master/examples/cli/README.md)
and the [GPUStack model card](https://huggingface.co/gpustack/stable-diffusion-v1-5-inpainting-GGUF).

## Results

| Candidate | Runtime/settings | Result | Decision | Retained artifact |
| --- | --- | --- | --- | --- |
| GPUStack SD 1.5 Inpainting Q4_0, SHA-256 `d157ce24483f0c999062da140eacebe8f3ed015e652723e31f6d39119b800c16` | Varve Rust helper / `diffusion-rs 0.1.20`, CPU, 512px, 20 steps | Completed, but the masked region became a bright rectangular sign-like object rather than a canoe. | Fail: prompt adherence and photographic plausibility | `diffusion-rs-gpustack-q4-cpu-512.png` |
| GPUStack SD 1.5 Inpainting Q4_0 | llama-box `v0.0.171`, Vulkan, 512px, 20 steps | Completed, but the frame was corrupted by neon/noise artifacts. The helper also reported heap corruption during shutdown. | Fail: runtime integrity | `llama-box-gpustack-q4-vulkan-512.png` |
| GPUStack SD 1.5 Inpainting Q8_0, SHA-256 `2301f1a0712de3dc2ff16181e1023865aa837922216e439491b98b00d12eb5fc` | llama-box `v0.0.171`, Vulkan, 512px, 20 steps | Same full-frame neon/noise corruption; higher weight precision did not correct it. | Fail: runtime integrity | `llama-box-gpustack-q8-vulkan-512.png` |
| Standard SD 1.5 Inpainting Q4_0, SHA-256 `ababf34dbf33f8b23d1401afeaa719167ff6a95b16389c61a08d83e8503a1b4d` | llama-box `v0.0.171`, Vulkan, 512px, 20 steps | Same corruption under the alternate artifact. | Fail: runtime integrity | `llama-box-standard-q4-vulkan-512.png` |
| Standard SD 1.5 Inpainting Q4_0 | upstream `stable-diffusion.cpp 7f410a3`, Vulkan, 256px, 20 steps, full mask | Loaded as `SD 1.x Inpaint` and completed without corruption, but the inspected output did not depict the requested canoe and was not photographically acceptable. | Fail: quality; only a smoke result because it is below the 512px gate | `sdcpp-standard-q4-vulkan-full-mask-256.png` |
| Standard SD 1.5 Inpainting Q4_0 | upstream `stable-diffusion.cpp 7f410a3`, Vulkan, 256px, 20 steps, lake mask | Preserved most of the frame but did not produce an acceptable visible canoe in the requested edit region. | Fail: prompt adherence; below release gate | `sdcpp-standard-q4-vulkan-lake-mask-256.png` |
| Official SD 1.5 Inpainting F16 components, converted artifact SHA-256 `6edcc106d27eaef5bb024b1ff6270b61f0c8fc6bc4c78b6b7afafaf9336a8c8f` | diagnostic `stable-diffusion.cpp 6b3edaa`, CPU, 512px, 20 steps | Loaded and decoded successfully, but the masked region became a blurred gray/red-edged rectangle rather than a red canoe. Protected pixels outside the mask were unchanged exactly. | Fail: prompt adherence and photographic plausibility | `official-reconverted-f16-cpu-512.png` |

The 512px upstream run loaded the model and reached sampling, but was stopped
at 11 of the 16 effective denoising steps after host available memory fell
below 1 GiB. It produced no qualification output. This is recorded as an
environment/resource limitation, not a pass or a failure of the model's
quality.

The official component conversion was subsequently repaired in an isolated
diagnostic workspace: the rebuilt artifact loaded as `SD 1.x Inpaint` and a
256px four-step qualification completed, but produced an essentially blank
frame. A full 512px run completed all 16 effective steps and decoded in 1,323
seconds; its retained full-frame and 100% boundary review failed semantic
quality. The artifact remains diagnostic-only and does not change the gate.

## Gate outcome

The required 24-photograph/32-task corpus, three-seed success rate, cross-
platform package matrix, constrained 4-GB run, cold/warm measurements, and
native cancellation measurements are not satisfied by this checkpoint. The
candidate profile remains installable only for explicit validation; its
`ready` handle must remain absent after the failed qualification run.

The website must not show the prior generated before/after pair as reviewed
proof. A future profile can replace this boundary only after a compatible,
supervised runtime produces reviewed Fill/Replace/Expand results and clears the
document, export, cancellation, memory, and platform gates.
