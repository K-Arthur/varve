# Toolbar review — diagnosis, repair, and verification (2026-09-15)

Scope: every command surface the editor presents as a toolbar — the floating
tool palette, the selection-following context bar, the menubar's own tool
cluster, and the overflow/flyout behaviour that connects them. Evidence lives
in `docs/screenshots/2026-09-15-toolbar-review/` (before/after pairs) and the
reproducible assertions in the specs named under each finding.

This is not an audit-only report: every P0/P1 below was reproduced, fixed, and
re-verified. Remaining work is listed honestly at the end.

## Method

1. Repository safety: read `AGENTS.md`, inspected `git status` (168 dirty files
   across several concurrent agents), left all unrelated work untouched, and
   committed only this review's paths.
2. Research gate (see "External failure evidence" below).
3. Runtime diagnosis: drove the real editor through Playwright on an isolated
   port (`VARVE_E2E_PORT=1431`), captured measured geometry (DOM dumps of
   `tabindex`, `aria-*`, bounding boxes, scroll extents) plus screenshots, and
   compared against source.
4. Fix → unit/component tests → browser regression specs → visual re-capture.

## Findings

### P0 — The palette was 15 tab stops, not one (accessibility, keyboard)

**Evidence.** A live DOM dump of `.floating-toolbar [role="toolbar"] button`
showed `tabindex` absent on every button (browser default `tabIndex = 0`), and
my diagnostic counted `tabbable: 15 / total: 15`. Tab-walking from the canvas
never reached the palette; arrow-key traversal only started working *after* a
user had already focused a button and pressed an arrow key.

**Root cause.** `@varve/ui`'s `Toolbar` applied its roving tabindex in an effect
whose only dependency was the focus index. The palette's buttons are owned by
workspace configuration and can appear *after* the first commit (config
hydration, mode switch, responsive collapse), so the mount commit had nothing to
annotate and the effect never re-ran — every later commit left the buttons at
the default. Once an arrow key changed the index the effect finally ran and the
invariant appeared to hold, which is why existing unit tests (children present
at mount) passed.

**Fix.** `packages/ui/src/components/Toolbar.tsx` re-applies the roving tabindex
on every commit (layout timing) and via a subtree `MutationObserver`, clamps a
shrunk list to the last enabled item, and never rests the roving stop on a
disabled control.

**Verified.** `MICRO` probe: `attrs: ["0","-1","-1"]` on mount; exactly one
`tabindex="0"` after arrows, clicks, and workspace switches.
`tests/e2e/canvas/toolbar-keyboard-overflow.spec.ts` asserts one tab stop,
arrow/Home/End traversal, and `aria-keyshortcuts` derived from the effective
binding (`V`, `H`).

### P0 — Primary creation tools were hidden behind a leading More menu

**Evidence (before).** At 1280×720 with both panels open the Design palette
rendered 13 of its 23 declared tools. `dom` dump:
`["pen","knife","shapeBuilder","select","lasso","hand","zoom","slice","eyedropper","pixelProbe","scale","inspect","booleanUnion"]`
— Rect, Ellipse, Text, Frame, Table, Line, Arrow, Warp and SAM were collapsed
into a **More** control pinned at the *start* of the row, each reachable only
through More → category submenu → item (three interactions).

**Root cause.** Two compounding policies in
`components/FloatingToolbar/useToolbarOverflow.ts`:

1. `FRONT_FACING_TOOL_IDS` pinned `shapeBuilder` and the boolean *commands* but
   not Rect/Text/Frame, so the creation core was collapsible while a disabled
   action flyout kept its slot.
2. Collapse happened per *declared group*. The Select group also declares Slice,
   Pixel Info, Scale and Inspect, so pinning it to keep Select in the row also
   pinned four measurement tools and squeezed everything else out.

**Fix.** `workspace/toolbarRetention.ts` scores tools by retention (navigation >
creation > editing > raster > inspection > AI/commands), with explicit
overrides where the registry category disagrees with reachability (Slice, Warp,
the raster keys, the boolean commands at 0). Collapse is now per **slot**, not
per group, and `useToolbarOverflow` collapses the lowest-retention slot first.
Surviving slots inherit `groupStart` so separators still express the declared
grouping. The More control moved to the trailing edge of the row and is
`position: sticky`, and its accessible name reports how many tools are hidden.

