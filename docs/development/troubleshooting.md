# Troubleshooting

Common issues and fixes for Varve development. For CI/CD failures, see
`docs/CI_CD_RESILIENCE.md`.

## Build

### `just check-env` fails

Run `just check-env` to verify the toolchain. Common failures:

- **`pkg-config --exists webkit2gtk-4.1` not found** — install Linux system
  dependencies (see `docs/development/setup.md` for per-distro packages).
- **`rustc` not found** — source Cargo: `. "$HOME/.cargo/env"`.
- **`pnpm` not found** — ensure `PNPM_HOME` is on PATH.

### `cargo build` fails with linking errors

Ensure the wasm32 target is installed and system libraries are present:

```bash
rustup target add wasm32-unknown-unknown
# Linux: install webkit2gtk-4.1, gtk3, librsvg, libsoup3, openssl, cmake
```

### AppImage build fails (`failed to run linuxdeploy`)

linuxdeploy's bundled `binutils strip` does not understand the `SHT_RELR`
section type emitted by modern toolchains. The justfile sets `NO_STRIP=1`
automatically for `package-appimage` and `package-linux`. If building
manually, set `NO_STRIP=1` in the environment.

### AppImage shows blank white screen

On distros with newer Mesa/EGL stacks (Arch, CachyOS, Fedora), the bundled
WebKitGTK fails EGL display creation. The AppImage build pipeline runs
`scripts/release/prune-appimage-bundled-libs.mjs` to remove the bundled
`usr/lib` stack so the host's libraries are used. Locally, run the app via
`pnpm tauri:dev` instead of the AppImage.

### LFS models not fetched

After cloning, model files may be placeholders:

```bash
git lfs install --local
git lfs pull
node scripts/release/check-bundled-assets.mjs
```

### Rust release build is slow (~38 min cold)

Expected. Profile: `opt-level = 3`, `lto = "thin"`, `codegen-units = 1`,
`strip = true`. Debug builds are fast; use `cargo build` (debug) for
iteration and `pnpm tauri:dev` for full desktop builds.

## Platform-specific

### Linux: Wayland shows generic icon in `tauri dev`

`tauri dev` does not install desktop entries. Run `just install-dev-icons`
(automatically called by the `pretauri:dev` hook on Linux).

### Linux: glibc version mismatch

Do **not** ship a Linux package built on a modern Arch/CachyOS machine.
A binary built on glibc 2.44 fails on Ubuntu 22.04 (glibc 2.35). Release
artifacts are built on `ubuntu-22.04` runners to set the floor at 2.35.

### Linux: AppImage requires FUSE2

AppImage needs FUSE2. On FUSE-less systems, use `--appimage-extract-and-run`.

### macOS: Gatekeeper blocks unsigned DMG

Unsigned DMGs trigger Gatekeeper. Users must go to System Settings >
Privacy & Security > Open Anyway. macOS builds are ARM64 only (no Intel
ONNX Runtime dylib).

### Windows: SmartScreen warning

Unsigned NSIS installer triggers "Windows protected your PC". SmartScreen
reputation builds over time with signed builds.

### Windows: E2E test shell syntax errors

PowerShell fails on bash-style line continuations. Add `shell: bash` to
CI steps that use `\` line continuations.

## Testing

### E2E first test times out

The editor's module graph takes ~90-100s on a cold Vite cache. Mitigations
are in place (global warm-up, 180s timeout). If the first test still fails
on a warm server, check whether a parallel process is editing
`packages/scene` or `packages/engine` — Vite invalidates and re-transforms
those modules mid-run.

### Perf-budget tests flake under load

Wall-clock assertion tests (e.g., `< 50ms`) fail when run concurrently with
CPU-saturating builds. Run them in isolation: `pnpm bench`.

### Untracked scratch files break typecheck

An untracked scratch file under `packages/*/src` (e.g.,
`__scratch__/probe.test.tsx`) is picked up by TypeScript. Verify with
`git status` and remove the untracked file.

### Desktop E2E build fails with `Permission wdio:default not found`

Use `pnpm desktop:build:test` (which enables the `wdio` Cargo feature),
not `cargo build -p varve-desktop`.

### Heavy task lease conflicts

Heavy tasks (full Vitest, Playwright, cargo tests, desktop builds) acquire
an exclusive cross-worktree lease. Concurrent agents queue. Opt out with
`VARVE_HEAVY_TASK_PARALLELISM=0`.

### Desktop tests fail: no display

Use `xvfb-run --auto-servernum pnpm test:desktop:native`. A container
without a display cannot prove interactive native-window behavior.

## Runtime

### ErrorBoundary collapses canvas to 0 height

Wrapping `.editor-canvas` in `<ErrorBoundary>` breaks CSS Grid/Flex
placement. Add `display: contents` to the ErrorBoundary wrapper.

### Drag threshold fires at wrong zoom

Anything compared against `clientX/Y` deltas is in CSS pixels and must
not be scaled by zoom. Use `worldDistanceForCssPixels` only where the
result is compared against a world-space delta.

## CI/CD

### Every job fails in ~3s

GitHub may have blocked job startup for billing reasons. Diagnose with
`just ci-health` (prints `BILLING` per run). Resolve at
https://github.com/settings/billing. Validate locally with `just gate`.

### Actions can't resolve pinned SHAs

Fabricated or stale SHAs. Run:

```bash
node scripts/pin-github-actions.mjs --verify   # lists bad SHAs
node scripts/pin-github-actions.mjs --pin      # re-pins
```

### GitHub Actions outage

Do NOT rerun jobs during an outage — they only re-queue. Wait for
`just ci-status` to report `operational`, then recover with
`node scripts/ci-health.mjs --rerun-stuck --yes`.

### Artifact upload fails: `Resource not accessible by integration`

Ensure the workflow has the correct `permissions` block. `upload-artifact`
v4 needs no `actions:` scope, but other operations need their specific
permissions. See `docs/CI_CD_RESILIENCE.md`.

## Quick reference

| Command | Purpose |
|---------|---------|
| `just check-env` | Verify toolchain availability |
| `pnpm desktop:preflight` | Desktop runtime diagnostics |
| `pnpm verify:plan` | Print what validation applies |
| `pnpm verify:quick` | Format/lint + direct tests |
| `pnpm verify:affected` | Impact-aware validation |
| `just gate` | Full Cascade Review |
| `just ci-health` | Classify recent CI failures |
| `just ci-status` | GitHub Actions incident status |
