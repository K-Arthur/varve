# Contextual typography bar italic — 2026-09-14

Captured from exact `master` SHA `6f4c4375ebd16e5f3349238a8180a57d1a4a209d` with the
DPR 1 Chromium typography visual workflow. The set covers light, dark, and
high-contrast themes in closed, open, and narrow states. The contextual
properties bar includes the real-face-gated Italic control while the floating
bar remains aligned to the shared palette tokens.

Command:

```text
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1732 VARVE_E2E_WORKERS=1 \
VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-toolbar-final-20260914-head \
npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts \
  --project=chromium -g 'DPR 1' --reporter=list --timeout=180000
```

All controls measure 32px high on a 46.796875px toolbar surface with a 2.88px
gap, 5.76px / 9.44px padding, and 14.72px control text. The menu remains
contained at the 640px narrow viewport. Metrics are stored beside each theme.
