# Generative Expand and Subtract completion plan — 2026-09-13

Status: revised/partial on `master`; the desktop plumbing and limited LaMa
qualification are recorded below, but semantic model qualification, browser
Expand quality, and cross-platform evidence remain open. Integration owner for
this slice: Codex. This document deliberately does not claim ownership of
unrelated dirty files listed by `git status`; those changes belong to concurrent
work and will be re-read before any shared-file edit.

## Research record

Research was completed before implementation decisions on 2026-09-13. Access
date is included because provider/runtime behavior changes.

| Source | Finding used here |
| --- | --- |
| [Adobe Generative Expand](https://helpx.adobe.com/ca/photoshop/desktop/create-open-import-images/create-images/explore-beyond-the-canvas-with-generative-expand.html) (accessed 2026-09-13) | The familiar interaction is Crop → drag a boundary → Generative Expand. Varve keeps that entry point, but labels the local promptless path honestly. |
| [Diffusers outpainting](https://huggingface.co/docs/diffusers/advanced_inference/outpaint) and [inpainting](https://huggingface.co/docs/diffusers/using-diffusers/inpaint) (accessed 2026-09-13) | White/edit and black/preserve mask polarity, padded boundary context, and explicit compositing are provider-boundary contracts, not assumptions to leak into the scene model. |
| [ComfyUI outpaint](https://docs.comfy.org/tutorials/basic/outpaint) (accessed 2026-09-13) | Outpaint is an inpaint workflow over a padded frame; padding and mask output must be removed/mapped explicitly before acceptance. |
| [ONNX Runtime Web large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html), [execution providers](https://onnxruntime.ai/docs/execution-providers/), and [WebGPU](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html) (accessed 2026-09-13) | Browser/WASM model support is constrained by model sidecars, memory, operator placement, and fixed-shape graphs. A model file or Python sample is not a Varve capability. |
| [W3C Compositing and Blending Level 1](https://www.w3.org/TR/compositing-1/) (accessed 2026-09-13) | Source-over/alpha behavior requires protected-pixel restoration and a separately tested transparent-source path. |
| [LaMa upstream](https://github.com/advimman/lama) and [paper](https://arxiv.org/abs/2109.07161) (accessed 2026-09-13) | LaMa is image-conditioned inpainting, not language-conditioned outpainting. Varve can qualify it for promptless continuation but must not expose an ignored prompt. |
| [ComfyUI unmasked-pixel report](https://github.com/comfyanonymous/ComfyUI/issues/1841) (accessed 2026-09-13) | A model/VAE round trip can alter pixels outside the intended mask; the final composition must restore the authoritative source. |
| [Adobe report: expansion rewrites the outside border](https://community.adobe.com/t5/photoshop-ecosystem-ideas/generative-expand-in-all-directions-problems/idi-p/14364407), [Adobe seam report](https://community.adobe.com/questions-700/generative-expand-issue-671957), and [Reddit UX complaint](https://www.reddit.com/r/photoshop/comments/1uuc41c/shoving_ai_in_our_faces_at_the_cost_of/) (accessed 2026-09-13) | Real user complaints center on source drift, seams/gaps, and intrusive controls. Varve addresses these with a source clip, full-border coverage, 1:1 review, and an existing image/crop entry point. These are reports, not prevalence measurements. |

Exact local model identity is recorded in
[`generative-expand-qualification-2026-09-13.md`](../audits/generative-expand-qualification-2026-09-13.md):
`lama-inpainting`, `lama_fp32.onnx`, SHA-256
`1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6`, Apache-2.0,
native `varve-bgremove`/ONNX Runtime CPU execution. The prompt-capable SD 1.5
candidate remains unqualified. Code and weight licenses are recorded separately
from hosted-service terms; no remote provider is enabled by this plan.

## Evidence matrix and baseline

| User task | Current baseline at plan time | Classification | Owned completion/evidence |
| --- | --- | --- | --- |
| Expand one image on any sides, preserve source, undo/reopen/export | Validated plan, source restore, full-output asset, undo/reopen paths exist; browser test covers generation/reopen/restore, while export proof needs a direct assertion | Partial integration | Add/strengthen the source/export regression and independently inspect the decoded export. |
| Wider portrait with output size/aspect and anchor | Margin, size, aspect, and nine-anchor helpers exist; no prompt claim in browser | Implemented but needs regression evidence | Exercise every anchor/odd margin family in pure geometry tests; keep prompt gated by actual model readiness. |
| Background-only expansion in a mixed composition | Entry point requires exactly one image and uses an image asset/overlay, preserving other scene nodes | Supported boundary | Assert unrelated node identity/content and document that composition sampling is explicit, not flattening. |
| Refine only a generated region | Existing Edit mask/regenerate and accepted overlay lineage exist | Partial integration | Add a regression for a second outward expansion protecting the first accepted result and for explicit Remove/Subtract masks. |
| Generative subtraction/remove object | Existing `remove` mode uses promptless local reconstruction and source-safe bounded overlays | Implemented, terminology/evidence gap | Expose “Remove / Generative Subtract” meaning in the shared surface/docs without changing the persisted `remove` schema; verify exact untouched-pixel and undo behavior. |
| Offline/provider absent | Quick Cleanup and browser prompt gating exist; prompt model is not qualified | Supported fallback boundary | Preserve truthful capability text and test no model/download path does not create a fake prompt result. |
| Huge margins, transparency, transformed placement | Limits, alpha warnings, source-space placement, and transform translation exist | Limited/unsupported cases | Keep declared limits; add no-show-through alpha and transformed-placement invariants; do not expand page/animation/vector semantics silently. |

## Dependency-aware implementation slices

1. **Geometry/protection contract (engine owner: Codex).** Keep the existing
   source-local `ExpandPlan` as the single source of truth. Add only pure,
   tested contracts needed to distinguish retained/protected pixels from the
   generated border and to reject a no-op or unsafe working frame before
   allocation. Acceptance: source bytes and alpha are exact at the translated
   rectangle for every margin family; provider corruption is repaired only in
   the protected rectangle; zero expansion makes no generation request.

2. **Existing editor workflow (editor owner: Codex, shared dialog files
   excluded unless isolated).** Keep Crop & Bounds → Generative Expand and
   Object → Generative Edit in the same dialog. Clarify Remove as generative
   subtraction and preserve the current object-selection handoff owned by the
   concurrent agent. Acceptance: bounds are review-only until Apply, original
   boundary/quality/provider limits are visible, and a canceled or stale job
   leaves the document unchanged.

3. **Non-destructive transaction/persistence/export (scene/editor owner:
   Codex).** Reuse existing derived assets, `Document.generativeEdits`, undo,
   codec, and structural export. Add focused round-trip/export evidence rather
   than a second asset or job system. Acceptance: accepted pixels are stable
   offline without the model, undo/redo never reruns inference, the PNG export
   decodes at the reviewed bounds, and protected source comparison uses a
   lossless matching reference.

4. **Real backend qualification and visual evidence (native/evidence owner:
   Codex).** Execute the pinned LaMa test through the production native helper
   on the checked-in corpus, retain hashes/metrics, and drive the real browser
   workflow with a separate port/profile. Acceptance: generated border is
   non-degenerate, all retained pixels are exact, and the report names content
   categories, dimensions, hardware, cold/warm timing, and limits. Do not use
   Fast PatchMatch or a mocked response as model evidence.

5. **Docs/marketing handoff.** Update current architecture/capability guidance
   and the existing generative-editing marketing/docs route only with verified
   claims. Keep prompt-conditioned Replace/Expand gated and distinguish
   promptless reconstruction, heuristic cleanup, crop reveal, canvas padding,
   and synthesis. Existing concurrent website edits are not overwritten.

## Delivery record

The planned vertical slices are implemented in the existing Crop & Bounds /
Generative Edit flow. No workspace, route, scene model, inference manager, or
provider manager was added. The browser Fast/PatchMatch tier was removed from
public Expand controls after a real-photograph edge-striping failure. The
AI-quality path stays gated behind local model download, but actual
browser-WASM Expand generation remains unqualified; the retained browser E2E
checks the tier boundary and download affordance rather than model output.

- `175045830` — coherent, bounded Expand passes with source restoration.
- `a6ac35792` — accepted Expand save/reopen/export coverage.
- `86ce88dc4` — Expand undo/redo coverage without rerunning generation.
- `e2b50b939` — truthful Expand quality and generated-resolution limits.
- `172720f71` — preserve the reviewed authored raster bounds during export.
- `2133bed06` — Generative Subtract E2E source-asset protection assertion.
- `2207f84c8` — qualification report, completion record, marketing copy, and
  retained browser evidence captures.
- `0e2a4e3f8` — refreshed and visually inspected website Expand/Subtract
  snapshots.

The pinned native `lama-inpainting` ONNX model was executed through the
production `varve-bgremove` helper on Linux x86_64 CPU across landscape,
portrait, architecture, and seascape cases. Promptless Expand is enabled only
within the measured photographic boundary; Prompt-conditioned Replace/Expand
remain gated. Existing Remove is the compatible persisted operation for
Generative Subtract and now has an explicit real-photo source-preservation
regression. Fast/PatchMatch remains the offline browser/constrained-device
fallback.

The final validation record below distinguishes browser UI/workflow evidence
from native model-quality qualification. The architecture case remains a
review-only limitation because independent inspection found a dark generated
band despite a close immediate seam score. Fast/PatchMatch remains implemented
for other reconstruction paths but is excluded from browser Expand.

## Final validation record — 2026-09-13

Passed feature evidence:

- Native model qualification: `VARVE_LAMA_QUALIFICATION=1 node
  scripts/quality/heavy-lease.mjs generative-expand-lama -- cargo test -p
  varve-bgremove --features ai --test lama_expand_qualification --
  --nocapture` — 1 test, 4 real photographs, 148.86 seconds total; source
  RGBA protection passed for every case. Linux x86_64 CPU, `ort-native`,
  `lama-inpainting`, 208 MB model, approximately 850 MB reserved peak.
- Browser Fast-quality Expand boundary: clean no-HMR Chromium run of
  `tests/e2e/caf/expand-real-photo.spec.ts` — 1 test passed in 1.1 minutes on
  a real landscape photograph; the browser Generate control was disabled and
  the desktop/provider explanation was visible. The earlier 1664x1272 browser
  output remains retained as rejected visual evidence because it showed edge
  striping.
- Editor Generative Subtract workflow: clean no-HMR Chromium run of the real
  photographic Remove test in `tests/e2e/caf/caf.spec.ts` — 1 test passed in
  2.8 minutes. It proves the `remove` recipe, bounded overlay, provider
  provenance, unchanged canonical source asset data URL, and unchanged source
  fill identity.
- Website marketing/docs visual validation: the existing generative-editing
  visual spec passed all 3 Chromium tests in 35.8 seconds after inspecting the
  feature full page, 390px narrow page, and dark docs page. The updated
  snapshots are committed in `0e2a4e3f8`; no horizontal overflow was found.
- Focused JS validation with `node_modules/.bin/vitest`: 5 files/67 tests for
  the core contracts and 8 files/67 tests for plan/provider/CAF/export/session
  coverage; all passed. Documentation, emoji, and token audits also passed.

Gate results and limits:

- `pnpm verify:plan` selected the full affected closure and reported
  `FULL-SUITE ESCALATION: YES` because the shared master tree contains
  workspace/toolchain/validation-infrastructure changes.
- `pnpm verify:affected` returned the expected escalation exit without running
  the full suite. The required `pnpm verify:full` was then invoked with the
  stated reason, but stopped at unrelated current-tree type errors in
  `packages/engine/src/backgroundRemoval/maskDecode.ts` and the LUT tests
  (`BlobPart` and `LutTransform.size`) after reporting existing architecture
  cycles/budget drift. It did not reach its test lanes. These failures are not
  in the Expand/Subtract changed files; the focused and real-runtime evidence
  above is the completion gate for this slice.

The accepted pixels, source snapshot, provenance, and browser export captures
are committed; no model or service is needed to reopen, undo/redo, or render an
accepted result. Cross-platform native LaMa, prompt-conditioned expansion,
transparent-object continuation, HDR/RAW master generation, animation, and
large/strong-perspective expansions remain explicitly limited or gated.

## Coordination and validation gates

The shared dialog, website pages, render hubs, and broad validation files are
currently dirty from other agents. Before touching any of those files, re-read
their current diff and either wait for a commit or stage an isolated hunk; no
reset/stash/checkout or broad staging is permitted. No new workspace, route,
scene model, inference manager, or provider manager is introduced.

For each owned slice: run `pnpm verify:plan`, then the selected
`pnpm verify:affected` checks, the focused unit tests, and the relevant real
browser/native/image inspection. Because geometry/scene/schema/export changes
are cross-package, the planner may escalate to the full gate; the reason will
be recorded in the final Agent Validation Report. Visual screenshots are
inspection evidence only when opened and reviewed, not merely generated.
