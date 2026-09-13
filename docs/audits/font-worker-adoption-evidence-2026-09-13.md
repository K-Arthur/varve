# Worker font adoption evidence — 2026-09-13

This checkpoint verifies the synchronous worker typography readiness boundary
used by canvas admission. A worker must not be trusted for a declared face
until the acknowledgement matches the current face-set key; a stale
acknowledgement cannot unlock a render.

## Exact run

The focused test was run from `master` after the package-export repair:

```text
./node_modules/.bin/vitest run packages/editor/src/render/workerHost.fonts.test.ts --config vitest.config.ts --reporter=verbose
```

Result: **1 test passed**. The test confirms that:

- the worker receives the exact face payload and current key;
- `fontsReady` stays false while adoption is pending;
- a stale key is ignored;
- a matching key with a failed family still reports that family unavailable;
- only a matching key that reports the family usable clears the admission set.

This is a host-level contract test. It does not certify a real browser
`FontFace` decode or WebKitGTK/Windows/macOS worker behavior; those remain
platform acceptance items.
