# External market check — local text-conditioned inpainting, 2026-09-16

Status: research addendum. This is a bounded external web check performed
against the existing [local inpainting/outpainting model
landscape](generative-inpainting-model-landscape-2026-09-15.md) (2026-09-15)
and the [lightweight-model
screen](../audits/generative-editing-lightweight-model-screen-2026-09-16.md)
(2026-09-16). It does not qualify, download, or run any model; it only checks
whether a materially new candidate has appeared since those documents were
written. No product route, marketing claim, or routing decision changes as a
result of this check.

## Question

Has a genuinely new, small, permissively licensed, text-conditioned masked
inpainting model with a CPU-feasible (ONNX/GGUF or comparable) runtime
appeared that the 2026-09-15 landscape review and the 2026-09-16 lightweight
screen do not already cover?

## What was checked

Three web searches on 2026-09-16 covering: lightweight ONNX/GGUF
text-conditioned inpainting models generally; a PowerPaint-specific
ONNX/GGUF conversion (PowerPaint v2-1 is the landscape doc's own first
qualification candidate, and no ONNX/GGUF port would remove the need for a
supervised adapter, but a maintained one would still lower qualification
cost); and small/distilled diffusion models explicitly sized for mobile/CPU
inpainting. One third-party research document surfaced by the first search
(`LynnColeArt/underpaint`, a separate open-source local-inpainting project)
was fetched and read for independent corroboration.

## Findings

- No new candidate. Every model actually named in the search results
  (Moebius, LaMa, MI-GAN, SDXL inpainting, RealVisXL V4.0 Inpaint, generic
  SDXL/SD3.5 distillation research such as Clockwork Diffusion, MobileDiffusion,
  and SD3.5-Flash) is either already in the 2026-09-15 landscape matrix, is not
  a masked-inpainting model at all (SD3.5-Flash and MobileDiffusion are
  general text-to-image research without a documented hard-mask contract), or
  is GPU-targeted research with no published weights suitable for a CPU-first
  qualification lane.
- No PowerPaint ONNX/GGUF conversion exists publicly as of this check. The
  landscape doc's own PowerPaint v2-1 plan (Python/Diffusers/Conda, a
  separate supervised adapter) remains the only path; there is no shortcut
  artifact to re-evaluate.
- Independent corroboration of the core finding. `LynnColeArt/underpaint`
  — a separate, unaffiliated local-inpainting project — targets an RTX
  4070-class discrete GPU as its baseline (`diffusers/stable-diffusion-xl-1.0-inpainting-0.1`,
  OpenRAIL++, and `OzzyGT/RealVisXL_V4.0_inpainting` at ~5.2 GB peak VRAM) and
  explicitly declines to ship a smaller model, stating "Smaller models are
  tempting, but the product should not launch around visibly weak restoration
  fills." That project treats GGUF as an untested, unproven "experimental
  backend lane" for its own GPU-class hardware, not as a CPU answer. This is a
  second, independent source reaching the same conclusion already recorded in
  Varve's own qualification work: no currently available small model clears
  the visual-quality bar for masked, text-conditioned inpainting on
  CPU-only/low-memory hardware.

## Conclusion

This check found nothing that changes the existing decision. PowerPaint v2-1
remains the correct first qualification candidate and FLUX.1-Fill-dev the
second, exactly as recorded in the 2026-09-15 landscape review; both still
require building a separate supervised adapter before any qualification run
can start, and neither shortcut appeared in this search. Prompt-conditioned
Fill, Replace, and Expand remain correctly gated. This addendum should be
treated as expired research context after roughly one month; a stale search
result is not evidence that the landscape has not moved by the time someone
reads this.

## Sources

- [Moebius-ONNX (Hugging Face)](https://huggingface.co/simonw/Moebius-ONNX)
- [underpaint model-research.md](https://github.com/LynnColeArt/underpaint/blob/main/docs/model-research.md)
- [Clockwork Diffusion (arXiv 2312.08128)](https://arxiv.org/pdf/2312.08128)
- [MobileDiffusion (arXiv 2311.16567)](https://arxiv.org/pdf/2311.16567)
- [SD3.5-Flash (arXiv 2509.21318)](https://arxiv.org/pdf/2509.21318)
