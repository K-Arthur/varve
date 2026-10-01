# Workspace dock geometry evidence

Captured from the live editor by
`tests/e2e/workspace/dock-layout-geometry.spec.ts` at 1440 × 900 CSS pixels.
The test creates one document, switches through the canonical workspace
sequence, verifies Layers / canvas / Inspector ordering and registered minimum
widths, confirms the floating toolbar stays inside the canvas (including
Draw's extra controls row), and checks that the Motion Timeline and Email
Preview occupy their configured lower dock regions. It then narrows the
viewport and verifies the drawer projection returns without changing the
saved layout.
The Email capture waits for the Email authoring Inspector tab to become the
selected tab before taking the screenshot. It also verifies the lower dock
tab group is present with Email Preview selected and Email Output available as
the adjacent tab.

| Workspace | Screenshot |
|---|---|
| Design | [design-light.png](design-light.png) |
| Print | [print-light.png](print-light.png) |
| Draw | [drawing-light.png](drawing-light.png) |
| Photo | [image-light.png](image-light.png) |
| Motion | [motion-light.png](motion-light.png) |
| Email | [email-light.png](email-light.png) |

The dedicated Email Output surface is separately captured at 1280 × 720 CSS
pixels in [email-output-light.png](email-output-light.png). Email authoring is
selected in Inspector, Preview is selected below the canvas, and Email Output
is visible as its sibling dock tab. The capture also shows the browser-preview
compatibility caveat in the panel.

The browser flow in `tests/e2e/email/controls.spec.ts` explicitly enables an
Email template, creates and expands a saved source block, removes its scene
node, and verifies the orphan explanation and unchanged authored HTML remain
available. [email-orphaned-authored-source.png](email-orphaned-authored-source.png)
was opened and inspected after the passing Chromium run; it shows the expanded
editor with zero scene layers. This verifies in-app reachability and source
preservation, not Gmail or Outlook rendering.

The keyboard/touch-accessible Move To workflow has a control screenshot in
`custom-move-controls-light.png` and the resulting live layout in
`custom-move-light.png`. `tests/e2e/workspace/customization.spec.ts` moves
Layers below Inspector, checks the resulting panel rectangles and customization
dialog width, and confirms the preference contains a dock tree.

`tests/e2e/workspace/dock-layout-geometry.spec.ts` now also includes real
pointer movement from Layers to the lower drop zone on Inspector, preview
feedback, Escape cancellation, one committed move, and a screenshot at
`dock-drag-layers-below-inspector.png`. All three tests in that spec passed in
Chromium before the panel-header correction on 2026-09-28, including the
six-workspace geometry pass, splitter commit/cancel, and real panel movement.
The later focused correction run passed both the floating-group control
workflow and the Inspector-control collision regression. The first run after
adding reserved panel chrome exposed two issues: Resize bubbled into the
title-row Move gesture, and the Inspector test targeted an overflow control
that is not present at the default width. The Move handler now ignores button
targets; Resize changes dimensions without moving the group, and the browser
test clicks the actual Collapse Inspector control. The six-workspace, drag,
splitter, Email, dark/high-contrast switcher, and updated float screenshots
were opened and visually inspected. The first splitter run exposed a flaky
one-off navigation helper; replacing it with the shared recovery-aware
`navigateToEditor` helper made the splitter test pass in isolation and in the
complete spec. Earlier runs used the documented one-worker lease opt-out only
after the shared lease timed out behind another session's long-running full
Vitest process; the host had approximately 8 GiB available.

`float-controls-light.png` shows the in-window floating Layers group at 1440 ×
900 CSS pixels, with Reset location, Redock, and Resize in the title row.
Singleton dock Move controls live in a separate 32-pixel dock title row;
tabbed panels use the tab strip. This keeps the Inspector Collapse control
and panel content outside the Move/Resize hit areas. The
same E2E creates the float through Customize Workspace, drags it with a live
preview, resizes it with a pointer, moves it with the keyboard, resets its
normalized placement, and redocks the group. The test confirms the portable
`floatingGroups` preference is saved.

`float-inspector-controls-light.png` is a separate live Inspector float at
1440 × 900 CSS pixels. The float action row sits above the Inspector tabs and
properties, with no shared hit area. Its browser check asserts the header and
both Inspector tabs do not overlap, verifies each tab is the hit-tested pointer
target, then clicks Design and Export while the floating actions remain
available. This covers the panel controls most likely to be hidden by a
floating title row; it supplements the Layers collapse-control regression.

`splitters-light.png` records a live resized split. The associated geometry
E2E uses ArrowRight and a real pointer drag, verifies the accessible value,
then checks that Escape cancels an in-progress resize without undoing the
committed one.

The narrow Focus-mode recovery screenshots are captured by
`tests/e2e/workspace/customization.spec.ts`: `focus-canvas-narrow-light.png`
shows the viewport-pinned exit control at 760 × 900 CSS pixels, and
`focus-recovered-narrow-light.png` shows the restored workspace with the
Layers drawer open. The test verifies that Focus keeps at least 320 CSS pixels
of canvas width and a usable floating toolbar, the exit control stays in the
viewport, and the settled Layers drawer stays within its bounds. This covers
Focus-mode recovery, not startup recovery from a corrupt saved layout.

The strict 936 × 900 CSS-pixel `workspace-shared-workflows` marketing capture
is in `../product/workspace-shared-workflows-light.png`. It shows the Logo
project panel and shared Code output beside one Design document, verifies the
panels stay within the editor shell, and leaves at least 320 CSS pixels of
canvas width. Website feature pages reuse this capture for Workspaces, Logo,
and Code.

The six workspace tabs show compact 1–6 key markers sourced from the live
shortcut registry. The browser test checks that the rendered left-to-right
sequence and registered keys agree before capturing each workspace. It also
captures the switcher in dark and high-contrast themes as
`switcher-dark.png` and `switcher-high-contrast.png`.

Run the focused browser evidence with:

```sh
node scripts/quality/heavy-lease.mjs "e2e: validate six workspace dock layouts" -- \
  npx playwright test tests/e2e/workspace/dock-layout-geometry.spec.ts \
  --project=chromium --workers=1 --reporter=list
```

This is a geometry and default-layout checkpoint. The customization E2E also
covers floating-group movement, resize, reset, and redock in the light theme.
Broader theme coverage for splitters and floats, native-window transfer
round-trips, and startup recovery from a corrupt saved layout remain open.
