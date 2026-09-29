# Channels, curves, white balance, split toning and sharpening

Research access date: 2026-09-28; delivery checks continued into 2026-09-29 UTC.
Status: implemented on `master`, with inspected browser/export/website evidence.
Native, physical-device and repository-wide certification remain incomplete
for the specific reasons below.

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
| P0 browser PDF fallback | An opened Poppler render contains RGB stripes while PNG/SVG are correct | Packed RGB used RGBA destination strides; xref placeholders and discarded alpha also required repair. New byte-exact writer and rendered comparison. |

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

### Editing sharpening milestone

Refreshed GIMP 3 Unsharp Mask and W3C Filter Effects again before this slice.
GIMP's broad noise-reduction wording is not adopted: unsharp masking can
amplify noise, and its own halo example shows why controls and detail review
matter. Varve's radius is its shared three-sigma support convention, not a
numerical GIMP-radius parity promise. No new color/numerical dependency was
introduced; existing shared IEC sRGB/Oklab primitives and their repository
licensing remain the authority.

The native validation approach was checked against
[Tauri 2 WebDriver documentation](https://v2.tauri.app/develop/tests/webdriver/)
(access 2026-09-28). The repository uses its embedded WDIO Tauri service,
not an assumption that a separately installed WebKitWebDriver exists.

- Before integration, `sharpenIntegration.test.ts`: 2/2 failures, proving the
  radius/domain dispatch and no-op readback boundary.
- After integration, lease-wrapped Vitest on sharpenIntegration, unsharpMask,
  export sharpen-domain, pipeline, and tonalPersistence: 23/23 pass.
- Independent full two-dimensional IEC sRGB Gaussian reference matches bytes
  across 128-column/64-row boundaries, including partial/zero alpha,
  fractional radius, threshold and luma/component modes.
- Export pipeline test distinguishes one post-resize pass from two passes;
  editing radius tests cover raster scales 0.5, 1 and 2.
- Earlier core affected run: direct lanes and Chromium 3/3 passed;
  editor closure: 8,119 pass, five failures in four workspace/configuration
  files outside tonal ownership, two skipped. Later reverse lanes did not run
  after fail-fast. This is not a green full-suite claim.
- Added an in-flight guard around explicit Auto White Balance to prevent
  overlapping estimates; source-identity rejection and conservative sample
  acceptance remain in force.

Native preflight passes. The legacy `~/.cargo/env` path from AGENTS is absent
on this host; the available cargo executable is `/usr/bin/cargo`. Native build
and actual WDIO screenshots are tracked separately from preflight.

### Detail, browser and website review

Editing Sharpen v2 now shares the output Gaussian operator, with encoded or
linear domains, fractional radius, threshold, luma-only and partial-alpha
controls. Existing box entries retain v1 until an explicit upgrade. A
requested document-pixel detail includes spatial halos; Channels separately
shows a source-pixel crop. Neither diagnostic allocates five full image copies.

The split-tone optimization retains shared color conversion and gamut
compression, decodes the 256 input code values once, compiles range parameters
once and avoids a Lab/Lch round trip for in-gamut colors. Three deterministic
4096-pixel color/alpha fixtures match the original v1 bytes exactly. Existing
neutral/alpha/lightness cases remain green (16 focused tests total).
The Oklab author and GIMP 3 references were reopened on 2026-09-28 before the
final performance review; no application-algorithm parity is implied.

The website adds an honest tonal overview, a practical guide and actual
editor screenshots. Both root and /varve builds pass Astro check (163 files,
zero errors/warnings/hints) and build 112 routes. The two-mode guide test
passes at desktop and 390px mobile widths with light/dark and native forced
colors. Opened full-page root mobile and /varve dark captures: paragraphs,
headings, examples and links fit without horizontal overflow. Additional
viewport captures make mobile text review separate from the tall overview.

The curve recording was opened as successive frames showing the same point
cross another point, Undo, a second drag and Escape rollback; numeric E2E
assertions verify identity and one-step history. This is interaction evidence,
not a frame-rate or physical touch/pen certificate. DPR-2 dark/high-contrast
screenshots were reopened after widening the numeric row; both Input and
Output labels and fractional values fit.

Validation found two test-assumption failures: the export control defaults to
2x, and diagnostic region position intentionally resets on reopen. The tests
now choose 2x explicitly and request the same region. Earlier offline failure
was dev-server lazy-module loading; the final test goes offline after loading
the app and uses empty sample caches. It does not certify offline PWA boot.

The first combined final affected run found generated website HTML in our
isolated build directory during the zero-emoji source audit. The builds were
moved under the existing excluded dist-root/dist-pages names; no audit rule
or baseline was changed. The affected command is rerun after this repair.

### Native build and host limits

Fresh native attempts failed first at concurrently edited platform/inference
compilation; the shared E2E typecheck later passed. The third
`node scripts/quality/heavy-lease.mjs 'tonal fresh desktop build after shared type repair' -- pnpm desktop:build:test`
passed desktop TypeScript and Vite, then Rust failed while writing
`libvarve_desktop_lib.rlib` with `No space left on device (os error 28)`.
The filesystem recovered about 6GiB after the failed compiler temporary
artifacts were released. The previous September-27 binary/archive remains;
it is not current native evidence. The queued native test was cancelled
before startup. No unrelated build caches or processes were deleted.

The committed WDIO spec imports the self-authored PNG through a real DOM File
change in WebKitGTK and exercises the five controls. This does not test the
OS file chooser. Run after a successful fresh build:

```bash
pnpm desktop:build:test
VARVE_WDIO_SPECS=./tests/wdio/tonal-controls.e2e.ts \
  node scripts/quality/heavy-lease.mjs 'tonal native control review' -- \
  xvfb-run -a pnpm exec wdio run wdio.conf.ts
```

Native/installed-package certification, physical Chromebook Duet ChromeOS,
ARM64/Crostini, Windows/macOS and pen remain pending. Manual verification:
import `tests/e2e/fixtures/tonal-reference.png`; add the five adjustments via
Object → New Adjustment Layer; move a curve point across another, cancel a
second drag, switch RGB channels and undo; sample the cast patch at preview
(20,20), repeat Auto and reset; apply split-tone ranges at 18%/15%; compare
Sharpen 80%, radius 3.5 at detail vertical 86%; fit/zoom without changing its
radius; save, close, reopen offline and request the same detail region; create
Red channel coverage, save/reload it and create/remove its mask. Export PNG,
SVG and PDF at explicit scales and compare the reference patch and coverage.
Expect source editability, exact retained parameters, no duplicated Auto or
output sharpen, and ordinary RGB export despite channel preview isolation.
For installed PWA boot, first prime a production build and its service worker
online, then fully close/reopen offline. The dev-route test does not certify it.

Some queued checks reached the default 600-second lease wait deadline while
Rust was compiling; these are scheduling failures, not test passes. Their
required focused runs were resubmitted with a 30-minute wait limit, preserving
the memory/serialization guards. The standalone architecture audit was
cancelled when the explicitly reasoned full gate began the identical
`node scripts/audit-architecture.mjs --ci` command, avoiding two simultaneous
copies. The full gate remains the final ratchet result.

### Export visual failure and repair

Opening the actual exported PDF in Poppler exposed colored stripes that the
initial `%PDF`/image-object checks missed. PNG and the SVG's embedded PNG were
correct. The browser-only minimal PDF writer allocated packed RGB but used
RGBA destination strides, truncating/misplacing pixels. Its xref offsets were
also placeholders, and it discarded alpha. The new PDF 1.4 helper packs RGB
with three-byte destinations, writes exact stream lengths/xref byte offsets
and emits a separate grayscale soft mask when coverage is nonopaque. It uses
the stable ImageData dimensions after closing the bitmap. This is an ordinary
DeviceRGB raster fallback, not a new PDF/X or ICC print implementation.

A separate scalar regression checks RGB byte order, partial/zero-alpha mask
bytes, every xref entry and corrupt-dimension rejection. The actual browser
export test independently renders with Poppler and checks flat/ramp/primary
patches against the PNG at the same explicit 2x scale (component tolerance 2).
Other CI hosts without Poppler annotate that rendered check as unavailable;
the stream/alpha/xref unit checks always run. Header validity is no longer
used as proof of correct pixels.

`SpecPanel/export.ts` already contains another owner's bitmap-dimension
lifetime repair. The integration commit uses only our helper/import/consumer
hunks from an isolated index; the unrelated dimension-cache lines and export
unit edits remain in their working tree. This protects their ownership while
making our committed caller rely on stable ImageData dimensions.

The channel-to-mask E2E reached the real mask handler and Undo, but exposed a
persistent-history warning from invoking that handler without an owning
transaction. The Channels button now wraps the canonical handler in
begin/commit/abort, with an assertion that creation emits no history-bypass
warning. Curves also offers restrained, editable Soft contrast/Invert presets
for the current channel, with one preset application per undo transaction.

### Final scoped results and limitations

Completed code commits on `master`:

- `401f1e7fd` — output sharpen uses one floating color domain and alpha-weighted neighborhoods.
- `65bf05d42` — canonical versioned curves, retained channel rows, source/coverage tools, relative white balance and split toning.
- `cb69ef084` — editing sharpen v2, bounded document/source-pixel detail, curve presets, mask transaction repair and byte-compatible split-tone optimization.
- `b53d6c260` — correct packed RGB, optional alpha soft mask and xref byte positions for the browser PDF fallback.
- `c9b2d819e` — generator-backed, hashed canonical Curves and Split Toning website screenshots; other staged manifest entries preserved exactly.

The sharpening/code commit passed the normal hook, including 33 direct cases;
the PDF commit passed its normal hook and four writer cases. The shared PDF
file's remaining diff is only the other owner's bitmap-dimension cache hunk.
No unrelated staging was included. All implementation remains on master;
the disposable detached validation copy is only for checking the candidate.

The last focused tonal/reference/codec suite passed 79/79 in 12 files. The
PDF/old export/CurveEditor suite passed 49/49 after repairing an asynchronous
portal test and preserving the existing MediaBox text layout. Chromium passed
the rendered export, real channel→mask→Undo without a history warning and
curve drag/preset/touch/theme cases (3/3). The updated sharpening detail,
camera invariance and offline warm reopen case passed (1/1, 58.0s). The actual
try route passed (1/1, 40.6s). The root and /varve website guide cases passed
(2/2, 10.2s), with opened desktop/mobile/light/dark/forced-color artifacts.
These runs overlap; they are not summed as independent test counts.

Performance records are in the [measurement report](../perf/tonal-controls-2026-09-28.md).
The real requested-detail latencies were 32.0/27.2/30.2ms on the already-loaded
host. The paired split-tone means improved while thousands of color/alpha
samples remain byte-identical. Substantial variation between later host runs
is retained in the raw results. The final harness gives Curves a fresh source
per iteration instead of repeatedly recoloring its input. No universal 60fps,
cold-start, peak-memory or physical low-end-device result is claimed.

The full gate was explicitly attempted with reason `Versioned tonal adjustment
schema and cross-package FilterIR integration`. Its initial format stage
reported unrelated dirty-file failures, and its typecheck caught two owned
benchmark callbacks returning ImageData rather than void. Those callbacks
were repaired and the engine typecheck passed immediately afterward. The
full gate's health, emoji and enforced architecture lanes passed at that
point; complete Rust/unit/browser suites did not execute. It is an attempted
gate, not full certification.

Later shared-worktree checks reflect concurrent changes: an engine typecheck
reported the preview-runner error constructor's inferred message union; its
owner subsequently added an explicit string type. The latency test's own
Window cast was repaired, and `pnpm typecheck:e2e` then passed. The final
architecture run failed solely on the new type-import cycle
`liveEffects/cpuProvider.ts → liveEffects/dispatch.ts`, outside this ownership.
Both directions were inspected; neither file was changed here and no baseline
was weakened. Total distinct cycles remained 15; the named allowlist still
correctly rejects a new cycle. This is unresolved architecture certification,
not a tonal-kernel failure.

The final shared-worktree affected attempts passed touched formatting/lint,
emoji and radius checks, then stopped on unfinished navbar documentation
links in another owner's files (initially three, later one screenshot-directory
link). Earlier affected editor/engine closures and their unrelated failures
are recorded above. No downstream lane skipped by fail-fast is called green.
A clean disposable copy, using the installed dependencies read-only, passed
touched formatting/lint and emoji before stopping because committed HEAD's
executor did not register the planner-selected `audit:radius` lane. The shared
checkout has that separately owned mapping in progress; the final affected
run returns there after the navbar evidence directory becomes available.
`pnpm_config_verify_deps_before_run=false` prevented pnpm from trying to
replace linked dependency directories; it skipped no validation lane. The
copy's failed executor result is not certification. Native disk exhaustion
and physical-device follow-ups remain as recorded above.

