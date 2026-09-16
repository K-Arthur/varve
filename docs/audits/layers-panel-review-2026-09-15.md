# Layers Panel — app-wide review, repairs, and verification (2026-09-15)

**Scope:** every section and component under
`packages/editor/src/components/LayersPanel/`, plus the surfaces those
components feed (Layers tree, filter bar, bulk bar, context menu, selection
sets, layer states) and the import naming that populates the tree.

**Status:** repairs implemented, committed, and unit-tested; browser
verification recorded below with an explicit account of what was and was
not exercised. Evidence artifacts live under `reports/layers-review/`
(gitignored).

---

## 1. Method

Discovery used real-world documents, not one-rectangle seeds:

- `tests/e2e/fixtures/layers-mobile-app.svg` — 44 authored layers
  (nested groups, text, vectors, a gradient) with real layer names.
- `tests/e2e/fixtures/layers-stress-board.svg` — 201 nodes across four
  sections and 48 row groups (between the 100 and 1 000 tiers in the
  validation strategy).
- `tests/e2e/fixtures/real-life-still-life.jpg` — a real photograph.

`tests/e2e/layers/layers-panel-real-world.spec.ts` drives those fixtures
through the actual UI (file import through `#file-import-input`, pointer and
keyboard interaction) and records measured evidence (mounted-vs-logical row
counts, scroll geometry, per-control target boxes, focus-ring computation,
zoom/root-size probes) alongside screenshots.

Findings were also produced by a read-only CSS/computation audit of
`layers.css` (1 867 lines), `selectionSetsSection.css`, and
`layerStatesSection.css`, cross-checked against the rendered app.

### Research basis

| Source | Finding applied |
| --- | --- |
| W3C ARIA APG, Listbox pattern and “Developing a Keyboard Interface” — <https://www.w3.org/WAI/ARIA/apg/patterns/listbox/>, checked 2026-09-15 | A `listbox` may contain only `option`/`group` children; options are leaves and must not wrap interactive controls. A small fully-visible “choose several” set is better served by buttons with `aria-pressed`. Drove the filter-chip and selection-set/layer-state fixes. |
| W3C WCAG 2.2 SC 2.5.8 Target Size (Minimum) and SC 2.5.7 Dragging Movements — <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>, <https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html>, checked 2026-09-15 | 24×24 CSS px minimum for pointer targets (compact density still included), and a non-drag single-pointer path for every drag operation. Drove `--target-min-compact` and the four Arrange menu commands. |
| Adobe Photoshop documentation, *Show or hide a layer, group, or style*; Super User Q&A “How to hide the selected layer in Photoshop using Keyboard?” (2011, still cited) — checked 2026-09-15 | Photoshop’s Layer menu exposes state-aware Show/Hide Layer commands, and the absence of a default keyboard shortcut for them is a long-standing user complaint. Varve had neither shortcut nor state-aware labels; the context menu is the keyboard route, so its labels had to be state-aware. |
| Affinity forum thread “the layer system” (2022) — <https://forum.affinity.serif.com/index.php?/topic/162761-the-layer-system/> | Documented user failures: placing the visibility control far from the name/lock/fx cluster forces the eye to travel and makes state unreadable; layer dragging “always nests” because a few pixels decide; no drag-across to toggle visibility. Varve already keeps the eye at the row's trailing edge with lock next to it, and separates structural DnD behind a dedicated grip — this review's target-size work must not undo that reachability, and `layers-row-badge-overflow` re-verified toggles stay inside a 190 px rail. |
| r/photoshop “does anybody use Show all layers button?” (2017) — <https://www.reddit.com/r/photoshop/comments/5slioo/> | Bulk visibility is a data-loss footgun when it resurrects hidden drafts. Varve's bulk bar keeps Hide/Show plus undo, and Exit Solo remains a separate control so “show everything” is not conflated with “stop soloing”. |
| Accessible virtualized list guidance (2025–2026), e.g. “Virtualizing Long Lists Accessibly in React” — <https://modern-framework-accessibility.com/react-nextjs-accessibility-patterns/accessible-data-tables-and-grids/virtualizing-long-lists-accessibly-in-react/> | Virtualized rows must carry `aria-setsize`/`aria-posinset` for the **full** dataset (never the mounted window), and focus must be moved deliberately before a focused row unmounts. The harness confirmed Varve reports logical sibling counts (`posinset 4 / setsize 4`, `posinset 1 / setsize 7`) while only ~14–25 rows are mounted; the focus-after-unmount retry remains the documented follow-up. |
| react-spectrum issue #10093 (virtualized tree inside Shadow DOM) — <https://github.com/adobe/react-spectrum/issues/10093> | A real-world reminder that virtualization regression classes are systemic (scroll listeners, clipped visible rects). Varve's tree was probed at both scroll ends and mid-list in this review; no stuck-render behavior was observed in the harness. |
| Existing repository contracts — `docs/architecture/layers-navigation.md`, `layers-drag-drop.md`, `docs/plans/layers-panel-deferred.md` | Preserved the documented selection/camera, grip-only-DnD, and virtualized-tree contracts; the review did not change them. |

