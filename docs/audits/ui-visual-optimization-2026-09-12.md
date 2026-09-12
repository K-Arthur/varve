# UI and visual optimization — 2026-09-12 pass

Status: implementation checkpoint on `master`. Continues
[`ui-visual-optimization-2026-09-09.md`](ui-visual-optimization-2026-09-09.md)
and the panel/canvas audit in
[`../../UI_UX_PANEL_CANVAS_AUDIT.md`](../../UI_UX_PANEL_CANVAS_AUDIT.md).

This pass was driven by runtime evidence from the real editor and website
(Playwright + DOM measurement), not by reading source alone. Every fix below
was reproduced before the change and re-measured after it.

## A. Research basis (external user feedback)

Online research into how users of comparable tools experience panels and
toolbars informed the priorities. The recurring themes were:

| Source | Repeated user complaint | Design response in this pass |
|---|---|---|
| [Figma forum — "Too much UI for small screens"](https://forum.figma.com/share-your-feedback-26/too-much-ui-for-small-screens-55147), ["Canvas space"](https://forum.figma.com/share-your-feedback-26/canvas-space-55389) | Panels/toolbars permanently consume canvas on laptop widths; users want independent collapse | Varve already has independent panel collapse; the compact status bar and dock now reclaim chrome width instead of wrapping |
| [Figma forum — left sidebar regression](https://forum.figma.com/share-your-feedback-26/figma-your-new-left-hand-menu-panel-is-a-disaster-7th-jan-2026-49352) | Permanently visible chrome "idle 90% of the time" crowds the working area | Low-priority status instrumentation is hidden by measured priority tiers, not left to wrap or clip |
| [Blender devtalk / bf-committers](https://archive.blender.org/lists/bf-committers/2012-January/035215.html) | "The UI shrinks removing pieces of labels text"; panels fragment into inconsistent heights | Menubar title protected with a minimum width; align clusters wrap as whole units; separators now render |
| [Blender — properties panel tab/scroll fatigue](https://blender.stackexchange.com/questions/246119/keyboard-shortcuts-for-properties-panel) | Endless scrolling and hard-to-recognise sections | Deeper inspector consolidation is the next focused phase (section H) |
| [Krita Artists — "Improving Krita's existing UX"](https://krita-artists.org/t/improving-kritas-existing-ux/51381) | Inconsistent spacing; controls around a list should rearrange into a single coherent row | Align & Distribute now groups commands so a wrapped row is a fallback, never a scatter |
| [Retool — Simplifying Retool's Inspector](https://retool.com/blog/simplifying-retools-inspector) | Categories were not mutually exclusive; a property could appear in several groups | One authoritative edit location per property (already Varve policy; preserved) |
| [Material Design — Applying density](https://m2.material.io/design/layout/applying-density.html) | Density should change dimensions, not padding; keep alignment stable | Control geometry stays stable when labels hide; no padding-only shrinking |

## B. Findings and fixes

| ID | Location | Evidence | Severity | Root cause | Fix | Status |
|---|---|---|---|---|---|---|
| UI-12 | `AlignDistributeBar` (Inspector) | At a 273px inspector the toolbar fragmented into ~6 rows with buttons pushed to both edges (`space-between`); `.insp-separator` measured `height: 0` and was invisible | P1 | `justify-content: space-between` + individually wrapping flex children; separator had no height | Wrapped commands in `.insp-align-group` (nowrap clusters), `flex-start` alignment, separator `height: 18px` | Fixed |
| UI-13 | Status bar | At 900px "canvas2d (cpu)" and "Rectangle 3" wrapped to two lines; the units `Select` ellipsised to "p…"; the AI chip was clipped | P1 | No `white-space` contract; no priority order; `.editor-status__info` used `margin-left: auto` for both left diagnostics and the right summary | Single-line contract, `.editor-status__meta` left cluster, `.editor-status__info` right summary, and measured priority tiers | Fixed |
| UI-14 | `MicroHint` | Centred on the whole shell (`left: 50%` against `.editor-shell`), bleeding 10px into the inspector at 900px | P2 | Absolute positioning without the canvas grid area | `grid-area: canvas` (same containing-block pattern as `.floating-toolbar`) + width capped to the canvas | Fixed |
| UI-15 | `ContextControlBar` | Four handlers were `() => {}` stubs; "Remove background" and "Vectorize" set the crop/select tools instead of running their commands | P1 | Feature scaffolded without wiring | Wired to `removeBackground`, `openVectorizeDialog`, `setSelectedFlipH/V`, `applyFramePreset`, `setNodeClipContent`, `alignSelected`, `booleanOp`; stub controls removed; busy/disabled state added | Fixed |
| UI-16 | Menubar header | `.editor-menubar { height: 100% }` absorbed the auto grid row; the context bar overflowed below it and rendered behind the tab strip (invisible) with ~30px of dead menubar space | P1 | Percentage height inside an auto flex-column header | `.editor-shell__menubar > .editor-menubar { height: auto }` | Fixed |
| UI-17 | Menubar (tablet) | At 900px the workspace dock bar was 313px inside a 255px wrapper and overflowed 55px leftward over the document title, which was clipped to "Un" | P1 | Overflow math assumed 32px/tab for the active mode, which renders a ~90px label pill; bar chrome (14px) was not subtracted | Icon tabs modelled at their real 33px; active pill floored at 104px; dock chrome subtracted; active mode keeps its name on desktop and compacts to an icon only below 210px of strip | Fixed |
| UI-18 | Website `/docs` | Three-link "Getting Started" card stretched to a ~400px empty box beside the 18-link "Tools & Features" card; prose rendered "theGitHub repository" and "thecontribution guidelines" | P2 | Equal-height card grid with wildly uneven content; Astro strips the trailing space before an inline link on its own line | Cards size to content (`align-items: start`); tools catalogue spans full width with a 3-column link list; explicit `{' '}` spacing | Fixed |

## C. Status bar priority tiers

The bar's intrinsic width is ~1020px at the default viewport. Measured
overflow before the fix: 266px @ 600, 171px @ 700, 58px @ 820, 36px @ 900.
After the fix the measured overflow is **0px at every width from 600 to
1440**. Tiers, chosen with headroom over the measured overflow:

| Breakpoint | Hidden |
|---|---|
| ≤ 1180px | compositor diagnostic (`canvas2d (cpu)`) |
| ≤ 980px | Fit page / Fit all / Fit sel cluster (still in View menu + shortcuts) |
| ≤ 860px | AI chip text label (dot remains), snap-grid number input |
| ≤ 700px | layout score badge, units select, cursor position |

At ≤700px the units select and fit commands remain reachable through the
workspace menus, command palette, and keyboard shortcuts, so no capability is
removed.

## D. Compact menubar / tablet behaviour

- The document title keeps a `5.5rem` minimum and truncates with an ellipsis;
  it is never painted over by the workspace dock.
- The workspace dock renders inactive modes as icons and keeps the **active
  mode's name visible on desktop strips** (threshold 210px of available
  strip). Below that it compacts to a 28px icon.
- Dock overflow math now matches rendered geometry, so the bar can no longer
  escape its wrapper.

## E. Website

`apps/website/src/pages/docs.astro` only. The docs index now places the three
short reference cards on one row (natural heights) and gives the tools
catalogue a full-width row with a multi-column link list. The page is shorter
(2574px → 2167px at 1280px wide), every card ends near its content, and the
previously missing spaces around inline links are restored.

## F. Verification record

```text
Changed scope: packages/editor (Inspector align bar, StatusBar, MicroHint,
ContextControlBar wiring, WorkspaceTabs + workspaceOverflow, editor.css,
inspector.css) and apps/website/src/pages/docs.astro.

Commands run:
- pnpm exec vitest run packages/editor/src/StatusBar.test.tsx \
    packages/editor/src/components/Inspector/sections/AlignDistributeBar.test.tsx \
    packages/editor/src/onboard/learning-system.test.tsx   (50 passed)
- pnpm exec vitest run packages/editor/src/workspace/workspaceOverflow.test.ts \
    packages/editor/src/components/WorkspaceTabs.test.tsx   (14 passed)
- pnpm --filter @varve/website typecheck                        (0 errors)
- pnpm build:website && pnpm build:website:pages                (84 pages each)

Runtime measurements (Playwright, Linux Chromium):
- Status bar scrollWidth == clientWidth at 600/700/820/900/1024/1180/1280/1440.
- Align bar rows: 4 coherent left-aligned rows at a 273px inspector; separators 1×18px.
- Workspace dock: bar fits inside its wrapper; no overlap with the title at
  700/820/900/1024/1200/1440; active label present on desktop widths.
- Micro hint: no longer appears in the canvas-bleed probe.
```

Skipped as unrelated: native Tauri window pass, Firefox/WebKit visual lanes,
macOS/Windows, screen readers, RTL/localized copy, DPR 2/3 (the existing
visual harness covers replay at each DPR separately).

Note: the repository already had failing `pnpm --filter @varve/editor
typecheck` errors and a large uncommitted font/typography workstream before
this pass; those files were not changed or committed here.

## G. Residual design-debt register

| Item | Severity | Reason deferred | Next action |
|---|---|---|---|
| Inspector section scannability at long scroll depths | P2 | Requires focused research + redesign | Section H of this record |
| Menubar menus at phone widths | P3 | Existing ≤640 compaction is adequate; needs a menu-overflow study | Revisit with the responsive shell pass |
| Native/Tauri window chrome verification | P2 | No desktop GUI session available under load | Run the desktop visual lane on a supported host |
| Full cross-theme visual matrix for this pass | P2 | Machine saturated by a concurrent suite during validation | Re-run `pnpm e2e:visual` when the machine is quiet |

## H. Next focused phase — Inspector panel

Per the follow-up request, the next pass will target the inspector alone:
research dedicated to inspector panels (property grouping, scroll depth,
mixed-value presentation, section recognition) plus WCAG 2.2 guidance
(target size, focus visibility, name/role/value, status messages), then audit
and implement. This record will link to it when it lands.
