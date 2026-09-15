# Export tab (Inspector) — diagnosis, repair, and verification (2026-09-15)

Scope: every section and component of the Inspector's **Export tab** —
`PropertiesPanel`'s export panel (Format/Code sub-tabs, empty states,
selection routing), `SpecPanel/AssetExportControls.tsx` (Quick export and
Export configurations), `SpecPanel/CodeGenView.tsx`, the `SpecPanel/export.ts`
helpers those surfaces call, and their styles in `SpecPanel.css`.

Adjacent surfaces were inspected but deliberately not modified:
`ExportDialog.tsx` (advanced batch workspace) carries uncommitted work from
another session; its command contract is consumed read-only.

Evidence: `docs/screenshots/2026-09-15-export-inspector/` (before/after),
`tests/e2e/inspector/export-tab.spec.ts` (real-world browser assertions on a
committed 1920×1280 CC0 photo fixture, not a synthetic rect), and the unit
suites named under each finding.

## Method

1. Repository safety: read `AGENTS.md` and the concurrent ownership notes
   (`docs/agents/layers-panel-2026-09-15-ownership.md`), inspected `git status`
   (120 modified files across several sessions), and committed only this
   review's paths.
2. Research gate (below).
3. Runtime diagnosis on an isolated port (`VARVE_E2E_PORT=1437`) driving the
   real editor: a real photo document (imported photo + drawn shape), dark and
   high-contrast themes, 240px minimum inspector width, 200% text-size
   preference, real download bytes parsed for PNG dimensions, and real
   clipboard contents.
4. Fix → unit tests → browser regression specs → visual re-capture.

## Research gate — what other products get wrong

Sources consulted 2026-09-15; see "References" for URLs.

| Finding from real user reports | Applicability to this tab |
| --- | --- |
| Figma forum: suffix retained when the export format changes, producing files like `NAME@2.svg`; replies call it "incorrect file naming" (2024). | The tab derives suffixes from scale and drops them for unscaled formats; verified by unit tests. Remaining risk was naming, not suffix logic (see F3). |
| Figma forum: export settings not remembered per object; users re-pick format/scale dozens of times a day. | Varve persists per-node configurations and keeps the current node's choice stable; the advisor re-suggests only when the selected object changes. Verified as an intended behavior, not re-worked. |
| Figma forum: `2x` and `1x` quick exports collide in the download folder because the file name does not encode scale. | Reproduced here: quick export wrote the same filename for every scale (F3). |
| Figma forum: `@2x` survives a format switch, so a 2x PNG became a "2x" SVG (`NAME@2.svg`). | Inspected; the add-configuration path computes the suffix from the format, and unscaled formats never carry `@Nx`. Covered by F3's naming contract. |
| Illustrator/Blender/MuseScore bug trackers: export silently overwrites or silently fails, no overwrite warning, no success feedback. | Desktop `saveBinaryFile` cancellation was reported as success (F4); browser downloads show success/failure messages. Overwrite prompting is owned by the native save dialog and is unchanged. |
| Multiple projects (open-design, rackarr, Live2D): export preview/errors swallowed, success not confirmed. | The tab already reports success/failure/warnings inline and in an `aria-live` region; F5 fixed the remaining stale-message case. |
| Blender: export dialogs with no overwrite prompt near identically-named import entries. | Native save dialog owns overwrite; the tab distinguishes "Export" (desktop, writes to disk) from "Download" (browser) in the primary action label. |
| WCAG 2.2 SC 2.5.8: 24×24 CSS px minimum target with a spacing exception. | Two preset-row controls measured below the minimum (F6). |
| WCAG 2.2 SC 1.4.13: hover/focus content must be dismissible, hoverable, persistent. | The shared `Tooltip` already implements all three (Escape handler at `Tooltip.tsx:384`); not re-worked. |
| WAI guidance: scrollable regions need keyboard access. | The generated-code block scrolls but was not focusable (F7). |

Explicitly not adopted: the claim that a specific pixel row height or font size
is required; the tab's compact fine-pointer density is retained, with targets
raised only where the measurement showed a failure.

## Verification

Reproduce with:

```bash
# Unit
pnpm vitest run packages/scene/src/export/naming.test.ts \
  packages/editor/src/components/SpecPanel/export.test.ts \
  packages/editor/src/components/SpecPanel/AssetExportControls.test.tsx \
  packages/editor/src/components/SpecPanel/AssetExportControls.desktop.test.tsx \
  packages/editor/src/intelligence/exportAdvisor.test.ts \
  packages/editor/src/components/Inspector/PropertiesPanel.test.tsx

# Real-world browser suite (photo fixture; full notes below)
TMPDIR=/var/tmp/varve-tmp npx playwright test tests/e2e/inspector/export-tab.spec.ts \
  --config=playwright.export-inspector.local.config.ts --reporter=list
```