For the PDF milestone, W3C Filter Effects and GIMP Unsharp Mask were refreshed
again on 2026-09-28. Adobe's public PDF reference download exceeded the browse
tool's size limit and its index page was unavailable; neither is claimed read.
The PDF implementation is supported here by independent stream/xref checks
and actual Poppler output, with ordinary DeviceRGB/soft-mask scope stated.

Opened durable evidence is indexed in
[the visual review](../screenshots/tonal-workflows/README.md), including the
corrected PDF, original/source and requested-detail stages, recording frames
and website viewports. Header checks, emulated touch and existing old native
binaries are never substituted for rendered or hardware evidence.

Native-boundary inspection confirms that `sceneToEngine.ts` lowers both
object and adjustment stacks through `adjustmentsToFilters`, while
`varve-bridge`, `varve-core` and `varve-engine` retain `filters` as JSON values
and clone them into render IR. This preserves the new fields at that wire
boundary. It is code-inspection evidence, not proof that a newly built native
webview rendered them; that runtime check remains blocked by disk space.

### Last delivery checks

The last 43-path affected run passed touched formatting/lint, emoji, radius,
docs and E2E TypeScript, then the actual demo and rendered-export cases. Four
of five tonal-workflow cases passed, including white balance/split toning,
channel→mask history, sharpening detail/offline reopen and pointer/theme cases.
The Curves/Mixer case lost its menu DOM and returned to Home before creating
the adjustment amid shared Vite reload warnings. Its opened failure screenshot
and locator trace are consistent with a concurrent reload; that cause is an
inference rather than a tonal assertion failure. The exact
case passed in a frozen copy of master (1/1, 41.0s including startup). Vite
blocked font/worker assets outside that copy's serving root, so that run
explicitly exercised the main-thread fallback; it is not worker/native parity
certification. The completed disposable copy was removed, preserving master.

