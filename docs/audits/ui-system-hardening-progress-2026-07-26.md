# UI system hardening progress

Date: 2026-07-26  
Branch: `audit/ui-system-hardening`  
Worktree: `.worktrees/ui-system-hardening`  
Status: Milestone 1 implemented and focused verification complete; the repository-wide programme remains open.

## Executive summary

This milestone addressed the reported menubar, right-inspector, contrast, and
canvas-label defects while adding regression coverage around the underlying
command and ownership systems.

The highest-impact root causes were:

- menu hover switching retained the previous menu's active index, which made a
  newly opened menu render scrolled into its middle;
- popup positioning lacked a final viewport size constraint, allowing long
  menus to clip;
- active menu rows and the document colour-mode control used decorative accent
  tokens that did not provide a valid text/background pair;
- the inspector rendered two geometry/appearance control surfaces, had two tab
  tiers plus a duplicate overflow copy, and exposed responsive clamp fields in
  both geometry and layout;
- inspector section registration decided composition but most section
  disclosures did not provide their registry IDs, so collapse/hide preferences
  appeared to work without controlling the rendered section;
- `openDocumentPanel` and `openInspectPanel` targeted removed tab IDs;
- the document page `contentRoot` is a storage container but canvas and
  selection-label code treated it as visible artwork, producing the stray
  “Page 1 content” label and incorrect layer counts.

Measured results for the touched workflows:

- 217 focused unit/component tests pass;
- 13 focused Chromium layout/visual/contrast scenarios pass after the final
  contrast correction (12 passed in the first final run; the one detected
  contrast issue was fixed and the affected 7-test subset then passed);
- both empty and selected inspector axe-core scans report zero violations;
- active menu rows pass axe contrast checks in light, dark, and high-contrast
  themes;
- the token audit passes all 120 pairs across all three themes;
- the emoji audit is clean across 2,130 files;
- the architecture audit reports no editor dependency cycles and no layer
  violations.

## Defect register

| Severity | Surface | Reproduction/root cause | Resolution | Evidence |
|---|---|---|---|---|
| High | Menubar | Open Object, hover View; old active index scrolls View into its middle | Reset menu and submenu indices when hover-switching | `visual-integrity.spec.ts` |
| High | Menubar | Long Object menu can extend beyond the viewport | Floating portal size middleware constrains available height/width | Object final-command E2E |
| High | Menubar | Active rows lose contrast in some themes | Selected rows use the semantic interactive/text token pair | Light/dark/high-contrast axe checks |
| High | Commands | Menu labels and registered shortcuts drift; 40 mismatches found in the initial integrity audit | Menu definitions overlay canonical shortcut-manager accelerators; native snapshots updated | Command-integrity and native-adapter tests |
| High | Commands | Distraction-free and flatten shared a binding | Distraction-free moved to `Ctrl+Shift+Period` | Collision audit |
| High | Commands | Several menu commands were aliases, stubs, or bypassed the real registry | Added real handlers/aliases and registry-first native dispatch | Action-handler/registry tests |
| High | Inspector | QuickBar duplicates X/Y/W/H, opacity, and fill | Removed inspector-only QuickBar | Ownership E2E and visual baseline |
| High | Inspector | Primary/secondary tabs plus overflow duplicate the same destinations | Replaced with one horizontal, scrollable APG tablist | Keyboard and DOM E2E |
| High | Inspector | `document` and `spec` tab IDs no longer exist | Document clears selection and opens Properties; Inspect activates the inspect tool and Export/Code | Action-handler tests |
| High | Inspector | Empty Properties button scrolls to a nonexistent document section | Render the real lazy DocumentPanel in empty Properties | Empty inspector E2E |
| High | Inspector | RGB active button measured 1.9:1 (white on decorative teal) | Use `interactive-default` with `text-on-accent` | Axe empty-inspector scan |
| Medium | Inspector | Geometry shows duplicate responsive clamp controls for every shape | Keep X/Y/W/H/R in Position & Size; keep responsive min/max in Layout only | Unit and ownership E2E |
| Medium | Inspector | Advanced image sections expand by default | Collapse background removal, colorize, denoise, and lens blur by default | Registry/section tests |
| Medium | Inspector | Section manager state does not control actual disclosure sections | Wire stable `sectionId` values through core and advanced sections | Registry and manager tests |
| Medium | Inspector | Blend mode wraps and field labels misalign | Keep field labels on one line and use the shared spacing token | Rectangle visual baseline |
| Medium | Inspector | Large empty-state illustration pushes document controls below the fold | Add inspector-scoped compact EmptyState layout | Document-settings baseline |
| High | Canvas | “Page 1 content” renders as artwork and conflicts with frame labels | Traverse active page children plus global children, not page content roots or inactive pages | Canvas-name-label unit/E2E |
| Medium | Selection info | Breadcrumb and layer count expose storage content roots | Filter page/master content roots and count visible active-page/global layers | SelectionInfoBar tests |
| Medium | Find/Replace | Replace-all offsets and recursive text discovery were incorrect | Recursive search, stable reverse replacements, capture support, custom Select | Find/Replace tests |

