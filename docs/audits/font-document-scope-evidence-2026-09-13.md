# Document font replacement scope evidence — 2026-09-13

The Document Fonts panel presents a page or whole-document scope. Before this
check, its replacement chooser always invoked the resolver against the complete
document, so a replacement selected from the current-page tab could rewrite
matching text on other pages as well. That made the visible scope control
misleading.

The editor replacement adapter now accepts an optional set of usage node IDs.
The page tab passes the IDs collected for that page; the document tab passes the
complete usage set. The resolver still handles top-level text and rich-text runs
with the same exact-face matching and provenance behavior. For a linked text
style, the adapter materializes the effective style font as a node-level
override only for the selected nodes. The shared style definition and nodes on
other pages remain unchanged. Restore uses the same scope set, so a reviewed
restore cannot silently expand to unrelated pages.

## Evidence

Focused command:

```text
pnpm exec vitest run \
  packages/editor/src/components/FontBrowser/applyFontReplacement.test.ts \
  packages/editor/src/components/FontBrowser/DocumentFontsPanel.test.tsx \
  --config vitest.config.ts --reporter=verbose
```

Result: 2 files, 13 tests passed. The new adapter assertions cover:

- a replacement changing one usage row while an identically named node stays
  on the original family;
- a linked text style becoming a scoped node override while the shared style
  and the other style consumer remain unchanged;
- restoring a scoped style override without changing its other consumers;
- existing exact-face, rich-run, provenance, restore, and ambiguous-history
  behavior.

The focused formatter/linter check also passed:

```text
pnpm exec biome check \
  packages/editor/src/components/FontBrowser/applyFontReplacement.ts \
  packages/editor/src/components/FontBrowser/applyFontReplacement.test.ts \
  packages/editor/src/components/FontBrowser/DocumentFontsPanel.tsx
```

This evidence is editor-side. Linked stories whose content is physically
shared by frames on multiple pages still require a story-aware scope model and
remain open in the acceptance matrix; the adapter does not claim to split a
shared story for a page-only operation.

## Browser and visual evidence

The existing Chromium workflow was run against the implementation:

```text
VARVE_E2E_PORT=1692 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 \
  npx playwright test tests/e2e/canvas/document-fonts-panel.spec.ts \
  --project=chromium --reporter=list --timeout=180000 \
  --output=reports/font-document-scope-20260913-final
```

Result: 1 test passed. The test exercised the real editor, opened the
replacement chooser, captured the narrow inspector, and checked the dark
560×760 layout. The inspected captures and hashes are in the
[screenshot manifest](../screenshots/fonts/2026-09-13-document-font-scope/manifest.json):

- [replacement chooser](../screenshots/fonts/2026-09-13-document-font-scope/replacement-chooser.png)
- [narrow dark current-page panel](../screenshots/fonts/2026-09-13-document-font-scope/narrow-dark.png)

The chooser remains readable at 1280×720 with the selected-family details and
variable-axis controls visible. At 560×760 the panel stays within the viewport,
the current-page scope remains legible, and the action buttons do not overflow.