The website screenshots are now generated from the reviewed captures through
`sync-tonal-scenes.mjs`, rather than being unregistered static copies. The
manifest owns their descriptions, dimensions and SHA-256; both canonical and
website copies match. Its source field keeps these E2E scenes during a full
product regeneration. `lastValidatedAgainst` stays null because the actual
capture included a dirty candidate. The shared manifest commit contains only
the two tonal entries. A structural comparison confirmed every previously
staged scene and global field remained unchanged in the main index.

The incremental 11-path marketing plan selected Tier 0, website unit/typecheck
and website E2E, with no Rust or global renderer suite. Its affected run passed
all Tier 0 lanes, then website tests reported 238 passes and one failure:
`performance-settings-dark.png` is referenced by another page but unregistered
by its owner. Tonal entries passed metadata, dimensions, hashes and canonical
copy checks. The standalone screenshot validator additionally reports the
other owner's `debug-workspace-shared-workflows.png` orphan; its emitted
violations are failures even though the script currently exits zero. No
allowlist or baseline was weakened. Astro check passed 164 files with zero
errors/warnings/hints, while the website E2E TypeScript check failed on the
unrelated `navbar.spec.ts` Playwright `focus({preventScroll:true})` option.
The corrected engine TypeScript check also passed. Fail-fast downstream lanes
are not called passes.

