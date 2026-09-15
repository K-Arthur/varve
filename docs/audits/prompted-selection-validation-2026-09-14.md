# Prompted selection validation audit

Status: active engineering evidence, 2026-09-14. This audit records the
selection-correctness slice; it is not a claim that semantic generative Fill,
Replace, or Expand is release-ready.

## Defect addressed

A prompted segmenter can return several masks and assign a high predicted-IoU
score to a mask that is still the wrong candidate for the user's prompt. The
previous adapter exposed those decoded candidates without a provider-independent
last-mile check. That made a high-scoring mask eligible for preview, cycling, or
commit even when it missed an include point or covered an exclude point.

The correction is deliberately placed in the editor session boundary:

`world prompt → canonical source-image mapping → decoder output → prompt gate → reviewed candidates → apply`

The provider adapter remains responsible for model-specific tensor plumbing and
decoding. Any provider-level filtering is only an optimization or diagnostic;
the editor owns the source geometry and the candidate that can mutate the
document, so a provider cannot bypass the same checks by returning a different
candidate format.

## Selection contract

Before inference, the editor now:

- requires exactly one live image node and captures document/node/source identity;
- maps every point and all four box corners through the image-placement inverse;
- fails closed when a prompt is outside the visible source image or a box has no
  positive area;
- retains source dimensions and a decoded-pixel fingerprint for the request and
  rechecks them before applying a reviewed mask.

After decoding, every candidate must:

- have source-sized dimensions and a complete mask buffer;
- cover every include point within the decoder-to-source tolerance;
- leave every exclude point uncovered;
- overlap a supplied box meaningfully and have its centroid inside the box
  tolerance; and
- not be an almost-full-frame mask that provides no useful object boundary.

Candidates that fail are removed from the review list rather than merely
labelled with a low score. The remaining candidate with the highest finite model
score is selected, and the session records how many candidates were rejected.
The inspector reports prompt match separately from predicted IoU. Apply and
Use as selection can only consume a candidate that was in this reviewed list,
and source identity is checked again at commit time.

## What this does and does not prove

Point and box prompts are spatial constraints, not semantic labels. A point on
the wrong object can still be honoured by a segmentation model; no geometric
post-check can infer an unstated human intention. The workflow therefore keeps
the mask overlay, candidate review, positive/negative refinement points, box
prompts, and explicit Apply/Use as selection actions. Broad, edge-touching,
multi-region, or semantically ambiguous results still require visible review
and additional prompts. Automatic foreground proposals remain estimates, not
proof of arbitrary object identity.

The existing real-photo SAM2 evidence is retained in
[`docs/quality/object-selection-parity.md`](../quality/object-selection-parity.md):
the braided portrait point workflow completed with reviewed candidates and
source-sized masks, while the MobileSAM boundary-click case demonstrated why
quality scores alone are not sufficient. The broader photo corpus and platform
qualification remain open release gates. A new isolated real-model browser run
on 2026-09-14 was stopped during model/startup work after no app assertion was
reached; it is not counted as evidence.

## Automated evidence

The provider-independent gate is covered by:

- `packages/editor/src/context/promptedMaskValidation.test.ts` — include and
  exclude points, box overlap, malformed dimensions, and higher-scoring wrong
  candidates;
- `packages/editor/src/context/useSam2Segmentation.test.tsx` — out-of-bounds
  prompts fail before inference; and
- `packages/editor/src/tools/sam2PromptCoordinates.test.ts` — transformed,
  rotated, and partially visible prompt geometry.

The focused validation run for this slice passed the mask-validation,
segmentation-hook, and provider-adapter suites (14 tests), the touched-file
Biome check, and the editor typecheck. The repository-wide affected planner
still escalates because unrelated concurrent workspace changes touch native,
website, schema, and validation surfaces; that escalation is recorded in the
handoff rather than hidden by a partial run.
