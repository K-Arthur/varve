# Workspace switcher design review (2026-09-29)

Scope: the workspace switcher in the editor menubar — the dock
(`packages/editor/src/components/WorkspaceTabs.tsx`), its `.workspace-dock*`
recipes in `packages/editor/src/editor.css`, the per-mode identity tokens in
`packages/ui/src/tokens/color.ts`, its overflow "More workspaces" menu, the
copy about it in `docs/` and on the website, and the narrow-width presentation
its layout depends on.

Reviewer: agent session, on `master` at `d28fee6a5`. Ownership record:
`docs/agents/workspace-switcher-design-2026-09-29-ownership.md`.

This is a **follow-up** to `docs/audits/workspace-switcher-review-2026-09-15.md`
(F1–F10, all fixed there) and to the re-verification in
`docs/audits/design-system-audit-2026-09-27.md` §8. The 2026-09-15 review fixed
the contrast of the **active pill**; this one looks at what the switcher puts
on screen *around* the pill — the number chips, the container treatment at
narrow widths, and the contrast of the state that is on screen most often
(an *inactive* mode).

Trigger (user directive): *"comprehensively review fix and improve the frontend
design of the workspace switcher … it has a few issues and problems such as
redundant design in certain view-ports especially and bad contrast … don't just
research on what works but also what other apps and offerings have failed at."*

## Method

1. Source and token inventory (component, CSS cascade, overflow math, tokens,
   marketing copy).
2. Rendered baseline: the real app at 1920/1440/1280/1024/900/899/800/640/480/
   360 CSS px across light, dark and high contrast, with the dock's computed
   box, its childrens' boxes and the painted sRGB bytes of every mode sampled
   (`docs/screenshots/2026-09-29-workspace-switcher-design-review/`, and the
   before/after pairs below).
3. Design-variant probes in the running app (badges on/off, raised card vs flat
   container) so the treatment decision was made against pixels, not sliders in
   a mock.
4. Research gate on the two mechanisms in play — permanent shortcut chrome on
   icon controls, and per-mode colour as the only identifier — plus the
   switcher failures users actually file.
5. Repair at the lowest shared layer, then new real-app verification
   (`tests/e2e/workspace/switcher-design-review.spec.ts`).

## Research record

Consulted 2026-09-29. Sources describe other products and general findings;
none is a claim about Varve users.

