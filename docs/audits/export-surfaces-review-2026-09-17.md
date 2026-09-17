# Export surfaces review — Inspector Export tab + Export dialog (2026-09-17)

Scope: every section and component of the Inspector's **Export tab**
(`PropertiesPanel` export host, `AssetExportControls`, `CodeGenView`,
`SpecPanel.css`) and the **Export dialog** (`ExportDialog`, `BatchJobList`,
`DestinationPicker`, `OutputResolutionPanel`, `PrintSettingsPanel`,
`PreflightFindingsPanel`, `ExportProgressBar`, `ExportResultsList`, their CSS,
and the `ExportLayer` wiring). Text, spacing, semantics, state coverage, and
document correctness were reviewed in the running application.

Prior context: the Inspector tab was reviewed 2026-09-15
(`docs/audits/export-inspector-audit-2026-09-15.md`) and both surfaces were
redesigned 2026-09-16 (`c3e2a03a9`, `3e0b2e0a0`). This session audits the
current state of the redesign and repairs what it left broken.

Evidence: `docs/screenshots/2026-09-17-export-surfaces/` (before/after),
unit suites named under each finding, and the browser runs described below.

## Method

1. Repository safety: read `AGENTS.md` + the active ownership records;
   inspected branch/HEAD/status/worktrees. The shared tree carries 141 dirty
   files from concurrent sessions; this session committed only its owned paths
   (`docs/agents/export-surfaces-review-2026-09-17-ownership.md`).
2. `pnpm verify:plan` at base `4bcaecf6d`: escalated (`FULL-SUITE ESCALATION:
   YES`) because of the shared toolchain-adjacent dirty set — recorded as the
   combined integration checkpoint, inner loop bounded to owned files.
3. Baseline runtime diagnosis on isolated port 14473 with the real editor:
   rectangle documents with real configurations (PNG 1x, PNG 2x, JPEG, SVG),
   light/dark/high-contrast tokens, 240px inspector, 200% root text size,
   760px stacked dialog, the code sub-tab, live preflight, and a full export
   run with real download interception.
4. Fix → unit regressions → browser re-verification → visual capture.

## Findings

Each finding records the demonstrated problem, root cause, repair, and
verification. P0/P1 are correctness/accessibility; P2 consistency/text; P3
polish or recorded deferrals.

### F1 (P0 — correctness) Preflight blocked valid exports with a false "Duplicate output path"

**Evidence (before).** With the standard PNG 1x + PNG 2x pair on one layer,
both the Inspector Export tab and the dialog showed
`Preflight: 1 error` — "Duplicate output path: 2 configurations resolve to the
same path `Rectangle 1.png`" — while the visible job list showed the distinct
files `Rectangle 1.png` and `Rectangle 1@2x.png`
(`before-tab-false-preflight.png`, `before-dialog-confirm-generic.png`). The
export then required an override confirmation to proceed; a real collision is
indistinguishable from a false one.

**Root cause.** `legacyBatchToRequest` (`packages/scene/src/export/adapter.ts`)
mapped each legacy job to a canonical configuration but never carried
`job.suffix`. The plan therefore resolved every same-format job through
`{name}{suffix}.{ext}` with an empty suffix, and
`pushCollisionFindings` compared the resulting identical `relativePath`
values. The dialog's displayed names (`buildJobs` → `formatFileName`) kept the
suffix, which is why the list and the preflight disagreed.

**Fix.** Propagate the suffix with `normalizeSuffix`, matching
`legacyPresetToConfiguration` (the adapter used by every other caller).

**Verified.** Unit: `adapter.test.ts` (suffix propagation, normalization) and
`preflight.test.ts` (distinct suffixes collision-free; identical suffixes
still blocked). Browser: both surfaces render clean preflights for the 1x/2x
pair (`after-tab-preflight-clean.png`, `after-dialog-badges-uppercase.png`).

### F2 (P1 — honesty) The preflight override confirmation described findings that were not present

