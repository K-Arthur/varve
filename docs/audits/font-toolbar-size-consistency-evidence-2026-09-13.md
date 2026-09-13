# Font toolbar size control evidence — 2026-09-13

The floating text toolbar now uses the same labelled, bordered `Size` control
as the contextual text bar. The numeric input remains a draft until blur or
Enter, and Escape restores the draft without committing. The change keeps the
toolbar surface geometry unchanged while making the field affordance and
spacing consistent across both editing surfaces.

## Browser evidence

The real Chromium visual spec was run against the editor at three device pixel
ratios. Each run exercised light, dark, and high-contrast themes, the open and
closed picker, a 640 CSS-pixel narrow viewport, keyboard navigation, and
viewport containment. The geometry assertions measured:

```text
toolbar height: 46.796875px
control height: 32px
gap: 2.88px
padding: 5.76px 9.44px
```

The screenshots below were inspected after the run. The floating and
contextual bars share the same vertical centerline and the `Size` field is
readable at the narrow viewport.

- [Light, open picker](../screenshots/fonts/2026-09-13-toolbar-size-consistency/light-open.png)
- [Dark, narrow picker](../screenshots/fonts/2026-09-13-toolbar-size-consistency/dark-narrow.png)
- [High contrast, open picker](../screenshots/fonts/2026-09-13-toolbar-size-consistency/high-contrast-open.png)

SHA-256 for the inspected captures:

```text
18da29da3ce02ca54b64518cd7846badbfe37a07d75b2ace170b63e94239fd5c  light-open.png
a5daf0f4a6e9273b0a4185bbb9d06b1c084e119854f7f5bcb134c4e67ff94661  dark-narrow.png
3f08a5f0b3cf538fb6f4b8acc648905a8ba5952be32819a19dffe87f85153420  high-contrast-open.png
```

Commands:

```text
./node_modules/.bin/vitest run packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx --config vitest.config.ts --reporter=verbose
TMPDIR=$(mktemp -d /tmp/varve-toolbar-size-dpr2-XXXXXX) VARVE_E2E_PORT=1682 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-toolbar-size-dpr2-20260913 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium --grep 'DPR 2' --reporter=list --timeout=180000
TMPDIR=$(mktemp -d /tmp/varve-toolbar-size-dpr3-XXXXXX) VARVE_E2E_PORT=1683 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-toolbar-size-dpr3-20260913 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium --grep 'DPR 3' --reporter=list --timeout=180000
```

DPR 1 was also exercised in the combined run at port 1681 and passed. That
combined run lost its browser process during later DPR 2/3 workers; isolated
runs for both DPRs passed, so the crash was a runner/resource issue rather than
a toolbar assertion failure.
