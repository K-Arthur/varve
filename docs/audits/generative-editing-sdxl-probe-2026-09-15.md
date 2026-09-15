# Generative editing SDXL probe — 2026-09-15

## Decision

The tested SDXL inpainting checkpoint/runtime pair is rejected for Varve's
prompt-conditioned workflow. It produced a valid image and the exact
production crop/letterbox/restore/composite path changed only the requested
mask, but the inspected result did not contain the requested blue fishing
boat. This is a semantic-quality failure, not evidence that the selection or
compositing pipeline is correct for arbitrary models.

Prompt-conditioned Fill, Replace, and Expand therefore remain unavailable.
The model was not added to the product profile, downloaded into the
repository, or used for marketing evidence.

## Reproducible real-photo probe

The source is the retained 512 × 512 center crop of
[`real-life-tsitsikamma-coast.jpg`](../../tests/e2e/fixtures/real-life-tsitsikamma-coast.jpg),
a CC BY-SA 4.0 photograph by Dietmar Rabich. The source, mask, prepared
context, raw results, restored patch, composite, difference map, and hashes
are retained in the [evidence directory](../../tests/e2e/fixtures/generative-evidence/qualification-2026-09-15-sdxl-probe/).
The full source-fixture provenance is recorded in
[`tests/e2e/fixtures/PROVENANCE.md`](../../tests/e2e/fixtures/PROVENANCE.md).

The task replaced a rectangular region of open water at `(360, 250)` with:

> a small blue fishing boat floating on the ocean, realistic photography

The negative prompt was `text, logo, watermark, blurry, deformed, duplicated
boat`, with seed `417`. The first comparison used four steps, CFG 6,
image-CFG 1, and strength 0.8. A second run used eight steps, CFG 7,
image-CFG 1, and strength 1 to check whether the failure was only a
low-step configuration issue.

The checkpoint is the 6,938,069,944-byte safetensors conversion at revision
`d3803f2`, SHA-256
`fe1b97fe6544814eb6fc8ce53f04ad8d339ec6946b58b0afd566fcc47813fa8a`. The
original SDXL inpainting card describes a 1024px workflow, recommends roughly
15–30 steps and strength below 1, and records the CreativeML Open RAIL++-M
license and known limitations around photorealism, composition, faces, text,
and full-mask strength. The [model card](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1)
and [safetensors conversion page](https://huggingface.co/wangqyqq/sd_xl_base_1.0_inpainting_0.1.safetensors)
are part of the model provenance; the conversion page states that it is not
deployed by an inference provider.

## Geometry and compositing result

The production preparation was reproduced exactly for the probe:

| Stage | Geometry |
| --- | --- |
| Source | 512 × 512 |
| Hard mask | x=360, y=250, width=116, height=96; 11,136 pixels |
| Context crop | x=325, y=215, width=187, height=166; 35px automatic padding |
| Model frame | 512 × 512, aspect-preserving content 512 × 455 at y=28 |
| Restored result | 187 × 166, returned to the original context origin |

An exact decoded RGB comparison found zero changed pixels outside the effective
mask and 11,126 changed pixels inside the 11,136-pixel mask. The compositing
boundary is therefore not the reason the semantic request failed in this
probe. This check does not excuse a bad mask: the mask itself was deliberately
reviewed and its source coordinates are retained so the model result can be
separated from selection errors.

## Visual finding

The four-step output and the eight-step output were inspected as both prepared
contexts and a full source composition. They produced a coherent blue-green
ocean/wave patch, but no recognizable blue fishing boat. Increasing the step
count did not correct the requested content. Prompt adherence is scored 0/4
for this task, so the candidate is not a usable semantic provider.

The host observed approximately 6.7 GiB peak resident memory and heavy swap
pressure during the native CPU run. This is also a resource rejection for a
4GB Chromebook/ARM default. No claim is made for Vulkan, Metal, Windows,
macOS, ChromeOS, or ARM because those packages were not run here.

## Selection-system implication

This probe reinforces the separation required by the editor:

- Object Selection and other mask sources must identify and review the exact
  source pixels before a provider runs.
- The provider must actually consume the mask and prompt; a successful PNG or
  changed bytes do not establish prompt adherence.
- The final composite must preserve pixels outside the effective mask, but
  that invariant cannot turn a reconstruction model into a semantic model.
- A failed semantic candidate stays unavailable. The UI must direct users to
  the reviewed Object Selection plus promptless Quick Cleanup/LaMa paths for
  removal, and must not silently route a requested Replace or Expand prompt
  to texture reconstruction.

The durable machine-readable record is
[`manifest.json`](../../tests/e2e/fixtures/generative-evidence/qualification-2026-09-15-sdxl-probe/manifest.json).
