# Disclosure / Accordion review — audit and verification (2026-09-15)

Task: review every disclosure/accordion/collapsible surface across the desktop
editor and the marketing website, repair real defects, validate with rendered
scenarios, and record what remains. Research ledger:
`docs/research/disclosure-review-2026-09-15.md`. Canonical contract:
`docs/architecture/disclosure-system.md`.

## 1. Scope and method

A full inventory of disclosure-like surfaces was produced first (host
implementation, persistence, defaults, unmount policy, CSS, tests). The review
then compared each surface against the WAI-ARIA APG contract, the WCAG 2.2
criteria in scope, and the failure reports documented in the research ledger —
most importantly the *state-reset on editing* class from Blender/Godot and the
*scroll-jump on toggle* class from Bootstrap/Elementor/GenerateBlocks.

Evidence sources used: source inspection, the unit suites, two new rendered
Playwright suites, and captured screenshots under
`reports/disclosure-review-2026-09-15/` (generated, gitignored).

## 2. Issue register

Severity: **S1** loses user work or blocks a core task; **S2** breaks an
accessibility contract or wastes user effort; **S3** polish/consistency.

| # | Sev | Surface | Finding | Root cause | Resolution |
|---|---|---|---|---|---|
| 1 | S2 | Global shortcuts × every button | **Space on any focused button ran Play/Pause instead of activating the button.** Inspector section headers, sidebar toggles, and switches could not be toggled with Space (WCAG 2.1.1 / APG violation). Reproduced on a real document. | `useShortcuts` dispatched the global `playPause` binding for any non-editable target and called `preventDefault()`, cancelling native activation | `isNativeActivationKeyTarget` + bare-Space deferral in `useShortcuts`; unit tests; E2E scenario `keyboard toggling keeps focus…`. Commit `36163f604` |
| 2 | S2 | Shared `Disclosure` | Focus was dropped to `<body>` when a close removed/hid the focused control | Content unmounts (or `hidden`) with no focus handoff | `useDisclosureFocusRestore` returns focus to the trigger only when focus was genuinely lost; 9 unit tests. Commit `13b6e26a4` |
| 3 | S3 | Shared `Disclosure` | Manual Enter/Space keydown handler duplicated native button activation (double-toggle risk with AT) | Legacy handler | Removed; native activation only. Commit `13b6e26a4` |
| 4 | S3 | Shared `Accordion` | Open header in non-collapsible single mode was a silent no-op; APG requires `aria-disabled` | Missing state | `aria-disabled` + `data-non-collapsible` on the open header. Commit `13b6e26a4` |
| 5 | S2 | Sidebar sections (variables, masters, pages, design canvases, spreads) | Collapse state reset on every remount (workspace switch, panel toggle, reload) — the top-reported editor panel failure in comparable products | Per-mount `useState` | `usePersistedDisclosure` (localStorage, independent keys, storage-failure fallback) + 5 tests. Commit `fb2e1ee09` |
| 6 | S3 | `SectionCollapseToggle` (7 sidebar panels) | Chevron direction was inverted relative to the shared primitive (expanded read right, collapsed read up) | `rotate(-90deg)` applied when collapsed | Collapsed reads right, expanded reads down, matching the primitive; reduced-motion honoured. Commit `fb2e1ee09` |
| 7 | S3 | Inspector registry sections | `aria-controls` pointed at a panel that does not exist while collapsed | Panel unmounted | `aria-controls` is conditional; registry host also restores focus via the shared hook. Commit `fb2e1ee09` |
| 8 | S3 | `ImportResults` | Details toggle had no `aria-expanded`/`aria-controls` | Local implementation | Added with a stable list id. Commit `fb2e1ee09` |
| 9 | S3 | `MinimapPanel` | Show/Hide minimap reported no state | `aria-label` only | `aria-expanded` on both; `aria-controls` while the panel exists; panel gets an id. Commit `fb2e1ee09` |
| 10 | S3 | Website FAQ (16) + compare FAQ (6) | Questions were bare summary text — screen-reader heading navigation skipped every entry | No heading in `summary` | `h3` per question with `display: inline`; source-level parity guards. Commit `5a7e00a7b` |
| 11 | S3 | Website FAQ/compare | Closed answers disappeared from print (NN/g: accordions print badly) | Native `<details>` UA hiding | Print override reveals `::details-content` and the answer container; verified with `emulateMedia({ media: 'print' })`. Commit `5a7e00a7b` |
| 12 | S3 | Website FAQ schema | Schema and visible questions had drifted: “How can I contribute to Varve?” vs “How can I contribute?” | Hand-duplicated content with no guard | Copy aligned; `faqDisclosure.test.ts` enforces question-level parity. Commit `5a7e00a7b` |
| 13 | S3 | Website changelog | Older-releases disclosure said “Show …” while open and used the opposite chevron convention | Static label, local rotation | Stateful label via CSS; chevron aligned to the shared right→down contract; print reveal. Committed with the website slice |
| 14 | S3 | `PreflightFindingsPanel` | A `ChevronDown` indicator was rotated 90° by the shared primitive (pointing left when open); its `--open` CSS class was dead | Consumer passed a down-chevron; CSS never applied | Uses the primitive’s right→down indicator; dead CSS removed |
| 15 | — | `FormatMigration.tsx` (`@varve/home`) | Unreachable (no importer) and has no CSS for its classes | Orphaned duplicate of the editor’s import report | Recorded in the architecture doc as delete-or-wire; not polished |
| 16 | — | Inspector `defaultExpanded` prop | Ignored in registry mode at 9 call sites (dead props) | Registry default wins by design | Documented on the prop and in the architecture doc; call-site cleanup left to the owning session |
| 17 | — | Registry ids without a `sectionId` consumer | Collapse state is local, so “Restore defaults” cannot reset it | Legacy-mode components | Recorded as a gap with an explicit do-not-repeat rule |