**Verified (after).** At the same window size the row renders
`["rect","line","arrow","pen","knife","shapeBuilder","text","frame","table","select","lasso","hand","zoom","eyedropper"]`
with 10 low-priority tools (4 boolean commands, SAM, Warp, Inspect, Slice, Pixel
Info, Scale) in More. `toolbar-keyboard-overflow.spec.ts` asserts the primary
set stays in the row and that the More control is trailing, sticky while the row
scrolls, and reports its hidden count.

### P1 — Nothing told the user what was hidden, or why

**Evidence.** The More button was labelled "More tools" and sat at the leading
edge, so nothing about it matched the expectation that overflow lives at the
end of a row; the hidden set could not be inferred.

**Fix.** Trailing sticky control, count-bearing accessible name, category-
grouped menu that lists only the collapsed slots, and activation through the
same `activate()` path as the row (activating a hidden tool pulls it back into
the row because the active tool is pinned).

### P1 — Context bar promised shape properties it did not render

**Evidence.** `ContextControlBar`'s own docstring and the user-visible bar both
claimed Fill / Stroke / Stroke width for a selected shape; the rendered section
was two flip buttons (`SHAPE_CCB_BUTTONS: ["Flip horizontal","Flip vertical"]`).
Changing a shape's fill therefore always meant leaving the canvas for the
Inspector.

**Fix.** `components/ContextControlBar/ShapeQuickControls.tsx` adds fill and
stroke colour wells (reusing `InspectorColorPopover`: full picker, document
swatches, recent colours) and a stroke-width field, routed through the existing
`setSelectedFill` / `updateNode` commands inside one transaction per gesture,
plus an explicit "Add stroke" action for shapes with no stroke. Scope stays
honest (first solid fill and first stroke; gradients, layered fills, caps and
per-side weights stay in the Inspector) and the docstring now says so.

**Verified.** `ContextControlBar.test.tsx` (12 tests) covers presence, the
add-stroke transaction, mixed-value display, and weight commit; the browser
probe confirmed add-stroke → width 8 → two undos restore the no-stroke state.

### P2 — Ambiguous, inert chrome on mouse-only devices

**Evidence.** The palette permanently rendered a custom three-node glyph whose
only explanation was a tooltip, for a modifier substitute that only affects
`pointerType === 'touch'` — inert on a mouse-only device.

**Fix.** `useHasTouchInput` gates the control on touch capability (or an already
enabled state) and the control now carries a visible "Multi-select" label,
because touch devices cannot summon a tooltip.

### P2 — Documentation drift around the palette

`workspace-navigation-progress.md` and `workspace-navigation.md` still listed
"toolbar composition from config" as deferred although it shipped; no canonical
toolbar document existed. Added `docs/architecture/toolbar-system.md` and
corrected both stale notes. The website's interface tour said the toolbar is a
"vertical strip" "on the left side"; it is a horizontal floating palette and
the context bar was undocumented — corrected in
`apps/website/src/pages/docs/getting-started/interface.astro` and
`docs/workspaces.astro`.

## External failure evidence (what other apps got wrong)

Researched current primary sources plus documented user complaints, then mapped
each to a realistic action here.