The browser suite drives a real document — the committed 1920×1280 CC0
architecture photo imported through the file input, plus drawn and
effect-bearing vector layers — at the 240px minimum inspector width, in dark
theme, and with a 200% root text size. It parses the actual PNG bytes of a
download (IHDR width/height), compares clipboard markup against the saved SVG
byte-for-byte, and asserts the disabled/enabled state of the primary action
for invalid scale drafts.

**Results (2026-09-15).** All nine browser scenarios pass; each was re-run as a
single invocation because the shared machine (several concurrent agent suites,
a 12 GB `/tmp` tmpfs at capacity, and other sessions' in-flight edits to
`packages/engine` and the Inspector controls) repeatedly crashed browser pages
or broke the dev server mid-run. Scenarios: advised format + real PNG@2x bytes,
multi-selection notice, scale bounds, suffix undo, 240px reachability,
stale-message clearing, keyboard-scrollable code, SVG copy/save parity with a
raster fallback, and 200% text operability. Unit suites: naming 32, spec-panel
export 30, controls 29, desktop-save feedback 3, export advisor 6; the
Inspector/component regression batch measured 342 passing tests across 22
files. The commit checkpoint's direct-unit stage passed for both source
commits. Full browser matrices and native desktop runs are deferred to the
integration/candidate CI lane, as the repository's validation policy states.

Finding → verification map: F1 browser + unit; F2 browser (filename + bytes) +
unit; F3 browser + unit; F4 unit (desktop save contract); F5 browser
(clipboard vs saved bytes) + unit; F6 browser (one undo) + unit; F7 reviewed in
the captured screenshots (24×24 rules); F8 browser (tab stop + focus); F9
browser (240px + 200% overflow measurements) with before/after screenshots;
F10 browser; F11 reviewed in the captured screenshots; F12 browser (advised
format) + unit.

`playwright.export-inspector.local.config.ts` is an untracked local
verification config; it differs from the root config only by dropping
Playwright's default `--disable-dev-shm-usage` (which moves Chromium's shared
memory into the 12 GB `/tmp` tmpfs that concurrent sessions had filled,
aborting the font data service and crashing pages).

## Findings

Findings are numbered F1… Each records evidence, root cause, fix, and
verification. "Before" evidence is the pre-fix behavior reproduced in the real
editor; "after" evidence is the passing assertion or measurement.


### F1 (P0 — honesty) Multi-selection exported one object silently

**Evidence (before).** With a photo and a drawn shape selected (Layers shows 2
rows, the context bar reads "Multi"), the Export tab rendered the ordinary
quick-export controls and exported only `selNodes[0]` — no notice of any kind.
Reproduction: `tests/e2e/inspector/export-tab.spec.ts` →
"multi-selection: the tab states which object will be exported".

**Root cause.** `PropertiesPanel` passes `selNodes[0]` to
`AssetExportControls`; nothing in the tab expressed that the rest of the
selection is ignored.

