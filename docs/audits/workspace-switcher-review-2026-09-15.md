# Workspace switcher review (2026-09-15)

Scope: the workspace switcher in the editor menubar — the dock
(`packages/editor/src/components/WorkspaceTabs.tsx`), its recipes in
`packages/editor/src/editor.css`, the overflow "More workspaces" menu, the
labels it renders, and the copy about it in docs and on the website. Toolbar
buttons are a separate surface with their own review
(`docs/audits/toolbar-review-2026-09-15.md`).

Reviewer: agent session G, on `master` at `969739124`. Ownership record:
`docs/agents/workspace-switcher-review-2026-09-15-ownership.md`.

## Method

1. Source and token inventory (component, CSS, overflow math, labels,
   shortcut registry, View menu, website copy).
2. Rendered baseline at 1920/1440/1280/1024 across light/dark/high-contrast,
   with computed styles dumped and WCAG ratios calculated from those values
   (`docs/screenshots/2026-09-15-workspace-switcher-review/before/`).
3. Research gate on the two design mechanisms in play — cursor-anchored
   magnification and icon-only navigation — plus the workspace-switcher
   failure reports users actually file.
4. Repair at the lowest shared layer (tokens, ARIA ownership, one measurement
   contract), then new real-app verification (`tests/e2e/workspace/switcher-review.spec.ts`).

## Research record

Consulted 2026-09-15. Sources describe other products and general findings;
none is a claim about Varve users.

| Source | Finding | Applied as |
|---|---|---|
| Zhai, Kong & Ren, *Human On-line Response to Target Expansion* (CHI 2005), chi2005.acm.org/assets/p177-zhai.pdf | A fisheye focused at the cursor gives **no motor-space advantage** — the target's hit limits are identical to no magnification — while lateral cursor motion is amplified, "perturbing the control ... in the absence of any gain". | Removed the dock's per-frame magnification loop. Its hit targets never changed either, so only the visual noise and per-frame cost were being paid. |
| Cockburn & Firth, *Improving the Acquisition of Small Targets*, csse.canterbury.ac.nz/andrew.cockburn/papers/smallTargets.pdf | "Bubble" hover expansion reduced selection time but users found it **distracting** and it induced hunting/"sloppy targeting"; unaltered-motor-space expansion can still help small targets. | Kept a restrained in-place hover cue (CSS scale, no neighbor movement, no layout writes), not a distance-driven fisheye. |
| Tognazzini, *Top 10 Reasons the Apple Dock Sucks*, asktog.com/columns/044top10docksucks.html | Dock magnification was "a great demo, but a poor daily performer"; macOS had to offer a way to turn it off. | Same conclusion as the CHI evidence; magnification is gone rather than configurable. |
| NN/g, *Icon Usability*, nngroup.com/articles/icon-usability/ | "Icon labels should be visible at all times... Don't rely on hover to reveal text labels"; labels are especially critical for navigation. | The active mode is always named; the inactive modes keep accessible names and tooltips, and the review explicitly records that icon-only inactive tabs are a space trade-off, not an ideal. |
| NN/g, *Hamburger Menus and Hidden Navigation Hurt UX Metrics*, nngroup.com/articles/hamburger-menus/ | On desktop, hidden navigation was used in 27% of cases vs 48% for visible; tasks at least 39% slower; difficulty +21%. | Overflow now carries a hidden-count accessible name, and the overflow path is verified end-to-end (opens, lists every hidden mode, switches, refocuses). |
| Adobe community, *Workspace Switcher Does Not Display Current Workspace* (2017), community.adobe.com/questions-712/workspace-switcher-does-not-display-current-workspace-1151099 | Photoshop CC 2017 replaced the workspace name with an icon; users: "one has to click instead of just looking to see what Workspace one is using". | The active workspace name stays visible in the pill (existing behavior, now covered by tests). |
| Photoshop Gurus forum, *missing workspace button on options bar* (2015), photoshopgurus.com/forum/threads/missing-workspace-button-on-options-bar.54772/ | At narrow window widths the workspace dropdown disappeared; users could not find it and reset preferences chasing it. | `computeWorkspaceLayout` never overflows the active mode, and the spec asserts the active mode is visible at 900–1024px. |
| Adobe community, *PSD-Work Window changed to I don't know what* (2025), community.adobe.com/questions-712/psd-work-window-changed-to-i-don-t-know-what-1177938 | Users who land in an unfamiliar workspace "don't know how they ended up with that window" and cannot return to a known arrangement. | The overflow menu's Reset Workspace to Default remains one interaction from the switcher whenever overflow exists; the View menu also carries reset. Recorded as a remaining discovery gap below. |
| WAI-ARIA 1.2, `radiogroup`, w3.org/TR/wai-aria-1.2/#radiogroup | A radiogroup's owned elements are radios; unrelated interactive children violate the role's content model. | Overflow trigger and divider moved out of the group. |
| WAI APG, *Keyboard Interface* (focusability of disabled controls) and the radio-group automatic-activation model, w3.org/WAI/ARIA/apg/practices/keyboard-interface/ | Focus and selection travel together in a radiogroup with automatic activation. | Keyboard activation now moves DOM focus; a regression test drives ArrowRight/ArrowLeft/Home/End in the real app. |
| WCAG 2.2, 1.4.3 Contrast (Minimum) and 1.4.11 Non-text Contrast, w3.org/TR/WCAG22/ | 4.5:1 for normal text; 3:1 for graphical objects required to understand a control. | Measured from rendered colors in all three themes; the new palette passes via the token system. |

