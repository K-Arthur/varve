# Font system closeout evidence — 2026-09-14

This is the closeout record for the font-system implementation work on
`master`. It supplements the dated audit, acceptance matrix, architecture
document, and the more detailed surface-specific evidence logs. It records the
last verification pass without changing the status of scenarios that still
require a native platform lane.

## Delivered surfaces

- The compact typography toolbar, contextual bar, inspector, Logo typography
  controls, Font Browser, Document Fonts panel, replacement flow, and image
  identification controls share the registry-backed font model and typography
  command path.
- Toolbar sizing and spacing are token-based and were checked at DPR 1, 2, and
  3, including dark, high-contrast, and narrow-panel captures. The latest
  inspected captures are recorded in
  [`font-toolbar-visual-evidence-2026-09-14.md`](./font-toolbar-visual-evidence-2026-09-14.md).
- Marketing and help content cover exact-face identity, local permissions,
  missing-font recovery, variable axes, licensing boundaries, Document Fonts,
  Select by Font, and image identification. The affected pages are the
  typography feature page, typography guide, and file-format guide.
- Native opaque-handle loading now selects the requested TTC/OTC member and
  refuses same-family fallback for missing or stale exact references; the
  focused proof is in
  [`font-native-exact-face-evidence-2026-09-14.md`](./font-native-exact-face-evidence-2026-09-14.md).

## Final focused checks

The current checkout passed the focused font/editor suites:

```text
pnpm exec vitest run packages/engine/src/font packages/editor/src/components/FontBrowser packages/editor/src/components/Typography/useTypographyPreview.test.ts packages/editor/src/components/Typography/typographyCommand.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
47 files, 585 tests passed
```

The Document Fonts browser workflow also passed against the existing Chromium
app server. It selected a bundled replacement, verified the replacement, used
Undo and Redo, and restored the original face through the confirmation dialog.
The inspected captures are stored under
`test-results/canvas-document-fonts-pane-5b10a--in-a-narrow-dark-inspector-chromium/`.

```text
npx playwright test tests/e2e/canvas/document-fonts-panel.spec.ts \
  --config=/tmp/varve-existing-e2e.config.mjs --project=chromium \
  --reporter=list --timeout=180000 --retries=0
1 passed
```

Website builds and the typography workflow E2E were previously rerun for both
the GitHub Pages and custom-domain base paths: 14/14 route checks passed. The
toolbar visual run passed at all three device pixel ratios, and the geometry
oracle passed five scenarios. The corresponding evidence logs contain the
exact commands and capture paths.

The required hygiene checks are clean:

```text
pnpm audit:docs   # clean: 898 docs, 486 links, 174 ADRs
pnpm audit:emoji  # clean: 4706 files
pnpm audit:tokens # 153 pairs pass across light, dark, high-contrast
```

## Validation boundary

`pnpm verify:plan` and `pnpm verify:affected` see 236 changed files because the
shared checkout contains concurrent native, imaging, and website work. The
planner therefore escalates to the repository full gate. That gate was run
with an explicit font checkpoint reason and stopped on pre-existing unrelated
workspace diagnostics (`contentAwareFill`, `mobileSam`, and LUT tests), plus
existing architecture-budget reports. No font diagnostic was reported.

Linux Chromium owns the browser and visual evidence. Native WebKitGTK,
Windows WebView2, and macOS WKWebView still need their respective desktop
lanes for exact installed-face restart, OS refresh/revocation, and native
clipboard/export certification. Those limitations remain explicitly Partial
or Open in the acceptance matrix; this closeout does not promote them to
complete.