| Source | Finding | Applied as |
|---|---|---|
| NN/g, *The Same Link Twice on the Same Page* (nngroup.com/articles/duplicate-links/) | "Place redundant links far apart from each other. If they can be seen together within the same view, then it's an indication that you may have too much redundancy." Each extra copy also "increases the interaction cost" and "depletes users' attention". | The number chip was a second copy of the shortcut fact already carried by the tooltip, `aria-keyshortcuts`, the `data-shortcut-key` attribute and the overflow menu's badge — all visible together. Removed (F1). |
| NN/g, *4 Dangerous Navigation Approaches that Can Increase Cognitive Strain* (nngroup.com/articles/navigation-cognitive-strain/) | "Designers know these links are duplicates, but users do not." | Same: the chip is only recognisable as a duplicate to whoever wrote it. |
| IconHK, *Using Toolbar Button Icons to Communicate Keyboard Shortcuts* (inria.hal.science/hal-01444365v1/document) | Embedding shortcuts in an icon control "can dramatically increase the complexity of the icon and affects its readability"; a stated goal is to "minimize the visual space used to convey shortcuts". | The chip was a bordered disc pinned to a 28px icon's corner. Removed (F1). |
| Bailly et al., *Promoting Hotkey Use through Rehearsal with ExposeHK* (gillesbailly.fr/publis/BAILLY_ExposeHK.pdf) | Permanent pre-learning of hotkeys causes a "performance dip" that "traps the user in pointer-based 'beginner mode'"; the researched alternative is on-demand display. | The chord stays on demand (tooltip, menu, shortcut reference) rather than permanently (F1). |
| *ShoCons: Effective Display of Shortcuts in Icon Toolbars* (scitepress.org/Papers/2019/84945/84945.pdf) | "Continuous display of shortcut mappings might overload the interface, which is already quite busy in complex applications." | The switcher shares a 273px strip with six controls at 1920 and a full row with the app menus at 640; the chips were the busiest element in it. Removed (F1). |
| NN/g, *UI Copy: UX Guidelines for Command Names and Keyboard Shortcuts* (nngroup.com/articles/ui-copy/) | Shortcuts "need to be easy to learn and memorize", and there is "little room to communicate about them in the interface", so expose them in menus and tooltips. | The ordered mapping survives in the tooltip, the `More workspaces` rows and View ▸ Workspace (F1). |
| Adobe community, *Workspace Switcher Does Not Display Current Workspace* (2017), community.adobe.com/questions-712/workspace-switcher-does-not-display-current-workspace-1151099 | Photoshop replaced the workspace name with an icon; the reply: "one has to click instead of just looking to see what Workspace one is using." | The active workspace must be named wherever it fits — including phone-width landscape, where our own CSS collapsed the label to `width: 0` even though the row had 96px to spare (F5). |
| Photoshop Gurus, *missing workspace button on options bar* (2015), photoshopgurus.com/forum/threads/missing-workspace-button-on-options-bar.54772/ | At narrow widths the workspace dropdown silently disappeared and the user reset preferences chasing it. | The switcher must never be the control that silently degrades; the compact tier keeps the pill, the overflow and the name-where-it-fits (F2, F5). |
| DaVinci Resolve 18.6 manual, *Switching Among Pages* §12 | Positive counter-pattern: page buttons are "organized in order of workflow, and they're always available", offer *Show Icons and Labels* / *Show Icons Only*, and hidden pages stay reachable by menu and shortcut. | The contract this review preserves: ordered, always available, active mode named when it fits, everything else one interaction away (F2, F5). |
| Blackmagic forum, *UI redundancy on multiscreen* (thread 125551) | Users describe the stacked page/workspace/layout controls as "redundancy, duplication and non optimal space utilization". | Two floating-surfaces-looking-like-one is a redundancy users name themselves (F2). |
| Blender developer archive, *T50845 Top Bar Design* | "workspaces and layouts is confusing, it just feels redundant and overkill"; the drop-downs "take a lot of unnecessary space on the bar." | Same class of finding: switcher chrome that duplicates another surface's job costs real space (F2). |
| Blender developer talk, *Ways of differentiating workspace tabs from menus and buttons* (devtalk.blender.org/t/ways-of-differentiating-workspace-tabs-from-menus-and-buttons/10592) | "Can you tell me what is a button, what is a tab and what is a menu?" — flat chrome erases the affordance boundary between tabs, buttons and menus. | When the container is flattened below 900px, the active pill keeps its opaque accent fill so the "current tab" boundary survives (F2). |
| Figma, *Our approach to designing UI3* (figma.com/blog/our-approach-to-designing-ui3/) | Figma's own retrospective: an icon-only control hid the chosen mode until a tooltip; they "restored inline state". | Supports keeping the named active pill (F5) rather than degrading to icon-only wherever a width query feels like it. |
| NN/g, *Universal Navigation* (nngroup.com/articles/universal-navigation/) | "If the design displays two navigation bars … people should be able to identify the navigation related to the current site and distinguish it from the universal navigation." | Two tiers must look like two tiers; the switcher should read as top-bar chrome below 900px, not as a third floating surface beside the toolbar (F2). |
| NN/g, *Hamburger Menus and Hidden Navigation Hurt UX Metrics* (nngroup.com/articles/hamburger-menus/) | Hidden navigation is measurably worse than visible navigation, so hiding it is a last resort. | Used as the *cost* side of F6: a scrollable menu rail hides the tail of the menu, so the rail only scrolls in the narrow band where the alternative is a menu item that is covered and unclickable. |
| W3C WAI, *Understanding SC 1.4.11* ("Buttons" figure) | Where the visual indicator of a control is the only way to identify it, that indicator must have sufficient contrast. | Cited alongside 1.4.11 above: the fix is to reassign the token role (a pill fill vs a glyph on the bar), not to drop per-mode identity (F3). |
| WCAG 2.2, 1.4.3 Contrast (Minimum) | 4.5:1 for normal text. | Pill label measured in every theme (F3). |
| WCAG 2.2, 1.4.11 Non-text Contrast | 3:1 for "visual information provided that is necessary for a user to identify that a control is present". | The inactive icon is that information, so it is held to 4.5:1 here, not 3:1 (F3). |
| WebAIM, *Understanding WCAG 2 Contrast and Color Requirements* (webaim.org/articles/contrast/) | "You cannot round a contrast ratio up to 4.5:1." | Design's glyph measured 3.23:1 before the fix — it passed nothing; the new floor is enforced by `audit:tokens`, not by eye (F3). |
| Apple, *Differentiate Without Color Alone* (developer.apple.com/…/differentiate-without-color-alone-evaluation-criteria/) | "Users shouldn't have to rely on color to distinguish different selection states or values"; supply an increased-contrast option for custom colours. | High Contrast still collapses all six modes to one accent, and the active state keeps fill + label so hue is never the only cue (unchanged, re-verified). |

