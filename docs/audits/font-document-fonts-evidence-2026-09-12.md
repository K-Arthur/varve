# Document Fonts replacement evidence — 2026-09-12

This checkpoint adds the missing replacement command to the Document Fonts
panel. The action is intentionally scoped to one usage row and reuses the
full browser's installed-family and exact-face selection model.

## Runtime contract

- Each used face row keeps its existing **Select** action and now exposes
  **Replace** with an accessible label containing the family and face.
- The panel reports the affected layer and character counts while the chooser
  is open. Closing the chooser does not mutate the document.
- Choosing a family clears an old exact reference. Choosing an expanded
  registered face carries its artifact/member reference into the replacement.
- The shared `applyFontReplacement` adapter calls `FontResolver`, updates top
  level text, rich runs, and shared text styles, and attaches manifest v2
  replacement provenance. The editor wraps the operation in one transaction.
- Escape is captured at the font-dialog boundary when another recovery or
  text-editing surface still owns focus. This closes the font workflow first,
  without committing the pending replacement.
- A full line-wrap geometry preview and a restore-original command remain open
  acceptance work; the panel warns that layout can change after replacement.

## Evidence

Focused tests passed:

```text
pnpm exec vitest run packages/editor/src/components/FontBrowser/DocumentFontsPanel.test.tsx packages/editor/src/components/FontBrowser/applyFontReplacement.test.ts packages/editor/src/components/FontBrowser/MissingFontDialog.test.tsx packages/editor/src/components/FontBrowser/missingFontRecovery.test.ts packages/engine/src/font/fontResolver.test.ts packages/engine/src/font/fontPersistence.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
```

Result: **10 files, 84 tests passed** (including exact replacement reference,
rich-run/style updates, single transaction wiring, Escape dismissal, and
missing-font recovery).

The editor package typecheck also passed:

```text
pnpm --filter @varve/editor typecheck
```

The shared replacement helper was extracted from the missing-font controller so
the Document Fonts and missing-font flows cannot drift in their matching,
identity-clearing, or manifest bookkeeping behavior.

The focused Chromium scene passed on port 1543:

```text
VARVE_E2E_PORT=1543 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/document-fonts-panel.spec.ts --project=chromium --reporter=list --timeout=120000
```

The run reached the replacement chooser, verified Escape dismissal, reopened
the responsive inspector at 560×760 in dark mode, and passed the containment
assertions. The inspected captures are:

- `test-results/run-1823034-1543/canvas-document-fonts-pane-5b10a--in-a-narrow-dark-inspector-chromium/document-fonts-replacement-chooser.png`
- `test-results/run-1823034-1543/canvas-document-fonts-pane-5b10a--in-a-narrow-dark-inspector-chromium/document-fonts-narrow-dark.png`

The first image shows the anchored Browse fonts chooser with the affected
Document fonts row behind it. The second shows the readable dark responsive
Document fonts panel with exact-face status, affected character count, and
Select/Replace actions within the viewport. A later retry on port 1544 hit a
headless Chromium SIGSEGV during screenshot capture; it is retained as an
environment limitation and is not counted as evidence.