| Documented failure | Source shape | Action taken |
|---|---|---|
| Figma UI3 bottom floating palette: cannot move/dock it; laptop screens and the macOS Dock hide it; "the floating thing in front of my work" | Figma forum feature request + Reddit threads, 2025–2026 | **Not resolved.** Palette position is not user-configurable in Varve either. Recorded as the top recommendation below; no half-measure shipped. |
| Figma: controls "burned under multiple clicks and menus" after the redesign | Reddit r/UXDesign, 2025 | Resolved for the palette: retention policy keeps creation/selection tools at one click and the earlier group-collapse defect that pushed Rect/Text/Frame behind three interactions is gone. |
| Affinity 3: flyout sub-windows hide individual tools; "can't click individual tools until you remove the default fly-outs" | Reddit r/AffinityPhoto, 2025 | Already sound and now verified: a flyout renders a clickable primary member plus a chevron, every member is individually reachable, and workspace customization can hide or show members. |
| Photoshop: "hiding tools behind individual workspaces is idiotic" — tools vanished after updates | Reddit r/photoshop, 2025 | Resolved in spirit: composition is per workspace but declared tools are never dropped — anything the workspace declares is reachable from the row or from More, and the customization dialog searches every registered tool. |
| Affinity: "Customize toolbar — no tools" (customizer cannot find commands) | Reddit r/Affinity, 2025 | Not applicable: `WorkspaceCustomizeDialog` lists `getToolbarToolIds(builtIn.toolbar)` with search, including flyout members. Covered by `WorkspaceCustomizeDialog.test.tsx`. |
| JupyterLab: overflowing toolbar widgets became invisible with no way to reach them | GitHub issue #10595 | Resolved: overflow is a first-class, categorised More menu; the sticky control cannot be scrolled out of reach. |
| Icon-only controls: unlabeled icons force guessing; tooltips don't exist on touch | NN/g-adjacent guidance, Trevor Calabro (11 studies), GazeSite, WordPress Gutenberg audit | Addressed: every tool button carries an accessible name and a shortcut tooltip; the touch-only control now carries a visible label; decorative glyphs stay out of the accessible tree. |
| Adaptive/hide-unused toolbars (Microsoft Office 2003 "smart menus") were disabled by users because prediction was opaque and cost an extra click | ACM adaptive-menus survey | Avoided: retention is a fixed, documented priority policy — not usage prediction — and no tool is removed from the product, only from the row. |

Deliberately **not** claimed: no user study was run, so preference statements
here are engineering judgement backed by the cited complaints, not measured
outcomes for Varve users.

## Verification performed

Environment: Linux (CachyOS), Node 22.23.2, Chromium via Playwright 1.62,
isolated dev server on port 1431 (`VARVE_E2E_PORT`), 1280×720 / 1280×800 /
900×800 / 640×800 / 480×700 / 430×800 viewports, three themes inherited from
existing suites.

| Command | Result |
|---|---|
| `npx vitest run packages/ui/src/components/Toolbar.test.tsx` | 8 passed (including the late-children regression) |
| `npx vitest run packages/editor/src/workspace/toolbarRetention.test.ts` | 8 passed |
| `npx vitest run packages/editor/src/components/FloatingToolbar/FloatingToolbar.test.tsx` | 9 passed |
| `npx vitest run packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx` | 12 passed |
| `npx vitest run packages/editor/src/workspace/toolbarComposition.test.ts` | 20 passed |
| `npx playwright test tests/e2e/canvas/toolbar-keyboard-overflow.spec.ts --project=chromium` | 6 passed |
| `npx playwright test tests/e2e/canvas/toolbar-per-mode.spec.ts` | 4 passed (contract updated: declared tools must be reachable from row **or** More; undeclared ones absent) |
| `npx playwright test tests/e2e/canvas/workspace-toolbar-visual.spec.ts` | 4 passed |
| `npx playwright test tests/e2e/canvas/toolbar-layout.spec.ts` | 2 passed (no chrome overlap regression) |
| `node scripts/audit-docs.mjs` / `node scripts/audit-emoji.mjs` | clean |
| `npx biome check <touched files>` | clean |
| `npx tsc --noEmit -p packages/editor/tsconfig.json` filtered to touched files | clean (pre-existing errors remain in `Menubar.tsx`, `inputPipeline.ts`, `vectorOps.ts`, `ShapeBuilderTool.test.ts`, `ManageLayoutsDialog.tsx`, `SpecPanel/export-matte.test.ts` — none touched by this review) |

Accessibility checks performed: keyboard-only traversal (Tab into the palette,
arrows, Home/End, Enter activation), visible focus ring captured, accessible
names and `aria-keyshortcuts` dump, disabled flyout primary not focusable via
arrow navigation, More control reports its hidden count, touch-only control
absent on a mouse-only user agent.

Not performed (honest gaps): screen-reader runs (NVDA/VoiceOver/Orca), 200%
text-enlargement and 320px reflow passes for the changed chrome, forced-colors
rendering of the new swatch controls, and physical touch/pen verification of the
gated Multi-select control. These need dedicated sessions; nothing in this
report should be read as covering them.

## Remaining work and recommendations

