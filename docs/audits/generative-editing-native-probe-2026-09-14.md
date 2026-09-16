# Native prompt-generation boundary probe — 2026-09-14

Status: diagnostic evidence only. This probe verifies that the then-current
production Rust helper received the corrected image-conditioning setting and
records the result of two locally available inpainting candidates. It does not
qualify a model for product use and does not change the model allowlist.

This report records helper identity
`diffusion-rs-0.1.20-varve-image-cfg-v1`. The current helper identity is
`diffusion-rs-0.1.20-varve-image-cfg-profile-contract-v2`, which adds a
model-profile request contract; the old run is not evidence for that newer
identity and must be rerun before any promotion.

## Why this probe was run

The Varve helper previously inherited the `diffusion-rs` default image CFG
value even when the request asked for a separate image-conditioning value. The
vendored binding now carries `image_cfg_scale` explicitly, and the helper
defaults its portable CPU reference path to image CFG `1.0`. This probe was
rerun through `target/release/varve-generative-helper` after that change, using
the same source, mask, prompt, seed, and output geometry for both candidates.

The output is intentionally retained because a valid PNG is not sufficient
evidence. Review must cover semantic adherence, photographic plausibility,
protected pixels, boundaries, resource cost, and repeatability before a model
can be promoted.

## Frozen diagnostic input

| Field | Value |
| --- | --- |
| Source fixture | [`real-life-port-campbell-coast.jpg`](../../tests/e2e/fixtures/real-life-port-campbell-coast.jpg) |
| Source provenance | [Port Campbell National Park coast](https://commons.wikimedia.org/wiki/File:Peterborough_(AU),_Port_Campbell_National_Park,_Worm_Bay_--_2019_--_0863.jpg), Dietmar Rabich, CC BY-SA 4.0 |
| Source SHA-256 | `778e6de9cae4cffcbff7456b81665b89839ceb53997c200a09d7b44d4a5b57e3` |
| Working frame | 256 × 256, aspect-preserving center crop |
| Mask | 256 × 256 grayscale; edit rectangle x=160..239, y=40..139; white means edit |
| Prompt | `a bright red hot air balloon floating in the sky, realistic photograph` |
| Negative prompt | `blurry, distorted, deformed, text, watermark` |
| Seed | `417` |
| Settings | 8 steps, text CFG 7, image CFG 1, strength 0.95, Euler-A, Karras, CPU RNG |
| Helper identity | `diffusion-rs-0.1.20-varve-image-cfg-v1` |
| Backend | `native-cpu` |

The mask is retained at [`mask.png`](../../tests/e2e/fixtures/generative-evidence/diagnostic-2026-09-14-native-helper/mask.png).

## Results

| Candidate | Artifact / SHA-256 | Observed result | Decision |
| --- | --- | --- | --- |
| Stable Diffusion 2 Inpainting F16 | [`sd2-helper-result.png`](../../tests/e2e/fixtures/generative-evidence/diagnostic-2026-09-14-native-helper/sd2-helper-result.png) / `bac025911a1dc71620586105ff75d99d193229b81f1b3aa626b2d8aae0b1b416` | The helper completed and produced a recognizable balloon-like object, but it was multicoloured/orange rather than the requested bright red, with insufficient photographic plausibility for the fixed quality rubric. The 256 × 256 run is consistent with the standalone diagnostic cost of about 133 seconds. | Rejected; diagnostic-only |
| Stable Diffusion 1.5 Inpainting Q4_0 | [`sd15-helper-result.png`](../../tests/e2e/fixtures/generative-evidence/diagnostic-2026-09-14-native-helper/sd15-helper-result.png) / `04bea9e6fc973a26e371110cc42eeb4d7ca3ed6ff4dd353c261bae4b12b8a785` | The helper completed in about 92 seconds, but the requested balloon was not present. The edit contained a cyan/white block-like artifact and did not meet semantic or photographic review requirements. | Rejected; diagnostic-only |

The SD 2 artifact is the 5,214,662,094-byte
`stabilityai/stable-diffusion-2-inpainting` checkpoint with SHA-256
`b29e2ed9a8fe58e76f7e801bda091d23738bd74c1da3f339bcbe2d40922fcb60`.
The SD 1.5 artifact is the pinned 1,747,219,584-byte Q4_0 candidate already
described in the [capability matrix](../quality/generative-editing-capability-matrix.md).
Neither model is stored in the repository or in portable documents.

## What this proves

- The production helper now carries the requested image CFG value through the
  Rust binding and reports `img_cfg 1.00` in its runtime provenance.
- The helper can complete a real-photograph masked request without crashing the
  editor process, but successful process completion and valid PNG bytes do not
  imply a useful edit.
- The current SD 1.5 and SD 2 candidates do not satisfy Varve's semantic
  quality gate. `GENERATIVE_MODEL_QUALITY_CERTIFIED_CHECKSUMS` must remain
  empty, and prompt-conditioned Fill, Replace, and Expand must remain
  unavailable until a complete corpus review passes.
- The SD 2 checkpoint is not a low-memory, Chromebook, or ARM default. The
  smaller SD 1.5 Q4 artifact also remains unsuitable for those claims until its
  exact runtime/architecture combination passes measured memory, cancellation,
  and quality gates.

## Next qualification gate

The next candidate must run through the production adapter on the frozen
24-photo/32-task corpus with three seeds per generative task. The retained
report must include source and mask hashes, prepared context, raw candidates,
composites, protected-pixel differences, 100% boundary crops, prompt/settings
provenance, timing, peak memory, cancellation, and platform identity. No
candidate may be promoted from this probe alone.

## Compatibility and mask-polarity follow-up — 2026-09-15

The pinned Q4 artifact is not merely an unreviewed quality candidate. Its
[model card](https://huggingface.co/gpustack/stable-diffusion-v1-5-inpainting-GGUF)
states that it is experimental and supported by `llama-box` built from a
patched `stable-diffusion.cpp`. Varve's production helper uses the pinned
`diffusion-rs` binding instead. The artifact therefore remains installed-file
diagnostic evidence only: the desktop status command reports it as incompatible
and the download command refuses to fetch it. This prevents a file-format match
or a successful process exit from being presented as a usable model.

The same model/runtime pair was also exercised with the exact source, prompt,
seed, dimensions, and settings while moving the white edit rectangle to its
inverse. The normal polarity (white = edit, black = preserve) kept the outside
scene stable and failed to produce the requested semantic object; the inverted
polarity changed the outside scene instead. This agrees with both the [SD 1.5
inpainting model convention](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting)
and the helper's `(1 - mask) * init` preparation. Selection polarity and frame
geometry are therefore not the root cause of the rejected prompt results.

This does not qualify any prompt model. Promptless LaMa/PatchMatch removal and
desktop expansion remain separate image-conditioned workflows with their own
real-photo evidence; semantic Fill, Replace, and prompt-conditioned Expand
remain unavailable until a compatible model passes the frozen corpus, resource,
cancellation, and platform gates.
