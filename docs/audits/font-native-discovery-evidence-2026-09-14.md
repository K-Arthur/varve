# Native font discovery evidence — 2026-09-14

This note records the native discovery repair that follows the typography
audit. It supplements the dated acceptance matrix; it does not replace the
pending desktop WebKit and Windows/macOS evidence.

## Finding

The desktop command returned family, style, and an absolute path. The webview
had no stable way to request the bytes for the selected face, and a path could
not identify a member inside a TTC/OTC artifact. The browser adapter also had
no native-byte request to use after an exact face was selected.

## Change

`enumerate_system_fonts` now returns optional `handle`, `artifactHash`,
`collectionIndex`, and `faceKey` fields. The artifact hash is computed from the
original file bytes and is cached once per path during one enumeration. For a
collection, the selected member is matched against the family/full/PostScript
names with `ttf-parser`.

`load_system_font` accepts the nested `{ request: { handle } }` IPC payload.
The native side decodes the versioned handle, re-enumerates the current system
font collection, verifies family/name/path membership, rehashes the file, and
checks the collection member before returning bytes. A forged or stale handle
returns a structured error or no result rather than becoming an arbitrary file
reader. `loadSystemFontFace` is the matching engine adapter and stays a no-op
outside Tauri.

The legacy family list and browser Local Font Access permission states remain
available. Search and hover still do not enumerate fonts; the existing explicit
refresh/allow action owns the permission prompt.

## Evidence

Commands run:

```text
rustfmt --edition 2021 apps/desktop/src-tauri/src/font.rs
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib font::tests -- --nocapture
pnpm exec biome check --write packages/engine/src/font/fontLoader.ts packages/engine/src/font/fontRegistry.ts packages/engine/src/font/fontIdentity.ts packages/engine/src/font/fontBridge.ts packages/engine/src/font/index.ts packages/engine/src/font/fontNative.test.ts
pnpm exec vitest run packages/engine/src/font/fontNative.test.ts packages/engine/src/font/fontLoader.test.ts --pool=threads --maxWorkers=1 --reporter=dot
```

Results:

- Desktop library check passed; existing unrelated warnings remain in
  `build.rs` and `src/lib.rs`.
- Four native font tests passed, including handle validation and host
  enumeration/filter invariants.
- Twenty-one engine font-loader/native-bridge tests passed.
- The browser bridge test proves the exact nested IPC request and verifies
  that non-Tauri runtimes never call native IPC.

## Limits and follow-up

The command returns the original collection artifact, with the selected member
validated in the handle. Slicing a TTC into a standalone face is still an
export/import concern and remains covered by acceptance scenarios 5 and 20.
Real desktop WebKit capture, OS refresh notifications, and Windows/macOS
manual runs remain pending. The native enumeration test uses the host font
database; it is an invariant check, not a frozen corpus certification.

## Embedded WDIO follow-up — 2026-09-14

`tests/wdio/font-native.e2e.ts` now exercises the real Tauri bridge. It checks
stable `(family, name)` ordering and de-duplication, the nested family-filter
request, and exact-byte loading by hashing the returned artifact and comparing
it with the native `artifactHash`. A minimal host with no readable font file
still records enumeration invariants; the normal Linux lane requires the
loaded-byte assertion.

The requested run was:

```text
VARVE_WDIO_SPECS=./tests/wdio/font-native.e2e.ts pnpm test:desktop:native
```

It reached `desktop:build:test` but stopped in the shared worktree's existing
frontend TypeScript errors (`Menubar.tsx`, `inputPipeline.ts`, `wheelClassifier.ts`,
`applyFontReplacement.ts`, `ManageLayoutsDialog.tsx`, `geometry/vectorOps.ts`,
`snapping.ts`, and `workspace/layoutVariants.ts`) before the Tauri binary or
WDIO spec could start. This is a build-lane blocker, not native test evidence.

## Native WDIO continuation — compact probe and feature-only build

The WDIO probe was tightened to calculate ordering, de-duplication, filtering,
and the returned-byte hash inside the webview, returning only compact summaries
through the embedded completion callback. This avoids sending the complete
system-font list or font bytes through the WebDriver transport. The file passes
`pnpm typecheck:e2e` and Biome.

To isolate the native lane from the unrelated frontend type errors, the desktop
Rust binary was rebuilt directly with the test feature:

```text
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --features wdio
```

The build completed successfully in 4m09s. The first direct WDIO launch reached
the embedded WebDriver server, but both tests then failed while invoking the
native command (`Completion handler for function call is no longer reachable`,
followed by `Tauri core.invoke not available`). Later launches could not bring
the embedded server up within 60 seconds. The host also lacks
`WebKitWebDriver` and `tauri-driver`; the run therefore remains environment
evidence, not a passing native-font certification. The next executable check is
the same compact spec in the Linux desktop lane with a stable embedded-driver
startup.

## Native command scheduling follow-up — 2026-09-14

Enumeration and exact-byte loading now run through Tauri's blocking task pool.
The command boundary remains asynchronous, so filesystem enumeration, font
parsing, and artifact hashing cannot starve the WebView callback queue while a
WDIO session is waiting for `invoke`.

Focused validation:

```text
rustfmt --edition 2021 --check apps/desktop/src-tauri/src/font.rs
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib font::tests -- --nocapture
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --features wdio
timeout 90s env VARVE_DESKTOP_BINARY=apps/desktop/src-tauri/target/debug/varve-desktop VARVE_WDIO_SPECS=./tests/wdio/font-native.e2e.ts pnpm exec wdio run wdio.conf.ts
```

The targeted Rust formatter check, four native font tests, library check, and
feature-enabled binary build passed. The bounded WDIO attempt reached the
embedded WebDriver and completed session setup, but both specs still reported
`Tauri core.invoke not available after 5s timeout`. The host diagnostics also
report no `WebKitWebDriver` and no `tauri-driver`. This is a useful scheduling
improvement and a reproducible environment boundary, but it is not a passing
desktop E2E result; the Linux desktop lane with its installed driver remains
the required certification check.

## Test-overlay asset root follow-up — 2026-09-14

The embedded driver failure was also reproduced with a compact WebDriver probe:
the Tauri globals existed, but the active document was `about:blank` and the
WDIO frontend bridge had never executed. The root cause was the test config
overlay omitting `build.frontendDist`; a merged Tauri configuration can then
launch the WebDriver server without a frontend asset root. The overlay now
declares `"frontendDist": "../dist"`, and the desktop compatibility test guards
that contract. A feature-only binary was rebuilt from the already generated
WDIO Vite bundle; the Rust build completed, while this host still lacks the
platform WebKit driver needed for a complete native session. The next check is
the same font spec in Linux CI/desktop with the corrected overlay and installed
driver. No native pass is claimed here.
