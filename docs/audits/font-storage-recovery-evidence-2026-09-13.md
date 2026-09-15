# Font storage recovery evidence — 2026-09-13

The export collector now treats a corrupt exact stored record as unavailable,
then continues to the verified bundled source for the same artifact. It still
rejects a response whose original bytes do not match the requested SHA-256.

## Exact run

```text
./node_modules/.bin/vitest run packages/engine/src/font/fontDataCollector.test.ts packages/engine/src/font/fontDataCollector.recovery.test.ts --config vitest.config.ts --reporter=verbose
```

Result: **2 files passed, 4 tests passed**. The recovery fixture supplies
tampered stored bytes and a matching bundled member; the collector returns the
bundled bytes and preserves the exact face reference. The neighboring tests
cover member selection, absent-member refusal, and modified-byte rejection.
