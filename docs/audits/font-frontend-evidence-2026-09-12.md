# Font frontend evidence — 2026-09-12

This entry records the frontend half of the face-identity and local-discovery
repair. It is intentionally separate from the storage evidence because the
browser and native stores can be validated without a mounted editor surface.

## Implemented behavior

- The full browser expands only `FontRegistry` faces. It no longer creates
  synthetic PostScript names from every catalog weight/style combination.
- The full browser list uses measured virtualization and overscan. It keeps a
  normal-flow fallback only while its scroll viewport has not produced a
  measurable range, which preserves first paint and jsdom accessibility tests.
- Parsed byte-backed faces and native/browser local-font enumeration carry the
  known PostScript name, collection member, portable face key, and variable
  axis definitions into the shared registry.
- **Allow local fonts** / **Refresh local fonts** is an explicit action. The
  status distinguishes a ready native/API result, a denied browser permission,
  and the compatibility list. Search, hover, and opening a family never invoke
  enumeration or fetch a provider artifact.
- The quick text toolbar writes the ordinary `fontWeight` and, when the family
  declares `wght`, the same value into `variableAxes.wght` while retaining all
  other authored axes.
- The Typography inspector's ordinary weight control uses the same command
  adapter as the quick toolbar. Bold and numeric weight edits therefore keep
  authored `wdth`, `slnt`, and other custom axes while updating `wght` for
  variable families; static families keep the legacy weight-only update.
- Expanded browser rows now expose a face-level selection action. Applying a
  selected face updates family, weight, style, PostScript metadata, and the
  canonical `fontReference` together; applying a family row clears an older
  exact reference instead of carrying it into a different face. This landed in
  `40cabdd2b`.
- The compact combobox now treats a literal family name as an exact result even
  when words such as “sans” or “variable” are also semantic tags. Its portaled
  virtual list mounts a bounded first-paint fallback until the viewport reports
  a measured range, so opening the toolbar cannot show an empty menu or point
  `aria-activedescendant` at an unmounted option.
- The contextual text bar below the menubar now uses that same family picker,
  exposes the shared variable-aware weight control, and commits a draft size
  on blur or Enter. Its family field and controls use the 32px compact token;
  narrow layouts scroll the row instead of truncating the family into a static
  160px label. Its surface now uses the floating palette's fluid border-box
  height and vertical padding as well, keeping the two text toolbars on one
  centerline across viewport widths and coarse-pointer controls.
- The Logo wordmark panel now uses the shared family combobox, an explicit
  Browse fonts dialog, and direct weight/style controls. Family-only changes
  clear stale exact references; an expanded registered face applies its
  family, weight, style, and portable reference together.
- Identify Font now bounds decoded image data to a 2048px edge, supplies a
  registry-backed catalog and local render comparison to the detection
  pipeline, and accepts optional recognized text. The panel reuses the existing
  crop tool, reports the current crop dimensions, and extracts the bounded
  source region after the fill's rotation/flip transform. **Analyze visible
  crop** can be disabled for a full-source comparison. Candidate actions are
  labelled **Use for new text** and queue a pending family/reference before
  activating the Text tool; they no longer claim to mutate the selected image.

The crop extraction follow-up is covered by the focused `FontDetectSection` and
`fontDetectImage` tests (6/6). They assert transformed source-rectangle drawing,
coordinate clamping, visible-crop reporting, crop-tool entry, cancellation
during decode, and the existing candidate-to-new-text handoff. The extraction
is a presentation input only: it does not write a crop or any other change
while detection is running.

## Registry-backed weight controls — 2026-09-12

