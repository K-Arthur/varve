# Font export fetch-timeout evidence — 2026-09-14

The bundled-font collector now bounds each URL fetch and distinguishes caller
cancellation from a fetch deadline.

## Contract

- `FontCollectOptions.timeoutMs` bounds one bundled artifact fetch (15 seconds
  by default).
- A deadline emits `timeout` through the progress callback.
- Export callers pass `failOnTimeout: true`, which raises
  `FontCollectionTimeoutError` instead of silently producing an incomplete
  package/PDF.
- Clipboard and other recovery-oriented callers keep the default non-throwing
  behavior and can surface the missing asset state.
- Existing exact artifact/member hash checks remain unchanged.

## Evidence

```text
pnpm exec vitest run packages/engine/src/font/fontDataCollector.test.ts packages/engine/src/font/fontDataCollector.recovery.test.ts packages/editor/src/packageExport.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
```

Result: 3 files passed, 12 tests passed, including a stalled-fetch timeout,
explicit export failure, and recoverable timeout path.

The change addresses the export row in
`docs/audits/font-acceptance-matrix-2026-09-09.md`; native embedding and full
format-policy proof remain separate acceptance work.