**Fix.** `AssetExportControls` accepts `selectedCount`; when it is greater than
one, an accessible note names the object that will be exported ("This tab
exports one object at a time — only *X* will export. N layers are selected.")
and offers a button that opens the batch workspace.

**Verified.** Unit: "names the exported object and offers the batch workspace
for multi-selection" / "does not claim a batch when only one layer is
selected". E2E: the note is visible with a real two-layer selection.

### F2 (P1 — correctness) Quick-export filenames diverged from the canonical naming engine

**Evidence (before).** `buildFilename` was a local sanitizer
(`replace(/[^a-zA-Z0-9-_\s]/g, '')`) while saved configurations used
`formatFileName` from `@varve/scene/export`. The same imported photo produced
`real-life-architecturejpg.png` from Quick export and
`real-life-architecture.jpg@2x.png` from a saved configuration. Unicode names
collapsed (`Café menü` → `Caf men.png`), Windows reserved device names were
passed through (`CON.png`), and the quick path had no scale marker at all, so a
1x and a 2x download of the same object were named identically.

**Root cause.** Two naming implementations; only one was canonical.

**Fix.** `buildFilename` now composes `stripSourceExtension(name) + suffix` and
delegates to `sanitizeFileName(name, ext, { keepDots: true })`. A new
`stripSourceExtension` in the canonical naming module drops a trailing
source-asset extension from the `{name}` filename token, which also repairs
the saved-configuration preview and the batch dialog (they share
`formatFileName`).

**Verified.** `naming.test.ts` (32), `export.test.ts` buildFilename cases (5),
E2E asserts `real-life-architecture@2x.png` for both the quick download and
the configuration preview, with real PNG bytes at 3840×2560.

### F3 (P1 — correctness) Custom scale accepted out-of-range and non-finite values

**Evidence (before).** The field declared `min=0.1 max=10` but no code
enforced them: `999999` (and, in engines that keep the exponent, `1e999` →
`Infinity`) left the primary action enabled and reached the rasterizer, where
the outcome was an error or a large fitted export rather than a statement of
the bound. Zero and negative drafts disabled the button with no explanation.

**Root cause.** `effectiveScale = customScale ? Number.parseFloat(customScale) : scale`
— parse only, no validation, no message.

**Fix.** `validateCustomScale` rejects non-finite, zero, negative, and
out-of-range drafts with the specific bound, marks the input `aria-invalid`,
links the explanation through `aria-describedby`, and disables the primary
action. In-range values only are handed to the export path.

**Verified.** Unit: "rejects out-of-range custom scales and explains the
bound". E2E (Chromium): `-5`, `0`, `999999` disabled with the exact bound in
the message; `2.5` enabled with no error; a retained `1e999` value is never
exportable.

### F4 (P1 — honesty, desktop) A cancelled native save reported success

**Evidence (before).** `handleExport` ignored the return value of
`platform.saveBinaryFile` for SVG and raster exports; cancelling the desktop
save dialog still produced "Exported X as SVG" / "Exported X as PNG at 2x". The
PDF branch already handled cancellation, which made the inconsistency visible
in one file.

**Root cause.** Three sibling branches; only one checked the save result.

**Fix.** SVG and raster branches check the saved path and report "Export
cancelled" when the dialog was dismissed.

**Verified.** `AssetExportControls.desktop.test.tsx` — cancelled raster save,
completed raster save (with the `Logo@2x.png` filename and scale in the
message), cancelled SVG save. E2E covers the browser verb ("Downloaded …").

### F5 (P1 — correctness) SVG copy could silently omit what the saved SVG contained

**Evidence (before).** The save path composed raster fallbacks
(`composeFlattenedRasterAssetsForNode`) before calling `exportNodeToSvg`; the
copy button called `exportNodeToSvg(node, doc)` directly. For any node whose
SVG representation depends on a raster fallback (layer effects, composite
gradients, mockups, adjustments) the copied markup omitted the rendered
content while the downloaded file kept it.

**Root cause.** Two call sites, two different asset sets.

**Fix.** One builder — `exportNodeToSvgMarkup(node, doc, engine)` — is used by
both the save branch and the copy value. The copy button is disabled while the
markup is being prepared.

**Verified.** E2E: the clipboard text is byte-identical to the saved `.svg`
for an effects-bearing object (raster fallback present in both).

### F6 (P1 — history) Suffix typing wrote the document per keystroke

**Evidence (before).** The suffix `onChange` called `onUpdatePreset` →
`updateDoc` outside any transaction: the dev console logged
`[history] updateDoc called outside transaction — this mutation bypasses
persistent history capture`, and each character became its own undo entry.
Adding a bundle created one undo entry per member preset.

**Root cause.** The document was used as the text field's draft state.

**Fix.** `PresetRow` keeps a local suffix draft and commits on blur or Enter
(Escape reverts). Add / update / remove / bundle-add run through
`groupCompoundOperation` in `PropertiesPanel`, so each user action is one
labeled transaction.

**Verified.** Unit: commit-on-blur (one call), Escape reverts (no call),
bundle through the grouped callback (one call for three presets). E2E: typing
`-display`, leaving the field, and pressing Ctrl+Z once restores `@2x`.

### F7 (P2 — accessibility) Preset-row targets below the 24×24 minimum

**Evidence (before).** Measured in the live DOM: the remove button was
22×22 CSS px and the checkbox label around a 13px native checkbox. WCAG 2.2 SC
2.5.8 (AA) requires 24×24 or compliant spacing.

**Fix.** `.spec-export__preset-remove` 24×24; the checkbox label carries a
24×24 minimum activation area; the suffix field keeps a 24px minimum height
inside the dense row.

**Verified.** CSS rules added; screenshots at default and narrow widths.

### F8 (P2 — accessibility) The generated-code block could not be scrolled from the keyboard

**Evidence (before).** `.spec-codegen__pre` is `max-height: 300px;
overflow: auto` with an explicit `:focus-visible` style, but the section had no
tab stop — the focus ring was unreachable and only a pointer could scroll the
code.

**Fix.** `tabIndex={0}` on the scroll region (with a lint justification; the
accessible name already exists).

**Verified.** E2E: the region has `tabindex="0"` and takes focus.

### F9 (P2 — layout/accessibility) The format row clipped at the 240px column and at enlarged text

**Evidence (before).** At the documented minimum inspector width (240px) the
segmented groups (`.spec-export__group` with `overflow: hidden`) ran past the
panel edge; the trailing buttons were partially unreachable. The problem
worsens with a text-size preference.

**Fix.** A container query on the existing `inspector` container stacks the
label above its control below 22rem and lets the segmented group wrap within
its border, so every option stays visible and clickable. Verified programmatic
at 240px: every format button's right edge is inside the group.

**Verified.** E2E "narrow inspector (240px min) keeps every quick-format
control reachable" and "200% text-size preference keeps export controls
operable" (mechanism: root `font-size: 200%`, reported as a simulation of a
user text-size preference, not as browser zoom).

