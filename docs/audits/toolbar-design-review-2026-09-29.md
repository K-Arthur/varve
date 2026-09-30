# Toolbar design review — dividers, surface, and tool grouping (2026-09-29)

Scope: the floating tool palette as a *visual* system — how it draws its group
dividers, how many surfaces declare its chrome, how it behaves at narrow
viewports — and, as a separate section, whether each workspace's toolbar
declares the right tools in sensible groups. Reproducible assertions live in
`tests/e2e/canvas/toolbar-divider-chrome.spec.ts`; captured evidence is in
`docs/screenshots/toolbar-design-review-2026-09-29/` (the `diagnostic/`
subdirectory is the pre-fix state, the `after-*` files the post-fix state).

This is not an audit-only report: every P0/P1 below was reproduced in a real
browser, fixed, and re-verified. Remaining work is listed honestly at the end.

## Method

1. Read `AGENTS.md`, `docs/architecture/toolbar-system.md`, and the workspace
   tool declarations; inspected `git status` — the tree carried ~375 dirty
   files from concurrent sessions and no in-progress git operation
   (`pnpm workflow:doctor`: `syncState ahead-only`, no merge/rebase).
2. Research gate: current primary sources plus documented user complaints (see
   "External failure evidence").
3. Runtime diagnosis: drove the real editor through Playwright on isolated
   ports (`VARVE_E2E_PORT` 1491–1513) and dumped computed styles, rects and
   icon centres at 1280×800 / 900×800 / 640×700 / 480×700 / 1440×900.
4. Fix → unit/component tests → browser regression spec → visual re-capture.

## Findings

### P0 — Group separators were rounded brackets, not rules

**Evidence.** A DOM dump at 1440×900 over every rendered group boundary:

| Property | Measured |
|---|---|
| `border-radius` of the element carrying the rule | `6px` (`--radius-control-compact`) |
| Rule | `border-left: 1px solid` |
| Icon centre vs button centre, group-leading tools | **+1.94px** (all other tools: 0.00) |
| Distance from the previous group | 5.76px |
| Distance to its own group | 2.88px |

**Root cause.** `.floating-toolbar__btn--group-start` drew the divider as
`border-left` on the tool button. `border-radius` curves a border, so the 1px
line bent into a "(" at each end; the same rule's `padding-left` shrank the
button's content box (hence the 1.94px icon offset), and its `margin-left`
doubled the gap on only one side.

**Fix.** Dividers are now a real flex element, `.floating-toolbar__divider`:
1px, `border-radius: 0`, `calc(control-height × --separator-toolbar-length-ratio)`
tall, `--color-separator-subtle`, centred in the row's `gap` on both sides. A
rule is suppressed before the first rendered slot, where it separated nothing.
The palette's button no longer carries border, padding or margin for grouping.

The same rule replaced the `height: 20px` literals in the context bar, text
bar and selection quick bar, so all five command surfaces share one grammar
and all three stop ignoring density and touch promotion.

**Verified.** `toolbar-divider-chrome.spec.ts` D1/D1-icon: radius 0, width
1px, height within 1px of the token-derived target, never transparent,
|left gap − right gap| ≤ 1px, no leading rule, and every icon within 0.5px of
its button's centre.

### P1 — A stray divider hung off the palette's trailing edge in every viewport

**Evidence.** `.floating-toolbar__actions` measured **10.91×9.91px at 480×700,
11.75×10.75px at 900×800, 12.5×11.5px at 1280×800** — an empty box with
`border-left: 1px solid`, with neither of its children rendered: the active
tool (Select) has no tool options, and `TabletTouchControls` is
`display: none` outside the tablet layout.

**Fix.** The container renders only when at least one of its three possible
controls exists (`hasToolOptions(state.tool) || isTabletLayout || touch
input`), and `TabletTouchControls` returns `null` off-tablet instead of
leaving a hidden node behind. Chromium's own `ToolbarView::Layout()` handles
the identical case by letting an empty trailing browser-actions cluster
contribute zero padding.

**Verified.** `toolbar-divider-chrome.spec.ts` D2.

### P1 — The palette declared its surface twice