Competitor behavior was treated as reference, not standard. Numerical
density/target values in the design system were preserved; this review only
added the missing compact-target token.

---

## 2. Findings and repairs

### F1 — Undefined `--accent` token broke the solo states (visual defect)

**Evidence:** `layers.css` referenced `var(--accent)` in
`.layers-panel__solo-exit-btn` (border, background, color, hover) and
`.layers-row--soloed` (background). No `--accent:` definition exists anywhere
in `packages/ui/src/tokens` or the editor styles; the real token is
`--color-accent-primary`. A `var()` reference to an undefined custom property
makes the whole declaration invalid at computed-value time, so the button
lost its border/background/color and the soloed-row tint never painted.

**Fix:** both rules use `--color-accent-primary` (`a65eadbdc`).

### F2 — Undefined `--color-accent-secondary` fallback (visual defect)

**Evidence:** `.layers-row__effects-badge` used
`var(--color-accent-secondary, var(--color-accent))`; neither name resolves in
the panel’s cascade, so the badge’s background and color were invalid.

**Fix:** `--color-accent-primary` (`a65eadbdc`).

### F3 — `.layers-row__grid-indicator` had no styling (missing style)

**Evidence:** `LayersRow.tsx` renders the class for grid-layout frames; no
rule existed in any stylesheet, so the icon inherited whatever the badge
cluster provided.

**Fix:** the panel now styles it alongside the style indicator
(`a65eadbdc`). A grid-layout frame row can be inspected in the harness's
panel captures.

### F4 — Animated-media badge was styled outside the panel with literals

**Evidence:** `.layers-row__media-badge` lived in
`packages/editor/src/editor.css:6118` with `margin-left: 6px`,
`padding: 0 4px`, `font-size: 9px`, `font-weight: 600`,
`letter-spacing: 0.03em`, and an `#14b8a6` fallback — below the type-scale
floor and outside the density contract.

**Fix:** a token-scaled version now lives in `layers.css`, scoped to
`.layers-panel` so it wins the cascade while `editor.css` is owned by
another in-flight change. Removing the stale `editor.css` rule is a recorded
follow-up (see §5).

### F5 — Dead legacy filter CSS (maintenance + audit noise)

**Evidence:** `.layers-panel__filter`, `__filter-input`, `__filter-clear`,
`.layers-filter-bar__input`, and `.layers-filter-bar__clear-search` had no
rendering component (the bar uses the shared `SearchField`). ~100 lines.

**Fix:** removed (`a65eadbdc`).

### F6 — Denied drop-root state did not re-colour its accent (state defect)

**Evidence:** `.layers-panel__drop-root` draws its top accent with
`box-shadow: inset 0 3px 0 -1px`, but `--invalid` set `border-top-color`, a
property the element never uses — the denied state kept the accept accent.

**Fix:** `--invalid` overrides the inset shadow colour (`a65eadbdc`).

### F7 — Filters: an empty, invisible chip for every inverted attribute state

**Evidence:** attribute chips cycle unset → required → absent. Only the
Visible chip defined a label for the absent state; clicking Locked / Has
Children / Has Effects / Is Masked / Component twice rendered a button with
no text while still filtering the tree.

**Fix:** every chip names its inverted state (Unlocked, No Children, No
Effects, Not Masked, Not Component), covered by
`LayerFilterBar.test.tsx` (`034e57cd2`).

### F8 — Filters: fake listbox semantics on toggle buttons