The final static builds produced 112 routes and indexed 109 search pages for
both `/` and `/varve`. The planner-selected broader website matrix was run
once with one worker and a five-failure bound, against isolated build outputs
and ports 4369/4370: 84 passed, five failed, 531 did not run after the bound.
The failures are outside the tonal pages: a glued link in `/docs/browser-demo`,
two background-removal screenshot differences, the settings guide's removed
mobile CTA selector, and a navbar Try-button geometry expectation. Their
source files and snapshot baselines were preserved. The runner also reports
its stop-at-maximum-failures error. These results do not certify the whole site.

The updated tonal guide then passed independently on both actual URL bases
(2/2, 5.5s). Its initial route now respects the project's base URL, and the
image assertion requires exactly two loaded illustrations rather than letting
an empty conditional-image loop pass. Latest 390px light/dark top captures
were opened again: heading, paragraphs, links and navigation remain readable
without horizontal overflow. Latest captures replace the corresponding
owned evidence files. Docs, emoji and tokens audits passed again; E2E
TypeScript passed after the final test additions.

The same Curves/Mixer case subsequently passed in the regular master checkout
with the existing `VARVE_DISABLE_HMR=1` option, isolated port 1450 and the
normal application assets (1/1, 48.0s including startup). There were no
outside-serving-root worker/font warnings in that log. This resolves the
failed browser interaction without treating the disposable fallback run as
backend parity evidence. Across the final targeted runs all seven
workflow/demo/export cases passed; they were not one all-green invocation.

### Agent Validation Report

