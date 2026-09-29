# Illustration and concept-art workflow research

**Accessed:** 2026-09-29
**Scope:** stroke delivery and opacity, hybrid line-art filling, public failure
reports from established drawing applications, and Varve's reproduced baseline.
**Evidence rule:** vendor manuals describe intended behavior; public user
reports are individual observations, not proof of a product-wide defect.

## Source ledger

| Source / version | Finding and confidence | Varve decision supported |
|---|---|---|
| [W3C Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/), Recommendation, 2026-06-30 (normative standard; accessed 2026-09-28) | A trusted parent `pointermove` aggregates its coalesced events. The spec says authors should process the parent or the full coalesced list, not both. Predicted events describe possible future input and are valid only until the next pointer event. High confidence for the web API contract; actual device/WebView delivery still needs runtime tests. | Feed confirmed points once, use predictions only for disposable previews, and retain final confirmed tails and dynamics changes. Do not assume a browser's synthetic test stream models a physical stylus. |
| [W3C Compositing and Blending Level 1](https://www.w3.org/TR/compositing-1/), Candidate Recommendation Draft (accessed 2026-09-28) | Defines source-over and blend behavior including isolated groups. This publication is a draft rather than a final Recommendation. It is useful as a formula reference, not proof that Varve's renderer matches every implementation. | Compare transparent-pixel blending and grouped rendering with the written equations and the authoritative Varve renderer; verify screenshots/exports rather than relying on a blend-mode label. |
| [Krita Manual 5.3: Opacity and Flow](https://docs.krita.org/en/reference_manual/brushes/brush_settings/opacity_and_flow.html), version displayed by the manual site as 5.3.0 (accessed 2026-09-28) | Krita documents opacity as the stroke-level transparency ceiling and flow as deposition per dab. This is a reference for user expectations, not a claim that all applications use identical brush engines. | Preserve Varve's established accumulation for existing presets; add an explicit stroke-opacity mode so artists can choose a stable translucent gesture while leaving repeated gestures able to accumulate. |
| [Krita Fill Tool manual](https://docs.krita.org/en/reference_manual/tools/fill.html), Manual 5.3 (accessed 2026-09-28) | The tool exposes reference scope, threshold, spread, feather and gap-close options. The manual documents available controls but does not measure their quality on Varve or imply every setting is correct for every illustration. | Keep artwork sampling scope distinct from fill destination; make line-art sampling and bounded edge controls explicit rather than silently targeting the selected layer. |
| [Krita Artists: “Help with Fill Tool”](https://krita-artists.org/t/help-with-fill-tool/48910), Krita 5.1 / Windows 10 report (accessed 2026-09-28) | A user reports the bucket filling the whole page instead of a simple enclosed square, and describes repeated animation-frame coloring as costly. This is one forum report; the underlying cause and later resolution are not established by the thread alone. | Add deterministic regression fixtures for open/closed boundaries and make threshold, sampling source, gap closure and output layer visible to the artist. |
| [Krita Artists: “Gap tolerance for selecting/filling messy lineart”](https://krita-artists.org/t/gap-tolerance-for-selecting-filling-messy-lineart-in-krita/127417), posts dated 2025-06-22–23; author used Krita 5.2.9 stable and was told gap closing existed in 5.3.0-prealpha (accessed 2026-09-29) | The poster says a one-pixel gap makes Magic Wand select the whole canvas and asks for the gap-tolerance behavior they had used in Paint Tool SAI. A reply says the then-nightly build had gap closing; this does not prove its final release quality. | Add a bounded, opt-in gap-closure radius for contiguous visible-artwork sampling; keep larger gaps and overflow outcomes explicit, and test both a bridged small break and an opening that still leaks. |
| [Krita Artists: “How do I fill in the little gaps left by the fill bucket tool in the corners of the lineart?”](https://krita-artists.org/t/how-do-i-fill-in-the-little-gaps-left-by-the-fill-bucket-tool-in-the-corners-of-the-lineart/87662), posts dated 2024-03-25–28; screenshot shown as Krita 5.2.2 (accessed 2026-09-29) | The poster reports corner pixels remaining unfilled; replies attribute it to antialiasing/tight corners and suggest grow/threshold changes or manual cleanup. The thread does not isolate one universal cause. | Keep edge expansion separate from gap closure. Test antialiased edges and tell artists to inspect selections because expansion can cross thin boundaries and gap closure cannot repair every shape. |
| [Krita assistant tool manual](https://docs.krita.org/en/reference_manual/tools/assistant.html), Manual 5.3 (accessed 2026-09-28) | Documents perspective and other drawing assistants as construction aids. It does not establish that Varve already has the same guide behavior. | Reuse Varve's current guide/tool surfaces for a bounded two-point perspective guide; keep it distinct from destructive four-corner image perspective. |
| [Krita reference-images tool manual](https://docs.krita.org/en/reference_manual/tools/reference_images_tool.html), Manual 5.3 (accessed 2026-09-28) | Documents in-canvas reference images. This is a workflow reference only. | Prefer ordinary Varve image nodes and assets with explicit session/document visibility and export treatment over a new document or editor mode. |
| [Adobe Community: Photoshop 27.10 progressive brush lag and masked adjustment layers blinking](https://community.adobe.com/bug-reports-711/photoshop-27-10-becomes-progressively-slower-during-normal-use-with-severe-brush-lag-and-masked-adjustment-layers-blinking-in-and-out-1639263), user report opened 2026-08-28; Adobe Community Manager requested a TIFF, recording, system info and a Wacom-disconnected comparison on 2026-09-16 (accessed 2026-09-28) | The reporter describes slowdown as a multi-layer TIFF grows, severe brush delay, and masked adjustment layers blinking. The thread shows investigation requests; it does not establish a fix, affected population, or root cause. | Measure latency and memory across increasing layer counts; compare brush and mask rendering in recordings. Bound sampling, preview and cache memory so work does not progressively degrade during an ordinary session. |
| [Clip Studio Paint community: “Frequent, random and unfixable lag?”](https://www.reddit.com/r/ClipStudio/comments/1udrs6k/frequent_random_and_unfixable_lag/), original post says CSP 5.0.4 with Huion H610PRO; a commenter describes similar lag/undo grouping on CSP 4.0.3 and a Galaxy Book 3 Pro 360 (accessed 2026-09-29; Reddit labels the posts 2026 as “months ago”) | One artist reports delayed/lagging strokes and Undo sometimes grouping 5–10 brush strokes after trying driver reinstall, app reinstall, cache clearing, tablet changes and preference changes. Replies are anecdotal and disagree on causes; this is not a confirmed CSP-wide defect. | Keep one pointer gesture as one history transaction, measure stroke-finalization latency, and test that consecutive strokes undo independently under sustained drawing. |
| [Clip Studio Paint community: “Stroke lagging”](https://www.reddit.com/r/ClipStudio/comments/1tr8n6t/stroke_lagging/), thread marked four months old when accessed 2026-09-29; commenters mention large/highly textured brushes, slow speed/quality settings, and lag even on high-spec devices | Reports and replies are informal and configuration-dependent. They identify brush complexity and large settings as plausible contributors but do not prove a common runtime cause. | Measure warm and cold latency by brush size, texture, smoothing and canvas size; keep preview and accumulation work bounded and publish only measured performance claims. |
| [ONNX Runtime execution providers](https://onnxruntime.ai/docs/execution-providers/) and [large-model web guidance](https://onnxruntime.ai/docs/tutorials/web/large-models.html), live docs (accessed 2026-09-28) | Provider availability, operator coverage and weight loading are separate runtime facts; large browser weights can require special handling. Documentation is mutable and does not certify Varve's bundled artifact or host. | Keep model claims tied to the actual artifact and measured runtime. Do not infer acceleration or safe memory use from an accelerator name or matching checksum. |
| [Real-ESRGAN upstream](https://github.com/xinntao/Real-ESRGAN), repository documentation (accessed 2026-09-28) | Upstream describes its own inference pipeline and model family. This does not establish provenance, licensing or parity for a separately converted ONNX file. | Treat converted-artifact source, conversion process, hash, license, operator support, memory and image quality as independent gates. |

## Baseline probes

These are reproduced function-level defects from the editor resolver, not yet
claims from a complete visible user workflow. Starting-point screenshots and
commands are recorded in the dated capability matrix.

1. With a vector selected and an eligible raster layer supplied as fallback,
   the resolver returned that unrelated raster layer. A paint stroke can thus
   land somewhere other than the explicit selection.
2. A hidden target with a nonexistent mask identity was accepted as a mask
   destination. The target contract did not check ancestor state or confirm
   that the selected mask matched the node's actual raster-mask asset.
3. A deleted fallback id caused a property-access exception rather than a
   described refusal.

The compositor/fill-source and progressive-latency complaints above motivate
targeted regression and workload tests; they are not recorded as reproduced
Varve defects until the relevant UI operation and output have been observed.

## Varve fill-source follow-up (2026-09-29)

The first Magic Wand round trip exercised only a painted raster layer and its
own fill action. It did not establish a hybrid flats workflow: the source was
not independently selectable from the output layer, and transparent line art
could not seed a white-paper region. The follow-up adds a renderer-backed
**Visible artwork** source and a separate **Create flats layer** action, while
keeping **Current layer** as the compatibility default. The implementation is
bounded at 16,777,216 sample pixels and uses an uncached temporary replay
surface. A 0–8 source-pixel edge expansion tucks fills under antialiased ink.
The new 0–8 px gap-closure radius applies only to contiguous visible-artwork
sampling: it closes short non-matching barriers in the temporary sample, with
three byte-per-pixel work planes (up to 48 MiB at the 16-megapixel sample
ceiling). Processing yields between bounded row/column chunks and checks the
request's abort signal; source pixels are never changed. Larger or complex
openings can still leak, and artists must inspect the result.

A closed transparent 640×480 line-art image imported through the real UI now
selects its white-paper interior through **Visible artwork** and fills a
separate Flats layer red. The inspected after-state keeps the black outline
visible, and Edit → Undo removes the flat while Edit → Redo restores it. The
user report about a bucket flood on an enclosed square motivated this fixture;
the initial open-contour fixture did flood, so it is not evidence of a Varve
regression. In the same browser workflow, the Inspector's compact Export panel
produced only the selected Flats raster (4096×4096, 50,625 red pixels, no black
linework, transparent corners). This exposed a scope mismatch in the test's
export route and is not an acceptable combined-artwork export result. The E2E
now groups the editable linework and Flats children before export. That grouped
PNG passed after save/reopen and was visually inspected at the fitted camera:
it is 4096×4096 with transparent corners, 50,625 red pixels within the ink
outline, and 7,231 black linework pixels. This verifies a discrete
linework-to-flats transaction, not brush sketch/ink, clipped shading, or the
entire raster-illustration acceptance workflow.

The first narrow-viewport visual pass also captured red bands through the
reopened Flats layer. Reproduction run
`illustration-apple-full-redraw-20260929` waited for the 960×720 backing store
and two animation frames, then compared the live pixels with the same-camera
authoritative redraw. The hashes differ
(`a461eac4…e125348` versus `cc31c2c3…90bddccb`), and the before/after redraw
captures both show the bands. The downloaded grouped PNG is clean. This is a
reproduced screen-render defect. A second same-camera comparison isolated the
experimental raster LOD path: it mismatched 27,040 of 68,770 red-mask pixels
(39.3%) after save/reopen, while the retained-surface redraw and grouped PNG
were clean. The completeness guard did not remove the artifact. The normal
editor adapter now keeps LOD disabled, and the leased Chromium save/reopen
workflow passes with zero red-mask mismatches at the original viewport and an
identical narrow-viewport full-redraw hash. This mitigation leaves the LOD
root cause unresolved; no LOD performance or correctness claim is made, and
the earlier banded screenshot is not suitable for marketing.

## Varve brush-accumulation follow-up (2026-09-29)

The Krita manual describes opacity as the stroke-level ceiling and flow as
per-dab deposition; this supports a familiar optional mode, not a requirement
that every brush engine behave identically. Varve now persists an optional
`buildup` or `stroke-opacity` value in brush presets. Existing and imported
presets without it resolve to the former buildup behavior. The built-in Soft
Shade uses stroke opacity: overlap reaches the preset opacity within one
pointer gesture, flow controls the rate, and a separate gesture can build
further. The per-gesture byte map is bounded to 64 MiB; beyond the tracked-tile
limit new tiles use buildup with an announcement. Mask strokes retain their
pre-existing convergence-to-target semantics. Brush thumbnails now render
through the production dab generator and tile compositor so the selected mode
is visible in the preview. This change addresses the opacity/flow expectation
recorded from the manual; it does not claim brush-engine parity with Krita.

## Varve clipped-paint follow-up (2026-09-29)

The product reports above did not identify this Varve defect; the reproduction
came from validating the planned clipped-shading workflow. Creating a group
matte over a raster source produced correct child pixels, but the live
compositor applied the camera transform again while compositing a full-surface
mask, so the result rendered transparent. After that was repaired, the first
save/reopen PNG was still transparent because the selected group was flattened
without its matte's external scene-node source. These were two independent
Varve integration defects, reproduced before each repair in the real browser.

The compositor now isolates callback transforms and composites full-surface
masks in identity coordinates. Structured node raster export, subtree
compositing, and artwork sampling collect mask source nodes as render
dependencies while retaining the selected subtree as the visible boundary.
The Paint tool options offer **Create clipped paint layer** for a visible
raster source; it creates a normal editable raster child in a group with a
live scene-node alpha matte. A workspace review also found that Design's
built-in toolbar omitted Paint entirely. Paint is now declared in the Design
toolbar, reachable through its Raster overflow at narrow widths, while sparse
user toolbar overrides continue to merge normally. The real browser flow
starts in Design and stays there through creation, paint, undo/redo, save,
reopen, and export. A leased Chromium regression confirms pixels stay
inside the source alpha and survive undo/redo, save/reopen, and transparent
PNG export. This is implementation and browser evidence, not qualification of
SVG/PDF, WebKitGTK, pen hardware, or transformed/masked/effected source variants.

## Artifact provenance caution

The existing anime-restoration ONNX file's SHA-256 was found to match the
repository manifest in the initial audit. A matching hash proves byte identity
with that manifest entry only. The model-host repository metadata and Varve's
manifest do not agree on a license label; neither label alone proves the
license or conversion provenance of the original checkpoint and generated
ONNX artifact. Do not present this model as license-cleared or quality-qualified
until the source checkpoint, converter, all notices, target runtime and artist
fixtures are checked independently.