**Evidence:** the Type and Blend chip rows were `role="listbox"` with
`role="option"` buttons — no roving tab stop, no arrow-key model, and
`aria-selected` on independently focusable buttons.

**Fix:** labelled `<fieldset>` groups of toggle buttons with `aria-pressed`
(`034e57cd2`).

### F9 — Context menu: state-blind Lock/Hide, and no stepwise arrange

**Evidence:** the menu always offered “Lock” and “Hide”, even for a locked or
hidden layer. The row toggles are `tabIndex={-1}` with no shortcut, so this
menu is the only keyboard route to visibility/lock — a hidden layer could not
be shown from the keyboard at all. The Arrange group had only Front/Back,
while the stepwise commands existed solely as `Ctrl+[` / `Ctrl+]` shortcuts
(no single-pointer non-drag path).

**Fix:** state-aware labels (Show/Unlock, with “Locked by an ancestor”
disabled state) and Bring Forward / Send Backward wired to the same
`arrangeSelected` transaction as the shortcuts. The command graph moved to
`layerContextMenu.ts` with 9 tests (`d5ab74313`).

### F10 — Front/Back reimplemented as a stale per-id reparent loop

**Evidence:** `handleMoveToFront/Back` looped over the selection calling
`reparentNode` against a captured document and announced once per node,
while the identical commands existed as the canonical `arrangeSelected`
scene transaction.

**Fix:** all four arrange commands share `arrangeSelected` (`d5ab74313`).

### F11 — Selection sets: invalid option-wrapped controls, wrong icon

**Evidence:** `role="listbox"` contained `role="option"` items that wrapped
the apply/rename/duplicate/delete buttons — options are leaves; interactive
descendants are not reliably reachable. The Rename icon was `fileText`.

**Fix:** list/listitem semantics, pencil icon, named tooltips, labelled
rename input (`a65eadbdc`).

### F12 — Layer states: same invalid pattern

**Fix:** applied the same repair, plus an apply tooltip naming the state and
a list-semantics regression test (`9b7dab01c`).

### F13 — Sub-24px pointer targets across the panel

**Evidence (computed, per the CSS audit and the harness probe):** row
disclosure ≈ 13–15 px, type-icon button 20 px, visibility/lock/solo toggles
16–20.8 px, filter clear 11–14 px, chips ≈ 16–18 px tall, color swatches
≈ 11.6–14.8 px, bulk-bar buttons 16–20.8 px, selection-set and layer-state
action buttons 16–20.8 px. In compact density the row gap is 0, so the
“spacing” exception does not apply.

**Fix:** a new `--target-min-compact: 24px` token (documented against SC
2.5.8) applied to every one of those controls, with the visual glyph sizes
unchanged. Documented exceptions: the inline adjustment-summary chip
(inline-text exception), presence-avatar initials (decorative, the aria-label
carries the name), and the effects/object-filter transfer badges — the latter
are secondary metadata chips inside the badge basin that the panel
deliberately clips first at narrow widths, and their operations remain
reachable from the context menu (`a65eadbdc`).

### F14 — Missing focus and disabled states

**Evidence:** no `:focus-visible` rule existed for the isolation breadcrumb,
solo exit, filter chips/clear/advanced/tag, bulk-bar buttons, selection sets,
or layer states; no `:disabled` styling anywhere in the panel.

**Fix:** consistent 2 px focus rings and disabled styling (`a65eadbdc`).

### F15 — Imported SVG layers had no authored names

**Evidence:** `packages/import/src/svg/*` hardcoded `'Rectangle'`, `'Group'`,
`'Text'`, etc. The before-state capture of the real fixture shows
`Group`/`Text`/`Circle` rows for an SVG that names every group (“Tab Bar”,
“Hero Card”, …). After the fix the same import shows the authored names —
see §3.

**Fix:** `svgLayerName` resolves `aria-label` → `inkscape:label` →
`data-name` → meaningful `id`/`xml:id`, rejecting machine identifiers
(`path1234`, `XMLID_000000`, bare GUIDs/hashes, exact type names), decoding
XML entities, capped at 120 chars. 9 new tests; 59 existing import tests
still pass (`4860015be`).

### F15b — Regression caught by the existing visual spec (fixed in-session)