## UI and panel inventory

| Surface | Runtime owner | Milestone status | Remaining work |
|---|---|---|---|
| Menubar | `Menubar` plus menu definitions/action registry | Repaired and browser-verified | Native macOS menu and Windows WebView2 need platform runs |
| Native menu adapter | `menu/nativeAdapter` and `useNativeMenu` | Registry-first dispatch and canonical accelerator snapshots verified | Native Tauri automation unavailable |
| Command palette/shortcuts | ActionRegistry and ShortcutManager | Integrity audit and main conflicts addressed | Full application orphan scan remains part of later milestones |
| Properties | `PropertiesPanel`/section registry | Consolidated, duplicate controls removed, document state connected | Advanced Fill/Stroke/Typography density remains |
| Appearance | Lazy `AppearancePanel` | Canonical owner preserved; no longer duplicated in Properties | Detailed per-control interaction audit remains |
| Adjustments | Lazy contextual `AdjustmentsPanel` | Canonical owner preserved; registry disclosures wired | Concurrent mask/CAF/type work prevents full gate |
| Prototype | Lazy `PrototypePanel` | Dedicated route and E2E discoverability verified | Full prototype interaction audit remains |
| Export/Inspect | One Export tab with Format/Code subtabs | Invalid Spec route removed; inspect selects Code | Export dialog duplication needs a later product decision |
| Audit | Lazy `AuditPanel` | Canonical tab preserved and menu actions deep-link | Existing intelligence-panel timing failures remain |
| Document settings | `DocumentPanel` inside empty Properties | Real Canvas and Document Color controls connected | Destructive colour conversion confirmation remains |
| Canvas labels | `CanvasNameLabels` | Storage roots filtered; active page scoped | Master-label behavior needs dedicated fixtures |
| Selection info | `SelectionInfoBar` | Storage roots filtered and real layer count used | Multi-page/master breadcrumb coverage can expand |
| Responsive inspector | Shell drawer plus inspector CSS | In-viewport drawer E2E passes | Touch/pen and enlarged-text manual matrix remains |

The pre-existing detailed matrices remain useful supporting documents:

- `docs/menu-capability-matrix.md`
- `docs/menu-workspace-matrix.md`
- `docs/audits/properties-panel-ownership-audit-2026-07-23.md`
- `docs/audits/panel-navigation-architecture-2026-07-23.md`

## Command-wiring report

The initial executable integrity audit found 40 cases where a menu-displayed
accelerator did not agree with the ShortcutManager and one direct binding
collision. Menu shortcut display is now derived from canonical shortcut
definitions. The native adapter snapshots cover macOS, Windows, and Linux
specification output across five workspaces.

Real handlers were added or corrected for document/inspect routing, ruler and
guide aliases, workspace switching, audit aliases, text formatting, Find and
Replace, and browser snapshot/archive equivalents. Native menu activation now
tries the ActionRegistry before the UI fallback, preserving the required
real-handler-before-no-op registration order.

This milestone does not claim that all application commands outside the audited
menu/action set are complete. Deferred and model-dependent image features remain
subject to their capability states.

## Menubar report

- Hover switching starts at the first enabled item and clears stale submenus.
- Long menus use portaled, fixed positioning with viewport constraints.
- Workspace rows remain enabled radio choices and expose checked semantics,
  rather than disabling the active row.
- Active menu row contrast passes automated checks in all three themes.
- Windows and Linux Tauri windows keep the in-window Edit and Help surfaces;
  macOS may delegate those conventional items to the native application menu.
- Shortcut labels come from canonical shortcut definitions instead of stale
  hardcoded strings.
- The Menubar import count remains 14; the `useNativeMenu` export was routed
  through the existing menu barrel to avoid another direct import.

## Panel and inspector report

The inspector now has one APG tab row. The removed overflow menu was a duplicate
copy of tabs rather than a true overflow solution; horizontal scrolling keeps
every destination reachable without rendering duplicates. Arrow keys wrap,
Home selects the first tab, and End selects the last.