## 3. Verification

Environment: Linux (CachyOS), Chromium headless shell via Playwright,
Rust toolchain not involved. Playwright temp redirected to disk
(`TMPDIR=~/.cache/varve-playwright-tmp`) because `/tmp` is a shared tmpfs under
concurrent agent load; one earlier run failed with Chromium
`font_data_service: No space left on device` — an environment failure, not a
product one.

### Commands actually run

| Command | Result |
|---|---|
| `pnpm exec vitest run packages/ui/src/components/__tests__/Disclosure.test.tsx packages/ui/src/components/__tests__/Accordion.test.tsx` | 40/40 passed (was 31; +9 contract tests) |
| `pnpm exec vitest run packages/editor/src/components/__tests__/persistedDisclosure.test.tsx packages/editor/src/components/MasterPanel/MasterPanel.test.tsx packages/editor/src/components/__tests__/sectionCollapseToggle.test.tsx` | 30/30 passed |
| `pnpm exec vitest run packages/editor/src/components/ImportResults.test.tsx packages/editor/src/components/Minimap/MinimapPanel.test.tsx packages/editor/src/components/Inspector/controls/controls.test.tsx` | 34/34 passed |
| `pnpm exec vitest run packages/editor/src/components/Export/PreflightFindingsPanel.test.tsx` | 8/8 passed |
| `pnpm exec vitest run packages/editor/src/shortcuts/ShortcutManager.test.ts packages/editor/src/shortcuts/useShortcuts.test.ts` | 30/30 passed |
| `pnpm exec vitest run apps/website/src/test/faqDisclosure.test.ts` | 5/5 passed |
| `pnpm --filter @varve/ui typecheck` | passed |
| `pnpm --filter @varve/editor typecheck` | no errors in any changed file; pre-existing errors remain in other sessions’ in-flight files (`SelectTool.test.ts`, `snapping.ts`, `workspace/layoutVariants*`, `workspaceStore`) |
| `TMPDIR=… VARVE_E2E_PORT=1499 npx playwright test tests/e2e/disclosures/disclosure-contract.spec.ts --project=chromium --workers=1` | 4/4 passed |
| `TMPDIR=… VARVE_E2E_PORT=1499 npx playwright test tests/e2e/disclosures/disclosure-visual.spec.ts --project=chromium --workers=1` | passed; captures written to `reports/disclosure-review-2026-09-15/` |
| `pnpm build:website` + `pnpm build:website:pages` | 104 pages built twice |
| `pnpm exec playwright test -c playwright.website.config.ts apps/website/tests/e2e/faq-disclosure.spec.ts apps/website/tests/e2e/axe.spec.ts --project=custom-domain` | 46/46 passed, including zero axe violations on the FAQ route |
| `pnpm exec playwright test -c playwright.website.config.ts apps/website/tests/e2e/faq-disclosure-captures.spec.ts --project=custom-domain` | 2/2 passed |

