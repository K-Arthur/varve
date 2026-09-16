# Dialog system review — 2026-09-15

Status: findings and fixes from the dialog-focused review session. Evidence
lives in gitignored `reports/dialog-audit/` and in the committed regression
spec `tests/e2e/dialogs/dialog-system.spec.ts`.

## Scope and method

The session reviewed every modal surface in the editor, the shared dialog
primitive it is built on, and the real workflows that open them:

1. **Static inventory** of every component that renders a native `<dialog>`,
   `role="dialog"`, or `role="alertdialog"` (`packages/editor/src/**`), and of
   the shared primitives in `packages/ui/src/components/`.
2. **Real-browser diagnosis** with Playwright against the running editor:
   focus placement/return, wheel/drag/backdrop behavior, Escape layering with
   nested Selects, short-viewport geometry, and instrumented event paths
   (window-capture listeners, `stopPropagation` call sites).
3. **Accessibility scan** (axe-core) of the dialog surfaces changed here.
4. **Visual inspection** of light/dark captures for the changed dialogs.

Research basis (checked 2026-09-15): MDN `<dialog>` (initial focus, inert
top layer, Escape per dialog), the 2025–2026 engineering write-ups on modal
focus/scroll/nesting failures (native `close()` restores focus but not when
the trigger unmounted; Escape must dismiss one layer), WCAG 2.2 criteria
2.4.3 Focus Order, 2.4.7 Focus Visible, 2.4.11 Focus Not Obscured (Minimum),
1.4.10 Reflow, 2.5.8 Target Size, plus APG dialog/alertdialog guidance.
Public user complaints that informed priorities: dialogs that cover the
artwork (Photoshop layer styles), dialogs opening off-screen or half-visible
(Figma community threads), and dialogs that close and lose the user's place.

## Inventory

**Family A — shared `@varve/ui` `Dialog` (native `<dialog>` +
`showModal()`).** Settings, Prompt/Confirm (AlertDialog), Welcome, Icon
Browser, Thumbnail Picker/Info, Auto Arrange, Color Conversion, Document
Info, Logo Preview, Rasterize, Manage Layouts, Workspace Customize,
Variables Panel, Quick Convert, Vectorize, Gradient Import, HDR Merge,
Effect Studio, Archive, and (after this session) Batch Rename. These get
top-layer rendering, an inert background, focus containment, Escape and
focus restoration from the platform.

**Family B — bespoke native `<dialog>` with custom header/backdrop.**
Content-Aware Fill, Frequency Separation, Font Browser, Recovery. They
`showModal()` themselves, so they keep the platform guarantees, but they
re-implement the header/close/backdrop contract.

**Family C — div-based modals with `FocusTrap` or a manual tab trap.**
Export, Upscale, Image Resize, Create Table from Data, Batch Background
Removal, Model Download, Missing Fonts. Keyboard containment works, but the
background is not inert for assistive technology and Escape handling is ad
hoc per component.

**Family D — non-modal overlays that use dialog-ish semantics** (Find &
Replace bar, floating toolbars, popovers, tool options, inspector popovers).
Explicitly out of scope for the modal contract; covered by the overlay
system and menu audits.

## Findings