Deliberately not claimed: no user study was run; preference statements are
engineering judgement backed by the sources above.

## Findings

Severity: **P0** blocks access or corrupts meaning; **P1** breaks a task or a
stated contract; **P2** polish/consistency.

### F1 — High Contrast: white text on the HC accent (P0, verified)

`[data-theme="high-contrast"] .workspace-dock__item--active` set
`--ws-mode-fg: var(--color-text-on-accent)` but the base rule's
`color: #ffffff` was never re-declared from that variable, so the variable was
dead. Computed in the running app: active pill background
`oklch(0.9519 0.2924 111.62)` (the HC yellow) with `color: rgb(255, 255, 255)`
→ **≈1.06:1**. The workspace name was effectively invisible in a theme built
for maximum readability. Evidence:
`before/06-dock-1920-high-contrast.png`, `before/computed-styles.json`.

### F2 — Light theme: active pill text below AA in 5 of 8 modes (P0, verified)

The pill used a fixed `#ffffff` on a per-mode background. Ratios computed from
the committed values: logo **3.25:1**, email **3.68:1**, design **4.01:1**,
motion **4.28:1**, drawing **4.38:1** — all below 4.5:1 at a 10.8px semibold
label (normal text). image 5.12:1, print 5.42:1, codegen 4.79:1 passed by
luck, not by system.

### F3 — Light theme: Logo icon below non-text contrast (P1, verified)

Inactive Logo icon `#d97706` on badge `#fef3c7` = **2.86:1**, below the 3:1
required for the only visual identifier of that control (all ratios in
`before/computed-styles.json` / the audit script output recorded below).

### F4 — `role="radiogroup"` contained a divider and a button (P0, verified)

DOM dump at 1024: `span.workspace-dock__divider`, `button.workspace-dock__more`
as children of the radiogroup. Screen readers that honour the role's content
model may not expose the overflow control, which is the only route to hidden
modes at narrow widths.

### F5 — Per-frame fisheye magnification (P1, verified)

The RAF loop called `getBoundingClientRect()` for each visible item and wrote
`svg.style.width/height` every frame while the pointer was over the dock —
forced style/layout work on the top bar for a visual effect with the negative
research record in the table above. Hit targets never changed size, so the
mechanism provided no interaction benefit. The effect also kept stale
`dockRect` geometry after a resize while the loop was running.

### F6 — Roving focus diverged from selection (P1, verified in the real app)

After `ArrowRight` from Design, the roving tabindex moved to Draw but DOM
focus stayed on the Design button (`handleSwitch` only restored focus for
overflow activations). The next arrow press was therefore computed from the
stale focused tab: a second `ArrowRight` was a no-op and `ArrowLeft` wrapped
to the far end of the strip. Discovered by the new real-app spec, not by the
existing unit tests.

### F7 — Three constants for one distance; a dead render condition (P2, verified)

CSS `gap: 5px`, JS `TAB_GAP = 6` (added to measured widths), and
`WORKSPACE_ICON_TAB_WIDTH = 33` ("28px plus the bar's 5px gap") described the
same distance. The CSS-vs-JS mismatch over-counted ~1px per tab. Related: the
inactive-tab label was rendered when `!iconOnly` but always collapsed to
`width: 0` by CSS, so the DOM carried invisible text while the overflow math
read those tabs' measured widths.