### Rendered scenarios (the real-world part)

`tests/e2e/disclosures/disclosure-contract.spec.ts` runs against the real editor
with a real document (two drawn rectangles) and covers:

1. **State survives the failure class**: collapse Fill → change selection →
   nudge + undo → expand an unrelated section, asserting the collapsed state
   every step.
2. **Scroll stability**: scroll the inspector past the first section, collapse
   the sticky “Position & Size” header, and assert the scroll position never
   moves downward past the reader’s reference row and never returns to 0.
3. **Keyboard**: Enter/Space toggle with focus retained, `aria-controls` only
   while the panel exists, and Tab never enters collapsed content.
4. **Persistence**: collapse Stroke and assert the flag reaches
   `varve-editor-settings.sections.sections.stroke.collapsed`.

Website scenarios (`faq-disclosure.spec.ts`): heading exposure, Enter/Space
toggling, multi-open comparison, Tab containment, print reveal via
`emulateMedia`, and schema/visible parity.

### Visual inspection performed

| Artifact | Observed |
|---|---|
| `editor-inspector-expanded.png` | Position & Size expanded with down-chevron; Corner Radius collapsed with right-chevron; header actions (e.g. “+ Add Stroke”) outside the heading |
| `editor-section-focused.png` | Teal focus ring around the whole section header; chevron/state unchanged |
| `editor-section-collapsed.png` | Collapsed Stroke/Section rows show right-chevron, header-only state, actions preserved |
| `website-faq-focused.png` / `open.png` | Focus ring around the summary; chevron rotates right→down when open; answer typography intact |
| `website-faq-print.png` | Print emulation shows every answer including previously closed ones; chevrons hidden |
| `website-changelog-older-open.png` | “Hide 2 older releases” state label; content revealed below |

## 3. Completion pass (same session)

The first handoff listed remaining work; this pass closed it.