| # | Severity | Finding | Root cause | Status |
|---|---|---|---|---|
| F1 | High | Escape in a nested `Select`/`MultiSelect`/`Combobox` dropdown dismissed the dropdown **and** the enclosing dialog. Reproduced in Export: `Background > Method`, one Escape closed the whole Export dialog. | Three compounding causes: the three primitives handled Escape with `preventDefault()` but not `stopPropagation()`; `Dialog` only deferred to nested overlays when an ancestor `NestedOverlayProvider` existed (only Settings and Effect Studio wrapped one); ExportDialog closed any Escape in a window-capture listener before the dropdown could see it. | **Fixed** |
| F2 | High | A press that began inside the dialog and was released over the backdrop closed it (selecting text in a field, dragging past the edge). Reproduced in Settings. | The click for a cross-element press/release is dispatched on the press/release common ancestor — the `<dialog>` element — so `event.target === dialog` was true even though the user never clicked the backdrop. | **Fixed** (shared Dialog and Content-Aware Fill, which copied the pattern) |
| F3 | Medium | `AlertDialog` put initial focus on the header Close button, so an immediate Enter could activate the focused default and confirm a destructive action. | Native `showModal()` focuses the first focusable element; the shared AlertDialog never opted into deliberate initial focus. | **Fixed** (focus moves to the cancel action; unit-tested) |
| F4 | Medium | Settings opened with focus on "Close dialog"; screen readers announced the close affordance rather than the dialog's purpose. | `Dialog`'s `focusFirstControl` is opt-in and Settings had not adopted it. | **Fixed** (focus lands on the active section tab; e2e-verified) |
| F5 | High | **Batch Rename was unreachable.** `BatchRenameDialog` and its logic were complete and unit-tested but no component rendered it. | The dialog was never wired into the Layers context menu or any command. | **Fixed** (context-menu entry, migrated to the shared Dialog; full workflow + undo + axe covered in e2e) |
| F6 | Medium | Family C modals keep the background in the accessibility tree; screen-reader users can browse content that is visually blocked. | `role="dialog"` + `aria-modal` on a `div` does not remove background content from the a11y tree the way a native `showModal()` does. | **Partially fixed** — Image Resize, Export, Model Download, Create Table from Data, Batch Background Removal, and Enhance Image migrated to the shared Dialog; Missing Fonts remains (its controller is mid-edit by another agent) |
| F7 | Medium | Capture-phase window Escape handlers in bespoke modals can dismiss a layer underneath an open nested overlay — same class as F1, different components. | Ad-hoc per-component Escape listeners instead of the shared nested-overlay contract. | **Open for `FontBrowserDialog` / `DocumentFontsPanel`** (both mid-edit by another agent during this review, deliberately untouched); `BatchBgRemoveDialog` and `TableEditOverlay` were checked and hold no nested Select/Combobox/Popover, so their capture handlers cannot race one |
| F8 | Low | When the invoking element is gone (a context-menu item that unmounted), native focus restoration has nowhere to go and focus falls to `<body>`; there is no fallback contract. | The platform restores focus to the element that had it before `showModal()`; it cannot invent a survivor. | **Fixed** — `Dialog` focuses the first `[data-dialog-focus-fallback]` marker when focus would land on `<body>`; the Layers tree marks itself |
| F9 | Low | Long dialogs have no in-dialog search or grouping review at the ≥15-item threshold (Settings sections, font/icon browsers). | No search affordance; settings nav relied on scanning. | **Fixed for Settings** — the section list filters by name, follows the first match, keeps arrow navigation to visible sections, and reports when nothing matches; font/icon browsers remain |
| F12 | Medium | `data-autofocus` could lose to a plain `<input>` earlier in the body: `querySelector` returns the first match in document order, so Settings' new section filter stole the deliberate initial focus from the active section tab. | The focus query mixed the explicit marker with generic fallbacks in one selector. | **Fixed** — the explicit marker is queried first; unit-tested |
| F10 | Info | `pnpm typecheck` failed on `master` before any dialog work (`ToolbarProps.children` required while the toolbar legitimately mounts empty; an untracked e2e spec used `Element.tabIndex`) and blocked the commit gate. | Missing optionality and a narrow element type. | **Fixed** (drive-by, both one-liners) |
| F11 | High | **Create table from data committed the table to the raw document root** (`rootChildren`) instead of the active surface's content root. The table rendered and was selected, but the Layers panel still showed "0 objects" and the node belonged to no page/canvas. Found by driving the real workflow end to end after the dialog was migrated. | The dialog reimplemented insertion instead of using the editor's `addNodeToActiveWorkspace` helper that every other create path uses. | **Fixed** — the helper moved to `scene/activeWorkspace.ts` and both the editor and the dialog use it; unit-tested against a real design canvas |