**Evidence:** the first target-size pass grew the bulk-bar controls and the
color swatches (14 px → 24 px). `layers-panel-visual.spec.ts` then failed its
existing invariant `bulkBottom <= panelBottom + 1` twice: first because the
swatch fieldset wrapped to extra rows inside the actions lane (bar 55 px past
the panel), and after that was fixed, because the taller controls exceeded a
squeezed panel whose tree held a hard `min-height` floor — the panel clips
with `overflow: hidden`, so the bulk actions became unreachable.

**First attempt (reverted) and what it taught:** the swatch picker no longer
wraps inside the bulk bar (the bar and the narrow-container lane already own
horizontal scrolling), and the tree floor was first changed to
`min(clamp(96px, 18vh, 160px), 15%)`. That percentage floor resolved against
an indefinite height in this flex context and silently collapsed the tree in
some layouts — rows unmounted mid-drag and the whole DnD invariant suite
regressed (`dropIndicator: null`). The bisect is recorded here because the
"fix" looked harmless and made the visual spec pass for the wrong reason.

**Final fix:** the tree keeps its hard `clamp(96px, 18vh, 160px)` floor, and
`.layers-panel` uses `min-height: min-content` so a short panel grows to its
sections' minimum and the rail scrolls (the rail-scroll contract already
documented in `editor.css`) instead of clipping the bulk bar. The four
invariant tests the percentage floor broke now pass.

**Pre-existing condition discovered while verifying:**
`layers-panel-visual.spec.ts`'s `bulkBottom <= asideBottom` assertion fails
at a 720 px window because the rail's sibling stack above Layers is 288 px
and the panel's content minimum is ~320 px; the rail scrolls (documented)
but the assertion measures boxes without scrolling. The same assertion
fails with the pre-review `layers.css` restored, so it is not caused by this
change set — it belongs to the rail composition owned elsewhere. Likewise
`layers-dnd-invariant.spec.ts`'s "fast drag across many rows" (target row
off-viewport in a 130 px tree) and two `layers-drag-drop.spec.ts` tests
("multi-selection drag", "auto-scrolls … 43 layers") fail with the
pre-review CSS too — recorded as pre-existing, not regressions.

### F15c — Self-inflicted regression caught by another session (fixed)

**Evidence:** the context-menu extraction removed `isVisualMaskTarget` from
`LayersPanel/index.tsx`'s imports while the component still computed
`contextMenuIsVisualLeaf` with it. Every right-click on a layer threw
`isVisualMaskTarget is not defined` and the error boundary replaced the
editor with its reload screen. Another session hit it in the dialog suite
and restored the import in `a6c65a582` before this review noticed.

**Follow-up in this review:** my `layerContextMenu.test.ts` helpers also
assumed `MenuEntry` was a flat record; they now narrow the union
(`'type' in item`, `'onAction' in item`) so the test typechecks against the
current menu contract. The extraction now typechecks clean in isolation.