Deliberately not claimed: no user study was run; no Varve user was surveyed. The
preference statements are engineering judgement backed by the sources above.

## Findings

Severity: **P0** blocks access or corrupts meaning; **P1** breaks a task or a
stated contract; **P2** polish/consistency.

### F1 — Every tab carried a number chip that duplicated four other channels (P1, verified)

Each visible tab rendered a `kbd` number chip (`1`…`6`) pinned to its
bottom-inline-end corner. The same fact was already available four other ways:
the tab's tooltip (`shortcut` prop), the tab's `aria-keyshortcuts`, the
`More workspaces` menu row's badge, and View ▸ Workspace. Measured at 1920
(light): the chip's box was `14×14` at `right = item.right + 3`,
`bottom = item.bottom + 2` — outside its own control, and past the bar's 3px
block padding, so it overhung the container's edge.

The chip was also the wrong shape for its meaning: an opaque disc with a 1px
border and `--color-text-secondary` text, drawn on top of the accent fill of
the active pill (see the light captures in this directory before the change,
and `before/` if regenerated). At a glance it reads as a notification or error
counter, not as a shortcut.

The product had already reached this conclusion for one presentation: an
uncommitted rule (`html[data-layout-mode="tablet"] .workspace-dock__shortcut`,
removed here) hid the identical chip with the comment *"Tablet keeps shortcut
discovery in the accessible names and tooltips; hiding tiny keyboard badges
removes a second visual layer from its dock."* A concurrent session's
uncommitted assertion in `tests/e2e/interaction/chromeos-device-matrix.spec.ts`
("keyboard-only badges should not crowd the touch switcher", expecting `0`)
encodes the same requirement for the portrait tablet case.

**Fix.** The chip is gone at every width. The ordered 1–6 mapping is carried by
`data-shortcut-key` on the radio (so the mapping stays assertable and
introspectable), `aria-keyshortcuts`, each tab's tooltip, the overflow menu's
badges, the View ▸ Workspace submenu and the shortcut reference. The web copy
that promised "each tab marked by its matching number" was updated in the same
change set.

### F2 — Below 900px the switcher was a third floating surface (P1, verified)

`.workspace-dock__bar` is a raised card at every width: opaque
`--elevation-surface-raised`, a 1px `--color-border-subtle` border,
`--radius-floating` and `0 2px 8px` shadow — the same construction, radius and
shadow as the **floating toolbar**.

That is the right treatment inside a single-row desktop menubar, where the card
is what groups the segmented control and separates it from undo/redo and the
zoom field. Below 900px it stops being right:

- **Portrait** puts the switcher on its own full-width second row
  (`docs/architecture/responsive-workspace.md`). Measured at 480×900: the
  switcher's card and the floating toolbar at the bottom of the same viewport
  rendered as the same shape, the same radius and the same shadow — two
  floating cards, three rows apart, on one screen.
- **Landscape** keeps the switcher inline behind the application menu rail, and
  the card painted its shadow over the last menu label. `0 2px 8px` spreads 8px
  in every direction, so at 640×400 the card's *box* began at the menu rail's
  right edge and its *shadow* reached 8px further left, into the label.

**Fix.** `@media (max-width: 899px)` flattens the container only:
transparent background, transparent border, no shadow. The active pill keeps
its opaque accent fill, so the current workspace is still the most prominent
thing in the strip and the tab-vs-button boundary Blender's users complained
about stays legible. Hit targets and the 44px rhythm are untouched. At ≥900px
the card is unchanged.

### F3 — Light theme: the inactive mode glyph barely cleared the non-text floor (P1, verified)

An inactive mode's only visual identifier is its 16px stroke icon; its name is
in the tooltip and the accessible name. Measured on the rendered bar
(`surface-raised`, `oklch(0.99 0.006 260)`) with the pre-change tokens:

| Mode | Token | Rendered | Δ over the 3:1 floor |
|---|---|---|---|
| Design | `B(6)` | **3.23:1** | +0.23 |
| Motion | `O(8)` | **3.59:1** | +0.59 |
| Draw | `G(8)` | 3.90:1 | +0.90 |
| Photo | `I(7)` | 4.22:1 | +1.22 |
| Print | `V(7)` | 4.32:1 | +1.32 |
| Email | `T(8)` | 4.61:1 | +1.61 |

Design is the boot mode, so the weakest glyph in the set is the one every new
session sees first. In dark theme the same roles rendered 9.2–11.2:1, which is
why the fault read as "washed out in light mode" rather than as a missing
colour.

**Fix.** In light theme `workspace-icon-<mode>` now uses the same ramp step as
that mode's `workspace-accent-<mode>`: one hue, one step, two roles (a pill
fill that hosts `text-on-accent`, and a glyph on the bar). Rendered now:
4.61–5.85:1. The `audit:tokens` grade for the six
`workspace-icon-<mode> on surface-raised` pairs was raised from `UI` (3:1) to
`AA` (4.5:1) with the reason recorded in `color.ts`, so the margin is enforced
rather than reviewed once. All 303 pairs still pass in all three themes.

### F4 — Two portrait blocks described the same rules with opposite intent (P1, verified)

`editor.css` held two
`@media (max-width: 899px) and (orientation: portrait)` blocks that both
targeted the switcher. The first set `min-inline-size: 32px` and
`label { display: none }`; the second, later in the cascade, set
`--dock-item-size: 44px`, `min-inline-size: var(--touch-target-min)` and
`label { display: inline; width: auto; opacity: 1 }`. Every switcher
declaration in the first block was dead, and the dead code made the
narrow-width behaviour unreadable from the cascade — including for whoever
edits the portrait tier next.

**Fix.** The first block keeps only what it owns (hide the duplicated document
title and zoom, make the menu rail scroll); the switcher's portrait sizing
lives in exactly one place. No rendered value changed — the later block already
won — and the block now says so.

### F5 — Phone-width landscape dropped the active workspace name with room to spare (P1, verified)

`@media (max-width: 640px)` forced the active pill to 28px and its label to
`width: 0; opacity: 0`. `computeWorkspaceLayout` measures *rendered* tab widths,
so a CSS-collapsed label reads as zero for ever: `compactActive` could never be
true for the right reason, and the pill was 28px even when the row was empty
around it.

