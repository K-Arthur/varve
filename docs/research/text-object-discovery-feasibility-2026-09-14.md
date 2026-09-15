# Text/object discovery feasibility gate — 2026-09-14

Status: **deferred** — detector research complete, runtime/model gate does not
yet pass. Ordinary point/box Object Selection is unaffected and text discovery
is not required by any existing workflow.

## Question

Can Varve offer "find object by description" as an optional local capability
that produces **reviewed detection boxes** which then enter the existing
promptable-provider router (detector → reviewed box → SAM2/MobileSAM/… →
candidate mask → selection/mask/refinement)?

The answer must be a detector that runs locally with no hidden service, needs
explicit user consent to download, and never becomes a dependency of ordinary
segmentation.

## Candidate: Grounding DINO Tiny

| Item | Value |
| --- | --- |
| Official repository | `IDEA-Research/GroundingDINO` (Apache-2.0) |
| Official checkpoint | `IDEA-Research/grounding-dino-tiny`, revision `a2bb814dd30d776dcf7e30523b00659f4f141c71`, 172M params (fp32 ~690 MB), Apache-2.0 |
| Official ONNX export | **None.** Export issues are open upstream; the widely used exporter is a third-party fork (X-AnyLabeling) that patches the model's `forward()` to move tokenization out of the graph. |
| Community ONNX (transformers.js) | `onnx-community/grounding-dino-tiny-ONNX`, revision `ff690b0a8050566c290287545bd059350f3e9096`, Apache-2.0, library `transformers.js` |
| Text encoder | BERT-base-uncased, embedded in the ONNX graph; tokenizer.json + vocab.txt published in the same revision |
| Preprocessing (published config) | resize to 800x800, rescale 1/255, ImageNet mean/std, pad, `format: coco_detection` |
| Query semantics (published card) | lowercase, end with a period; multiple phrases are separated by periods; box/text thresholds default 0.3 |

### ONNX artifact sizes (from the published revision)

| Variant | Bytes | SHA-256 (LFS) |
| --- | --- | --- |
| fp32 `model.onnx` | 718,761,381 | `267c8b00d269dc2dda0d8592812d3027abd5fb59f1cabf8e3d56f8fdf07f68ec` |
| fp16 `model_fp16.onnx` | 360,393,267 | `04c18d2db35569f11c47732f2e05ed3a71559a8903823fc581e90b0e3168c9ff` |
| int8 `model_int8.onnx` / `model_quantized.onnx` | 203,824,481 | `3bff430de583461ab3c1e8b99b19508f4fb238bf0fea0cde2c45f840a0082a26` |
| q4 `model_q4.onnx` | 227,229,745 | `2ed98a91b75f00d325c7581bee83b92b5b98460981772edf5ed844370ac25c11` |
| q4f16 `model_q4f16.onnx` | 151,069,879 | `48435b57e5a5ca01792596b9c64277260b734c10aed320109505c8e71238d6ac` |

The smallest variant that remains a credible detector (int8, 204 MB) is still
~4.6× the combined size of the two promptable providers Varve ships
(SAM2 134 MB + 21 MB, MobileSAM 28 MB + 16 MB). Model file size is not the
working-set budget: at an 800x800 input the vision backbone, the BERT text
tower, and the fusion decoder all allocate activations on top of the weights.

## Why the gate does not pass yet

1. **No reproducible, official artifact.** The official repository does not
   publish ONNX. The transformers.js export pins config/tokenizer but not a
   conversion script, so Varve cannot reproduce it from pinned sources the way
   it reproduces the SAM2 graph repair (`scripts/models/repair-sam2-graph.mjs`).
   The mission's own artifact rule forbids promoting a convenient community
   export "because it works".
2. **Browser memory profile.** The plausible variants are 152–204 MB of weights
   before activations; the fp32 graph is 686 MB. On the medium/low memory tiers
   Varve already gates `wasmSafePeakBytes` for, this is not a safe default and
   must be an explicit, tier-gated, consent-based download.
3. **Two-stage quality is unmeasured.** Detector recall/box quality against the
   existing corpus has not been measured because no tokenizer adapter has been
   built. Detector quality is not segmentation quality, and the mission
   requires both stages to be measured separately before user-visible claims.
4. **Scope/ownership.** The Object Selection UI is concurrently being reworked
   (review gate, subject proposals, explicit provider choice). Adding a second
   discovery surface now would create the parallel frontend the architecture
   forbids.

## Required architecture when this is revisited

```text
text phrase
  → text normalization (documented policy: case, whitespace, phrase separator,
    empty/oversized prompt rejection)
  → text-conditioned detector (local only; explicit download; no auto-download)
  → threshold + dedupe + top-K in engine code (bounded overlays)
  → reviewable candidates (box, phrase, detector score with provenance)
  → user accepts candidate(s)
  → existing promptable-provider router (capability → runtime → hard budget →
    validated quality)
  → candidate mask → selection / mask / refinement
```

Open items before implementation: pin a conversion script or use the
transformers.js export with a recorded revision and parity measurements;
measure peak working set in a browser WASM session for the chosen variant;
build detector fixtures (phrase recall, duplicate detections, attribute
phrases); verify coordinate mapping through image placement, crop, rotation,
flip, and fit modes; and extend the Object Selection review list rather than
building a new panel.

## Decision

**Deferred due to artifact/runtime/memory evidence.** No detector artifact is
pinned into the model catalog, no download is offered, and no text UI is
shipped. This document and the researched artifact table are the prerequisite
for a future implementation task. Ordinary prompted selection remains the
supported path for selecting a specific object.