```text
Changed scope: shared RGBA8 tonal/filter contracts and kernels; scene normalization;
  existing editor adjustment/channel/curve/detail surfaces; browser PDF raster helper;
  focused unit/E2E/native-ready specs; tonal architecture/research/performance/release
  docs; website overview/guide and two canonical screenshot scenes.
Validation plan: owned staged indices selected Tier 0, direct tonal tests and affected
  package/reverse-dependent closures for code; final delivery selected three exact
  browser specs, website unit/typecheck and website E2E. Incremental screenshot/site
  plan selected Tier 0 and website lanes only. Full visual and Rust were deliberately
  unrelated to that final marketing-only slice. The schema/API change separately
  justified an attempted full gate.
Commands actually run: see exact command ledger below and earlier milestone commands.
Passed: touched format/lint, normal commit checkpoints, engine TypeScript, E2E
  TypeScript, docs/emoji/tokens/radius audits; 79/79 focused cases in 12 files;
  49/49 PDF/export/curve cases; all seven targeted Chromium workflow/demo/export
  cases across final runs; independent Poppler pixel comparison; two tonal website
  guide cases; Astro check and both 112-route static builds; bounded benchmark runs.
Skipped as unrelated: Rust workspace and global visual suites in the final site-only
  plan; cloud/model-download work, RAW/Kelvin/HDR/print-engine expansions outside
  the specified rendered-image workflow. No affected failure is labelled unrelated
  merely to make a check green.
Escalations: shared closure failures, the new separately owned live-effect cycle,
  unregistered performance screenshot/navbar TypeScript and five broader website
  failures prevent repository/site certification. Affected/full fail-fast lanes
  and 531 stopped website cases remain unexecuted, not passed. Native fresh build
  exhausted disk; physical Duet/pen/Windows/macOS and cold offline PWA remain pending.
Full suite run: yes (verify:full invoked; initial gates failed, complete suite did not run).
If yes, reason: Versioned tonal adjustment schema and cross-package FilterIR integration.
```

Exact delivery commands below were run on master. `GIT_INDEX_FILE` pointed at
owned-path-only indices for staged plans/affected checks and shared-file commits.
Browser runs used the heavy lease, one worker, isolated profiles and the named
ports. Website commands used the bundled Node 24 runtime required by Astro 7.

```bash
pnpm verify:plan --staged
pnpm verify:affected --staged
pnpm exec tsc --noEmit -p packages/engine/tsconfig.json
pnpm typecheck:e2e
pnpm --filter @varve/website typecheck
pnpm exec vitest run apps/website --maxWorkers=1
node scripts/screenshots/sync-tonal-scenes.mjs docs/screenshots/tonal-workflows
node scripts/screenshots/validate.mjs
pnpm audit:docs
pnpm audit:emoji
pnpm audit:tokens
node scripts/audit-architecture.mjs --ci
VARVE_FULL_GATE_REASON='Versioned tonal adjustment schema and cross-package FilterIR integration' pnpm verify:full
```

The exact six-file unit invocation in the sharpening commit hook was:

```bash
pnpm exec vitest run --maxWorkers=1 \
  packages/editor/src/components/Inspector/controls/CurveEditor.test.tsx \
  packages/engine/src/exportPipeline/pipeline.test.ts \
  packages/engine/src/sharpenIntegration.test.ts \
  packages/engine/src/splitToneParity.test.ts \
  packages/engine/src/unsharpMask.test.ts \
  packages/scene/src/tonalPersistence.test.ts
```

The exact final browser failure-resolution command was:

```bash
VARVE_DISABLE_HMR=1 VARVE_E2E_PORT=1450 VARVE_LEASE_TIMEOUT=1800000 \
  node scripts/quality/heavy-lease.mjs 'tonal actual worker curves and mixer with HMR disabled' -- \
  pnpm exec playwright test tests/e2e/effects/tonal-workflows.spec.ts \
  --grep 'retains curve channels' --project=chromium --workers=1 --reporter=list
```

The broader website invocation was
`node scripts/quality/heavy-lease.mjs 'tonal website final dual-host matrix' -- bash /tmp/varve-tonal-website-matrix.sh`.
That temporary runner used the client-env guard, `astro check`, two
`astro build --outDir` commands (root and `SITE_BASE=/varve`), then
`pnpm exec playwright test -c reports/tonal-website/playwright-all.config.ts --workers=1 --max-failures=5`.
The config imported the real website config and changed only output paths,
worker/failure bounds and local server ports/base URLs; it included the
entire 620-case matrix and did not update snapshots.
The focused follow-up was
`node scripts/quality/heavy-lease.mjs 'tonal guide registered captures on both URL bases' -- pnpm exec playwright test -c reports/tonal-website/playwright.config.ts --workers=1`.
Its two projects used the same isolated builds on 4357/4358 and only
`tonal-guide.spec.ts`. Temporary runners, terminal logs and full videos are
local evidence, not durable CI receipts. The committed numerical/raw benchmark
results, screenshots and exported artifacts are linked above.