Measured at 640×400 before the fix: the dock's wrapper was 282px wide, the bar
186px, the application menu rail ended at 299px, and the row held 96px of
unused space between the switcher and undo/redo while the active workspace's
44px name was hidden. This is exactly the Photoshop complaint in the research
table — the current workspace is not named, so it has to be discovered by
clicking.

**Fix.** The width query is gone; `computeWorkspaceLayout` decides. At 640×400
the bar now measures 240px, the name is present at `width: 44`, `opacity: 1`,
and `compactActive` is false. At 360×740 the measurement genuinely does not fit
six tabs with a name, so the pill compacts to its icon and the name moves to
the tooltip and accessible name — the documented contract, now driven by the
measurement rather than by a media query.

### F6 — Between 641px and ~750px the switcher covered the Help menu, and stole its clicks (P1, verified)

`==.editor-menubar__side` and `.editor-menubar__controls` are both
`flex: 1 1 0` on purpose — the symmetry is what puts the document title on the
bar's true midpoint. The menu rail inside `.editor-menubar__side` had no
`min-width: 0`, so between 641px and ~750px (where the menus' min-content width
of ~349px exceeds the half the symmetry gives them) the rail painted *outside
its own box*, over the switcher. Because `.editor-menubar__controls` follows
the rail in the DOM, the switcher won hit-testing at the overlap.

Measured, hit-tested 4px inside the last menu label:

| Width | Rail box | Last label right | Dock box x | Overlap | What the click hit |
|---|---|---|---|---|---|
| 641×500 | 24–372 | 372 | 322 | 50px | `workspace-dock__item--active` |
| 660×500 | 24–373 | 373 | 331 | 41px | `workspace-dock__item--active` |
| 700×500 | 24–374 | 374 | 351 | 22px | `workspace-dock__bar` |
| 760×500 | 28–379 | 379 | 381 | none | `editor-menubar__item` |

So at those widths clicking the tail of **Help** switched the workspace or hit
the dock container. This is the "redundant chrome in certain viewports" the
directive described, in its most concrete form: one piece of chrome occupying
another's space and its target area.

**Fix.** The rail is constrained in the same compact tier:
`min-width: 0`, `flex-shrink: 1`, `overflow-x: auto` with a hidden scrollbar —
the treatment the portrait tier already documented ("the menu strip can scroll
rather than clip"). The rail's clip box now ends 3px before the switcher at
641–760 and 64px before it at 899; the same hit test lands on
`editor-menubar__item` at every width; and the rail scrolls by 57px at 641 and
0px at 899, so the strip is reachable by scrolling instead of being painted
over. Scrolling a menu rail is itself a cost, which is why the change is
scoped to the tier where the alternative is a covered, unclickable menu.

## Decisions and deliberate exceptions

- **The number chip is removed, not restyled.** Keeping it and only hiding it
  on coarse pointers was the alternative (it is what the tablet rule and the
  concurrent assertion asked for). It was rejected because the chip is
  redundant at *every* width — the desktop single-row strip is where six
  chips occupy the largest share of the control — and because a shorter chip
  still duplicates the tooltip that appears on hover of the same control at
  the same moment. Superseded mechanism: `0805eb0`'s "registry-derived 1–6
  markers in radio order"; the requirement it answered (the numbers must not
  skip or disagree with the switcher order) is preserved by the tab order,
  `data-shortcut-key`, `aria-keyshortcuts` and the tooltips.
- **The flat compact treatment is a media query, not a class.** It is derived
  from the presentation tier (`max-width: 899px`), the same condition the
  responsive contract uses for the drawers and the two-tier portrait menubar.
  Adding a JS-toggled class would put a presentation decision in the component
  and risk it disagreeing with the layout it describes.
- **The pill keeps its fill when the container flattens.** Removing both would
  leave a row of equally weighted glyphs with no visible "you are here"
  (Blender devtalk, 2019).
- **AA (4.5:1) for the inactive icon, not 3:1.** WCAG 1.4.11 requires 3:1 for
  the visual information needed to identify a control; this icon *is* that
  information, at a 16px stroke and a 2.25px weight, so it is held to the text
  bar. Over-requiring here costs one ramp step per mode and removes the whole
  "which step did this mode get?" class of regression.
