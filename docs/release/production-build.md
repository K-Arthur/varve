# Strata — Production Build Commands

**Date:** 2026-08-04
**Verified on:** CachyOS Linux (kernel 7.1.5, Wayland), Node v26.4.0, pnpm 11.9.0,
rustc 1.97.1, tauri-cli 2.11.3, webkit2gtk-4.1 2.52.5, **glibc 2.44**

Every command below is marked **VERIFIED** (run on this machine, result recorded)
or **UNVERIFIED** (correct as far as configuration goes, but never executed here —
usually because it needs hardware we do not have).

---

## 0. The one thing to know first — MEASURED

**Do not ship a Linux package built on this machine.** This is no longer an
assumption; it was tested.

Installing the locally-built `.deb` into a clean `ubuntu:22.04` container
(`just verify-packages`) gives:

```
glibc available on Ubuntu 22.04 : 2.35
glibc required by the binary    : GLIBC_2.39

/usr/bin/strata-desktop: /lib/x86_64-linux-gnu/libc.so.6:
    version `GLIBC_2.39' not found (required by /usr/bin/strata-desktop)
```

The binary refuses to exec. Note the floor is **2.39, not 2.44** — a binary
inherits the highest glibc symbol version it actually references, not the
host's full version.

**This also changed the CI runner.** `ubuntu-latest` is Ubuntu 24.04, which is
glibc 2.39 — building there produces exactly the same floor and silently
excludes Ubuntu 22.04 LTS, Debian 12 and Fedora 38, while the docs claimed 22.04
support. `release.yml` now builds Linux artifacts on **`ubuntu-22.04`**, which
sets the floor at 2.35.

| Distro | glibc | Built on CachyOS / ubuntu-latest | Built on ubuntu-22.04 |
|---|---|---|---|
| Ubuntu 22.04 LTS | 2.35 | ✗ | ✓ |
| Debian 12 | 2.36 | ✗ | ✓ |
| Fedora 38 | 2.37 | ✗ | ✓ |
| Ubuntu 24.04 LTS | 2.39 | ✓ | ✓ |

Local packages are for smoke-testing only.

---

## 1. Clean dependency install — VERIFIED

```sh
pnpm install --frozen-lockfile
```

Result: exit 0, "Already up to date", no lockfile drift.

`postinstall` runs two scripts: `copy-onnx-wasm.mjs` (local copy from
`node_modules`) and `fetch-onnxruntime.mjs` (downloads ~25 MB of ONNX Runtime
from GitHub, pinned to 1.27.1 and checksum-verified **before** extraction).

For a genuinely cold checkout, the bundled AI model must also be fetched — it is
stored in Git LFS and `git clone` does not fetch LFS content by default:

```sh
git lfs install --local
git lfs pull --include="apps/desktop/public/models/font-classify.onnx"
node scripts/release/check-bundled-assets.mjs   # fails loudly if you skipped it
```

---

## 2. Quality gates — VERIFIED

```sh
pnpm lint          # exit 0 (48 warnings, no errors)
pnpm typecheck     # exit 0
pnpm test          # exit 0
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
```

Note: one perf-budget unit test (`computes diff for 10,000 nodes quickly (<50ms)`)
failed at 114 ms when run concurrently with a `cargo build` saturating the CPU,
and passed cleanly when run alone. It is a wall-clock assertion with no
isolation — treat a failure under load as contention, not regression.

---

## 3. Frontend production build — VERIFIED

```sh
pnpm --dir apps/desktop build      # tsc --noEmit && vite build
```

Result: exit 0, ~2m 25s, 7,370 modules.

Output is **147 MB** in `apps/desktop/dist`, and all of it is embedded in the
desktop binary:

| Part | Size | Note |
|---|---|---|
| `ort-wasm/` | 93 MB | Every onnxruntime-web variant (`ort.all.*`, `ort.jspi.*`, minified *and* not) |
| `assets/` | 42 MB | Includes a single 10.1 MB JS chunk (2.66 MB gzipped) |
| `models/` | 13 MB | Bundled ONNX models |

Both the 93 MB of unused ORT variants and the 10 MB monolithic chunk are the
obvious size wins, and both matter for the 4 GB RAM target.

---

## 4. Rust release build — VERIFIED

```sh
cargo build --release --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Result: exit 0. **38m 47s** from a cold cache. Produces a 71 MB
`apps/desktop/src-tauri/target/release/strata-desktop`.

Profile (`Cargo.toml` `[profile.release]`): `opt-level = 3`, `lto = "thin"`,
`codegen-units = 1`, `strip = true`. Good for size and speed; `strip = true`
means **no symbols are retained for crash triage** — see §9.

---

## 5. Linux packages

### deb and rpm — VERIFIED

```sh
just package-deb          # or: package-rpm
# equivalently:
cd apps/desktop && pnpm tauri build --bundles deb,rpm --ci
```

### AppImage — VERIFIED, with a required workaround

```sh
just package-appimage     # sets NO_STRIP=1 for you
```