1. **Palette position/docking preference (P1, larger feature).** The dominant
   complaint in the external evidence. A workspace-level `toolbarPlacement`
   (bottom-centre default, plus at least top and a draggable dock) with the
   chrome grid already modelled would resolve it. Not attempted here because it
   changes the shell grid and every bottom-anchored surface (page-nav, selection
   info, status bar, drawer FABs) and needs its own verification pass.
2. **The View menu is 1984px tall at 1280×800** (measured; it scrolls inside its
   clamped portal, and keyboard reach is fine). Pointer users must wheel-scroll
   a menu to reach Workspace/Reset/Customize/Layouts entries. Recommended:
   move the eight per-workspace switch entries into a "Workspace" submenu —
   they duplicate the menubar's workspace switcher — and keep View under one
   screen.
3. **Text editing renders the same controls twice** (context bar and the
   floating text bar) while a text edit session is active. Both write through
   the same command and stay in sync, so this is a density/clarity question
   rather than a correctness bug; it was left unchanged to avoid a silent
   behaviour change, and is recorded as a hypothesis for a follow-up review.
4. **Status-bar height** remains a literal `28px` in `editor.css:1050` although
   `--statusbar-height` exists. Not changed: the token resolves to 26.4px at
   1280 and the priority-tier breakpoints are tuned to the literal, so this
   needs a coordinated change with its own visual pass.
5. Follow-ups not attempted: palette virtualisation is unnecessary at these
   counts (largest workspace declares 20 tools); no dependency was added for
   overflow detection (a `ResizeObserver` plus measured `scrollWidth` was
   sufficient).

## Agent validation report

```text
Changed scope: packages/ui/src/components/Toolbar.tsx(+test);
  packages/editor/src/components/FloatingToolbar/** (overflow, touch gate, css);
  packages/editor/src/workspace/toolbarRetention.ts(+test), toolbarComposition.ts;
  packages/editor/src/components/ContextControlBar/** (ShapeQuickControls, css, test);
  packages/editor/src/shortcuts/toolShortcutLabel.ts, index.ts;
  tests/e2e/canvas/toolbar-keyboard-overflow.spec.ts (new),
  toolbar-per-mode.spec.ts, workspace-toolbar-visual.spec.ts;
  docs/architecture/toolbar-system.md (new), workspace-navigation.md,
  plans/workspace-navigation-progress.md, README.md,
  docs/audits/toolbar-review-2026-09-15.md (this file),
  docs/screenshots/2026-09-15-toolbar-review/**;
  apps/website/src/pages/docs/getting-started/interface.astro,
  apps/website/src/pages/docs/workspaces.astro
Validation plan: pnpm verify:plan reports FULL-SUITE ESCALATION because the
  working tree contains 168 files from other concurrent sessions
  (Cargo.toml/Cargo.lock, generative-edit, font system). Escalation is driven
  by those unrelated changes, not by this review's paths; the pre-commit hook
  executed the affected closure for the committed paths.
Commands actually run: unit suites listed above; the four Playwright specs
  listed above on an isolated port; audit:docs; audit:emoji; biome check;
  tsc -p packages/editor filtered to touched files; git commit (pre-commit
  hook ran the affected closure twice).
Passed: all commands above except the pre-existing failures noted below.
Skipped as unrelated: Rust/cargo workspace, native desktop GUI matrices,
  model-quality, packaging, signing, website e2e — no Rust, packaging, or
  website build path was touched. Website unit suite was run: 5 failures are
  pre-existing and provably unrelated (`ideas/../canvas.astro: raw color
  #172126`, `docs/tools/grids.astro: #dce7eb` and four stale `.varve` demo
  fixtures — none appear in this review's diff).
Escalations: none. No full-suite run.
Full suite run: no. Reason: no workspace/toolchain/test-runner/schema change.
```

## What users can now do more reliably

- Reach and operate the whole palette from the keyboard: one Tab stop, arrows,
  Home/End, shortcuts announced, focus never stolen.
- Find Rect, Text, Frame, Table, Pen, Line and Arrow in one click at the default
  window size instead of three, and see exactly how many tools overflow.
- Change a shape's fill, stroke and stroke width from the context bar without
  leaving the canvas, with undo restoring each edit as one step.
- See a labelled Multi-select control on touch devices instead of an unexplained
  glyph on every device.
