# Font frontend evidence — 2026-09-12

This entry records the frontend half of the face-identity and local-discovery
repair. It is intentionally separate from the storage evidence because the
browser and native stores can be validated without a mounted editor surface.

## Implemented behavior

- The full browser expands only `FontRegistry` faces. It no longer creates
  synthetic PostScript names from every catalog weight/style combination.
- The full browser list uses measured virtualization and overscan. It keeps a
  normal-flow fallback only while its scroll viewport has not produced a
  measurable range, which preserves first paint and jsdom accessibility tests.
- Parsed byte-backed faces and native/browser local-font enumeration carry the
  known PostScript name, collection member, portable face key, and variable
  axis definitions into the shared registry.
- **Allow local fonts** / **Refresh local fonts** is an explicit action. The
  status distinguishes a ready native/API result, a denied browser permission,
  and the compatibility list. Search, hover, and opening a family never invoke
  enumeration or fetch a provider artifact.
- The quick text toolbar writes the ordinary `fontWeight` and, when the family
  declares `wght`, the same value into `variableAxes.wght` while retaining all
  other authored axes.
- The Typography inspector's ordinary weight control uses the same command
  adapter as the quick toolbar. Bold and numeric weight edits therefore keep
  authored `wdth`, `slnt`, and other custom axes while updating `wght` for
  variable families; static families keep the legacy weight-only update.
- Expanded browser rows now expose a face-level selection action. Applying a
  selected face updates family, weight, style, PostScript metadata, and the
  canonical `fontReference` together; applying a family row clears an older
  exact reference instead of carrying it into a different face. This landed in
  `40cabdd2b`.

## Focused validation

Commands run:

```text
./node_modules/.bin/biome check packages/engine/src/fontRegistry.ts packages/engine/src/fontRegistry.test.ts packages/engine/src/font/fontLoader.ts packages/engine/src/font/index.ts packages/editor/src/components/FontBrowser/FontBrowser.tsx packages/editor/src/components/FontBrowser/FontBrowser.css packages/editor/src/components/FontBrowser/FontBrowser.test.tsx packages/editor/src/components/FontBrowser/restoreStoredFonts.ts packages/editor/src/components/FloatingTextBar/FloatingTextBar.tsx packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx
./node_modules/.bin/vitest run packages/engine/src/fontRegistry.test.ts packages/engine/src/font/fontLoader.test.ts --config vitest.config.ts --reporter=verbose
./node_modules/.bin/vitest run packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx --config vitest.config.ts --reporter=verbose
./node_modules/.bin/vitest run packages/editor/src/components/FontBrowser/FontBrowser.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=verbose
./node_modules/.bin/vitest run packages/editor/src/components/FontBrowser/FontBrowser.test.tsx packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx packages/editor/src/components/Inspector/sections/__tests__/VariableAxes.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
./node_modules/.bin/tsc -p packages/engine/tsconfig.json --noEmit
pnpm audit:docs
pnpm audit:emoji
pnpm audit:tokens
```

Results: registry/loader **61/61**, toolbar **29/29**, browser **3/3**;
engine typecheck and all three audits passed. The editor typecheck was run as
part of the affected work and remains blocked by unrelated concurrent edits in
`Menubar`, `createActionHandlers`, `AIStatusIndicator`, `ContextAwareShortcuts`,
`PositionSizeSection`, `StorageSettingsTab`, and `WorkspaceTabs`.
The face-selection regression and its neighboring typography controls pass
**24/24** in the focused combined run (the browser face assertion is included).

## Visual inspection

The inspected toolbar captures remain in
[`2026-09-10-toolbar`](../screenshots/fonts/2026-09-10-toolbar/). At 1280 CSS
pixels, all three themes measure a 46.796875px surface, 2.88px gap,
5.76px/9.44px padding, 32px controls on a common centerline, and 14.72px field
text. The closed/open/narrow captures cover DPR 1/2/3 and light, dark, and
high-contrast themes. The newer frontend captures are in
[`2026-09-12-frontend`](../screenshots/fonts/2026-09-12-frontend/); the
format/undo and long-text clipping states were inspected before this change.

The focused Chromium attempt was made with:

```text
VARVE_E2E_PORT=1537 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-selector.spec.ts --project=chromium --reporter=list
VARVE_E2E_PORT=1538 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-selector.spec.ts -g "font selector opens dropdown with bundled fonts" --project=chromium --reporter=list
```

The first run reached the editor but the first selector test could not mount
its menu, and the persisted-font case timed out while waiting for the text
tool. The isolated rerun was stopped in `global-setup` when the New button was
detached during concurrent editor changes. These are environment/concurrency
failures, not passing claims for the new browser action; the deterministic
component and registry tests above are the evidence for this slice. A fresh
Chromium run on a quiet `master` checkout remains the next executable check.

The follow-up visual run used the shared toolbar oracle after the inspector
adapter landed:

```text
VARVE_E2E_PORT=1545 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium --reporter=list
VARVE_E2E_PORT=1546 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium -g 'DPR 1' --reporter=list
```

The first run passed DPR 2 and DPR 3 and hit a cold-start canvas-bounds race in
DPR 1. The isolated DPR 1 rerun passed after the dev server was warm. All
three DPRs therefore passed the theme, readable-menu, viewport-containment,
active-descendant, and shared-chrome assertions. I inspected the resulting
light open, light narrow, and dark narrow captures under
`test-results/run-1048965-1546/`; the family field stays readable, controls
remain 32px on one centerline, and the menu stays inside the narrow viewport.

## Remaining platform work

Linux Tauri/WebKitGTK still needs an embedded local-font permission and native
refresh capture. Windows WebView2 and macOS WKWebView remain pending their
native CI/manual environments. Document Fonts, Select by Font, exact
collection-face replacement, and image crop-to-font application remain open
from the main typography audit.