**Evidence.** Both `.floating-toolbar__row` and
`.floating-toolbar [role="toolbar"]` declared `border`, `border-radius`,
`background` and `box-shadow`; the second was then zeroed by
`.floating-toolbar__row [role="toolbar"]`, and the whole first declaration was
dead because `.floating-toolbar--palette` (the card) now owns it. High contrast
added a third edge: an `outline` on the inner scroll box drew a rectangle
inside the card.

**Fix.** One owner. `.floating-toolbar__card` owns border, radius, surface and
shadow; the row and scroll box own layout only; high contrast thickens the
card's border instead of outlining an inner element.

**Verified.** D3: the row and scroll box report `border 0px`, `shadow none`,
`transparent` background, and exactly one element inside the palette casts a
shadow.

### P1 — The drawing workspace stacked two cards, and the second was left-aligned

**Evidence.** At 1440×900 the palette measured `696.6×45.5` and the brush row
`470.4×41.5` at the **same `x` (302.7)** — a second, narrower card flush to the
first card's left edge, each with its own border, radius, surface and shadow,
2.88px apart. Two floating cards where the brush controls are tool options of
the palette.

**Fix.** The brush row is a section of the same card, separated by a
`--separator-thickness` rule, stretching to the card's edges.

**Verified.** D4: both rows report identical left/right edges, the brush row
casts no shadow and has a `border-top`, and the palette still casts exactly
one.

### P2 — At narrow widths the card was pinned to a spanning wrapper's leading edge

**Evidence.** At 480×700 the wrapper measured `x 4.95, w 468.47` while the card
measured `x 4.95, w 447.34` — flush left with ~21px of dead canvas beside it.
The `@media (max-width: 640px)` override (`left/right`, `width: auto`,
`transform: none`) made the wrapper span the canvas while the card stayed
content-sized and block-laid-out inside it.

**Fix.** The override is gone. The base rules — `width: max-content` capped by
`max-width: calc(100% - var(--space-4))` — already give the bounded,
centred, scrollable strip the override was written for, without the side
effect. The rationale is recorded at the rule so the L2 (2026-08-10) intent is
not lost.

**Verified.** D5: symmetric insets within 3px, inside the canvas box on both
sides, and the scroll box filling the card rather than overflowing it.

### P2 — Two spacing rules that added a second distance to the row gap

The flyout chevron's `margin-right: var(--space-1)` and the drawing row colour
section's `margin-left` each sat on top of an existing flex `gap`, so the space
after every flyout was 5.92px where every other pair was 2.96px — which is also
why the divider that followed a flyout measured 2.95px away on one side and
2.96px on the other. Both margins are gone; the gap is the one distance.

## Tool grouping and workspace exposure

Grouping is content, not chrome, and it decides what a divider can honestly
claim. `WORKSPACE_CONFIGS` now carries the rule; what it was violating:

| Workspace | Before | After |
|---|---|---|
| Design | `… table │ Warp │ select …` — Warp in its own trailing group, two groups from `pen knife shapeBuilder nodeEdit` | Warp joins the vector group |
| Design | one 10-tool group: select, lasso, hand, zoom, slice, eyedropper, pixelProbe, scale, inspect | `select lasso hand zoom` │ `slice eyedropper pixelProbe scale inspect` |
| Print | the same 10-tool group | same split |
| Drawing | one 10-tool group: select, lasso, hand, zoom, text, eyedropper, pixelProbe, frame, panel, table | `select lasso hand zoom` │ `text frame panel table` │ `eyedropper pixelProbe` |
| Photo | `pen pencil line text table scale inspect` | `… table` │ `scale inspect` — `scale` now pairs with `inspect` everywhere |
| Photo | `scale` sat in a creation group; Design/Print had it in the measurement group; Motion and Email had `scale inspect` | one cross-workspace shape |

**Exposure.** Print declared Rect and Elliptical Marquee as two *flat* buttons
while Pixel Lasso, Magic Wand and Selection Brush were absent entirely — half
of a five-tool family, in a vector, typography and preflight workspace whose
sibling (Design) declares none of it. Both tools were removed from Print; they
remain registered, appear in the command palette as **Hidden from toolbar**,
and can be re-added from Customize Workspace. This is the one removal in this
review, and it is the shape Photoshop's own "tools missing" page describes —
hence the deliberate removal path rather than a silent one.

