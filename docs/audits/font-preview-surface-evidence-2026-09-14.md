# Typography preview surfaces — 2026-09-14

The family/face picker now uses the same presentation-only preview boundary in
the floating quick toolbar, contextual properties bar, and Typography
inspector. Hovering or keyboard navigation applies a temporary render through a
`preview` transaction. Escape, dismissal, target changes, and unmount restore
the captured document; selecting a family or exact face commits one authored
history entry. A surface without a transaction boundary falls back to its
existing explicit apply path rather than pretending that a preview is safe.

## Implementation

- `useTypographyPreview` owns the begin/apply/commit/abort lifecycle and keeps
  callback references stable across document renders.
- The floating toolbar receives the editor transaction callbacks from
  `CanvasOverlays` and passes preview callbacks through the shared
  `FontSelector`.
- The inspector supplies the same callbacks for single- and multi-node
  typography edits and now reports a mixed family value to the combobox.
- The contextual bar uses the same controller, so all editing surfaces have
  one Escape and stale-target boundary.

## Focused evidence

```text
pnpm exec vitest run \
  packages/editor/src/components/Typography/useTypographyPreview.test.ts \
  packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx \
  packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx \
  packages/editor/src/components/Typography/typographyCommand.test.ts \
  --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
```

Result: **4 files passed, 57 tests passed**. The new hook tests cover
multi-hover without history, commit-on-selection, Escape/target-change
restoration, unmount cleanup, and the explicit no-boundary fallback. The
floating-toolbar test exercises the real portaled picker and verifies that a
hover previews without committing and Escape aborts it.

The existing Chromium toolbar run remains the visual evidence for shared
32-pixel controls, aligned centers, viewport-contained menus, and Light/Dark/
High Contrast/narrow states. Native WebKitGTK, Windows WebView2, and macOS
WKWebView visual runs remain platform-owned checks.
