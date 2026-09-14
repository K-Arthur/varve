# Frequency Separation / Liquify repair audit — 2026-09-14

This is the research and evidence record for the repair pass on Varve's
existing raster retouching workflows. The work stays in the existing scene,
tile, IR, history, canvas, and export paths. It does not add a model,
network service, duplicate editor, or new raster authority.

## Research ledger

Access dates are 2026-09-13 and 2026-09-14 (America/Vancouver). Product
documentation is used for workflow expectations; the image-processing
references are used for mathematical and browser/API contracts.

| Question | Source / version | Finding | Varve decision and trade-off |
|---|---|---|---|
| What does practical frequency separation expose? | [Affinity Photo 2: Frequency Separation](https://affinity.help/photo2/en-US.lproj/pages/Retouching/retouch_frequencySeparation.html) | Tone/colour and texture are edited independently; Gaussian is the default, while Median and Bilateral have different edge behavior; radius and masks are part of the workflow. | Ship a visible Before/Combined/Tone/Detail comparison and a layer-pixel radius. Keep Gaussian as the only method until another method has its own reconstruction proof. |
| How is a detail band represented safely? | [GIMP 3: Wavelet Decompose](https://docs.gimp.org/3.0/en/plug-in-wavelet-decompose.html) | A neutral detail value and reconstruction blend are workflow-critical; integer and floating representations do not have identical reconstruction behavior. | Store a signed residual encoded around neutral 128, decode with the exact Varve equation, and display the neutral meaning. Do not pretend a contrast-enhanced preview is the stored detail. |
| What does a usable Liquify session include? | [Adobe Photoshop: Liquify overview](https://helpx.adobe.com/photoshop/desktop/effects-filters/artistic-stylize-filters/overview-of-liquify-filter.html) | A production Liquify workflow includes brush modes, freeze/thaw, reconstruction, mesh/backdrop concepts, and a session that can be accepted or cancelled. | Provide bounded push/expand/contract/twirl/restore/smooth, raster freeze/thaw, reset, undo, and explicit unsupported-target guidance. Vector geometry and group freeze remain honest limitations. |
| Which brush semantics are useful in a non-destructive editor? | [Krita Transform tool](https://docs.krita.org/en/reference_manual/tools/transform.html), [Krita deform brush engine](https://docs.krita.org/en/reference_manual/brushes/brush_engines/deform_brush_engine.html) | Users expect direct canvas brushes, reverse/restore-like controls, and a distinction between wash and buildup. Large brushes and whole-image transforms are commonly expensive. | Push uses path delta and cannot drift while stationary. Time buildup is limited to radial/twirl modes and normalized by elapsed time, so event rate is not an artwork parameter. |
| Which mapping and border convention avoids holes? | [OpenCV 4.x geometric transformations](https://docs.opencv.org/4.x/da/d54/group__imgproc__transform.html) | Remapping is naturally expressed as output-to-source sampling; interpolation and border policy are explicit parts of the result. | Persist an output→source field and use a gather sampler. Transparent is the default border policy; clamp is explicit and not silently substituted. |
| What input samples are authoritative? | [W3C Pointer Events](https://www.w3.org/TR/pointerevents/) | User agents may coalesce input; `getCoalescedEvents()` supplies high-resolution samples and prediction is not authoritative. | Process coalesced events in order, ignore predicted samples for commits, commit a release coordinate once, and preserve one history transaction per gesture. |
| Where should expensive CPU work run? | [MDN Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) | Workers keep laborious processing away from the UI thread, but messages are copied/structured-cloned unless transfer mechanisms are used. | Keep the current CPU fallback correct and source-preserving. Use the existing worker/render infrastructure for future full-resolution tiled passes rather than adding an unbounded per-dab copy protocol. |
| Should WebGPU be required? | [MDN WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) | WebGPU enables compute but is limited-availability and secure-context dependent across browsers. | Do not make Liquify or Frequency Separation depend on WebGPU. The current path remains CPU-capable; acceleration is an optimization after measured evidence. |
| How should decoded pixels and colour be treated? | [MDN ImageDecoder](https://developer.mozilla.org/en-US/docs/Web/API/ImageDecoder/ImageDecoder), [CSS Color 4](https://www.w3.org/TR/css-color-4/) | Decoding and colour-space conversion/premultiplication are explicit concerns, not incidental browser defaults. | The current product contract is 8-bit encoded sRGB. Frequency Separation blurs premultiplied RGB, keeps alpha as coverage, and does not advertise 16-bit, HDR, wide-gamut, or CMYK behavior. |
| What export byte-level invariant matters? | [W3C PNG specification](https://www.w3.org/TR/png/) | A successful download event is not an image-content assertion; the written file has a format signature and encoded dimensions/data. | The persistence E2E saves the actual download and checks the PNG signature/size before treating export as evidence. |
| What desktop API constraint applies? | [Tauri 2 dialog plugin documentation](https://tauri.app/plugin/dialog/) | Native dialogs/filesystem access are platform/plugin concerns and must not be assumed from a browser-only test. | No new Tauri dependency is needed for these operations. Native GUI verification is reported separately from Chromium visual evidence. |

## Failure patterns investigated

These are recurring complaints or failure reports in other offerings, used as
test hypotheses rather than as proof that Varve had the same bug:

| Reported failure pattern | Evidence | Varve repair or product boundary |
|---|---|---|
| Liquify push direction appears reversed or unpredictable. | [Krita user report](https://www.reddit.com/r/krita/comments/13j5quh/) | The field contract is written down as output→source; Push subtracts pointer travel, and the deformation grid is drawn in content direction. Engine tests assert direction and the overlay uses the same transform path. |
| Large images/brushes make Liquify unusable. | [Krita large-brush discussion](https://www.reddit.com/r/krita/comments/ru29pq/), [whole-picture lag discussion](https://www.reddit.com/r/krita/comments/ng6ci3/) | The field stores only a bounded grid, source tiles remain authoritative, render caches are pixel-budgeted, and hostile CPU output allocations fall back safely. A full-resolution tiled warp for >32 Mi-pixel layers is deferred rather than falsely advertised. |
| Freeze masks can hang or destabilize Liquify. | [Adobe community freeze-mask report](https://community.adobe.com/bug-reports-711/p-freeze-using-mask-tools-in-liquify-660409) | Freeze data is bounded to 512×512, RLE runs are length-checked before allocation, malformed samples are finite no-ops, and group-level freeze is disabled with an explicit message instead of pretending the shared composite has a per-band mask. |
| Clone/retouch work lands on the wrong layer or samples the whole composite. | [Photoshop frequency-separation discussion](https://www.reddit.com/r/photoshop/comments/tts60c/) | The UI names the target and component; the decomposition's detail value 128 is documented as neutral; retouch tooling continues to use the selected raster component rather than silently sampling “all layers.” |
| A non-destructive effect disappears or is doubled after reopening/flattening. | [Adobe community Liquify persistence report](https://community.adobe.com/questions-712/liquify-not-persistent-in-documents-created-using-ps-2021-1112661) | Fields, band links, and residual tiles are document state. Source Liquify moves to a shared group on separation, component fields are materialized once on re-split, and both group/component fields are materialized once on flatten. |
| GPU toggles or browser differences change responsiveness/fidelity. | [Adobe community Liquify lag report](https://community.adobe.com/bug-reports-711/liquify-tool-is-lagging-to-the-point-of-being-unusable-660550) | The CPU path is the correctness fallback; WebGPU is not required. Capability claims and native WebKit verification remain separate from Chromium E2E. |

## Implemented state contract

### Frequency Separation

- Source raster tiles remain the input authority. Creation replaces the
  original raster's tiles with low-band tiles, creates a stable-ID detail
  band, and wraps them in a marked group.
- In the working representation, `I = source`, `L = Gaussian(I)`,
  `H = I − L`, `E = round(H / 2) + 128`, and `R = L + 2(E − 128)`, with one
  final RGB clamp and alpha taken from `L`.
- The current representation is 8-bit sRGB RGBA. The unedited oracle is
  `max |R − I| ≤ 1` LSB/channel. This is a declared precision limit, not a
  claim of floating-point or wide-gamut support.
- Radius is Gaussian sigma in layer pixels. The blur uses clamp-to-edge and
  `ceil(3σ)` support; camera zoom, preview scale, and export scale do not
  change it.
- The group owns source appearance that applies to the recombined result:
  opacity, blend mode, masks, layer effects, and object filters. Child bands
  are ordinary raster targets with neutral child appearance.
- Re-split reads the current decoded band state, preserving ordinary tone/
  texture retouching. An advanced band Liquify field is materialized into
  that state once and cleared so it cannot be applied twice. A shared group
  Liquify field remains separate and is applied after decode.
- Flatten materializes the decoded bands, then the shared group field, removes
  authoring-only Liquify state, and composes wrapper/child placement before
  deleting the marker.

### Liquify

- A field is a validated 32×32 default (64×64 maximum) output→source grid;
  control-point displacements are bounded to half the reference extent.
- The renderer gathers from authoritative source pixels using premultiplied
  bilinear sampling. Identity returns the source without a second copy;
  transparent borders never reveal an undeformed fallback.
- Push is travel-driven; expand/contract/twirl use bounded time-normalized
  buildup; Restore and Smooth operate on the field, not on image colour.
- Raster targets persist freeze coverage as bounded RLE/base64 authoring data.
  A marked Frequency Separation group can receive a shared deformation but
  cannot receive a freeze mask in this version; the UI states that boundary.
- Group pointer coordinates resolve through the low-band pixel transform so a
  wrapper transform cannot make the brush write at an unrelated location.

## Reproduction and regression evidence

The initial production audit found the following confirmed defects in the
existing call paths, each reproduced by a failing test before the repair:

1. Unsupported persisted methods were reported as the selected method even
   though Gaussian was executed; runtime normalization now returns the actual
   method.
2. Mismatched Frequency Separation dimensions were mixed instead of rejected.
3. Resizing a Liquify output could construct `ImageData` with a source-sized
   buffer, and hostile dimensions could request an enormous typed-array
   allocation.
4. Non-finite dab strength could pass through clamping and corrupt a field.
5. Cache replacement subtracted neither the old entry nor its pixels exactly
   once, so long sessions exceeded the intended budget.
6. Re-split and flatten applied persisted band/group deformation more than
   once, while group creation duplicated source appearance in the tone band.
7. The pointer-up path could lose a final release coordinate and add an extra
   time-based dab; it now commits a release point only when it is new.

Focused unit/scene evidence currently passes:

- Engine Frequency Separation and Liquify repair tests: reconstruction,
  dimensions, invalid input, output allocation, and freeze safety.
- Scene Frequency Separation tests: group links, reconstruction, appearance
  transfer, source-Liquify handoff, re-split, flatten, duplicate, codec
  round-trip, band deformation, and freeze persistence.
- Editor cache/tool repair tests: replacement accounting and component target
  resolution.

The feature-specific browser regressions also pass. The re-split and Liquify
cases were run with HMR disabled to keep the shared checkout's concurrent
source edits from navigating the test page:

- `frequency-separation.spec.ts`: reconstruction/undo passed in Chromium;
  the re-split preservation case passed independently in 3.6 minutes.
- `liquify.spec.ts`: real push drag, undo, and redo passed in Chromium in
  4.7 minutes.
- `frequency-liquify-persistence.spec.ts`: combined creation, group Liquify,
  save/reopen, and byte-identical export passed in Chromium in 1.2 minutes.

The dirty checkout contains unrelated concurrent edits and several active
dev servers. The first Chromium E2E attempt was therefore not accepted as
visual evidence: the app remained on Loading Varve and the page context was
destroyed during setup. A dedicated rerun used an isolated port and artifact
directory. The final trace-bearing run completed the production workflow in
1.2 minutes with one Chromium worker. The first successful rerun exposed a
brittle cross-camera backing surface hash: the serialized retouch state and
exported PNG were unchanged, but the restored viewport painted a different
camera projection. The regression now compares the surface before/after a
forced full redraw at each camera, and compares the actual pre- and
post-reopen PNG bytes. Both checks pass.

Captured artifacts:

- [before canvas](../../test-results/retouch-fs-liquify-20260914-visual-final/canvas-frequency-liquify-p-869b3-vive-save-reopen-and-export-chromium/frequency-liquify-before.png)
- [after canvas](../../test-results/retouch-fs-liquify-20260914-visual-final/canvas-frequency-liquify-p-869b3-vive-save-reopen-and-export-chromium/frequency-liquify-after.png)
- [reopened canvas](../../test-results/retouch-fs-liquify-20260914-visual-final/canvas-frequency-liquify-p-869b3-vive-save-reopen-and-export-chromium/frequency-liquify-reopened-canvas.png)
- [export PNG](../../test-results/retouch-fs-liquify-20260914-visual-final/canvas-frequency-liquify-p-869b3-vive-save-reopen-and-export-chromium/frequency-liquify.png)
- [reopened export PNG](../../test-results/retouch-fs-liquify-20260914-visual-final/canvas-frequency-liquify-p-869b3-vive-save-reopen-and-export-chromium/frequency-liquify-reopened.png)
- [interaction summary](../../test-results/retouch-fs-liquify-20260914-visual-final/canvas-frequency-liquify-p-869b3-vive-save-reopen-and-export-chromium/frequency-liquify-interaction-summary.json)
- SHA-256 for both files: `450f93b9eff1d4e3755e89e91ef9f396bfe0210bde04532026e959b9dba4742` (512 × 384 RGBA PNG)

The final trace recorded 2 committed interaction samples. Pointer-to-present
was 168.9 ms p50 and 441.1 ms p95/max. Total interaction time was 272 ms p50
and 5.297 s max; the max includes the test's deliberate full-resolution
reopen/export waits and is not a pure input-latency budget.

Marketing/docs visual evidence was captured from the built static site at
1440 × 1000 in a local preview: `/features/retouching/` and
`/docs/tools/retouching/` both returned HTTP 200, rendered their expected
title and heading, and showed no horizontal overflow or broken navigation.
The reviewed captures are `/tmp/retouching-feature.png` and
`/tmp/retouching-docs.png` (the files are local QA artifacts, not product
assets).

## Capability and limitation matrix

| Capability | Status |
|---|---|
| Gaussian two-band reconstruction, signed neutral detail, alpha policy | Implemented and focused-test verified |
| Stable linked Tone/Detail group, ordinary raster retouch targets | Implemented and scene-test verified |
| Source-preserving raster Push/Expand/Contract/Twirl/Restore/Smooth | Implemented and engine/scene-test verified |
| Raster Freeze/Thaw, reset, undo transaction | Implemented; focused tests pass; raster freeze is not exercised by the persistence scenario |
| Canvas dialog, target status, Before/Combined/Tone/Detail controls | Implemented and Chromium visually exercised |
| Save/reopen/export combined workflow | Implemented and Chromium E2E verified |
| Chromium visual oracle and captured before/after artwork | Verified; full-redraw hashes are stable at both cameras and exported captures match |
| Firefox, WebKit browser, WebView2, WKWebView, ChromeOS/Debian container | Capability policy exists; not visually exercised by this pass |
| 16-bit/float/HDR/wide-gamut/CMYK Frequency Separation | Not supported/advertised |
| Median/Bilateral/Wavelet Frequency Separation | Deferred pending independent reconstruction contract |
| Vector/text geometry Liquify | Deferred; targets are not silently rasterized |
| Group-level Freeze/Thaw and >32 Mi-pixel tiled CPU warp | Deferred with explicit UI/docs boundary |

## Performance evidence

The cache accounting repair is covered by a focused replacement test. The
engine baseline was run with `vitest bench --run --pool=forks --project=node`
on 2026-09-14 in the repository checkout:

| Fixture | Separation cold | Recombination | Liquify gather warp |
|---|---:|---:|---:|
| 128 × 96 | 12.74 ms mean | 0.22 ms | 36.29 ms |
| 512 × 384 | 288.42 ms mean | 3.17 ms | 479.61 ms |
| 1024 × 768 | 2116.28 ms mean | 15.90 ms | 1013.54 ms |

The workload is a non-identity 32×32 field over an RGBA fixture with a
transparent edge and a 128-alpha island. Environment: AMD Ryzen 3 5300U
(4C/8T), CachyOS Linux 7.2.3, Node v22.23.2, Vitest 4.1.10, CPU path,
22 GiB host RAM with only about 6.6 GiB available during the run. The values
are a loaded development-machine baseline, not a device guarantee. The
Chromium pointer-to-present measurement above is from one 1440 × 900
production-canvas run on the same host; it is evidence for this workflow,
not a cross-device product budget. No throttled browser number is promoted
to a product budget.