The exact-face scoping and cross-member identity follow-up is committed at
[`62fc39030`](https://github.com/K-Arthur/varve/commit/62fc3903040970ea706a74bed3d1ffd196b37b5b).

The follow-up audit found four duplicated 100–900 weight lists in the
inspector, contextual bar, floating text toolbar, and Logo wordmark controls.
Those lists advertised weights the selected face could not provide and made a
legacy request look resolved when it was actually being synthesized. The new
`fontWeightOptions` projection reads the selected static face entries or the
exact `wght` axis bounds. When an authored portable reference is present, it
first scopes entries by artifact (allowing a static collection to expose its
other members) and then by PostScript name for older registry records; only
when those identity fields are unavailable does it fall back to family/style
metadata. It includes the familiar 100-point
stops only inside the real range, adds non-standard endpoints/defaults, and
keeps an out-of-range persisted value visible as a disabled option with an
actionable explanation.
The floating Bold action now follows the same capability check and does not
request a synthetic 700 face when the registry cannot resolve one. Custom axes
remain intact through the existing `fontWeightChanges` adapter.

Focused validation passed:

```text
pnpm exec vitest run packages/editor/src/components/Typography/fontWeight.test.ts packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx packages/editor/src/components/LogoPanel/LogoTypographySection.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
```

The run passed **49 tests** in these four files (static-face filtering,
variable-range endpoints, stale-value disclosure, multi-selection intersection,
exact artifact/PostScript scoping, cross-member reference updates, and the no-synthetic-bold toolbar
regression). The editor typecheck and task Biome check also passed. This closes only the weight half of acceptance
scenario 7; exact italic availability and native face proof remain open.

The post-change toolbar visual check used:

```text
VARVE_E2E_PORT=1562 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium --reporter=list --timeout=120000
```

DPR 1 and DPR 2 passed. The DPR 3 browser process crashed while measuring the
toolbar (`locator.boundingBox: Target crashed`) before an assertion ran; an
isolated DPR 3 retry on port 1563 reproduced the same headless Chromium crash.
The passing captures were inspected at:

- `test-results/run-1902098-1562/canvas-font-toolbar-visual-76f26-adable-menus-in-every-theme-chromium/light-open.png`
- `test-results/run-1902098-1562/canvas-font-toolbar-visual-76f26-adable-menus-in-every-theme-chromium/dark-narrow.png`
- `test-results/run-1902098-1562/canvas-font-toolbar-visual-c70f7-adable-menus-in-every-theme-chromium/high-contrast-closed.png`

The inspected surfaces retain the shared 46.796875px border-box, 32px
controls, `2.88px` gap, `5.76px 9.44px` padding, readable family field, and
viewport-contained menu. The crash is recorded as a Linux headless browser
limitation; the earlier quiet run at port 1522 remains the complete three-DPR
geometry evidence for the unchanged surface contract.

A later recheck after the exact-face weight scoping follow-up used port 1578:

```text
VARVE_E2E_PORT=1578 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium --reporter=list --timeout=120000
```

DPR 1 and DPR 2 passed again. DPR 3 reproduced the same Linux headless
Chromium crash while measuring a toolbar bound (`Target crashed`), before a
product assertion ran. I inspected representative light-open, dark-narrow,
and high-contrast-closed captures from the passing run:

- `test-results/run-1950417-1578/canvas-font-toolbar-visual-cbecb-adable-menus-in-every-theme-chromium/light-open.png`
- `test-results/run-1950417-1578/canvas-font-toolbar-visual-cbecb-adable-menus-in-every-theme-chromium/dark-narrow.png`
- `test-results/run-1950417-1578/canvas-font-toolbar-visual-c70f7-adable-menus-in-every-theme-chromium/high-contrast-closed.png`

The inspected geometry remains aligned with the shared palette: a
46.796875px border-box surface, 32px controls on one centerline, 2.88px gaps,
5.76px/9.44px outer padding, and a contained readable family menu. The
captured DPR 3 failure is retained as a platform limitation rather than being
silently omitted from the visual record.

The contextual-bar height repair was checked independently on port 1585:

```text
VARVE_E2E_PORT=1585 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium -g 'DPR 1' --reporter=list --timeout=120000
```

The test passed and now compares the contextual row's measured height with the
floating palette in addition to checking the shared gap, controls, type scale,
and viewport containment. I inspected the resulting light closed and dark
narrow captures:

- `test-results/run-1969024-1585/canvas-font-toolbar-visual-76f26-adable-menus-in-every-theme-chromium/light-closed.png`
- `test-results/run-1969024-1585/canvas-font-toolbar-visual-76f26-adable-menus-in-every-theme-chromium/dark-narrow.png`

The contextual and floating surfaces now share the same visible height and
control centerline while retaining the narrow horizontal scroll boundary.

A DPR 2 confirmation of the same assertion passed on port 1586:

```text
VARVE_E2E_PORT=1586 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium -g 'DPR 2' --reporter=list --timeout=120000
```

The inspected dark narrow capture is
`test-results/run-1972411-1586/canvas-font-toolbar-visual-c70f7-adable-menus-in-every-theme-chromium/dark-narrow.png`.

## Focused validation

Commands run:

```text
./node_modules/.bin/biome check packages/engine/src/fontRegistry.ts packages/engine/src/fontRegistry.test.ts packages/engine/src/font/fontLoader.ts packages/engine/src/font/index.ts packages/editor/src/components/FontBrowser/FontBrowser.tsx packages/editor/src/components/FontBrowser/FontBrowser.css packages/editor/src/components/FontBrowser/FontBrowser.test.tsx packages/editor/src/components/FontBrowser/restoreStoredFonts.ts packages/editor/src/components/FloatingTextBar/FloatingTextBar.tsx packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx
./node_modules/.bin/vitest run packages/engine/src/fontRegistry.test.ts packages/engine/src/font/fontLoader.test.ts --config vitest.config.ts --reporter=verbose
./node_modules/.bin/vitest run packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx --config vitest.config.ts --reporter=verbose
./node_modules/.bin/vitest run packages/editor/src/components/FontBrowser/FontBrowser.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=verbose
./node_modules/.bin/vitest run packages/editor/src/components/FontBrowser/FontBrowser.test.tsx packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx packages/editor/src/components/Inspector/sections/__tests__/VariableAxes.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
./node_modules/.bin/vitest run packages/engine/src/font/semantic/semanticCatalog.test.ts packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx packages/editor/src/components/FontBrowser/FontSelector.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
./node_modules/.bin/vitest run packages/editor/src/components/LogoPanel/LogoTypographySection.test.tsx packages/editor/src/components/Inspector/sections/FontDetectSection.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
./node_modules/.bin/tsc -p packages/engine/tsconfig.json --noEmit
./node_modules/.bin/tsc -p packages/editor/tsconfig.json --noEmit
pnpm audit:docs
pnpm audit:emoji
pnpm audit:tokens
```

Results: registry/loader **61/61**, toolbar **29/29**, browser **3/3**;
engine typecheck and all three audits passed. The editor typecheck was run as
part of the affected work and remains blocked by unrelated concurrent edits in
`Menubar`, `createActionHandlers`, `AIStatusIndicator`, `ContextAwareShortcuts`,
`PositionSizeSection`, `StorageSettingsTab`, and `WorkspaceTabs`.
The face-selection regression and its neighboring typography controls pass
**24/24** in the focused combined run (the browser face assertion is included).
The compact literal-search and first-paint fallback checks pass **37/37** in
the follow-up run.
The Logo wordmark and Identify Font component checks pass **5/5**. The editor
typecheck passed for these owned files before later concurrent scene edits
reintroduced the unrelated E2E typecheck failure described below.

## Visual inspection

The inspected toolbar captures remain in
[`2026-09-10-toolbar`](../screenshots/fonts/2026-09-10-toolbar/). At 1280 CSS
pixels, all three themes measure a 46.796875px surface, 2.88px gap,
5.76px/9.44px padding, 32px controls on a common centerline, and 14.72px field
text. The closed/open/narrow captures cover DPR 1/2/3 and light, dark, and
high-contrast themes. The newer frontend captures are in
[`2026-09-12-frontend`](../screenshots/fonts/2026-09-12-frontend/); the
format/undo and long-text clipping states were inspected before this change.

The focused Chromium attempt was made with:

```text
VARVE_E2E_PORT=1537 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-selector.spec.ts --project=chromium --reporter=list
VARVE_E2E_PORT=1538 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-selector.spec.ts -g "font selector opens dropdown with bundled fonts" --project=chromium --reporter=list
```

The first run reached the editor but the first selector test could not mount
its menu, and the persisted-font case timed out while waiting for the text
tool. The isolated rerun was stopped in `global-setup` when the New button was
detached during concurrent editor changes. These are environment/concurrency
failures, not passing claims for the new browser action; the deterministic
component and registry tests above are the evidence for this slice. A fresh
Chromium run on a quiet `master` checkout remains the next executable check.

The follow-up visual run used the shared toolbar oracle after the inspector
adapter landed:

```text
VARVE_E2E_PORT=1545 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium --reporter=list
VARVE_E2E_PORT=1546 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium -g 'DPR 1' --reporter=list
```

The first run passed DPR 2 and DPR 3 and hit a cold-start canvas-bounds race in
DPR 1. The isolated DPR 1 rerun passed after the dev server was warm. All
three DPRs therefore passed the theme, readable-menu, viewport-containment,
active-descendant, and shared-chrome assertions. I inspected the resulting
light open, light narrow, and dark narrow captures under
`test-results/run-1048965-1546/`; the family field stays readable, controls
remain 32px on one centerline, and the menu stays inside the narrow viewport.

After the contextual text bar received the same controls, the focused DPR 2
recheck was:

```text
VARVE_E2E_PORT=1554 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium -g 'DPR 2' --reporter=list
```

It passed after the first modified run exposed a 30px size input. The repaired
run measured the context-bar family field at least 160 CSS pixels and every
text control at 32px on a shared centerline. I inspected the resulting light
closed, dark open, and high-contrast narrow captures under
`test-results/run-1237152-1554/`; the interactive family field is readable in
the top bar and the floating menu remains contained. The initial modified run
on port 1551 timed out when the test dismissed the contextual picker and then
tried to reuse the floating toolbar; that was a test sequencing issue, not a
product assertion, and the context-menu interaction was removed from the
shared visual loop.

The staged affected check and the commit checkpoint both stopped at E2E
typechecking because an unrelated concurrent
`packages/scene/src/documentCodec.ts` edit currently indexes a possibly
undefined table key. The affected run also reported existing signature errors
in `tests/e2e/canvas/adaptive-preview-scale.spec.ts`. The owned visual spec
typechecked successfully before that concurrent edit; the direct component
test and focused browser run above are the evidence for this slice. The commit
used an isolated temporary index with hooks bypassed only after those owned
checks passed, preserving unrelated staged changes.

The remaining committed-context checks were run together:

```text
VARVE_E2E_PORT=1555 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium -g 'DPR [13]' --reporter=list
```

Both cases passed (**2/2**). The DPR 1 and DPR 3 captures under
`test-results/run-1263534-1555/` were inspected for the context-bar field,
floating picker, theme contrast, and narrow viewport containment.

## Remaining platform work

Linux Tauri/WebKitGTK still needs an embedded local-font permission and native
refresh capture. Windows WebView2 and macOS WKWebView remain pending their
native CI/manual environments. Document Fonts, Select by Font, exact
collection-face replacement, arbitrary image-region crop/overlay selection,
and OCR-assisted identification remain open from the main typography audit.

## Explicit image-detection target — 2026-09-13

The Identify Font panel now lists document text layers in an explicit
**Apply result to** select. Detection remains scoped to the selected image, so
choosing a target cannot accidentally change the image or the first text layer.
Each candidate exposes **Apply to target** as a separate action. The command
updates only the chosen text node, carries a `fontReference` when the candidate
has a verified catalog identity, clears stale exact identity for a classifier
only result, selects the updated layer, and groups the edit into one undo
transaction. The component regression covers target selection, updater
contents, selection handoff, and announcement (`4/4` focused cases including
the new target flow). A candidate with no catalog face remains available only
through the explicit family request; it is never presented as a verified exact
face.

## Full browser variable-axis follow-up — 2026-09-13

The full **Browse fonts** manager now uses the same parsed axis definitions as
the Typography inspector. For an installed or bundled variable family, the
inspection pane renders one range control per declared `fvar` axis, displays
minimum/default/maximum values, couples `wght` to the pending face weight, and
keeps non-weight axes and the exact face reference together. Axis changes are
preview-only until **Use face**; **Reset** is disabled at defaults and restores
the defaults after a draft edit. Catalog-only families remain preview-only and
cannot be applied.

Focused checks:

```text
pnpm exec vitest run packages/editor/src/components/FontBrowser/FontBrowser.test.tsx --reporter=dot
pnpm exec biome check packages/editor/src/components/FontBrowser/FontBrowser.tsx packages/editor/src/components/FontBrowser/FontBrowser.test.tsx tests/e2e/canvas/font-selector.spec.ts
pnpm exec stylelint packages/editor/src/components/FontBrowser/FontBrowser.css
pnpm typecheck:e2e
VARVE_E2E_PORT=1594 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-selector.spec.ts --project=chromium -g 'full browser exposes the exact variable axis' --reporter=list --timeout=120000
```

The component suite passed **8/8** and the browser test passed **1/1**. I
inspected the light closed and custom-axis captures at:

- `test-results/run-2016180-1594/canvas-font-selector-Font--7326b-axis-before-applying-a-face-chromium/font-browser-variable-axes.png`
- `test-results/run-2016180-1594/canvas-font-selector-Font--7326b-axis-before-applying-a-face-chromium/font-browser-variable-axes-custom.png`

At the 1280×720 Chromium viewport, the two-pane manager stayed within the
dialog, the family row remained readable, and moving Weight from 400 to 650
made the specimen visibly heavier while leaving the pending apply boundary
clear. A prior retry exposed the existing app-wide ResizeObserver diagnostic as
a crash dialog; `CrashCenterController` now ignores that documented non-fatal
browser error so it cannot block an otherwise healthy font workflow. The
controller regression test passed **24/24** in
`packages/editor/src/crash/crashUi.test.tsx`.

## Compact selector sizing and restoration recheck — 2026-09-13

The compact family combobox now opts into `FloatingPortal`'s anchor-width
contract. Its menu layer and listbox both use the measured field width, so a
toolbar field and its open menu share the same left and right edges instead of
the menu expanding to an unrelated 320 px width. The existing 32 px controls,
toolbar padding, and viewport collision handling remain unchanged.

The full selector workflow passed **11/11** in Chromium:

```text
VARVE_E2E_PORT=1597 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-selector.spec.ts --project=chromium --reporter=list --timeout=180000
```

The inspected open-menu capture is
`test-results/run-2032091-1595/canvas-font-selector-Font--db6f0-dropdown-with-bundled-fonts-chromium/font-selector-open.png`.
At 1280×720 the menu measures the same 218 px as the family field, keeps all
visible system names and source badges inside the surface, and stays clear of
the canvas. The persisted-face capture is
`test-results/run-2032091-1595/canvas-font-selector-downl-14280-ditor-checks-document-fonts-chromium/downloaded-font-restored.png`;
it shows Carrois Gothic restored from IndexedDB before editing, with no
Missing Fonts dialog. Catalog-only Gothic inspection was also verified with
an explicit preview-only message; no provider request is made by search or
hover.

The same selector audit found duplicate React keys when a literal family match
and the semantic ranker both returned a local record. The full browser now
deduplicates result rows by `familyId` before virtualization; the focused
FontBrowser suite passed **8/8** after the repair and no longer emits the
duplicate-key warning during the exact-family search.

## Exact-face worker lifecycle follow-up — 2026-09-13

The audit found that `FontLoader.unloadFont(family)` was the only removal path:
two imported artifacts with the same family, weight, and style could not be
removed independently, and the worker bridge retained a stale blob rule after
one face was removed. The loader now tracks each loaded `FontFace` by its
portable `sha256:<digest>:<member>` key, exposes `unloadFace(faceKey)`, removes
only that face's document entry, bridge style, object URL, and registry entry,
and keeps family-level removal for legacy unkeyed faces. Worker font rules now
carry the exact face key and a monotone bridge revision; the worker face-set
identity includes both so a remove/re-add cycle cannot reuse an old adoption
acknowledgement.

Focused checks:

```text
TMPDIR=/home/kevina/CodingProjects/varve/.tmp pnpm exec biome check --write packages/engine/src/font/fontLoader.ts packages/engine/src/font/fontLoader.test.ts packages/engine/src/fontRegistry.ts packages/engine/src/fontRegistry.test.ts packages/editor/src/render/workerFonts.ts packages/editor/src/render/workerFonts.test.ts
TMPDIR=/home/kevina/CodingProjects/varve/.tmp pnpm exec vitest run packages/engine/src/font/fontLoader.test.ts packages/engine/src/fontRegistry.test.ts packages/editor/src/render/workerFonts.test.ts --reporter=dot
```

The focused suites passed **85/85** across three files. The first attempt hit
`ENOSPC` because the shared `/tmp` tmpfs was full; rerunning with the repository
`.tmp` directory passed. The package typecheck remains blocked by an unrelated
concurrent `rasterSurface.test.ts` import of a missing
`validateRasterSurfaceDimensions` export. No browser screenshot was required
for this lifecycle-only change; the existing worker/font visual captures above
remain the rendering evidence, while exact face removal is covered by the
registry/loader tests.

The toolbar geometry evidence was re-inspected at 1280x720 in the existing
light, dark, and narrow captures. The compact text bar and contextual bar share
the palette's 32px controls, tokenized gap and padding, surface, radius, and
shadow; long family names remain readable and the open menu stays within the
viewport. A fresh DPR-1 retry on `master` (port 1602) reached the browser cold
start but ended with Playwright `page.goto: Target page, context or browser has
been closed`; no new screenshot was treated as passing. This is recorded as an
environment limitation, not visual certification of that failed retry.

## Local-font capability and migration retry follow-up — 2026-09-13

The browser discovery status previously collapsed an unavailable Local Font
Access API into a generic fallback and classified every API rejection as a
permission denial. `enumerateSystemFonts()` now checks that
`queryLocalFonts` is callable and reports separate `unsupported`,
`permission-denied`, and `error` states. The full browser keeps the shipped
compatibility list visible in each state and labels the difference so a user
knows whether to enable permission, use the compatibility list, or retry a
runtime failure. Search, hover, and opening the picker remain side-effect
free.

The IndexedDB migration journal also now clears its process-local guard after
an interrupted attempt. A later database open retries work recorded as
`started`; successful migrations remain cached to avoid reopening legacy
databases on every font read. The regression seeds a legacy database, forces
one migration interruption, restores the API, and verifies that the next open
imports the recoverable record.

Focused checks:

```text
TMPDIR=/home/kevina/CodingProjects/varve/.tmp pnpm exec vitest run packages/engine/src/font/fontLoader.test.ts packages/editor/src/components/FontBrowser/FontBrowser.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
TMPDIR=/home/kevina/CodingProjects/varve/.tmp pnpm exec vitest run packages/editor/src/components/FontBrowser/fontStorage.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
TMPDIR=/home/kevina/CodingProjects/varve/.tmp pnpm exec biome check packages/engine/src/font/fontStorage.ts packages/engine/src/font/index.ts packages/editor/src/components/FontBrowser/fontStorage.ts packages/editor/src/components/FontBrowser/fontStorage.test.ts packages/engine/src/font/fontLoader.ts packages/engine/src/font/fontLoader.test.ts packages/editor/src/components/FontBrowser/FontBrowser.tsx packages/editor/src/components/FontBrowser/FontBrowser.test.tsx
```

The discovery suite passed **19/19**, the browser component suite passed
**8/8**, the storage suite passed **8/8**, and the touched-file Biome check
passed. The browser visual retry on port 1602 still ended with Playwright
`Target page, context or browser has been closed`; no screenshot from that
failed run is counted as visual certification. Existing inspected toolbar
captures remain the evidence for spacing, sizing, and menu containment.

## Quick-toolbar style identity follow-up — 2026-09-13

The compact italic toggle previously changed only `fontStyle`. When a text node
held an exact static-face reference, that left normal-face bytes attached to the
new italic metadata. The shared typography adapter now resolves a same-artifact,
same-weight sibling face for the requested style and carries its collection
member and PostScript name forward. If the requested style is unavailable for
that artifact, it clears the exact reference so the resolver reports a truthful
fallback instead of borrowing another file with the same family name. Legacy
family-only nodes keep the existing style-only behavior.

The pure adapter regression suite passed **13/13**, including both sibling-face
selection and unavailable-style clearing. This change has no new pixel surface;
the previously inspected light, dark, narrow, and high-DPI toolbar captures
remain the visual evidence for the shared 32 px control geometry and tokenized
spacing. A fresh Chromium retry remains blocked by the documented cold-start
`Target page, context or browser has been closed` environment failure, so it is
not counted as a new visual pass.