**`NO_STRIP=1` is mandatory on Arch/CachyOS.** Without it the build fails with
only:

```
failed to bundle project: `failed to run linuxdeploy`
```

The real error is visible only by invoking linuxdeploy directly:

```
ERROR: Strip call failed: strip: libzstd.so.1: unknown type [0x13] section `.relr.dyn'
```

linuxdeploy 1-alpha (built 2024-07-26) bundles a binutils `strip` that predates
`SHT_RELR`. Every system library on a current Arch host has a `.relr.dyn`
section, so stripping fails for all of them and linuxdeploy aborts. `NO_STRIP=1`
skips that step, which costs essentially nothing: the Strata binary is already
stripped by the release profile, and distro libraries ship stripped.

This is set in `justfile` (`package-linux`, `package-appimage`) and in
`release.yml`'s Tauri build step.

### All Linux formats at once

```sh
just package-linux
```

---

## 6. macOS and Windows — UNVERIFIED

Never executed. No Mac, no Windows machine.

```sh
# macOS, Apple Silicon — on a Mac or a macos-latest runner
rustup target add aarch64-apple-darwin
cd apps/desktop && pnpm tauri build --bundles dmg --ci

# Windows x86-64 — on Windows or a windows-latest runner
cd apps/desktop && pnpm tauri build --bundles nsis --ci
```

Note the macOS build deliberately targets `aarch64`, not `universal`: the
bundled ONNX Runtime dylib has no macOS Intel build, so a "universal" binary
would be half-degraded (audit H-3).

The honest way to get a first result for either is to run
`.github/workflows/release.yml` via `workflow_dispatch` with
`platforms: linux-windows` or `all` and read the logs.

---

## 7. Collect, checksum, verify — VERIFIED

Verified end-to-end against synthetic bundles (collect → merge → verify →
notes). The version guard refuses to run at `0.0.0`, so set a version first:

```sh
node scripts/release/version.mjs set 0.1.0
cargo check --workspace                                              # refresh Cargo.lock
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml        # and the app's
node scripts/release/version.mjs verify v0.1.0

node scripts/release/collect-artifacts.mjs \
  --bundle-dir apps/desktop/src-tauri/target/release/bundle \
  --out dist/release --os linux --arch x86_64

node scripts/release/verify-artifacts.mjs --dir dist/release --expect-version 0.1.0
```

Artifacts are renamed to `<Product>-<version>-<os>-<arch>.<ext>` (the product name
is read from `tauri.conf.json`, so it follows a rename), hashed, and
described in `dist/release/release-manifest.json` + `SHA256SUMS.txt`.

Independent check (this is what a user runs):

```sh
cd dist/release && sha256sum -c SHA256SUMS.txt
```

---

## 8. SBOM — VERIFIED

```sh
node scripts/release/generate-sbom.mjs --out dist/release/strata-0.1.0-sbom.cdx.json
```

Result: CycloneDX 1.5, **1,324 components** — 715 cargo, 603 npm, 1 vendored
binary (ONNX Runtime), 5 bundled models.

No external tooling required (no syft, no cargo-cyclonedx). Uses
`cargo metadata --locked` across **both** Cargo workspaces — the Tauri app is a
separate workspace, so a root-only scan would miss tauri, wry and everything
else that actually ships.

If it fails with a `--locked` error, the lockfile is stale relative to a version
bump; run the two `cargo check` commands in §7.

---

## 9. Debug symbols — KNOWN GAP

`[profile.release] strip = true` discards symbols, so the "unstripped binary"
artifact `release.yml` uploads for crash triage is not actually unstripped.

To retain symbols without shipping them, add a profile that inherits release but
keeps debug info, build releases with it, and upload the symbols as a private
workflow artifact rather than a release asset:

```toml
[profile.release-symbols]
inherits = "release"
strip = "none"
debug = 1
```

Deferred: it roughly doubles build time and there is no crash-reporting pipeline
to consume the symbols yet.

---

## 10. Release dry run — VERIFIED

Everything except tagging and publishing:

```sh
node scripts/release/check-bundled-assets.mjs
node scripts/release/version.mjs verify
pnpm lint && pnpm typecheck && pnpm test
cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings

just package-linux
node scripts/release/collect-artifacts.mjs --out dist/release --os linux --arch x86_64
node scripts/release/generate-sbom.mjs --out dist/release/strata-sbom.cdx.json
node scripts/release/verify-artifacts.mjs --dir dist/release
cd dist/release && sha256sum -c SHA256SUMS.txt
```

Nothing here contacts GitHub or publishes anything.

---

## 11. Website — VERIFIED

```sh
pnpm --filter @varve/website build      # exit 0, 42 pages, 0 errors

# with a custom domain later:
SITE_URL=https://example.com SITE_BASE=/ pnpm --filter @varve/website build
```

After a release, point the download page at it:

```sh
node scripts/release/update-website-manifest.mjs \
  --manifest dist/release/release-manifest.json --tag v0.1.0
```