### Verified non-findings

- **Background scroll behind a dialog**: wheel over the backdrop did not
  scroll the shell, panel trees, or inspector in the editor (measured: no
  scroll container changed and `window.scrollY` stayed 0). No scroll-lock was
  added to `Dialog` on this evidence; the editor shell is a fixed grid, and a
  speculative lock risks breaking the Home surface.
- **Focus restoration on the normal path**: Escape from Settings returns
  focus to the canvas element that opened it, and menu-opened dialogs return
  focus to the invoking `File` menu item (probe `FOCUS_AFTER_CLOSE`,
  `probe-after-menu-escape-close.json`).
- **Short-viewport fit**: at 900×560 the Export surface stays inside the
  viewport, its footer row is visible, and the body scrolls instead of
  growing (asserted in the committed spec).
- **Backdrop click still dismisses**: a genuine press-and-release on the
  backdrop closes shared dialogs; the drag guard does not over-block
  (e2e-asserted).

## Evidence

```bash
VARVE_E2E_PORT=1479 VARVE_E2E_WORKERS=1 \
  npx playwright test tests/e2e/dialogs/dialog-system.spec.ts --project=chromium --reporter=list
# 7 passed: Escape layering, Settings focus/restore/drag-out/backdrop,
# short-viewport Export, Batch Rename workflow + undo, axe, visual captures

npx vitest run packages/ui/src/components/Dialog.test.tsx \
  packages/ui/src/components/{Select,MultiSelect,Combobox}.test.tsx \
  packages/editor/src/components/{BatchRename,Export,Settings,LayersPanel,ContentAwareFill}
# 566 passed
```

Captures (gitignored): `reports/dialog-audit/batch-rename-{light,dark}.png`,
`settings-{light,dark}.png`, plus the pre-fix probe JSON in the same folder.
The pre-fix Export escape path was instrumented to
`ExportDialog.tsx`'s window-capture `handleKey` calling `stopPropagation`
before the Select could consume Escape.

## Implementation summary

- `packages/ui/src/components/Dialog.tsx` — backdrop dismissal requires the
  press and the release to happen on the backdrop; the dialog provides its
  own nested-overlay registry; `AlertDialog` focuses the cancel action.
- `packages/ui/src/components/{Select,MultiSelect,Combobox}.tsx` — Escape
  stops propagating at the layer it closes.
- `packages/ui/src/components/NestedOverlayContext.tsx` — exported
  `useNestedOverlayRegistry()` so an owner can both provide and read the
  registry (the `useContext`-only shape could not).
- `packages/editor/src/components/Export/ExportDialog.tsx` — Escape defers to
  nested overlays and top-layer native modals; provides its registry.
- `packages/editor/src/components/BatchRename/*` — migrated to the shared
  Dialog, dead CSS removed, wired into the Layers context menu.
- `packages/editor/src/components/LayersPanel/index.tsx` — menu entry and
  dialog host, tree-ordered layer list.
- `packages/editor/src/components/Settings/SettingsDialog.tsx` — deliberate
  initial focus.
- `packages/editor/src/components/ContentAwareFill/ContentAwareFillDialog.tsx`
  — same press/release rule for its custom backdrop.
- `packages/editor/src/components/ImageResizeDialog.{tsx,css}` — migrated to
  the shared Dialog (native top layer, inert background, focus containment,
  Escape, restoration); the hand-rolled tab trap, backdrop button, window
  Escape listener, and dead CSS are gone, and the error text uses the
  `--color-feedback-danger` token instead of a hardcoded fallback.
- `packages/editor/src/components/Export/*` — Export and its nested model
  download prompt migrated to the shared Dialog. The custom overlay,
  header/close button, `FocusTrap`, window-capture Escape handler, and
  nested-overlay registry are gone: the platform now provides top-layer
  placement, an inert background, containment, Escape with the nested Select
  guard, and focus restoration. While a batch/video export or package build
  runs, the dialog is deliberately not dismissible from the backdrop or
  Escape, matching the disabled Close button. The model download prompt is
  the only div-based modal that was safe to keep nested before it too became
  a native dialog; its consent action receives initial focus.