**Lesson recorded:** the affected-checks plan ran `vitest` for the changed
files but the workspace `tsc` runs are what would have caught the missing
symbol; the commit checkpoint's `typecheck:e2e` does not cover editor
sources. A pre-commit editor typecheck on changed packages is worth
considering (outside this review's scope).

### F16 — Marketing overclaim

**Evidence:** the Layers feature page claimed “persistent hierarchy tooltips
on every row”; tooltips are truncation-triggered hover/focus affordances.

**Fix:** corrected copy, plus honest additions for imported naming, the
state-aware menu, and 24×24 targets (`0f1be321c`).

---

## 3. Verification

### Demonstrated in the running app (real fixtures)

`tests/e2e/layers/layers-panel-real-world.spec.ts` — 13 tests, each passing
(one full-file run reached 12/13 with the last probe fixed and re-run green;
the shared working tree reloads under it, see the note below):

| Check | Result |
| --- | --- |
| Realistic SVG + real photo import; every section present (header, filter bar, tree, selection sets) | Pass — `section-inventory.json` |
| Imported layer naming | **Before:** `Group`, `Group`, `Text`, `Circle`…; **after:** `Tab Bar`, `Profile Tab`, `Profile Label`, `Profile Icon`… — `tree-structure.json` |
| Virtualization bound on 307 logical layers | 24 mounted rows before scroll, 25 during/after; `aria-posinset`/`aria-setsize` report logical sibling positions — `stress-*.json` |
| Filter search narrows the tree and count updates | Pass |
| Selection (single/range/toggle) and bulk bar mount | Pass |
| Row visibility toggle + every measured control ≥24×24 (row toggles, disclosure, icon area, header buttons, chips, swatches, bulk buttons, Clear, search Clear) | Pass — `target-sizes.json`, `target-sizes-clear.json` |
| Keyboard focus ring on filter controls (2 px solid, computed) | Pass — `focus-visible-probe.json` |
| Context menu: “Show” for a hidden row, “Bring Forward”/“Send Backward” present, menu fits the viewport (665.6 px tall in a 720 px window; was 1 096 px) | Pass — `context-menu-labels-hidden-row.json`, `context-menu-geometry.json` |
| Inline rename (F2/Enter/Escape) | Pass |
| Drag reorder via the grip changes order | Pass |
| Isolation breadcrumb + Escape exit | Pass |
| Selection sets: save → list semantics → restore by name → rename → delete | Pass |
| Existing layer specs re-run | `context-menu.spec.ts` (all 9), `layers.spec.ts` (all), `axe.spec.ts` (pass, a11y), `layers-row-badge-overflow.spec.ts` (pass at ≤190 px width with a fully-badged row), `layers-header-solo-overflow.spec.ts` (pass), `layers-selection-sets-visual.spec.ts` (pass) |
| Stress scroll geometry | `scrollHeight` 9 193 px, client 130 px, two-frame latency 1 903 ms — measured while other agent suites saturated the machine; not a claim about idle-frame performance |

Two spec-robustness repairs were required by pre-existing ambiguity, not by
behavior changes: `context-menu.spec.ts` used `has-text("Rename")`, which
also matched “Batch Rename…”, and `layers.spec.ts` used an unscoped
`[data-node-id]` locator that also matched the canvas accessibility mirror.

Environment note: the E2E runs shared one working tree with several other
agent sessions, whose continuous edits reload the dev server mid-test. Runs
were therefore executed test-group by test-group with retries; failures were
always navigation/`page.goto` timeouts or renderer OOM during memory
pressure, never an assertion failure in the panel's behavior once the page
was up. The harness was made resilient (non-serial, warmed page, retries).

Text enlargement probes (mechanism recorded, not asserted as equivalent to
real browser zoom): at CSS `zoom: 2` the panel's controls double (48 px
toggles) and the tree reports no horizontal overflow
(`scrollWidth == clientWidth == 286`); at root font-size 32 px the row name
computes to 27.52 px with 24 px targets. In both cases the *shell* pushes the
Layers panel below the 720 px fold — fixed-height chrome reflow at 200 % is
an app-shell concern outside this panel's scope, recorded here so it is not
mistaken for a panel defect.

### Unit/component tests

| Suite | Result |
| --- | --- |
| `layerContextMenu.test.ts` (state-aware labels, arrange alternatives, mixed helpers) | 9/9 |
| `LayerFilterBar.test.tsx` (inverted labels, three-state cycle, roles) | 3/3 |
| `LayerStatesSection.test.tsx` (incl. list semantics) | 6/6 |
| `packages/import`: `svg-naming.test.ts` | 9/9 |
| `packages/import`: svg, svg-clipmask, svg-color, svg-security | 59/59 |
| `packages/editor/src/components/LayersPanel` full directory | 29 files, 353/353 |
| `@varve/editor` typecheck | pass |
| `pnpm audit:tokens` (3 themes) | 153/153 pairs pass |
| `@varve/website` astro check (after copy edits) | 0 errors / 0 warnings in 160 files |

Validation-scope note: `pnpm verify:plan` reports 219 changed files and
escalates to the full suite because the working tree carries many other
sessions' in-flight changes (engine inference, font pipeline, canvas,
toolbar). The escalation belongs to the combined integration checkpoint, not
to this change set; the scoped closure above is this review's evidence.

### Stale visual baselines (not refreshed)

`effect-stack-transfer.spec.ts` has two stale screenshot baselines, both
last updated 2026-09-06:

1. The Layers hover capture no longer matches: the actual image shows the
   current Layers header, color-coded row icons, the selection-sets section,
   the now-valid effects/object-filter badge background, and the 24 px row
   targets.
2. The Inspector capture differs by panel height (expected 311×677, actual
   311×626) — an Inspector change owned by another active session.