| # | Item | Outcome |
|---|---|---|
| 18 | LayersPanel sections still used per-mount state | `LayerStatesSection` and `SelectionSetsSection` now use `usePersistedDisclosure` (`layer-states`, `selection-sets`); the two files were clean at edit time and the change is recorded in the ownership handoff |
| 19 | `FormatMigration.tsx` unreachable + unstyled | Deleted (no importer, no CSS, duplicate of the editor's `ImportResults`); recorded in the architecture doc |
| 20 | 12 dead top-level `defaultExpanded` props | Removed from `AdaptiveContrast`, `AiToolsHint`, `Animation`, `Effects`, `FramePresets`, `ImageCrop`, `PagePrint`, `PathText`, `Perspective`, `PrototypePanel`, and `DocumentPanel` (×5); registry defaults are unchanged, so no behaviour change |
| 21 | Variable Font Axes subsection ignored its collapsed default | Root cause: `getSubsectionState` treated missing state as expanded, so the toggle inverted the wrong value. Fixed at the source: subsection defaults are now declared on the section definition (`SectionDefinition.subsections`), `isSubSectionCollapsed` consults them, and the call-site prop was removed. First toggle now opens the panel |
| 22 | `paint-library` registry id had no consumer | Wired `sectionId="paint-library"` (component and registry defaults both collapsed) |
| 23 | `warp` registry id had no consumer | Wired `sectionId="warp"` and set the registry default to expanded, preserving the component's previous behaviour while gaining persistence and restore-defaults |
| 24 | `interaction` / `mockups` / `align-distribute` | Investigated: no section-level collapse exists for them (`interaction` renders inside `PrototypePanel`, `mockups` inside its own list, the align bar is anchored and marked essential), and they are not in the manager's collapsible set. Recorded in the architecture doc instead of forcing a wrapper |
| 25 | `mask` | Kept legacy on purpose: its default depends on whether a mask exists, which the registry cannot express. Documented as the remaining conditional-default exception |

### Completion-pass verification

| Command | Result |
|---|---|
| `pnpm exec vitest run` on `sectionRegistry`, `registryDisclosure` (new), `controls`, `featureOwnership`, `SectionManagerTrigger`, `FramePresetsSection`, `AdaptiveContrastSection`, `PaintLibrarySection`, `EffectsSection`, `ImageEnhancementSection`, `SmartFiltersSection`, `ColorizeSection`, `PropertiesPanel`, `sectionOrdering`, `AdjustmentsPanel`, `AppearancePanel`, `persistedDisclosure` | 8 files / 125 passed in the second batch; 3 files / 81 passed in the subsection batch; 99 passed in the first batch |
| `npx playwright test tests/e2e/a11y --project=chromium --workers=1` | 9/9 passed, including focus-order guards (“focus never lands inside aria-hidden content”, “no positive tabindex”) |
| `npx playwright test tests/e2e/disclosures/disclosure-contract.spec.ts --project=chromium --workers=1` | 4/4 passed after the registry changes |
| website `faq-disclosure.spec.ts` (7 tests, incl. the new 44px target check) + `touch-targets.spec.ts` (touch project) | 7/7 + 1/1 passed |

## 4. Known limitations / not verified here

- **Physical input devices** (touch/pen/AT combinations) were not exercised.
  Coarse-pointer target size is asserted for the website FAQ summary (44px)
  and the touch-project header spec passes; screen-reader output was not
  captured.
- **Native desktop (Tauri/WebKitGTK)** was not run; all rendered evidence is
  Chromium. The affected code is DOM/React-level and platform-independent, but
  the native shell is untested here.
- **Real-user research was not conducted.** The research ledger cites
  documented third-party complaints, not Varve users.
- **`/tmp` contention**: an early E2E run hit environment disk exhaustion. The
  disk-redirect workaround is recorded, but the underlying shared-tmpfs
  pressure is a machine/coordination issue, not fixed by this work.
- **Text enlargement / 200% zoom** for the changed website surfaces is covered
  by the site’s `visibility.spec.ts` (“text enlarged to 200%”); the editor
  inspector was not re-measured at 200% zoom in this session.
- **Legacy inspector sections** (`mask`, `warp`’s nested Settings, crop
  sub-panels, brush sub-panels, state-machine sub-panels, effect-studio
  details) keep sessionStorage collapse state; only the registry entries are
  reset by “Restore defaults”.
- **Residual format/lint**: the two LayersPanel files carry pre-existing
  Biome `useSemanticElements` warnings (4) unrelated to this change.

## 5. Commits

| Commit | Content |
|---|---|
| `0822251f4` | Ownership record + research ledger |
| `13b6e26a4` | Shared primitive focus/keyboard/APG repairs + tests |
| `fb2e1ee09` | Sidebar persistence, chevron contract, registry aria, ImportResults, minimap |
| `5a7e00a7b` | Website FAQ headings/print/parity + docs |
| `36163f604` | Space-activation fix + rendered disclosure contract spec |
| `3a3545ea5` | Preflight chevron repair, changelog chevron alignment, capture specs, architecture doc, this audit, AGENTS.md truth pass |
| `72c0bb62f` | Completion pass: registry subsection defaults, dead-prop removal, paint-library/warp wiring, LayersPanel persistence, FormatMigration deletion, a11y/touch validation |