- `packages/editor/src/components/BatchBgRemoveDialog.{tsx,css}` and
  `Upscale/UpscaleDialog.{tsx,css}` — migrated to the shared Dialog with
  their stage/workspace layouts preserved (the enhance workspace keeps its
  1120x900 two-column grid through a `dialog.upscale-dialog` size override),
  their nested model prompts moved to sibling dialogs, and their dead shell
  CSS deleted. Batch removal focuses the first method choice; both dialogs
  are not dismissible while processing.
- `packages/editor/src/components/Settings/SettingsDialog.tsx` — a section
  filter (`SearchField`) narrows the tablist, follows the first match when
  the active section is filtered out, keeps Arrow/Home/End navigation to the
  visible tabs, and reports "No settings match" with an empty list.
- `packages/editor/src/components/Dialog.tsx` — `data-autofocus` now wins
  over an earlier plain input (the Settings filter had stolen the deliberate
  initial focus); the explicit marker is queried before generic fallbacks.

## Verification record (final)

- **Unit, all passing**: Dialog (16), Export (22), Model Download (9),
  Image Resize (3), Batch Rename (12), Create Table from Data (5, including
  the active-surface regression), Batch Background Removal (16), Settings
  (19, including the section filter), plus the 566-test affected closure for
  the earlier slices and a 66-test re-run of the migrated dialog families.
- **E2E, `tests/e2e/dialogs/dialog-system.spec.ts`**: 11 journeys covering
  Escape layering (Export + nested Select), Settings initial focus / focus
  restoration / drag-out / backdrop click / section filter, Export at
  900x560, Create Table from Data end to end (toolbar → paste → create →
  layer in the tree), Batch Rename with undo, focus fallback to the selected
  tree row, an axe scan, Enhance Image from the layer context menu, and
  light/dark captures. Final run: 10/11 passed, and the one crashed capture
  test passed immediately on retry. The Enhance Image journey also passed
  in-harness on that run; earlier attempts crashed the renderer at random
  steps under memory pressure, and a direct probe of the identical flow had
  already verified the dialog (opens at 1120x688 inside 1280x720, grid body,
  footer, Escape closes, focus returns to the selected row).
- **Machine conditions**: the afternoon ran ~14 concurrent agent processes;
  RAM/swap were exhausted at times and the 12 GiB `/tmp` tmpfs hit 100%,
  which crashed Chromium renderers mid-journey. Browser runs were done with
  `TMPDIR=/var/tmp/...` to avoid the full tmpfs.
- **Concurrent-regression repairs (not dialog work, but found here)**: the
  context-menu extraction left `isVisualMaskTarget` unimported in
  `LayersPanel/index.tsx`, crashing every layer right-click into the error
  boundary; several untracked e2e/engine files carried type errors that
  blocked the shared commit gate; a WASM-probe spec referenced an undefined
  model-path constant. All fixed minimally or resolved by their owner.

### Still open

- Native Tauri/WebKitGTK runtime verification of the migrated dialogs — the
  evidence above is Chromium in the web build.

## Remaining work (explicitly not done)

1. Migrate the last Family C modal (F6): Missing Fonts — its controller is
   mid-edit by another agent, so it was deliberately untouched.
2. Apply the nested-overlay guard to the remaining capture-phase Escape
   handlers (F7) once `FontBrowserDialog` / `DocumentFontsPanel` are no
   longer mid-edit.
3. Adopt `focusFirstControl` in the remaining large shared dialogs whose
   first control is meaningful (Archive, Vectorize, Icon Browser).
4. In-dialog search for the font/icon browsers (the Settings filter shipped).
5. Native/Tauri host verification of the migrated dialogs was **not** run in
   this session; the e2e evidence is Chromium in the web build.