**Evidence (before).** The confirm dialog read "Preflight found 1 error that
may make the exported file unusable (e.g. missing fonts, out-of-gamut
colors)" while the only finding was a filename collision.

**Fix.** The message names the actual blocking findings (up to three titles,
then "and N more") and states the real consequence: files may be unusable or
overwrite each other.

**Verified.** Unit: "names the actual blocking finding in the preflight
confirmation" asserts the finding title is present and the old generic
example is not. Browser: the standard export path with F1 fixed shows no
confirmation at all for a clean batch.

### F3 (P1 — consistency) The same format had different badge colours in the two surfaces

**Evidence (before).** Measured in the live DOM:

| Format | Inspector preset row | Dialog job row |
|---|---|---|
| PNG | success green | interactive teal |
| SVG | interactive teal | warning amber |
| JPG | warning amber | success green |
| WEBP | undeclared token (`color-interactive-subtle`, unresolved → transparent) | hardcoded `#a855f7`/`#9333ea` |
| PDF | danger red | danger red |

Dialog badges were lowercase (`png`), Inspector badges uppercase (`PNG`).
Status colours (success/warning/danger) were being spent on format identity
while the real status column sat next to them.

**Fix.** One shared `FormatBadge` component + CSS used by both surfaces:
neutral token surface, uppercase label through a single `formatLabel()`
(also used by the dialog's format filter chips). Format stays color-independent
— the text is always visible — and the semantic palettes return to status
meaning only. The hardcoded WebP palette and the unresolved
`--color-interactive-subtle` dependency are gone.

**Verified.** Unit: BatchJobList badge test (`PDF/X-1a`). Browser:
`after-tab-preflight-clean.png`, `after-dialog-badges-uppercase.png`,
`after-tab-dark.png`, `after-dialog-dark.png`.

### F4 (P1 — layout) The dialog's dimensions column clipped its own value

**Evidence (before).** The column was 80px with `text-overflow: ellipsis`;
measured rows rendered `240x150 · 9…` and `280x240 · 1…`, cutting off the PPI
that distinguishes a print-bound output.

**Fix.** Headers now read **File / Format / Dimensions / Size / Status**
("Size" previously sat over pixel dimensions while estimated bytes were
"Est."), the column is 104px, dimensions use the app's `×` convention, and
the PPI sits on its own line inside the same cell. No value is truncated.

**Verified.** Unit: "labels the dimension column and keeps PPI visible beside
it" (text `2480 × 3508 300 PPI`, dedicated `.batch-job-row__ppi`). Browser:
`dimsW === dimsScrollW === 104` for both rows.

### F5 (P1 — workflow) An unconfigured document dead-ended in the dialog

**Evidence (before).** `Ctrl+E` with a selected shape but no saved
configurations showed only "No export jobs to display." — no explanation of
how jobs appear, no route to create one, and a disabled `Export (0)`.

**Fix.** The dialog's empty state explains that each enabled configuration on
a layer adds a file and offers **Open the Export tab**, which closes the
dialog and switches the Inspector to the Export tab
(`ExportLayer` → `editor.setInspectorTab('export')`).

**Verified.** Unit: "explains how jobs appear and offers the Export tab when
nothing is configured". Browser: the action closes the dialog and shows
`#insp-tabpanel-export` (`after-dialog-empty-recovery.png`).

### F6 (P2 — text) Status icons silently failed to render

**Evidence (before).** `BatchJobList` used `name="Loader2"` and
`name="AlertCircle"`, neither of which is a valid `IconName`; `Icon` logs a
warning and renders no glyph, so running/error rows showed only the visually
hidden status word. (Both were also pre-existing typecheck errors.)

**Fix.** `LoaderCircle` (the semantic registry's spinner) and `CircleAlert`.

**Verified.** Typecheck of the file is clean; the row status cell now renders
a real icon in every state.

### F7 (P2 — consistency/text) Mixed case and typography across both surfaces

- "Motion Export" title-cased among sentence-cased section titles → **Motion
  export**.
- `Packaging...` / `Filter files...` ASCII dots vs `Exporting…` / `Choose a
  preset…` ellipses → one ellipsis character.
- "Largest: 280 x 240 px" → `×`.
- `PATH PREVIEW:` (uppercase + letter-spacing) → `Path preview:`, matching
  every other label in the card.
- Byte sizes read `63.3KB` in rows and `~179.3 KB` in the footer, and results
  showed raw MIME (`image/png`). Consolidated into one `formatFileSize`
  (spaced units) and `formatLabel`; the results line now reads
  `PNG · 1.3 KB · 54ms`.
- Preset rows read `PNG PNG` (badge + summary duplicated the format). The
  summary now carries only scale and suffix (`2x · @2x`), with `1x` as the
  explicit default.

**Verified.** Unit: results list and dialog assertions updated; BatchJobList
summary coverage. Browser: `after-results-list.png`, `after-tab-dark.png`.

### F8 (P2 — accessibility) Accessible names did not contain their visible labels

| Control | Visible label | Old accessible name |
|---|---|---|
| Custom resolution | `Custom resolution` | `Temporary raster output resolution in PPI` |
| Bleed | `Bleed (mm)` | `Bleed in millimetres` |
| Image resolution | `Minimum image resolution (PPI)` | `Minimum effective image resolution in DPI` |
| Job filter | placeholder `Filter files...` | `Filter jobs` |
| Workspace entry | `Open export workspace` | `Open advanced export workspace` |

WCAG 2.5.3 requires the visible label text to be part of the accessible name.
The resolution field also mixed PPI/DPI for the same unit.

**Fix.** Accessible names start with the visible label and add the override
semantics as a suffix (e.g. "Bleed (mm) — overrides the document bleed for
this export"). The dialog's print/output-resolution wrappers no longer
duplicate the nested region names, and the print panel's heading level
matches its sibling sections.

**Verified.** Unit suites for each panel; the e2e locator updated.

### F9 (P2 — accessibility) Format filter chips had no pressed state

The Active/`All` state of the dialog's format filters was visual only.
**Fix:** `aria-pressed` on every chip, with coverage asserting the
All → PNG transition.

### F10 (P2 — tokens) Dense-metadata type sizes and the count-badge background

- `.spec-export__preset-badge` used `font-size: 9px` (below the token ladder);
  the whole per-format badge block is replaced by the shared component.
- The preset count badge resolved to a transparent pill because
  `--color-interactive-subtle` is referenced but defined nowhere in the token
  source. Replaced with `--elevation-surface-sunken` + border + secondary
  text; measured `oklch(0.95 0.008 260)` after the fix.
- Six `font-size: 11px` literals in `DestinationPicker.css` → `--font-size-2xs`;
  dangling `--color-interactive-subtle` and `--shadow-sm` fallbacks replaced
  with the tokens themselves.

### F11 (P2 — a11y, verified not repaired) Code sub-tab scroll region

The generated-code region keeps its dedicated tab stop
(`CodeGenView.tsx:117-121`, `tabIndex={0}` on `.spec-codegen__pre`). The F8
fix from the 2026-09-15 audit is intact; an earlier probe had measured the
inner `<pre>` instead of the scroll region.

### Deliberate decisions and recorded deferrals

- **D1 — Neutral format badges over a per-format palette.** A categorical
  hue set would need new token contracts and would still spend semantic hues
  on metadata. Chosen: neutral chips, format always spelled out. Rejected:
  inventing `--color-format-*` tokens; reusing status tokens.
- **D2 — No scrubbing added to numeric export fields.** Unchanged from the
  2026-09-15 decision (bounded values set once per export; native number
  semantics + explicit bounds).
- **D3 — Export tab reachability in the Inspector overflow remains the
  recorded deferral.** Reproduced and quantified on 2026-09-17 at the 1280px
  Playwright viewport: with nothing selected the tablist renders
  `[Design, Export]`; after drawing a frame with the frame tool it renders
  `[Design, Adjustments, Prototype]` with the Export tab moved into "More
  inspector tabs" — i.e. the tab a user wants immediately after creating an
  exportable frame is behind a menu. The overflow order itself is consistent
  (`InspectorTabBar.getOverflowedInspectorTabIds` drops
  `audit`(priority 5) first, then same-priority tabs in reverse declaration
  order). Changing which tab survives is shared workspace-configuration
  policy: more than a dozen e2e suites reach Export *through* the More menu
  today, so a priority change is a cross-owner migration rather than a
  one-line fix. The two specs this session touched were given the same
  More-fallback helper the other suites already use
  (`export-settings.spec.ts`, `export-workspace.spec.ts`), and both now pass
  in full. The policy decision (which tabs stay pinned at which widths, and
  whether Export deserves a retention priority) is left to the
  workspace/Inspector tab owners with this evidence attached.
- **D4 — `--color-interactive-subtle` remains dangling in two other
  surfaces** (`Inspector/sections/effects/effects.css`,
  `UpscaleDialog.css`). Outside this review's ownership; reported so the token
  is either defined or the references replaced by their owners.
- **D5 — DestinationPicker token chips + legend.** The chips (`+{name}`, …)
  and the short legend below them partially duplicate each other; the legend
  explains only three of the five tokens. Readable as-is, but a candidate for
  a single consolidated hint line. Not changed to bound this pass.
- **D6 — The 12×12 "Why SVG?" tooltip trigger.** Below the 24×24 minimum, but
  the WCAG 2.5.8 spacing exception applies (measured 8px gap to the nearest
  target, 26px centre-to-centre, no intersecting circles). Left unchanged.

## Validation

Changed scope: `packages/scene/src/export/{adapter,adapter.test,preflight.test}.ts`,
`packages/editor/src/components/Export/*`, `packages/editor/src/components/SpecPanel/{AssetExportControls.tsx,SpecPanel.css,AssetExportControls.test.tsx}`,
`packages/editor/src/components/Shell/ExportLayer.tsx`,
`tests/e2e/spec/{export-settings,export-workspace}.spec.ts`,
`apps/website/src/pages/docs/tools/export.astro`, this report + evidence.

Commands actually run:

```bash
pnpm verify:plan                                   # escalated (shared dirty tree; recorded)
npx vitest run packages/scene/src/export/adapter.test.ts packages/scene/src/export/preflight.test.ts
npx vitest run packages/editor/src/components/Export packages/editor/src/components/SpecPanel packages/scene/src/export
pnpm --filter @varve/scene typecheck               # errors only from other sessions' dirty files, none in export/owned paths
pnpm --filter @varve/editor typecheck              # 41 pre-existing errors in other sessions' files; zero in owned paths
VARVE_E2E_PORT=14481 VARVE_E2E_WORKERS=1 TMPDIR=/var/tmp/varve-tmp \
  npx playwright test tests/e2e/spec/export-settings.spec.ts tests/e2e/spec/export-workspace.spec.ts \
  --project=chromium --reporter=list               # 8 passed (1.4m + 1.9m across two runs)
node .tmp-export-after.mjs                         # isolated-port browser re-verification (port 14473)
```

Passed: scene export 36; editor Export + SpecPanel + scene export 368 across
29 files; the two changed e2e specs 8/8 in Chromium; browser re-verification
of F1–F7 with the before/after measurements recorded above.

Skipped as unrelated: the full repository gate (`FULL-SUITE ESCALATION`
belongs to the combined integration checkpoint), the remaining e2e suites,
Cargo suites, native desktop runs. Pre-existing typecheck errors in other
sessions' files (`snapping.ts`, `layoutVariants.ts`, `workspaceStore.ts`,
`EyedropperTool.test.ts`, `SelectTool.test.ts`, `export-matte.test.ts`) are
unrelated to this change and were not repaired here.

Unverified lanes (not passed): real touch/pen hardware, screen readers,
native desktop (Tauri) dialog runs, and physical low-end/Chromebook devices.
The dark-theme and enlarged-text checks were run in Chromium; WebKitGTK was
not exercised.