- **Per-mode hue survives every theme except High Contrast.** Unchanged from
  the 2026-09-15 review: hue is a discovery aid, never a state cue. High
  Contrast defines all six modes as the single HC accent.
- **The >=900px raised card is unchanged.** It is load-bearing there (it groups
  the segmented control against undo/redo and zoom on one line) and it is the
  only place the switcher has room to be a distinct object.
- **The menu rail is constrained, not the switcher.** F6 could have been fixed
  by letting the menus win the space and making the switcher compact harder
  (`.editor-menubar__side { flex: 0 1 auto }`). Rejected: at 641px that halves
  the dock's flex width, and the switcher's own documented degradation (compact
  pill + overflow menu) then hides three of six workspaces behind an extra
  interaction while the menus stay fully visible. The chosen fix costs a
  scroll on the menu strip only in the 641–760px band, where the menus need
  ~349px and the 50/50 symmetry gives them ~320px.
- **Inactive tabs remain icon-only.** Unchanged trade-off from 2026-09-15;
  re-measured here only to confirm the contrast of that chosen state.

## Implementation

| Change | Where |
|---|---|
| Light `workspace-icon-*` = the mode's accent step; icon contrast pairs raised to `AA` with the reason in code | `packages/ui/src/tokens/color.ts`, `packages/ui/src/tokens/tokens.css` (generated) |
| Number chip removed; `data-shortcut-key` moved onto the radio; reason recorded in the component | `packages/editor/src/components/WorkspaceTabs.tsx`, `packages/editor/src/components/WorkspaceTabs.css` (deleted) |
| Compact tier flattens the container at `max-width: 899px`; the menu rail is constrained (`min-width: 0` + hidden-scrollbar `overflow-x`) so it cannot paint over or steal the switcher's targets; phone-width label clamp removed; portrait switcher rules consolidated into one block; dead tablet chip rule removed | `packages/editor/src/editor.css` |
| Ordered-mapping contract, badge-free assertion, geometry lookup | `WorkspaceTabs.test.tsx`, `tests/e2e/workspace/dock-layout-geometry.spec.ts` |
| Real-app design-review contract (6 tests) | `tests/e2e/workspace/switcher-design-review.spec.ts` (new) |
| Switcher contract: chip, container tier, contrast grade, name-at-phone-width | `docs/architecture/workspace-system.md` |
| Switcher treatment at the compact breakpoint and the phone-width naming rule | `docs/architecture/responsive-workspace.md` |
| Marketing claim about the number markers, and the switcher description | `apps/website/src/pages/features/workspaces.astro`, `apps/website/src/pages/docs/workspaces.astro`, `apps/website/src/pages/docs/getting-started/interface.astro` |

## Verification performed

Environment: Linux (CachyOS), Chromium via Playwright, isolated dev server,
1920×1080 / 1440×900 / 1280×800 / 1024×768 / 900×600 / 899×600 / 800×1280 /
640×400 / 480×900 / 360×740 viewports, all three themes.

| Command | Result |
|---|---|
| `npx vitest run packages/editor/src/components/WorkspaceTabs.test.tsx` | 8 passed |
| `pnpm audit:tokens` | 303 pairs pass across 3 themes; icon pairs now `AA`; usage scan clean |
| `pnpm --filter @varve/ui tokens:generate` | `tokens.css` regenerated |
| `pnpm typecheck:e2e` | clean |
| `npx biome check` on every touched file | clean (3 pre-existing `noDescendingSpecificity` warnings in untouched regions of `editor.css`) |
| `tests/e2e/workspace/switcher-design-review.spec.ts` (heavy lease) | see "Verification results" |
| `tests/e2e/workspace/dock-layout-geometry.spec.ts` | see "Verification results" |
| `tests/e2e/interaction/chromeos-device-matrix.spec.ts -g "portrait menubar compaction"` | see "Verification results" |

