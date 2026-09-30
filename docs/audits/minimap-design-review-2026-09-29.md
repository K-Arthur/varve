# Minimap Design Review — 2026-09-29

## Scope

A frontend-design review of the canvas minimap, covering visual composition,
contrast, control redundancy, interaction affordance, and responsive behaviour.
The work was performed on `master`; unrelated pre-existing worktree changes from
concurrent sessions were preserved.

Two user-reported symptoms drove the review:

1. **"Redundant design in certain viewports"** — the panel claimed a region it
   did not use, and repeated controls that already exist elsewhere.
2. **"Bad contrast"** — the drawn artwork was effectively invisible in the
   default theme.

The canonical contract after this review is
[Minimap System](../architecture/minimap-system.md).

## Method

- **Live measurement** of the rendered panel at 900×600, 1024×700, 1440×900 and
  1920×1080 in Light, Dark and High Contrast, including canvas-pixel histograms
  and computed styles read through Playwright against the running Vite app.
- **Code review** of `minimapLayout.ts`, `minimapRenderer.ts`, `MinimapPanel.tsx`
  and `minimap.css`.
- **Contrast arithmetic** run against the repository's own `oklchContrastRatio`
  over all three theme maps, before and after.
- **External evidence** on what overview panels get wrong elsewhere, prioritised
  for failure modes that are cheap for us to resolve. Sources are listed in
  [External evidence](#external-evidence).

## Baseline measurements (before)

At the default 1440×900 window, with a normal sidebar width:

| Metric | Measured |
|---|---|
| Panel card | 302.3 × 160.8 CSS px |
| Map canvas | **120 × 120 CSS px**, left-aligned |
| Empty card area | **~156 px wide — 51% of the card** |
| Map background | `--color-surface-raised` (Light: `oklch(0.99 0.006 260)`) |
| Dominant shape ink | `--color-border-subtle` → **rgb(221,233,222)** |
| Shape ink on map background | **1.19:1** (Light), 1.55:1 (Dark), 21.00:1 (High Contrast) |
| Group/frame stroke | `--color-border-subtle` → same **1.19:1** |
| Header controls | object count · **Fit** · hide-chevron · rail-collapse — four items |
| Theme change | canvas kept **light-theme tokens** under a dark panel |

The two dominant canvas colours accounted for 95% of the map's pixels, at a
1.19:1 ratio — the artwork was a pale shape on a pale field, distinguishable
only by its edge, and that edge was the same 1.19:1 tone.

## Findings and corrections

| ID | Severity | Finding | Correction |
|---|---|---|---|
| D-01 | High | Shape, text and group ink all resolved from `--color-border-subtle`, measuring **1.19:1** against the map backplate in Light. The default theme's artwork was invisible. | New `minimap-ink-frame/shape/text/image/adjustment` tokens, each measured **3.49–4.79:1 in Light, 3.67–5.04:1 in Dark and 19.08:1 in High Contrast** against `surface-sunken`, and locked as contrast pairs so `pnpm audit:tokens` re-verifies them. |
| D-02 | High | The canvas was sized to hug the content aspect inside a card that stretched the full sidebar width, leaving **51% of the card empty** at the default window size, and `minimap.css` simultaneously declared `width: 100%` on the canvas — a declaration the inline size from the renderer always overrode, so the stylesheet and the layout disagreed about who owned the size. | `computeMinimapSize` now produces a *stage* that fills the available width and takes its height from the content, clamped to 48–168 px tall. The dead `width`/`height` declarations were removed; the stage's own content box is the width budget. An initial 320 px width ceiling was caught by the responsive E2E assertion at 1920 (`canvas fills its stage`) and removed: for a wide document the *width* binds the fit, so the ceiling was making the map 23% smaller than the rail could carry — the same "fixed pixel size on a growing display" failure the competitor threads complain about. |
| D-03 | High | The map kept **light-theme colours under a dark panel** whenever the theme changed outside React (OS scheme under a `system` preference, a `storage` event, a direct `applyThemePreference`). `colors` was memoised on `editor.state.themeRevision` alone. | Observe `data-theme` with a `MutationObserver` plus `prefers-color-scheme` and `prefers-contrast`, and re-resolve on any change. |
| D-04 | Medium | The header repeated a **"Fit" button** that duplicates the StatusBar Fit group (Fit page / Fit all / Fit selection), the View menu, and the map's own double-click/`Enter`/`Space`/`Home` gesture — four routes to one command inside one 12 px strip. | Removed. The map keeps the documented gestures; the StatusBar and View menu keep the buttons. |
| D-05 | Medium | Frame and page labels were drawn as small as **5 px** in a hard-coded `system-ui` stack, and auto-generated names ("Frame 4") were drawn as if they oriented someone. | 7 px floor, 10 px cap, resolved from `--font-body`, and auto-generated names are never drawn (`isOrientationLabelWorthy`). Below the floor the label is omitted rather than mushed. |
| D-06 | Medium | The viewport rectangle was unbounded: while panning near a document edge its surviving half rendered as **two bare lines through the artwork**, and at high zoom it could collapse to a sub-pixel sliver. | Clipped to the map stage (`clipFootprintToStage`) and inflated to a 14 px floor. Hit-testing uses the same clipped shape plus a 10 px tolerance, giving a ~34 px effective target (WCAG 2.5.8 needs 24×24). |
| D-07 | Medium | When the viewport left the map entirely, the outline vanished with no explanation, leaving a markerless panel that reads as broken. | A chevron on the nearest map edge points at the off-stage viewport. |
| D-08 | Medium | The header's available-height budget read **zero** in production: the panel's `parentElement` is an `<ErrorBoundary>` wrapper that is `display: contents`, so every "fraction of available space" clamp was silently inert and sizing fell through to its hard ceiling. | Read the nearest ancestor with a real layout box; measure the stage's content box for width; measure before paint in `useLayoutEffect`. |
| D-09 | Medium | The exceptional-scale badge read "N flagged" with no action — a diagnostic with no verb. | The badge reveals the flagged object (`revealSelection({ behavior: 'reveal' })`) without selecting it. |
| D-10 | Low | Every circle and ellipse was drawn as its **bounding box**, so the overview lost the one silhouette that makes an ellipse recognisable. | `MinimapEntry.paint` distinguishes an `ellipse` class drawn as a silhouette via `ctx.ellipse`. Form now carries the distinction (WCAG 1.4.1) rather than hue alone. |
| D-11 | Low | Group outlines were painted over children that already carry the same edge — a redundant second rectangle per group. | Groups still contribute to content bounds but are no longer painted. |
| D-12 | Low | The hide-map chevron target was **20×20 px**, below WCAG 2.5.8's 24×24 minimum. | Sized from `--component-xs-height` (24 px). |
| D-13 | Low | With no measurable viewport, the map still advertised click/drag/arrow interaction that silently did nothing. | `data-navigable` drives the `grab` cursor and the accessible name now states that navigation is unavailable. |
| D-14 | Low | An empty surface showed a blank tile. | A caption over the backplate explains why. The canvas stays mounted so the tab stop and layout do not jump when the first object appears. |
| D-15 | Low | Exceptional-scale markers drew a dashed box **plus an X glyph** — noisy, and two signals for one fact. | Corner ticks only: the dashed outline and the X were both dropped, leaving one quiet marker in the danger token. |
| D-16 | Low | `lockedStroke` was declared in the palette and never drawn. | Removed. Lock state reads in the Layers panel; a 2 px map mark cannot carry it usefully. |

## What was deliberately not changed

- **Geometry, scope, navigation, persistence and lifecycle** — the earlier
  [minimap-repair-2026-09-05](minimap-repair-2026-09-05.md) findings (MM-01…MM-10)
  remain sound and were untouched.
- **The retained document layer and camera-only redraw** — the retained-layer
  invariant is still asserted, and viewfinder hover/drag state is explicitly
  excluded from its cache key so interaction never repaints the document.
- **No animated camera transition.** Cockburn et al. (2009) and NN/g both report
  that animated overview jumps improve spatial comprehension, and Maya's ViewCube
  animates for the same reason. We did not add it: Varve's camera path is a
  performance-sensitive pipeline with documented frame-time invariants, and a
  100–300 ms camera animation belongs in the camera system with its own
  benchmark, not bolted onto a panel. Revisit when the camera work lands.
- **No map-level zoom or size preference.** Users ask for it in every competitor
  thread, but the map already scales with the sidebar width and the sidebar is
  user-resizable, which is the same control expressed once rather than twice.
- **No interior wash on the viewport rectangle** — it would have reintroduced
  the contrast erosion corrected by D-01.
- **No per-workspace minimap visibility.** `panel.minimapVisible` is already a
  durable global with a View-menu recovery path; splitting it per workspace
  would add a second source of truth for a low-cost preference.

## External evidence

Research prioritised *failures we can realistically resolve cheaply*. Full
source list at the end of each section.

### 1. Overview panels are ignored when they duplicate what already exists

| Claim | Source |
|---|---|
| Photoshop's Navigator is excluded from the default workspace and "at its default size, the Navigator panel isn't very useful" — every tutorial starts by saying "resize it first" | https://www.photoshopessentials.com/basics/how-to-use-the-navigator-panel-in-photoshop/ |
| "Ignore the navigator. The entire panel is kinda useless anyway… you save a lot of screen space that could be better used for layers etc." | https://www.reddit.com/r/photoshop/comments/4fi07n/colr_difference_in_navigator/ |
| Photoshop's Navigator zoom controls are "hyper-sensitive" and `View > Fit on Screen` is "totally useless for this purpose" — a third, worse path to a command that already has two | https://sketchbooky.wordpress.com/2026/04/04/setting-a-custom-zoom-level-for-photoshop/ |
| VS Code's own maintainers, when adding drag: "As a follow-up we can then explore **if the overview ruler is redundant**" | https://github.com/microsoft/vscode/issues/20935 |
| The headline complaint thread states three reasons for turning it off: "stuff is too small to really make out where I'm going", "don't really benefit from the loss of screen real-estate or the distraction", and "a proper index… or the search function work so much better" | https://news.ycombinator.com/item?id=36758012 |
| Research: overview+detail *increased* task time where semantic zoom already existed, and "switching between the overview and the detail window required mental effort and time" — yet users still preferred having one | Hornbæk et al.; overview+detail review, https://dl.acm.org/doi/10.1145/1456650.1456652 |
| "People rarely use site maps. In Study 2, only 7% of users turned to the site map… Dynamic or interactive site maps caused horrible failures" | https://www.nngroup.com/articles/site-map-usability/ |

**Resolved:** D-04 removed the fourth Fit copy. The overview's remaining verbs —
click-to-jump, drag-to-pan, double-click/Enter/Home to fit — are each unique to
it or already single-sourced. The one command it duplicated is gone.

### 2. Contrast and legibility of miniature marks

| Claim | Source |
|---|---|
| "the minimap needs me to strain my eyes… everything else is scalable, you can't modify the size of the minimap at all. That means people who suffer from poor eyesight or those who have hdpi screens just have to accept poor accessibility." | https://github.com/microsoft/vscode/issues/32581 |
| "Bad foreground and background contrast for minimap hover; Whenever I want to drag the slider, I can't find the location of the slider. This is very bad." | https://github.com/primer/github-vscode-theme/issues/200 |
| "on a 4k the minimap looks like a nanomap" / "minimap is unusable in this resolution" | https://github.com/microsoft/vscode/issues/21773 |
| Any visual information necessary to identify a control or its state needs **3:1**; the test is "if the least-contrasting area is less than 3:1, assume that area is invisible" | https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html |
| Interactive targets must be **≥24×24 CSS px** at Level AA | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html |

**Resolved:** D-01 (enforced 3:1+ ink family, 3.49:1 minimum measured), D-05 (7 px
label floor), D-12 (24 px targets), D-02/D-08 (map scales with the sidebar
instead of a fixed 120–160 px).

### 3. The viewport rectangle is the one pixel that must never fail

| Claim | Source |
|---|---|
| Four separate issues about the viewport highlight only showing on hover: "A setting which keeps the viewport visible at all time would greatly improve my minimap experience" | https://github.com/Microsoft/vscode/issues/21784, #21810, #21404, #21761 |
| "when scrolling… it can be difficult to guess where the slider might be" | https://github.com/microsoft/vscode/issues/127918 |
| GIS: "because the individual map is so small, the red overview square is nearly invisible at the statewide scale" | https://gis.stackexchange.com/questions/450698/use-qgis-geometry-generator-to-expand-overview-map-frame |
| Academic scalability limit: "the viewfinder may shrink too much in size and make its manipulation more difficult for users" | Chittaro et al., MOBHCI 2008, http://hcilab.uniud.it/images/stories/publications/2008-09/ZoomableUserInterfaceswithOverviews_MOBHCI2008.pdf |
| "I noticed that I am unable to navigate via it anymore. Clicking on it does nothing." | https://community.miro.com/ask-the-community-45/can-no-longer-navigate-via-minimap-19869 |
| The clearest acceptance criteria users hand back: "Zoomed-out overview… Highlighted rectangle showing the current viewport / Drag to navigate / Click to jump to an area / Show/hide option" | https://forum.figma.com/suggest-a-feature-11/feature-request-add-a-canvas-minimap-for-large-figma-files-56831 |
| A drag-and-drop signifier must signal both that the item is *grabbable* and what dragging it does; add magnetism to make a small target forgiving | https://www.nngroup.com/articles/drag-drop/ |

**Resolved:** D-06 (14 px floor + clip + a 10 px forgiveness margin shared by the
drawn and hit-tested shapes), D-07 (off-stage pointer), D-13 (`grab`/`grabbing`
cursors and an honest accessible name), D-09 (the flagged badge now has a verb).

### 4. A rectangle over a bounding box is not a map

| Claim | Source |
|---|---|
| "At scale, jumping is disorienting; continuous drag is the safer primitive" — and beyond ~3k lines "this preview becomes very tiny and unreadable" | https://github.com/microsoft/vscode/issues/28511 |
| A wireframe-only overview "had only a limited effect… and was negatively judged by users, despite their reduced screen occupation"; overviews only earn their space when they carry semantics | Chittaro et al., MOBHCI 2008 |
| "It's for looking at the shape of the code, not the contents." — the strongest defence of the form *is* shape recognition | https://news.ycombinator.com/item?id=36758012 |
| Off-canvas and orphaned objects silently destroy overview scaling: "90% of the minimap is just voided space" was traced to one stray object; "My minimap is only showing the bottom half of my board" had a manual workaround | https://community.miro.com/ask-the-community-45/scaling-minimap-2633, https://community.miro.com/ask-the-community-45/minimap-not-centered-16872 |
| "the map doesn't help much when you have multiple users…" — a static map ages badly, and connectors/lines were removed because they "clutter the minimap without providing meaningful navigation value" | https://community.miro.com/ask-the-community-45/improve-navigation-around-the-board-15059, https://github.com/tldraw/tldraw/issues/6327 |
| Composite artwork colour drives overview usability: at ½ screen an 80%-transparent map was fastest; at ⅛ screen the result reversed — **size and opacity are coupled** | MDPI *Sensors* (2020), https://mdpi-res.com/d_attachment/sensors/sensors-20-04605/article_deploy/sensors-20-04605-v3.pdf |
| The overview should display "the user's 'footprints'… to indicate both the current location and the previous ones" | https://www.nngroup.com/articles/navigating-large-information-spaces/ |

**Resolved:** D-10 (ellipse silhouettes), D-11 (no redundant group outlines),
D-09 (stray-object escape hatch), D-01 (hues that survive on the backplate).
Not resolved, recorded as residual below: no search/selection history marks.

### 5. Off-canvas content and overview fit

| Claim | Source |
|---|---|
| Illustrator's Navigator breaks "as soon as an object is placed on the outskirts of the canvas" | https://illustrator.uservoice.com/forums/601447-illustrator-desktop-bugs/suggestions/40741081-navigator-does-not-change-view |
| QGIS: "when enlarging it, the contents doesn't zoom in back. In effect, after a few resizes of QGIS window, overview map becomes unusably tiny" — the overview's own fit must be idempotent | https://github.com/qgis/QGIS/issues/11509, https://github.com/qgis/QGIS/issues/11848 |
| QGIS extent frame "usually not accurate" because it uses different bounds than the main canvas | https://issues.qgis.org/issues/2243 |
| tldraw: clicking the minimap had a pointer offset from a **stale cached `getBoundingClientRect`** | https://github.com/tldraw/tldraw/issues/8383 |

**Resolved / defended:** D-08 makes the fit idempotent (derived from measured
boxes, not guessed padding) and pre-paint; pointer mapping continues to use the
canvas's live rect, never a cached one; the scene continues to come from the
shared `ResolvedEditorSceneScope`, which is why the map cannot disagree with the
canvas about fit.

### 6. Discoverability and control congestion

| Claim | Source |
|---|---|
| Blender: the axis indicator and the interactive navigation buttons cannot be turned off separately — "How does that make sense… to be toggled together by one checkbox?" | https://devtalk.blender.org/t/2-8-rc-impossible-to-remove-navigation-buttons-without-removing-axis-indicator/8341 |
| Blender's top-right corner crowding fix: vertical navigation buttons, buttons on hover | https://devtalk.blender.org/t/top-right-viewport-crowding-additional-suggestion-to-t64929/7455 |
| Krita users repeatedly do not know the overview exists — discoverability, not capability, is the failure mode | https://forum.kde.org/viewtopic.php?f=137&t=171594, https://krita-artists.org/t/does-krita-have-zoom-in-overview/177394 |
| "Having gone thru the 768-line preferences file… I find I'm still unable to disable the horrible minimap… This is the #1 blocker for me" | https://forum.sublimetext.com/t/disable-minimap-preference/57770 |

**Resolved:** D-04, D-16 and the header separator address congestion directly —
four header items reduced to two, with the rail-level collapse control
visually separated from minimap-scoped controls. Discoverability already has a
durable path (`Ctrl+Shift+M`, View menu, command palette), which the review
confirmed and left alone.

## Residual limitations

| Item | Why it is still open |
|---|---|
| No selection/search/history marks on the map ("footprints") | Needs a second semantic channel and a decision about who owns it; the map currently reports selection only. |
| No camera animation on minimap jumps | Belongs to the camera system with its own benchmark; see "deliberately not changed". |
| No map-level zoom / density preference | The sidebar is already the size control; adding a second one risks the redundancy class of defect fixed here. |
| Hue-only distinction between vector and raster leaves | Form is primary (frame / mass / bar / ellipse); hue is supplementary. At 1–2 px, additional hue-only distinctions would not be perceivable, which is the WCAG 1.4.1 failure mode the form hierarchy exists to avoid. |
| Groups are invisible | Intentional; their children carry the same edge. A group *outline* would be restored only with a reason to distinguish it from its content. |

## Validation record

Commands run for this review:

- `pnpm --filter @varve/ui audit:tokens` — **all 324 pairs pass across 3
  themes**, including the 8 new minimap overview pairs.
- `pnpm --filter @varve/ui tokens:generate` — `tokens.css` regenerated from the
  audited TS source; `pnpm exec vitest run packages/ui/src/tokens` — **61 tests
  passed** (drift guard).
- `pnpm exec vitest run packages/editor/src/components/Minimap --maxWorkers=1 --reporter=dot`
  — **85 tests passed**.
- `pnpm exec tsc -p packages/editor/tsconfig.json --noEmit` — no errors in the
  minimap files (pre-existing `CurveEditor.test.tsx` errors belong to concurrent
  work and are untouched).
- `pnpm typecheck:e2e` — passed.
- `pnpm audit:docs` — clean (1127 docs, 735 links, 178 ADRs indexed).
- `pnpm exec biome check packages/editor/src/components/Minimap/ packages/ui/src/tokens/`
  — clean.
- `node scripts/quality/heavy-lease.mjs "e2e: minimap visual validation …" -- npx playwright test tests/e2e/canvas/minimap.spec.ts --project=chromium --workers=1 --reporter=list`
  — **3 tests passed** (navigation/resize/workspace/recovery; theme × rail-width
  matrix; empty state).

### Visual evidence

Captures to `docs/screenshots/minimap-design-review-2026-09-29/`:

| File | Covers |
|---|---|
| `01-light-1440.png`, `01-dark-1440.png`, `01-high-contrast-1440.png` | The overview at 1440×900 in all three themes |
| `02-*-panel.png` | The same three at panel scope |
| `03-wide-1920.png`, `03-narrow-1024.png`, `03-compact-900.png` | Rail widths from 900 to 1920 |
| `04-high-zoom-minimum-viewfinder.png` | The viewfinder at a high zoom ratio |
| `05-empty-state.png` | The empty-surface caption |

Measured **from the captured pixels** (histogram of each theme capture), not
from the token table — the rendered artwork tone against the rendered backplate:

| Theme | Ink on backplate | Ratio |
|---|---|---|
| Light | `rgb(186,107,36)` on `rgb(235,239,244)` | **3.49:1** |
| Dark | `rgb(186,107,36)` on `rgb(4,6,8)` | **5.04:1** |
| High Contrast | `rgb(249,253,0)` on `rgb(0,0,0)` | **19.08:1** |

All three clear WCAG 1.4.11's 3:1 non-text floor, from the same pixels a user
sees. The baseline for the identical measurement was **1.19:1** in Light.

The responsive assertions are behavioural rather than eyeballed: the painted
canvas must fill its stage at 900, 1024, 1440 and 1920 CSS px, and the map must
be more than 1.5× wider at 1920 than at 900. The first run failed that
assertion and exposed the 320 px ceiling recorded in D-02.

Deliberately skipped: Rust workspace tests, the full Playwright suite, and the
full Vitest suite — no native dependency, schema, or shared infrastructure
change is in scope for a panel-internal design revision. `pnpm verify:plan`
escalated to a full suite, but both stated reasons are attributable to
concurrent unrelated worktree changes (a workspace/toolchain and a
high-risk dependency change from other sessions), not to this slice; a full
gate run would measure that work, not the minimap.