### F8 — Terminology split (P2, verified)

`WORKSPACE_LABELS.codegen = 'Codegen & Audit'` while the shortcut registry
("Workspace: Codegen"), the View menu, and the website said "Codegen". The
long label was also the only one that wrapped to two lines in the overflow
menu (41px row against 32px siblings).

### F9 — Navigation labels at the smallest type step (P2, verified)

The pill label rendered at `--font-size-2xs` (10.1–10.8px), the smallest step
in the product scale and below the `--font-size-xs` caption role the system
uses for interface captions.

### F10 — Fixed heights clipped enlarged text and stale measurements survived (P1, verified)

The bar used `height: 36px` and items `height: 28px`; with a user font-size
preference the rem-based label grows past those values. Nothing re-measured the
tab widths on a text-size change (the observed wrapper's width does not change
when fonts grow), so the overflow math kept stale widths. The new spec failed
against the old CSS for exactly this case.

## Decisions and deliberate exceptions

- **Per-mode identity, tokenized (supersedes the first-pass single accent).**
  The first pass replaced the rainbow with one product accent; the follow-up
  restored per-mode hues as real tokens (`--color-workspace-accent-*`,
  `--color-workspace-icon-*`) built from the ramps, because the original
  problem was never hue itself — it was 16 untokenized hex values with no
  audit. The eight modes are now contrast pairs in `CONTRAST_PAIRS`, so
  `audit:tokens` covers 201 pairs across three themes (was 153), and the
  real-app spec additionally proves the eight accents resolve to eight
  distinct rendered colors in light and dark, and to one HC accent in high
  contrast. The old palette failed because a *fixed* step is not a *fixed*
  contrast: light pills now use steps 7–9 (white text 4.6–6.0:1 vs the old
  3.25–5.42) and icons use steps 6–8 (3.2–4.6:1 vs the old 2.86 fail).
- **Dark accents maximize chroma inside AA.** Step-4 tints (L≈0.8) rendered
  as "muted" on the dark bar; the shipped dark accents use steps 6–7 with
  roughly double the chroma (C 0.12–0.16) while *improving* the dark-text
  margin to 5.4–9.6:1. Light-tint icon roles are unchanged (8.2–9.8:1).
- **One vertical group rule for the menubar family.** The menubar's two `|`
  rules rendered at 5×22.1px and 4×18.7px because each was a text glyph sized
  by its inherited font; both now use the same recipe as the dock overflow
  divider (`--separator-thickness` × `--space-4`, `--color-separator-subtle`,
  `--space-1` margins). That also gives the elevated dock bar 2 × `--space-1`
  clearance from the zoom rule and undo/redo — the same distance its own items
  keep from each other. Covered by a new spec case, and it completes the
  menubar/dock half of the separator system's "seven heights for one role"
  remaining item.
- **High Contrast collapses all eight modes to the single HC accent** (one
  `ok(0.9519, 0.2924, 111.62)` accent, white icons): hue must not be a state
  cue in a theme built for maximum separation.
- **Magnification removed, not made optional.** Research record above; the
  hit targets never changed, so nothing is lost, and a preference for a
  negative-value effect would add state for no task gain.
- **Dock geometry stays literal pixels in one place.** `--dock-item-size`,
  `--dock-bar-height`, `--dock-inset-*` are declared once on `.workspace-dock`
  because `WorkspaceTabs.tsx` (`OVERFLOW_BTN_WIDTH`, `DOCK_CHROME_WIDTH`) and
  `workspaceOverflow.ts` (`WORKSPACE_ICON_BUTTON_WIDTH`) depend on those
  numbers. The inter-tab gap is the exception: it is a spacing token
  (`--space-2`) and its resolved value is passed into the math.
- **Inactive tabs remain icon-only.** NN/g's guidance says labels should be
  visible; at 1920 the strip has ~729px against ~600px of eight labels, and
  the active mode already occupies the pill. The trade-off is recorded here
  rather than hidden: active name always visible, full names in tooltips,
  accessible names on every radio, and all modes one interaction away.
- **The overflow menu keeps the shared `size="default"` wrapping.** "Reset
  Workspace to Default" still wraps to two lines; the shared Menu is owned by
  the menu-contract session and long-label wrapping is its documented
  behavior.

## Implementation