### Verification results

Filled in from the leased run recorded in
`docs/agents/workspace-switcher-design-2026-09-29-ownership.md`; the raw
captures are the PNGs in this directory.

- **F1** — zero painted chips and zero overhanging tab children at 1920; six
  `data-shortcut-key` carriers in radio order; `aria-keyshortcuts` intact.
- **F2** — opaque surface + shadow at 1024; transparent surface, no shadow at
  899/800/640/480, with the active pill still opaque at each.
- **F3** — 18 mode/theme combinations measured from painted sRGB bytes; every
  pill label, pill icon and inactive icon ≥ 4.5:1.
- **F4** — 800×1280 portrait: 44px switcher items, active name visible.
- **F5** — 640×400: name present at 44px, `opacity: 1`, `compactActive` false;
  360×740: pill compacts and the name moves to tooltip/accessible name.
- **Menu rail** — the switcher paints at or after the rail's end at
  640/700/899/900, and the overflow still lists every hidden mode.

## Remaining work

1. **Inactive-tab labels** remain an icon-only trade-off (unchanged from
   2026-09-15), though the AA margin on those icons is now real.
2. **Browser/OS text-size and assistive-technology matrices** for this surface
   remain untested here (same honest gap as 2026-09-15): no screen-reader run
   (NVDA/VoiceOver/Orca), no physical touch/pen, no WebKitGTK shell.
3. **The concurrent tablet-mode session's work** (two-tier portrait menubar,
   touch chrome scale) is carried in the commits that touch `editor.css`; see
   the ownership record for exactly which hunks are theirs.
4. **CHANGELOG entry deferred** — `CHANGELOG.md` holds another session's
   uncommitted entries, so a pathspec commit would have swept them in. Ready to
   paste under Unreleased/Changed: "The workspace switcher no longer paints a
   shortcut chip on every tab (the chord stays in the tooltip, the overflow
   menu and `aria-keyshortcuts`); below 900px it reads as top-bar chrome
   instead of a second floating toolbar; the active workspace keeps its name at
   phone widths; and the inactive mode glyphs meet AA as the only identifier of
   an inactive mode."

## Agent validation report

```text
Changed scope: packages/editor/src/components/WorkspaceTabs.tsx(+test),
  packages/editor/src/components/WorkspaceTabs.css (deleted),
  packages/editor/src/editor.css (dock recipes + compact/portrait tiers),
  packages/ui/src/tokens/color.ts, packages/ui/src/tokens/tokens.css (generated),
  tests/e2e/workspace/switcher-design-review.spec.ts (new),
  tests/e2e/workspace/dock-layout-geometry.spec.ts,
  docs/architecture/workspace-system.md,
  docs/architecture/responsive-workspace.md,
  docs/audits/workspace-switcher-design-review-2026-09-29.md (this file),
  docs/agents/workspace-switcher-design-2026-09-29-ownership.md,
  docs/screenshots/2026-09-29-workspace-switcher-design-review/**,
  apps/website/src/pages/features/workspaces.astro,
  apps/website/src/pages/docs/workspaces.astro,
  apps/website/src/pages/docs/getting-started/interface.astro
Validation plan: pnpm verify:plan escalates to a full gate on the working tree
  because it holds several concurrent sessions' changes (cargo/Cargo.lock, six
  workspace-mode consolidation, tablet mode, presentation decks, GPU
  qualification). The escalation is driven by those unrelated paths, not by
  this review; the affected closure for the touched files was run directly.
Commands actually run: the table under "Verification performed".
Passed: all of the above.
Skipped as unrelated: Rust/cargo workspace, native desktop matrices,
  model-quality, packaging, signing; no Rust, packaging or release path touched.
  Whole-editor Playwright projects not selected above.
Escalations: none.
Full suite run: no. Reason: no workspace/toolchain/test-runner/schema change.
```
