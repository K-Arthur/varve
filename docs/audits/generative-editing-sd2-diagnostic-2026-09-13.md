# Generative editing SD 2 inpainting diagnostic — 2026-09-13

## Decision

The official Stable Diffusion 2 inpainting candidate is not promoted to a
Varve provider. It loaded and completed through the current upstream
`stable-diffusion.cpp` CPU runtime, but a corrected real-photograph task did
not produce the requested object. The run also demonstrates that this profile
is unsuitable as a low-memory or Chromebook default: even a 256 × 256 test
needed about 133 seconds on the development CPU.

This is a model/runtime qualification failure, not a compositing pass. No
product model allowlist or prompt-capable UI state was changed by this
diagnostic.

## Candidate and runtime

| Field | Value |
| --- | --- |
| Model | `stabilityai/stable-diffusion-2-inpainting` |
| Artifact | `sd2-inpainting-f16.safetensors` |
| Artifact size | `5,214,662,094` bytes |
| Artifact SHA-256 | `b29e2ed9a8fe58e76f7e801bda091d23738bd74c1da3f339bcbe2d40922fcb60` |
| Runtime | upstream `stable-diffusion.cpp` |
| Runtime revision | `42d6c0ab92fe6595776b28e3f7c8925db79b31f5` |
| Backend | CPU |
| Host | Linux x86_64, AMD Ryzen 3 5300U |
| License | OpenRAIL++ (model card) |

The model was downloaded and executed outside the repository. It is not
stored in the application or portable documents.

## Corrected real-photo task

The earlier qualification prompt used a sunset-yard photograph that did not
contain a lake. To remove that confounder, this diagnostic used
`tests/e2e/fixtures/real-life-tsitsikamma-coast.jpg`, a licensed coastal
photograph whose source visibly contains red kayaks and open water.

- Working frame: 256 × 256, aspect-preserving center crop.
- Mask: a 64 × 64 edit rectangle over open water to the right of the existing
  kayaks; white means edit and black means preserve.
- Prompt: `a small red canoe floating on the ocean, side view, realistic
  photograph`.
- Negative prompt: `text, watermark, blurry, distorted, duplicate objects`.
- Seed: `417`.
- Settings: 20 nominal steps, CFG 7, strength 0.75, Euler A, discrete
  scheduler.

## Result

The runtime completed successfully in 132.81 seconds. The returned
`varve-sd2-watercraft-canoe-right-256.png` remained visually close to the
source scene and contained no recognizable inserted canoe in the masked
region. The output was inspected as a full frame and compared with the
source; it is not acceptable evidence of prompt adherence or photographic
inpainting quality.

The earlier mismatched-source SD 2 checks were also negative: 256 × 256 and
512 × 512 runs did not produce a recognizable canoe. The newer upstream
runtime reproduced the same behavior and cost, so simply upgrading the helper
does not resolve the candidate's quality or resource problem.

## Product consequence

Prompt-conditioned Fill, Replace, and Expand remain gated behind an exact
reviewed model certificate. The current local workflow continues to expose
promptless Quick Cleanup / reconstruction where it is useful, with the
provider identity and limitations disclosed. SD 2 is not a fallback: silently
discarding prompts or substituting its output would make the UI claim a
capability the visual evidence does not support.

The next candidate must pass, on the production adapter:

1. recognizable prompt-conditioned edits on the frozen real-photo corpus;
2. protected-pixel, alpha, geometry, persistence, and export checks;
3. cancellation and helper-crash checks; and
4. measured memory and latency gates on each supported desktop target.

Source/model references: [Stable Diffusion 2 inpainting model
card](https://huggingface.co/stabilityai/stable-diffusion-2-inpainting),
[stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp), and the
repository's [fixture provenance](../../tests/e2e/fixtures/PROVENANCE.md).