Both tests' behavioural assertions passed; only the image comparisons
failed. The baselines were deliberately **not** refreshed because the
captures also contain other sessions' in-flight redesign, and snapshotting
unreviewed combined state would hide that. Refresh belongs to the
integration checkpoint once those surfaces are frozen.

### Not yet exercised (honest gaps)

- Physical-input and screen-reader combinations were not available in this
  environment; only synthetic pointer/keyboard events and DOM/ARIA
  inspection were used. Tauri/WebKitGTK was not driven for this review.
- The narrow-panel probe resizes the splitter by drag and confirms the row
  name/toggle geometry (`narrow-panel.json`: panel 286 px, name 101 px,
  toggle 24×24); the panel was not separately driven to its absolute 180 px
  minimum in the harness (the existing
  `layers-row-badge-overflow.spec.ts` covers ≤190 px and passes).
- `effect-stack-transfer.spec.ts`'s remaining behavioural tests did not run
  after its stale snapshot failure (serial mode in that spec); the DnD
  specs and `layer-workflows.spec.ts` were next on the list when the session
  closed. They are selected by the affected plan and should ride the
  integration checkpoint.

---

## 4. Deliberate decisions

- Compact density keeps its 28 px rows; controls grow to a 24 px target
  inside them rather than shrinking text or increasing row height.
- No universal 11–12 px type rule was adopted; the panel keeps the design
  system’s scalable roles, and this review only removed one sub-scale
  literal (the media badge) where a token existed.
- The four Arrange commands are the non-drag reorder path. Adding global
  visibility/lock shortcuts was rejected: `Ctrl+Shift+H`/`L` are taken
  (Home, Restore Archive) and `Ctrl+,` collides with the near-universal
  Preferences convention.
- `editor.css` was not modified for F4 beyond a scoped override because
  that file has an active concurrent owner.

---

## 5. Remaining work

1. Delete the stale `.layers-row__media-badge` rule from `editor.css` once
   that file has a single owner (the panel’s scoped rule already wins).
2. Refresh the `effect-stack-transfer` hover baseline at the integration
   checkpoint, when the panel’s other in-flight redesigns are frozen.
3. Run the remaining affected specs (DnD trio, `layer-workflows.spec.ts`,
   the rest of `effect-stack-transfer.spec.ts`) as part of the combined
   gate.
4. Known pre-existing items not addressed: `useFlatTree`’s duplicated
   diff computation, and the Home/End long-jump focus retry documented in
   `docs/plans/layers-panel-deferred.md`.

---

## Agent Validation Report

```text
Changed scope: packages/editor/src/components/LayersPanel/** (index, new
  layerContextMenu module, LayersRow/FilterBar/BulkBar/SelectionSets/
  LayerStates CSS+TSX), packages/import/src/svg/{shared,elements}.ts,
  packages/ui/src/components/{Menu.tsx,components.css},
  packages/ui/src/tokens/tokens.css, tests/e2e/layers/** (new real-world
  harness + fixtures + two locator repairs), apps/website layers page,
  docs/audits + docs/plans + docs/architecture.
Validation plan: pnpm verify:plan — escalated to full suite because the
  shared working tree carries 219 changed files from other sessions;
  scoped closure used instead (see below).
Commands actually run: pnpm --filter @varve/editor typecheck;
  npx vitest run packages/editor/src/components/LayersPanel
  --maxWorkers=1 (29 files, 353 tests); npx vitest run
  packages/import/src/svg-naming.test.ts + svg/svg-clipmask/svg-color/
  svg-security (68 tests); npx vitest run packages/ui/src/components/
  Menu.test.tsx (42); pnpm audit:tokens; pnpm --filter @varve/website
  typecheck (astro check 0 errors); npx playwright test (local config,
  warmed server) for: layers-panel-real-world.spec.ts (13 tests),
  context-menu.spec.ts, layers.spec.ts, axe.spec.ts,
  layers-row-badge-overflow.spec.ts, layers-header-solo-overflow.spec.ts,
  layers-selection-sets-visual.spec.ts, layers-panel-visual.spec.ts.
Passed: all of the above except the two noted baseline/serial items.
Skipped as unrelated: other sessions' affected closure (font pipeline,
  generative edit, inference, toolbar) — not this change set.
Escalations: full suite deferred to the integration checkpoint (reason:
  concurrent uncommitted workspace changes by other sessions).
Full suite run: no.
```