Design kept `paint` in its own group. That single-tool group is a true class
boundary (Design now paints, for clipped paint layers), not a stranded tool;
the distinction is written at `WORKSPACE_CONFIGS`.

**Not changed, recorded as open:** Email declares neither `eyedropper` nor
`pixelProbe` while every other workspace that samples colour declares both.
Email's own contract converts layout to HTML tables at export rather than
authoring a Table object, so its omission of the `table` tool is deliberate and
was left alone; the colour sampler looks like an oversight but was not changed
without a decision on what Email's colour workflow is meant to be.

## External failure evidence (what other apps got wrong)

Researched primary sources and documented user complaints, then mapped each to
a realistic action here.

| Documented failure | Source shape | Action taken |
|---|---|---|
| Photoshop: *"This separator appears to serve no purpose as the tools that precede and follow it form no distinct group of related tools"* — 11 upvotes, Adobe Community "Move the Toolbar separator" (2022, answered 2023) | Feature request against a separator that groups nothing | **Fixed.** The leading rule is suppressed, and Warp no longer sits between `table` and `select`. Groups now map to one concern. |
| Photoshop: separators removed in CC 2017, *"I used to rely on the separators to help me find things faster"* — r/photoshop (2017), two Adobe feedback threads from 2015 | Separators deleted rather than repaired | **Not taken.** Dividers stay; they are repaired so they are legible instead of being removed as unusable. |
| Photoshop: *"Tools missing from the toolbar"* — Adobe helpx, updated 2024 (workspace switch or saved preferences hide tools after an update) | Tools vanish from a workspace with no obvious route back | **Half-resolved.** Print's marquee tools were removed as a *wrong-workspace* decision, but the recovery routes the complaint asks for already exist here and are now asserted: command palette shows "Hidden from toolbar", Customize Workspace re-adds them. |
| Photoshop: *"Why did all my J tools got separated?"* — r/photoshop (2016): a tool family that belonged in one flyout rendered as separate slots, so the shortcut only cycled one | A family exposed inconsistently between workspaces | **Resolved.** Photo and Draw expose the pixel-selection and retouch families as flyouts; Print no longer exposes a 2-of-5 fragment. |
| Autodesk Fusion `addSeparator`: *"if there's nothing in between them, separators display on top of each other … you just can't tell"* — Autodesk Forums (2017) | A separator that separates nothing | **Fixed.** Leading rule suppressed; the trailing cluster no longer renders a divider when it has no controls. |
| Delphi `TToolBar` `tbsDivider`: the rule draws at the separator button's **left edge**, not centred between two buttons; *"the divider line is not exactly in the center between two buttons"* — Stack Overflow (2014) | Rule painted by a bordered neighbour instead of as its own element | **Fixed.** Same root cause as ours, same fix: the divider is an element, equidistant from both sides. |
| Chrome DevTools `Toolbar.hideSeparatorDupes()` and Chromium `ToolbarView::Layout()` (`browser_actions_->GetPreferredSize().IsEmpty() ? right_padding : 0`) | A shipped toolbar that normalises separators after layout and lets an empty trailing cluster contribute nothing | **Followed.** Both are the model for the leading-rule guard and the conditional trailing cluster. |
| Volvo Cars design system, Divider usage: *"Don't use a divider to fix layout or alignment issues. Fix the layout instead of covering it with a line"*; *"Maintain consistent padding … to the sides of the divider to establish a clear rhythm"* | The rule the violated spacing directly contradicts | **Fixed.** The `padding-left`/`margin-left` that caused both the icon offset and the asymmetry are gone; the rule no longer does layout work. |
| Material Design 1 and 3: *"Use full-width dividers sparingly. Too many divider lines will make an interface look cluttered"* | Over-divider risk of the opposite kind | **Bounded.** Group counts per workspace are unchanged in total (merging Warp −1, splitting a catch-all +1); no workspace gained more than one divider. |
| SAP UI5 `ToolbarSeparator` + SAP Community: separators *"do not adjust to the height of the Toolbar"* | Fixed-height rules that do not follow the row | **Fixed.** Height is `control height × --separator-toolbar-length-ratio`, so it follows density and touch promotion. |
| Material-UI #18022: a vertical `Divider` computes `height: 0` inside a flex container | A divider sized by percentage/`h-full` in flex | **Avoided.** The palette divider is an explicitly sized flex item (`flex: 0 0 auto` + `align-self: center`), not a stretched one. |
| KDE Phabricator T11665: *"nothing visually indicates that the buttons are grouped"* — long-standing Breeze-style request | Grouping cues are load-bearing, not decoration | **Kept.** This is why the review repaired dividers rather than removing them as noise. |
| Figma forum, 2025–2026: redundant persistent chrome that *"drives me crazy"*, on-canvas controls that cause misclicks, and a duplicate menu | Inert or duplicated chrome that occupies the working surface | **Partly resolved.** The empty trailing cluster and the second drawing card are gone. The largest of these — palette docking — is unchanged, below. |

