# Object-selection user complaints — cross-product research (2026-09-15)

Purpose: learn from the failure modes users report in other tools *before*
shipping provider routing, text discovery, or new selection UI. Each complaint
below is mapped to a concrete Varve behaviour: already guarded, deliberately
accepted as a limitation, or not applicable because we do not ship that claim.

Method: primary user reports (Reddit threads, upstream issue trackers) and
project write-ups, searched 2026-09-15. Marketing pages were not treated as
evidence. Sources are linked at the end.

## Complaint taxonomy → Varve mapping

| # | Reported failure | Where it bites | Varve mapping | Status |
| --- | --- | --- | --- | --- |
| 1 | "Select subject" produces jagged, low-resolution edges; background inside loops is not detected | Photoshop users (multiple threads) | Promptable masks are thresholded at **source resolution** (SAM2/MobileSAM decoders emit source-sized logits). Holes and disconnected regions are preserved by `areaSelectionFromMaskCoverage` instead of "keep largest component". | Guarded |
| 2 | The automatic result changes quality between app versions/machines, with no explanation | Photoshop 2021/2025/2026 threads | Routing is deterministic and evidence-carrying: each provider has a `PromptedQualityValidation` record with the corpus version and `runtimeEnvironment`, and every rejection has a structured reason. No silent tier swaps. | Guarded |
| 3 | "It picks a huge background patch when I click near an edge" | Varve's own MobileSAM real-photo gate found exactly this (boundary click → 98.2% coverage candidate) | Candidate cycling stays mandatory; predicted-IoU is not presented as semantic confidence; MobileSAM stays `experimental` and cannot win `auto` until a browser-quality corpus clears it. | Guarded (routing), known limitation (candidate ranking) |
| 4 | Average-looking masks fail catastrophically on thin geometry, tiny objects, and hair | Photoshop hair threads; Varve corpus `thin-geometry`, `tiny-object`, `hair-fur` | The router enforces a **critical-category floor** (IoU and boundary F ≥ 0.5 on thin/tiny/edge/hair). An average IoU cannot hide a catastrophic category; a provider below the floor is ineligible, not merely ranked lower. | Guarded |
| 5 | Binary masks clip hair/fur/glass; no partial transparency | Canva vs matting comparison; Varve `hair-fur` boundary F is ~0.7 | Honest limitation: promptable segmentation returns a hard mask, not alpha matting. The website says hair/glass may need brush or trimap refinement, and no copy promises cutout-grade transparency. | Accepted limitation |
| 6 | Manual corrections do not persist / flicker back (Canva) | Canva threads | The reviewed candidate is the committed candidate (`preview → commit identity`), committed as one ordinary document-mask operation; documents render with no model installed. No re-inference on apply. | Guarded |
| 7 | Output resolution is silently downgraded after processing | Canva print-quality thread | Masks are source-pixel and applied through the existing raster-mask commit path; the provider never resamples the document image itself. | Guarded |
| 8 | WASM inference OOMs/crashes the tab on high-resolution images | CVAT SAM plugin issue #10492 | Hard working-set budget is computed from **measured peak working set + source bytes** *before* allocating a full-resolution canvas; providers over budget are rejected, not down-ranked. The editor also has an admission gate + bounded embedding cache. | Guarded |
| 9 | WebGPU is attempted, silently falls back, or crashes the optimizer; browser variance | ORT-web articles; WebSAM write-up | Providers declare `supportedExecutionProviders`; a provider not validated for the active runtime is rejected before ranking (EfficientSAM is WASM/native-only because its decoder needs int64). | Guarded |
| 10 | First use is a huge, unexpected download; browser demos demand ~800 MB models | WebSAM notes; SAM-in-Browser takes 30–60 s per embedding | Routing never downloads. Uninstalled models are rejected with an install reason; downloads happen only through explicit model UI with size shown. Bundled Fast paths exist. | Guarded |
| 11 | Cloud processing is better than local, so local feels broken, and users cannot tell which ran | Photoshop "cloud version is much better" thread | The result always names the provider that ran (`routingReason`), and the website says optional models are downloaded explicitly and run on-device. No hidden remote path exists. | Guarded |
| 12 | Browser demos break after cache/service-worker staleness and only recover after clearing site data | SAM2 web demo issue #727 | Embedding caches are keyed by source fingerprint + model artifact + preprocessing version, so a stale embedding cannot be reused across artifacts. Model files are content-addressed by checksum in the manifest. | Guarded by cache identity (no service worker in the editor) |
| 13 | Quantized models are shipped to save bytes and quality quietly drops | SAM-in-Browser note | Providers are selected on **measured corpus quality**, never on file size; the current promptable providers ship fp32 graphs with pinned checksums. | Guarded by policy |
| 14 | Text-prompted selection returns the wrong instance or a non-salient object | Text-grounding literature; general "select by text" reports | Text discovery is deferred (no artifact passes the gate), and the required architecture keeps detection separate: reviewed boxes enter the normal promptable router, never a direct mask. No "describe and it is selected" claim is shipped. | Not shipped (deferred) |
| 15 | Users cannot tell whether a score means "this is what you asked for" or "the mask is clean" | Photoshop/Canva confidence confusion | Scores carry provenance (`predicted-iou` / `stability` / `heuristic`), are labelled as estimates in UI copy, and are never compared across providers as if calibrated. Measured ranking quality (top-candidate accuracy 20–40%) is recorded rather than papered over. | Guarded |
| 16 | Refinement tools glitch or erase work when used on hard edges | Photoshop Refine Edge threads | Refinement hands off to the existing selection refine path against the same mask; the reviewed candidate is never mutated in place, and no edge brush is advertised as a fix-all. | Accepted limitation |

