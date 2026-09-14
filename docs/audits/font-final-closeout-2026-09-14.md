# Font system closeout — 2026-09-14

This is the final bounded closeout for the font and typography work on
`master`. The implementation is shipped in progressive commits; this note
records the user-facing surfaces, the last visual check, and the platform work
that cannot be certified on this Linux host.

## User-facing scope

- The FontRegistry/FontLoader/FontResolver path now carries portable artifact
  and collection-member identity through discovery, storage, document loading,
  replacement, rendering, and export preflight.
- Native system-font requests use opaque handles and exact collection-member
  extraction. Refresh removes stale native entries, and stored collection
  members are restored as standalone validated faces.
- The inspector, contextual bar, floating text bar, and Logo controls share
  the same face picker and typography command adapter. Preview is temporary;
  a chosen face is one undoable change. The quick bars use the shared
  `--component-compact-height` (32px), toolbar gap, padding, surface, radius,
  and overflow tokens. The contextual bar keeps a bounded family field rather
  than squeezing it into an unreadable pill.
- The marketing feature page and typography guide describe exact faces,
  variable axes, local-font permission/import, missing-font recovery, Document
  Fonts, licensing boundaries, and image identification. The architecture and
  dated audit documents link the evidence instead of promising unsupported
  native or cross-platform behavior.

## Visual evidence

The focused Chromium run previously passed **6/6** across DPR 1, 2, and 3,
with light, dark, high-contrast, narrow, open-menu, and expanded-face captures
inspected. Measured values were 32px controls, shared gap `2.88px`, shared
padding `5.76px 9.44px`, readable family fields, and no menu clipping.

The final rerun on this host passed DPR 1, DPR 2, and all four typography
interaction cases. DPR 3 then crashed in Chromium with a renderer
`SIGSEGV` while `page.evaluate()` read computed styles; no toolbar assertion
failed. A single DPR-3 retry reproduced the same browser crash. This is
recorded as a host/browser limitation, not a visual pass, and does not change
the earlier inspected DPR-3 evidence.

```text
CI=1 VARVE_E2E_PORT=1792 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 \
VARVE_E2E_OUTPUT_DIR=font-final-closeout-20260914 \
npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts \
tests/e2e/canvas/typography-editing.spec.ts --project=chromium \
--reporter=list --timeout=180000
```

## Validation boundary

The focused font/editor suites, parser corpus, native exact-face adapters,
browser Document Fonts workflow, website builds, and documentation/emoji/token
audits are green in the linked validation report. `pnpm verify:plan` selected a
Tier-5 escalation because the shared worktree contains unrelated workspace,
toolchain, Rust, desktop, and validation-infrastructure changes. The required
full gate was run with an explicit reason and stopped on those unrelated
typecheck/lint/architecture diagnostics; no font diagnostic was reported.

Native Linux WebKit/WDIO, Windows WebView2, and macOS WKWebView restart and
exact-byte lanes remain platform-owned follow-ups. Live collaboration
transport, real color-font output parity, and the large-catalog benchmark also
remain evidence gaps; the product surfaces report these as limitations rather
than implying certification.

See the [agent validation report](./font-agent-validation-report-2026-09-14.md),
[native exact-face evidence](./font-native-exact-face-evidence-2026-09-14.md),
and [font architecture](../architecture/font-system.md) for the detailed
commands, commits, and acceptance matrix.
