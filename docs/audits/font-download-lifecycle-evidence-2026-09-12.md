# Font download lifecycle checkpoint — 2026-09-12

This checkpoint continues the September 11 audit on `master`. It covers the
font download manager, not installation storage or the complete font program.

Four controlled regressions reproduced stale cancelled/retried attempts and
validation exceeding the queue limit. Four transport regressions reproduced
late progress after cancellation and missing network deadlines. Two integrity
regressions reproduced false success from the synchronous helper and unavailable
Web Crypto. The manager now invalidates attempts by generation, retains capacity
through validation, clamps concurrency to one or two attempts, drains the queue
without an empty-batch loop, and bounds headers plus body to 30 seconds. Retries
wait for the previous attempt to settle. Removed jobs cannot publish late results.

SHA-256 verification uses actual bytes. The deprecated synchronous helper declines
supplied hashes; the async verifier reports missing Web Crypto instead of claiming
success. The required OFL Geist fixture supplies the real artifact and metadata.
Transport and scheduling are controlled; these tests do not establish browser
permission, offline UI, native download, storage cancellation or restart behavior.

## Validation

The final focused run passes **35 tests**. Engine typechecking passes. The earlier
affected package run passed 4,490 engine tests before the later network/integrity
cases were added; the final focused run covers those additions. The dependency
closure was collected once, with targeted repairs after failures. It remains
incomplete: editor units were interrupted, editor/import compilers report existing
unrelated errors, and desktop typechecking was terminated. No passing full gate
or complete end-to-end font scenario is claimed.

```sh
pnpm verify:plan
VARVE_TEST_WORKERS=2 VARVE_E2E_PORT=1471 VARVE_E2E_OUTPUT_DIR=font-lifecycle-affected pnpm verify:affected
VARVE_TEST_WORKERS=2 pnpm exec vitest run packages/engine/src/font/fontDownloadLifecycle.test.ts packages/engine/src/font/fontDownloadManager.test.ts
pnpm --filter @varve/engine typecheck
pnpm audit:docs
pnpm audit:emoji
pnpm audit:tokens
```

Local output: `reports/font-lifecycle-2026-09-11/`, especially `integrity-after.log`,
`integrity-types.log`, `affected.log`, and `downstream-after-editor.log`.
The docs and emoji audits passed; all 153 token pairs passed across three themes.

The [acceptance matrix](./font-acceptance-matrix-2026-09-09.md) retains all 24
scenarios as open. Next checks: bounded parser workers; cancellation during
storage; durable migration/uninstall/restart; browser offline retry; Linux
Tauri/WebKitGTK exact-face workflow. Windows WebView2 and macOS WKWebView need
their native environments. See the [font architecture](../architecture/font-system.md).