Deliberately **not** claimed: no user study was run, so every preference here
is engineering judgement backed by the cited complaints, not a measured outcome
for Varve users.

## Verification performed

Environment: Linux (CachyOS), Chromium via Playwright, isolated dev servers on
ports 1491–1513, 480–1920px viewports, `--workers=1` through the heavy lease.

| Command | Result |
|---|---|
| `npx vitest run packages/editor/src/workspace packages/editor/src/components/{FloatingToolbar,ContextControlBar,SelectionQuickBar,FloatingTextBar} packages/ui/src/tokens` | **798 passed, 4 failed — all four pre-existing** (see below) |
| `npx playwright test tests/e2e/canvas/toolbar-divider-chrome.spec.ts` | **6 passed** |
| `npx playwright test toolbar-divider-chrome toolbar-per-mode toolbar-layout toolbar-keyboard-overflow` | **16 passed, 1 failed, 1 did not run** (the failure is `toolbar-layout`'s beforeEach click, reproduced on baseline too) |
| `npx tsc -p packages/editor/tsconfig.json --noEmit` | clean for every touched file |
| `npx tsc -p tests/e2e/tsconfig.json --noEmit` | clean |
| `npx biome check <touched files>` | clean |
| `pnpm audit:docs` / `pnpm audit:emoji` | clean (run by the commit checkpoint) |
| `pnpm exec biome check --staged`, `audit-health`, `secret-scan`, `audit-contacts`, `import-boundaries` | clean (commit checkpoint, three commits) |

Accessibility checks performed: one tab stop preserved across the new DOM
(`toolbar-keyboard-overflow.spec.ts`, 6 passed), `aria-keyshortcuts`
unaffected, dividers `aria-hidden` and excluded from the toolbar's button
query, icon centring (a hit-target concern) asserted to 0.5px.

### Pre-existing failures — reproduced at HEAD, not caused by this review

Each was re-run with the review's own changes reverted and failed identically:

1. `packages/editor/src/workspace/layersPanelConfig.test.ts` — expects
   `['component','layout']` for a non-workspace mode that falls back to Design
   (`['appearance','component','layout']`).
2. `packages/editor/src/workspace/__tests__/panelRegistry.test.ts` (×2) — the
   registered panel set has 10 entries against an 8-entry `PanelId` union
   (the `emailPreview`/`emailOutput` panels).
3. `packages/editor/src/workspace/dock/__tests__/dockProperty.test.ts` — random
   operation sequences violate a layout invariant.
4. `tests/e2e/canvas/toolbar-layout.spec.ts`'s beforeEach `Add publishing page`
   click was intermittently unstable because the shell transitions
   `grid-template-columns` under it and the canvas dock sweeps over the layers
   panel; its *assertion* also failed deterministically on master because it
   compared `floatingToolbar.bottom` against `pageNav.top` while Print's page
   nav is a left-hand column. Both forms are repaired in this review (see the
   last commit), and the repaired first test now passes with these changes.
5. `toolbar-layout`'s second test — `rectsOverlap(quickBar, pageNav)` returns
   `true`. **Reproduced on master**: the review's source files were reverted to
   their pre-review versions and this spec's own assertions run against them;
   it fails identically. The selection quick bar and page-nav overlap in the
   import-and-flip scenario, independent of anything in this review, and is
   left open rather than weakened.

## Remaining work (open, and why)

1. **Marketing screenshots showing the editor were not regenerated.**
   `apps/website/public/screenshots/*.png` are full-editor captures, so a
   handful still show the pre-fix palette (a curved group rule and the trailing
   stub). Regeneration is `pnpm screenshots:update`, which rebuilds the whole
   marketing set through `scripts/screenshots/product.mjs`,
   `screenshots:og.mjs`, `screenshots:workflow.mjs` and a website build — and
   `product.mjs` is currently carrying another session's in-flight changes, so
   running it here would capture their unfinished work alongside this fix.
   **Run it once that settles**; the copy on `docs/getting-started/interface.astro`
   and `docs/workspaces.astro` is already correct.
2. **Palette docking.** Still the dominant complaint in the external evidence
   (Figma's UI3 threads): the palette can move top/bottom but cannot be docked
   or dragged. Unchanged here — it changes the shell grid and every
   bottom-anchored surface, and deserves its own pass.
3. **Screen-reader, forced-colors, 200% text and touch passes** for the new
   divider elements — see "Honest gaps".
4. **Email's colour sampler.** `eyedropper`/`pixelProbe` are declared in every
   workspace that samples colour except Email; needs a decision on Email's
   colour workflow rather than a quiet addition.

## Honest gaps

- **No screen-reader pass** (NVDA/VoiceOver/Orca) on the new divider elements,
  and no forced-colors or high-contrast *capture* of them. The token swap does
  change high contrast deliberately: `--color-border-subtle` (white in HC) to
  `--color-separator-subtle` (mid-grey in HC), matching what the menu and
  menubar separators already render there — but that was reasoned from the
  token table, not captured.
- **No 200% text-enlargement or 320px reflow pass** for the changed chrome.
- **No physical touch/pen verification** of the touch-promoted 44px divider
  height.
- **The E2E set was not run to completion**: `workspace-toolbar-visual`,
  `toolbar-surface-review`, `toolbar-followup`, `font-toolbar-visual` and
  `selection-quick-bar` were not executed in this session. The unit suites and
  the four E2E files named above were.

## Agent validation report

```text
Changed scope: packages/ui (token generator + generated tokens.css);
  packages/editor/src/components/FloatingToolbar/**,
  ContextControlBar/ContextControlBar.css, FloatingTextBar/FloatingTextBar.css,
  SelectionQuickBar/SelectionQuickBar.css, workspace/workspaceTypes.ts;
  tests/e2e/canvas/{toolbar-divider-chrome,toolbar-per-mode,toolbar-layout};
  docs/architecture/toolbar-system.md, docs/audits/toolbar-design-review-2026-09-29.md,
  docs/screenshots/toolbar-design-review-2026-09-29/**
Validation plan: `pnpm verify:plan` reports FULL-SUITE ESCALATION: YES — driven
  by the concurrent sessions' ~375 dirty files (vitest.setup.ts,
  scripts/quality/*, Cargo.lock), not by this review's paths.
Commands actually run: the unit and browser commands in the table above; three
  commit checkpoints (each ran biome --staged, audit:emoji, audit-health,
  audit-impact-config, secret-scan, audit-contacts, audit-interface-sizing,
  import-boundaries and the affected unit/typecheck closure).
Passed: as listed.
Skipped as unrelated: Rust/Cargo workspace, native desktop GUI matrices,
  model-quality, packaging, signing, website e2e, benchmarks — no Rust,
  packaging or website build path was touched by the code commits.
Escalations: none triggered by this review's paths.
Full suite run: no. Reason: no workspace/toolchain/test-runner/schema change
  attributable to these paths; the planner's escalation came from other
  sessions' dirty files.
```

## What users can now do more reliably

- Read the row by group: every separator is a straight, evenly spaced rule that
  actually marks a change of concern, and none of them opens a group of one
  that means nothing.
- Find a tool where its family is: Warp is with the other path tools, `scale`
  is with `inspect` in every workspace, and Print no longer shows two of the
  five pixel-selection tools as flat buttons.
- See no chrome that has nothing behind it — no stub at the palette's trailing
  edge, no second card under the drawing palette, no dead surface beside the
  palette on a narrow screen.