| Change | Where |
|---|---|
| Tokenized palette, single accent, flex `min-height`, CSS hover cue, forced-colors rules, reduced-motion | `packages/editor/src/editor.css` |
| Magnification loop removed; radiogroup contains only radios; roving focus moves with keyboard activation; measured gap; hidden-count name; only the active tab renders a label; bar observed for remeasurement | `packages/editor/src/components/WorkspaceTabs.tsx` |
| Gap-aware layout input; one icon-button constant; fallback gap constant | `packages/editor/src/workspace/workspaceOverflow.ts` |
| `WORKSPACE_LABELS.codegen = 'Codegen'` with the naming rule documented | `packages/editor/src/workspace/workspaceTypes.ts` |
| Switcher contract | `docs/architecture/workspace-system.md` §Switcher surface |
| Switcher copy and canonical mode name | `apps/website/src/pages/docs/workspaces.astro`, `docs/getting-started/interface.astro`, `features/workspaces.astro` |
| Real-app contract spec (10 tests) | `tests/e2e/workspace/switcher-review.spec.ts` |
| Unit tests: ARIA ownership, gap input, roving focus | `WorkspaceTabs.test.tsx`, `workspaceOverflow.test.ts` |
| Reviewed visual baselines | `tests/e2e/workspace/visual.spec.ts-snapshots/workspace-tabs-*.png` |

## Verification performed

Environment: Linux (CachyOS), Chromium via Playwright, isolated dev server on
port 1441 (`VARVE_E2E_PORT`), 1920×1080 / 1024×768 viewports, all three
themes.

| Command | Result |
|---|---|
| `npx vitest run packages/editor/src/components/WorkspaceTabs.test.tsx packages/editor/src/workspace/workspaceOverflow.test.ts` | 20 passed |
| `npx vitest run packages/editor/src/workspace` (42 files) | 645 passed |
| `npx vitest run packages/help` | 31 passed (help copy changed) |
| `pnpm --filter @varve/website exec astro check` | 0 errors, 0 warnings (website pages changed) |
| `npx playwright test tests/e2e/workspace/switcher-review.spec.ts --project=chromium` | 10 passed |
| `pnpm audit:tokens` | 201 pairs pass across 3 themes (was 153) |
| `pnpm --filter @varve/ui tokens:generate` | `tokens.css` regenerated (65,752 bytes) |
| `pnpm --filter @varve/desktop exec vite build` (production bundle) | built in 16.4s |
| `npx playwright test tests/e2e/editor/workspace-nav.spec.ts --project=chromium` | 4 passed |
| `npx playwright test tests/e2e/canvas/workspace-toolbar-visual.spec.ts` + `tests/e2e/workspace/visual.spec.ts -g "workspace tabs"` | passed; 3 baselines regenerated and visually reviewed |
| `node scripts/audit-docs.mjs` / `node scripts/audit-emoji.mjs` | clean |
| `npx biome check` on every touched file | clean |
| `npx tsc --noEmit -p packages/editor/tsconfig.json` filtered to touched files | clean (pre-existing errors elsewhere remain; none touched here) |

One pre-existing test defect surfaced and was repaired while running the
existing specs: `workspace-nav.spec.ts` looked up the overflow entries as
`role="menuitem"` although the menu has rendered them as `menuitemradio` since
the control became a radio group; the assertion now matches the real role. The
product behavior was correct — the menu's ARIA snapshot is recorded in
`after/aria-snapshot.txt`.

What the real-app spec verifies:

- **Rendered contrast**, not authored tokens: the label and icon colors are
  painted onto a canvas and measured from the resulting sRGB bytes. 8 modes ×
  3 themes × (active label ≥ 4.5:1, every inactive icon ≥ 3:1, no label
  truncation) — 24 mode/theme combinations.
- **Mode-identity wiring**: eight distinct rendered accents in light and dark,
  exactly one in High Contrast (guards against one token aliasing another).
- **Menubar rhythm**: both zoom group rules render identically and the
  elevated dock bar clears its neighbours by at least its internal item gap.
- **ARIA ownership**: every `[role]` child of the radiogroup is a radio; the
  overflow trigger is outside it and reports `More workspaces (N hidden)`.
- **Overflow**: hidden modes are all present in the menu; selecting one
  changes the real editor state (`aria-checked` and the active pill's
  `data-mode`).
- **Keyboard**: ArrowRight/ArrowLeft/Home/End activate the expected mode and
  the group has exactly one tab stop.