Properties now owns common geometry/layout/appearance/fill/stroke/typography.
Appearance, Adjustments, Prototype, Export/Code, and Audit remain dedicated lazy
surfaces. Empty Properties owns document settings because clearing selection is
the canonical document context; no deprecated Document tab is needed.

The old QuickBar duplicated canonical controls and has been removed. Position &
Size contains one X/Y/W/H set and rotation. Responsive min/max sizing remains in
Layout. Corner Radius and costly processing sections use progressive disclosure.

## Accessibility and design-system report

- Empty and selected inspector axe-core scans: zero violations.
- Menubar active-row axe contrast: clean in light, dark, high-contrast.
- Document colour active state changed from an invalid decorative accent pair
  to the audited interactive pair.
- APG tab roving focus is covered in unit and browser tests.
- Menu rows expose radio/checkbox semantics only for matching roles.
- Portaled menus remain keyboard reachable and within the viewport.
- No new native `select`, hardcoded interface colour, or emoji was introduced.
- Token audit: 120/120.
- Emoji audit: clean.

Manual screen-reader, touch, pen, Windows high-scaling, macOS VoiceOver, and
WebView2 validation were not available in this Linux/Chromium environment.

## Test report

Focused green evidence:

- 217 unit/component tests in 14 files.
- Native menu adapter: 42 tests and 15 platform/workspace snapshots.
- Chromium visual/layout/contrast set: 13 scenarios after combining the
  12-passing full run with the corrected 7-test inspector rerun.
- Inspector axe: empty and selected states pass.
- Visual baselines:
  - `document-settings-chromium-linux.png`
  - `rectangle-properties-chromium-linux.png`
- Token audit: 120/120.
- Emoji audit: clean.
- Full format check: 2,225 files, clean.

Repository-wide evidence:

- `pnpm test`: 9,802 passed, 47 failed, 3 skipped.
- Fifteen native-menu snapshot failures and the inspector expectations caused
  by this milestone were updated; their focused reruns pass.
- Remaining failures are in concurrent/inherited work: import insertion,
  workspace `setTool` extraction, intelligence audit timing, scene state
  machines/migration expectations, home shortcut semantics, and clone
  benchmarks.
- `pnpm typecheck` stops in `@strata/codegen` on stale scene-model fixtures and
  converter assumptions before completing the workspace.
- `pnpm lint` reports existing unfinished codegen, Shell test hook, CSP import,
  and E2E debt. Focused checks on touched files have no errors.

## Architecture report

- Editor dependency cycles: zero.
- Layer violations: zero.
- Scene retains six cycles from concurrent model work.
- Menubar imports: 14, unchanged by the `useNativeMenu` integration.
- Shell imports: 46; no import added by this milestone.
- CanvasArea imports: 64; no import added by this milestone.
- Context complexity: 839, under the recorded 847 ceiling but close to it.
- Menubar and context retain pre-existing hub-budget warnings.
- PropertiesPanel reports 28 outgoing imports and remains a composition hub;
  workflow panels are lazy-loaded and the former QuickBar imports were removed.

## Remaining risks and follow-up priorities

1. Restore a self-consistent repository baseline by integrating or completing
   the concurrent scene/codegen/context work; do not mask those failures.
2. Complete the broader orphan/no-op command inventory beyond the audited
   menubar and action-registry set.
3. Audit every control in Appearance, Adjustments, Prototype, Export, and Audit
   with real state mutations, history, persistence, empty/error/unsupported
   states, and pointer/keyboard E2E.
4. Decide whether Audit remains a permanent tab or moves to the proposed
   contextual utility surface.
5. Split advanced Fill, Stroke, and Typography editors from common Properties.
6. Validate Windows WebView2, macOS WKWebView/native menu, Linux Tauri, enlarged
   text, screen readers, touch, and pen.
7. Re-run the full gate after the concurrent baseline is green.

## Git and concurrency record

The work was isolated in `.worktrees/ui-system-hardening` on
`audit/ui-system-hardening` from `dad22741`. The primary worktree already
contained extensive uncommitted and concurrently changing work, so its snapshot
was not overwritten.

No commit or push is recorded for this milestone yet. The isolated worktree
contains copied concurrent changes and the full gate is not green. Committing
that mixed snapshot would violate ownership, and pushing a knowingly broken
state would violate the delivery protocol. The focused patch must be reconciled
onto the owning branches after their changes settle, then committed in coherent
menu, inspector, and test milestones.