## What the complaints imply for routing (adopted)

1. **Feasibility before preference.** Users experience "it chose the wrong
   thing" as a product failure, not a tuning knob. `auto` therefore filters
   capability → runtime → hard budget → validation before any ranking, and
   every rejected provider carries a readable reason.
2. **Measured evidence, not manifest tiers.** A manually assigned quality
   number is exactly the kind of thing that produced the "select subject got
   worse in version N" threads. Providers without a corpus record cannot win
   `auto`; experimental providers cannot win at all.
3. **Category floors.** Hair, thin geometry, tiny objects, and edge-touching
   subjects get their own floor because those are the cases users post about.
4. **Explicit provider choice stays advanced.** Ordinary users choose
   Auto/Fast/High quality; model names live in diagnostics and the advanced
   provider selector. This follows the complaint that users were forced to
   reason about cloud vs local vs device capabilities.
5. **Never download inside routing.** The largest single complaint cluster in
   browser AI tooling is first-load cost; Varve keeps it explicit.
6. **Warm-state is latency, not quality.** A cached embedding makes a
   provider faster; it never makes it better. The router only uses warm state
   inside the quality-equivalence band.

## Deliberately not claimed

* No alpha-matting quality ("professional cutout") is promised for prompted
  segmentation.
* No semantic recognition ("knows it is a dog").
* No "select everything" automatic mask generation as a hidden default.
* No text-based discovery until a detector passes the artifact/runtime gate.

## Sources

* r/photoshop — "AI Subject Selection isn't actually real?" (2025-02-07): <https://www.reddit.com/r/photoshop/comments/1ijyo9g/ai_subject_selection_isnt_actually_real/>
* r/photoshop — "Select Subject/Remove Background sucks in PS2026?" (2026-03-20): <https://www.reddit.com/r/photoshop/comments/1rz0t86/select_subjectremove_background_sucks_in_ps2026/>
* r/photoshop — "Subject Select for hair lying on clothing" (2024-09-29): <https://www.reddit.com/r/photoshop/comments/1fs7hde/subject_select_for_hair_lying_on_clothing/>
* r/photoshop — "Remove background/Subject Select issue" (2023-03-26): <https://www.reddit.com/r/photoshop/comments/122oje6/remove_backgroundsubject_select_issue/>
* r/photoshop — "Edges always feathered on selections from Select subject" (2024-05-20): <https://www.reddit.com/r/photoshop/comments/1cwruhj/help_edges_always_feathered_on_selections_from/>
* r/photoshop — "Refine Edge brush glitches on hair" (2025-12-10): <https://www.reddit.com/r/photoshop/comments/1pj3tot/does_anyone_know_how_to_avoid_these_glitches_with/>
* r/photoshop — "Select subject makes terrible selection" (2021-01-24): <https://www.reddit.com/r/photoshop/comments/l3xdwj/select_subject_makes_terrible_selection_help/>
* r/canva — "Background remover degrades quality of remaining image" (2024-05-14): <https://www.reddit.com/r/canva/comments/1cs18wr/background_remover_degrades_quality_of_remaining/>
* r/canva — "Canva BG Remover sucks" (2023-12-16): <https://www.reddit.com/r/canva/comments/18ji4ur/canva_bg_remover_sucks/>
* r/canva — "BG remover" sky deletion (2026-03-12): <https://www.reddit.com/r/canva/comments/1rrpp88/bg_remover/>
* r/canva — "Video background remover not great" (2025-02-15): <https://www.reddit.com/r/canva/comments/1iq83cx/video_background_remover_not_great/>
* Flowith — Canva background remover vs matting pipeline (2026-03-19): <https://flowith.io/blog/cutout-pro-vs-canva-background-remover-hair-fine-details/>
* CVAT issue #10492 — SAM auto-annotation WASM OOM on high-resolution images: <https://github.com/cvat-ai/cvat/issues/10492>
* WebSAM (Xevion) — WebGPU optimizer crash, `.ort` pre-optimization, model commitment: <https://xevion.dev/projects/websam>
* segment-anything issue #270 — browser inference speed and bundling limits: <https://github.com/facebookresearch/segment-anything/issues/270>
* SAM2 issue #727 — web demo cache/staleness inconsistency: <https://github.com/facebookresearch/sam2/issues/727>
* sunu/SAM-in-Browser — quantized encoder quality and 30–60 s embedding times: <https://github.com/sunu/SAM-in-Browser>
