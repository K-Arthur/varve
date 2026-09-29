# Channels, curves, white balance, split toning and sharpening

Access/review date: 2026-09-28. Status: implementation and verification in
progress on `master`; this ledger does not certify the entire mission.

## Refreshed primary research

| Source/version | Finding and decision | Uncertainty |
| --- | --- | --- |
| [GIMP 3 Channels](https://docs.gimp.org/3.0/en/gimp-channel-dialog.html) | Inspection, color targeting and saved selection masks are different operations. Inspection must remain outside authored/exported effects. | GIMP's global channel model is not Varve's layer model. |
| [GIMP 3 Curves](https://docs.gimp.org/3.0/en/gimp-tool-curves.html) | Numeric input/output and point actions supplement dragging. A channel selector must edit retained channel data. | Interaction precedent, not proprietary evaluator parity. |
| [SciPy 1.18 PCHIP](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html) | Increasing unique X and weighted harmonic slopes preserve local shape without imposing globally increasing output. Use a versioned evaluator; keep old Catmull-Rom data reproducible. | Algorithm reference only; no SciPy runtime dependency. |
| [darktable development split toning](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/split-toning/) | Shadow/highlight hues, saturation, balance and compression are distinct from gradient replacement. Neutral chromatic contribution must bypass. | Development manual; no installed-version or numeric parity claim. |
| [Adobe Camera Raw color/tone](https://helpx.adobe.com/camera-raw/desktop/using/make-color-tonal-adjustments-camera.html) | Rendered JPEG/TIFF correction has relative temperature semantics; RAW Kelvin needs camera/development context. | No calibrated illuminant estimate is possible from arbitrary rendered pixels. |
| [darktable development color calibration](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/color-calibration/) | Chromatic adaptation and white balance have explicit input stages; double correction and gray-world scene bias require attention. | Mixed illuminants cannot be fixed by one global correction. |
| [GIMP 3 Unsharp Mask](https://docs.gimp.org/3.0/en/gimp-filter-unsharp-mask.html) | Amount, radius and threshold control edge contrast, with halos/noise as real tradeoffs. Blur and subtraction must share a domain. | Photo quality remains workload-dependent. |
| [W3C Filter Effects 1](https://www.w3.org/TR/filter-effects-1/) | Filtering, masks, opacity and color domains have separate contracts; preserve authored order. | Current Varve scalar effects are RGBA8; richer color metadata does not confer HDR/ICC execution. |
| [WCAG 2.2 dragging](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) | Single-pointer alternatives are required separately from keyboard alternatives. Provide numeric fields and explicit add/delete/reset. | Automated checks cannot certify every assistive technology. |

## User-reported failures worth preventing

Reports are anecdotal failure evidence, not prevalence estimates or a claim
that current versions of those applications remain affected.

| Report | Realistic Varve response |
| --- | --- |
| [Affinity V2 Unsharp Mask preview/apply mismatch](https://forum.affinity.serif.com/index.php?/topic/171938-unsharp-mask-is-a-disaster-for-me/) (search index accessible; direct page retrieval failed) | Independently verify constant patches/edges, actual applied pixels and export. CPU/GPU agreement alone is insufficient. |
| [Affinity transparent RGB export question](https://www.reddit.com/r/Affinity/comments/1ngri4q/is_there_a_way_to_export_with_a_transparent_alpha/) | Raw scalar no-ops retain hidden RGB and alpha. Do not claim a Canvas2D/encoder round trip retains hidden RGB. |
| [Affinity alpha-to-mask discoverability](https://www.reddit.com/r/Affinity/comments/1t0bazh/does_affinity_canva_version_have_the_ability_to/) | Name channel inspection versus mask creation clearly; preserve mask ownership and partial coverage. |
| [Photoshop curve keyboard regression](https://community.adobe.com/bug-reports-711/p-photoshop-26-10-unable-to-change-the-input-value-of-anchor-points-in-curves-using-arrow-keys-658046) | Keep numeric field focus and arrow-key editing stable; verify channel changes and point selection through the real DOM. |
| [Adobe targeted curve-channel question](https://community.adobe.com/questions-712/using-curves-to-make-a-change-to-a-specific-portion-of-an-image-1058583) | Different components at one sampled pixel legitimately have different input coordinates. Channel names and retained points must make that explicit. |

## First failing boundaries

| Severity / workflow | Baseline evidence | Boundary and intended repair |
| --- | --- | --- |
| P0 linear output sharpen | `exportPipeline/sharpen.ts` decodes source but uses an encoded-byte blur; constant linear-domain patch regression authored before repair | Domain mismatch before subtraction. Decode before alpha-weighted blur, retain floating intermediates and encode once. |
| P1 curve graph | Engine interpolates Y at an X segment fraction; widget interpolates X and Y independently | Two different functions. Graph samples the canonical scalar evaluator; saved legacy algorithm remains available. |
| P1 curve drag | Sorted point indices and fixed-pixel SVG coordinates | Stable authored identities, viewBox coordinate conversion, capture lifecycle and numeric alternatives. |
| P1 channel/curve tabs | One row/channel in schema, tab changes overwrite that entry's target | Retain independent authored settings with backward-compatible optional fields; all outputs read original RGB. |
| P1 Auto WB | Separate histogram means yield additive Color Balance; repeated click appends another adjustment | Actual joint samples, explicit relative correction, reliable sample rejection and source-stage repeatability. |
| P1 edit sharpen | Box loop indexes fractional radius and subtracts premultiplied RGB against differently treated destination | Versioned floating alpha-weighted operator and bounded neighborhood support. |

## Processing contract

Current effect surface: straight-alpha, encoded sRGB RGBA8 `ImageData`.
Processing in float does not turn the upstream surface into 16/32-bit HDR.
Color-only operations preserve alpha and raw fully transparent RGB. Channel
inspection is transient and excluded from persistence/export. Master RGB
curves apply the same component transfer; they are not luminance-only curves.

Output sharpening executes after final resizing, with radius in output
pixels. The Gaussian radius is the existing three-sigma support convention,
with fractional authored radius and integer support. Both source and blur
must be encoded sRGB or both linear sRGB. Neighborhood RGB is alpha-weighted;
source alpha is retained. A luma-delta correction is not a guarantee of hue
preservation after RGB clipping. Component thresholding uses maximum absolute
component delta so isoluminant chromatic edges remain eligible.

## Evidence and validation

Initial `pnpm verify:plan`: full escalation from pre-existing workspace,
framework and validation-infrastructure edits; full output at
`/tmp/varve-tonal-initial-plan.txt` (ephemeral).
Browser baseline: isolated Vite port 1437; Home and real editor loaded via
agent-browser; meaningful controls, no Vite overlay. Console-array inspection
returned empty, which is not an exhaustive console capture.

### Output sharpening milestone

- Before repair, `pnpm exec vitest run packages/engine/src/exportPipeline/sharpen-domain.test.ts --maxWorkers=1`: 5 failures / 6 cases. A flat `[128,87,203]` became `[0,0,159]`; independent linear edge reference expected `[63,189]`, received `[0,167]`.
- After repair, `pnpm exec vitest run packages/engine/src/exportPipeline/sharpen-domain.test.ts packages/engine/src/exportPipeline/stages.test.ts packages/engine/src/exportPipeline/pipeline.test.ts --maxWorkers=1`: 32/32 pass.
- `pnpm exec biome check --write` on the three owned TS files: pass.
- Isolated-index `pnpm verify:plan --staged`: engine/reverse-dependent closure,
  Tier 0/direct tests; no Rust, website E2E or full visual suite selected.
- `pnpm verify:affected --staged`: Tier 0 and direct tests pass; affected
  engine lane: 5,373 tests passed, 13 skipped; one unchanged alpha round-trip
  test fails. Its fixture writes offsets 0/4 (red), then expects them as alpha;
  `maskFromImageData` takes minimum red/alpha coverage, so zero alpha correctly excludes those samples. No sharpen import exists
  in that path. Reverse-dependent lanes did not execute after fail-fast.
- `pnpm exec tsc -p packages/engine/tsconfig.json --noEmit`: pass.
- `pnpm audit:tokens`: 303 contrast pairs and token-usage scan pass.
- Opened `/tmp/varve-tonal-sharpen-review.png` at source-pixel scale. Flat
  colored areas match, step edges have the expected local contrast increase,
  diagonal detail stays continuous and transparent feathering shows no dark
  fringe. This synthetic board is kernel evidence, not an editor screenshot
  or a real-photo quality certification. Raw PNG evidence is ephemeral until
  the final screenshot/evidence set is collected.

Unavailable native/hardware evidence stays pending.


### Curves and mixer milestone

`compileCurve` is now shared by the graph and byte transfer. New adjustments
use PCHIP v2; old documents without a version normalize to legacy v1. Point
coordinates retain fractional code values and optional ids. Master RGB then
individual curves have retained independent arrays. Mixer rows are independent
and every output reads the original input; offsets are code values, not percent.
Legacy one-row entries remain valid until an explicit edit promotes them.

Focused channel/curve/editor/normalization/compositor tests: 73/73 pass;
canonical transfer tests plus old curves tests pass. Chromium actual-menu
workflow passes (1 test, 17.1 s): photo import → Object / New Adjustment Layer
→ curves / numeric points / channel switches → independent mixer rows.
Opened `reports/ui-review/tonal-workflows/01-curves-light.png` and
`02-mixer-light.png`. Graph/histogram fit the inspector. The first visual pass
found truncated repeated numeric labels; compact visible labels were added
while retaining complete accessible names. Updated screenshots follow at the
combined workflow gate. Editor typecheck now reports only an unchanged
`tools/paintTarget.ts:176` undefined-node error; no tonal file errors remain.

### Relative white balance and split toning

Refreshed darktable development Color Calibration / Split Toning and the
Oklab author's reference on 2026-09-28 before this milestone. The former
explicitly distinguishes partial white balancing from full chromatic
adaptation and warns about gray-world failure on artificial scenes. Varve's
operator is deliberately documented as linear RGB relative gains, without
claiming Bradford/CAT16, Kelvin or camera characterization. Split Toning
reuses shared Oklab conversion and gamut mapping instead of another color
library. No new dependencies or copied application implementations.

New defaults, normalization, IR dispatch, catalogue entries and frontend
controls are connected to existing Object Filters/Adjustment Filters. The
source histogram owner now shares its bounded pixel sample with neutral
picking, Curves sampling and channel inspection. Auto is explicit, rejects
insufficient evidence and uses the upstream source. Legacy Temperature/Tint
and Color Balance remain independent.

Focused numerical/editor tests passed 114/114 before the final codec and
history checks. New tests include independently calculated linear gain output,
known neutral patch correction, dominant-color/black/clipped/partial-alpha
rejection, exact split-tone bypass, hue wrap, endpoint protection and bounded
Oklab lightness error. The first expanded E2E run passed Curves/Mixer but two
cases returned to Home during live source reloads; these are rerun with source
files held stable. Screenshot artifacts from failed startup are failures, not
verification of the tonal UI.

The channel path uses full-resolution source decoding within the existing
16MP mask budget, not the inspection preview. It preserves fractional alpha
coverage through existing source/image/world mapping and area selections.
Existing Save/Delete/Rename/Duplicate selection operations lacked document
transactions; the new workflow exposed that history gap and now wraps those
resource edits in one owning transaction. No second channel resource format.

Stable Chromium rerun: 2/2 pass (WB/split tone 26.4s; channel inspection and
saved coverage 14.9s). Opened all three updated artifacts at 1280×720. Neutral
reference becomes gray after patch correction; the upstream preview remains
uncorrected as labelled. Split-tone swatches, numeric fields and visible
slider labels fit the narrow inspector, with the remaining controls available
by scrolling. Channel snapshots preserve the original image; pixel-selection
context remounts the inspection surface in Composite, so the test reopens it
instead of assuming old transient preview state survives that context change.
The first split-tone locator omitted the NumberField's `value` label; the test
now uses its real accessible name. Architecture CI audit passes enforced
ratchets; printed pre-existing hub warnings are not silently rebaselined.

Current Agent Validation Report (milestone, not final certification):
- Changed scope: engine tonal schema/evaluator/dispatch, scene normalization,
  inspector controls, canonical source diagnostic, channel-to-area-selection
  adapter and saved-selection transactions, targeted tests, canonical docs.
- Validation plan: touched-file policies and direct tests, then editor/engine/
  scene reverse closure; the source diagnostic selects integration E2E/perf
  lanes. Rust and website E2E are not selected for this core milestone.
- Commands: isolated-index `pnpm verify:plan --staged`, `pnpm verify:affected
  --staged`; lease-wrapped Vitest and Chromium commands recorded above;
  `pnpm typecheck:e2e`; package `tsc --noEmit`; `pnpm audit:docs`,
  `pnpm audit:emoji`, `pnpm audit:tokens`; architecture audit `--ci`.
- Passed: focused 114 cases, source/AdjustmentPanel/SelectionSources direct
  lanes, E2E typecheck, docs/emoji/tokens, enforced architecture audit.
- Initial affected failure: old identity test expected even an exact diagonal
  curve to remain active. It is updated for the new proven-neutral contract,
  with a nonuniform legacy multi-point counterexample retained.
- Skipped as unrelated: Rust, website E2E and full visual suite at this stage.
  Reverse lanes after fail-fast are not called passed.
- Full suite run: no yet; final escalation is required for the shared
  adjustment/IR changes and will be run with a stated reason.

The actual DocumentCodec round trip initially failed because the test passed
smart filters through a shape factory option that does not attach them. The
fixture now explicitly attaches the same node field used by production. The
codec, compatibility/retained-state and identity repair rerun passes 14/14.
The wider codec/compositor/catalogue/mask selection run passed 91 other cases;
its only failure was that corrected fixture. Legacy monochrome mixer entries
with a non-red editor tab retain their original coefficients. This is covered
separately from new full-matrix monochrome behavior.