- **Hover**: icon layout sizes and every button rect are byte-identical before
  and after a pointer sweep; exactly the hovered item carries the transform.
- **Endurance**: switching through all eight modes keeps `Untitled 1` and the
  canvas mounted with no console/page errors.
- **Text enlargement**: at a 32px root the Codegen label is complete and
  unclipped, the pill grows, and every mode stays reachable (visible radios +
  menu = 8).
- **Forced colors and 480px**: `forcedColors: 'active'` at a 480px viewport
  keeps the active mode identifiable (boundary ring plus its accessible name),
  every mode reachable, and no console errors; the rendered state was
  inspected in `after/forced-colors-480.png`.

Not performed (honest gaps): live browser zoom (Ctrl+=) and OS-level text-size
preferences — the root-font-size mechanism exercises the rem-relative tokens
but is not the same runtime path; screen-reader runs (NVDA/VoiceOver/Orca);
physical touch/pen; Safari/Firefox; the native WebKitGTK shell (the production
Vite bundle builds, but only the browser/DOM path was exercised).

## Remaining work

1. **Reset discovery.** F1–F10 are fixed, but a user who lands in an
   unfamiliar workspace still has to find reset in the overflow or View menu.
   A future pass could surface "Reset Workspace" in the command palette
   results for mode-switch queries (it is already a palette command).
2. **The View menu duplicates all eight workspace entries** — the toolbar
   review's recommendation #2 (`docs/audits/toolbar-review-2026-09-15.md`)
   proposes a Workspace submenu; that remains the right fix and would remove
   the last competing list of mode names.
3. **Inactive-tab labels** depend on the space budget above; if the menubar
   layout ever gains room, showing all names is the NN/g-aligned direction.
4. **The shared Menu's wrapping behavior** for long labels is owned by the
   menu-contract session; this review only removed the dock's own contribution
   to it.
5. **Browser/OS text-size and assistive-technology matrices** remain untested
   for this surface, as listed above.
6. **CHANGELOG entry deferred.** `CHANGELOG.md` holds another session's
   uncommitted isometric entries; a pathspec commit would have swept them in.
   The user-facing change belongs under Unreleased/Changed once that work
   lands: "the workspace switcher now follows the product accent and passes
   contrast in every theme; keyboard arrows move focus with the selection".

## Agent validation report

```text
Changed scope: packages/editor/src/components/WorkspaceTabs.tsx(+test),
  packages/editor/src/workspace/workspaceOverflow.ts(+test),
  packages/editor/src/workspace/workspaceTypes.ts,
  packages/editor/src/editor.css (dock recipes only),
  tests/e2e/workspace/switcher-review.spec.ts (new),
  tests/e2e/editor/workspace-nav.spec.ts,
  tests/e2e/editor/workspace-navigation-contracts.spec.ts,
  tests/e2e/canvas/image-mode.spec.ts,
  tests/e2e/canvas/workspace-toolbar-visual.spec.ts,
  tests/e2e/workspace/visual.spec.ts-snapshots/workspace-tabs-*.png,
  docs/architecture/workspace-system.md,
  docs/audits/workspace-switcher-review-2026-09-15.md (this file),
  docs/agents/workspace-switcher-review-2026-09-15-ownership.md,
  docs/screenshots/2026-09-15-workspace-switcher-review/**,
  apps/website/src/pages/docs/workspaces.astro,
  apps/website/src/pages/docs/getting-started/interface.astro,
  apps/website/src/pages/features/workspaces.astro
Validation plan: pnpm verify:plan reports FULL-SUITE ESCALATION because the
  working tree holds other concurrent sessions' changes (Cargo.toml/Cargo.lock,
  generative-edit, font system). Escalation is driven by those unrelated
  paths, not by this review's files; the pre-commit checkpoint ran the staged
  closure for the committed paths.
Commands actually run: the four commands listed under "Verification
  performed" plus the capture run that produced the before evidence.
Passed: all of the above.
Skipped as unrelated: Rust/cargo workspace, native desktop matrices,
  model-quality, packaging, signing; no Rust, packaging, or release path was
  touched. Browser visual baselines for panels/inspector/full-editor remain
  untouched: they were already stale from other sessions' in-flight work and
  updating them here would have captured that uncommitted state.
Escalations: none. No full-suite run.
Full suite run: no. Reason: no workspace/toolchain/test-runner/schema change.
```
