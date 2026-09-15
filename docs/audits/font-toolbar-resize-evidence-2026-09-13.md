# Quick font toolbar resize evidence — 2026-09-13

This checkpoint covers the active text-editing toolbar lifecycle and the
spacing/size contract between the compact typography bar, the contextual bar,
and the main floating palette. It is a working-tree observation collected on
Linux Chromium while other agents were advancing `master`; it does not certify
the pending native WebKitGTK, WebView2, or WKWebView lanes.

## Reproduced failure

The visual toolbar flow created a text layer, entered editing, and resized the
viewport from 1280 to 1920 CSS pixels. Chromium delivered a resize-triggered
`Escape` to the focused native textarea. That committed the edit, unmounted
the floating font toolbar, and left the selection quick bar showing **Edit**.
The failure was visible in the failed capture from port 1625 and was confirmed
with a temporary DOM/focus trace: `resize → key Escape target TEXTAREA →
focusout TEXTAREA → toolbar=0`.

## Repair

- `TextEditOverlay` records viewport revisions, consumes one resize-delivered
  Escape during a bounded 250 ms handoff, restores textarea focus, and keeps
  regular Escape available for the user's explicit finish action.
- Blur completion waits across two animation frames and a bounded timer so a
  resize event that arrives after native blur can be observed before deciding
  whether the editing surface really ended.
- `FloatingTextBar` keeps its overlay alive through viewport/window focus
  churn, suppresses the matching portal Escape for the same bounded handoff,
  and cleans the timer on unmount. The following user Escape still dismisses
  the toolbar.
- The existing shared tokens remain authoritative: 32 px compact controls,
  `--space-toolbar` vertical padding, `--space-toolbar-item` gaps,
  `--toolbar-height` fluid sizing, matching surface/radius/shadow tokens, and
  a 180–220 px family field with horizontal overflow instead of truncation.

## Focused validation

```text
pnpm exec biome check packages/editor/src/components/TextEditOverlay.tsx packages/editor/src/components/TextEditOverlay.test.tsx packages/editor/src/components/FloatingTextBar/FloatingTextBar.tsx packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx
TMPDIR=/home/kevina/CodingProjects/varve/.tmp pnpm exec vitest run packages/editor/src/components/TextEditOverlay.test.tsx packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --no-file-parallelism --reporter=dot
```

The formatter/linter check passed. The focused suites passed **46/46**. The
new assertions cover both the resize-triggered textarea Escape and the
resize-triggered portal Escape, plus the normal second Escape path.

The real browser flow passed:

```text
TMPDIR=/home/kevina/CodingProjects/varve/.tmp VARVE_E2E_PORT=1640 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium -g 'DPR 1' --reporter=list --timeout=120000
```

Result: **1 passed** in 1.7 minutes after commit `dd2b9ae646f75daa17598c36331c49e6ad96ccbd`. The flow exercised light, dark, and high
contrast themes, 1920/1280/640 CSS-pixel widths, closed/open/narrow picker
states, keyboard filtering, active-descendant mounting, menu containment, and
the resize that previously ended editing. The inspected captures and metrics
are in [`2026-09-13-toolbar-resize`](../screenshots/fonts/2026-09-13-toolbar-resize/).

The measured DPR-1 toolbar contract was identical in all three themes:

| Property | Measured value |
| --- | --- |
| Controls | 32 px high, common centerline |
| Bar height | 46.796875 px |
| Gap | 2.88 px |
| Padding | 5.76 px 9.44 px |
| Field type size | 14.72 px |
| Overflow | `auto`, `nowrap` |
| Family field | 180 px minimum at the narrow check |

The failed port-1625 retry is retained only as diagnosis evidence. A later
pass on port 1635 is the accepted visual result. The post-commit run captured its launch and completion at
`dd2b9ae646f75daa17598c36331c49e6ad96ccbd`; `master` did not advance during the
run. The captures are therefore tied to the committed toolbar fix, while the
remaining platform lanes still require their own environments.

## Acceptance disposition

This closes the quick-toolbar resize regression and supplies fresh geometry
evidence for acceptance scenario 8. It does not close the broader scenario:
presentation-only preview, full range transaction coverage, and native
platform evidence remain open in the [font acceptance matrix](font-acceptance-matrix-2026-09-09.md).