### F10 (P2 — feedback) Stale export message survived a selection change

**Evidence (before).** "Exported Logo as PNG at 2x" remained under the
controls after selecting a different object, appearing to describe the new
object.

**Fix.** The node-change effect clears the message.

**Verified.** E2E "stale export message clears when the selected object
changes".

### F11 (P3 — tokens) Hardcoded type values in the export rows

`11px` literals in `.spec-export__preset-file`, `.spec-export__preset-suffix`,
and `.spec-export__preset-unavailable` replaced with `--font-size-2xs`, the
existing dense-metadata token.

### F12 (P1 — correctness) The advised default for an imported photo was SVG

**Evidence (before).** Discovered by the new browser suite: after importing the
1920×1280 JPEG photo, the Export tab preselected **SVG**, with the accessible
reason "Vector path exports losslessly as SVG", and hid the raster Scale row.
The E2E assertion on the advised format failed against the pre-fix advisor, and
two other scenarios could not run at all because the scale controls were
absent.

**Root cause.** `suggestExportFormat` classified image fills with
`/\.jpe?g$/i.test(src)` and `src.endsWith('.png')`. Imported artwork stores a
data URL (`data:image/jpeg;base64,…`, see
`packages/editor/src/import/mergeImportedResources.ts`), so neither check
matched; the node's `rect` shape then matched the vector branch.

**Fix.** `nodeHasImageSource` now classifies both data URLs (mime from the
data-URL header) and file paths, and exposes `isRaster`. A placed raster never
takes the vector branch: JPEG sources keep JPEG, PNG sources keep PNG, SVG
sources keep SVG, and an unknown raster container defaults to PNG (or JPEG when
the placed size is large) with no false "vector" reason.

**Verified.** `packages/editor/src/intelligence/exportAdvisor.test.ts` (6
cases) plus the browser suite's advised-format assertion (JPEG for the imported
photo).

## Deliberate decisions and remaining work

- **D1 — Format/Scale remain `aria-pressed` toggle rows.** They are the
  Inspector's only single-select controls not using the shared
  `SegmentedControl` (APG radiogroup). Migration is deferred: that component
  is being extended with disabled/tooltip support in another session, and a
  role change touches several export specs at once. Tracked as remaining work,
  not silently ignored.
- **D2 — No scrubbing added to the custom scale field.** Section 6B
  applicability: numeric editing applies; drag-scrubbing does not add value to
  a bounded multiplier that is set once per export. The field keeps native
  number semantics with explicit bounds and validation.
- **D3 — Export tab in the Inspector overflow menu.** With an image selected at
  1280px, the contextual Adjustments tab can push Export behind the
  Inspector's "More" menu (`docs/screenshots/2026-09-15-export-inspector/`).
  Tab overflow policy is shared workspace configuration; recorded here rather
  than changed in this pass.
- **D4 — Terminology.** "Configuration", "export setting", and "preset" all
  appear in the tab. Harmonizing the copy is deferred to avoid churn across
  concurrent sessions; the three refer to one concept (a saved per-node output).
- **D5 — Preflight detail.** The tab lists preflight finding titles only; the
  advanced workspace shows the full findings. Expanding them inline is
  remaining work.
- **D6 — Compact drawer.** The mobile/tablet inspector drawer presentation was
  not exercised in this pass; the container query is scoped to the panel, so
  the behavior there follows the same rules but is unverified.
- **D7 — Engine selection for quick export.** `AssetExportControls` creates a
  stub engine when the live editor does not pass one, while the other export
  surfaces (`ExportLayer` copy/export SVG, logo packaging, mockup capture) use
  `createEngine('auto')` so the native IR builder is preferred on desktop.
  This pass did not change the engine choice: verifying native/TS IR parity
  for every node kind is its own workstream, and the browser export path
  (exercised here end to end) is the stub/WASM side of that comparison.

