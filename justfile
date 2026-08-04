# Strata monorepo task runner. `just -l` lists recipes.
# Tooling is installed user-local; cargo/pnpm/just are expected on PATH.

default: list

list:
    @just --list --unsorted

# --- One-time environment check ---
check-env:
    @echo "rustc:  $$(rustc --version)"
    @echo "cargo:  $$(cargo --version)"
    @echo "pnpm:   $$(pnpm --version)"
    @echo "just:   $$(just --version)"
    @echo "pkg-config webkit2gtk-4.1: $$(pkg-config --exists webkit2gtk-4.1 && echo FOUND || echo MISSING)"

# --- Install JS deps ---
install:
    pnpm install

# --- Build everything ---
build: build-rust build-js
build-rust:
    cargo build --workspace --all-targets
build-js:
    pnpm -r --filter "./packages/*" run build

# --- WASM build (web engine backend) ---
wasm-build:
    rustup target add wasm32-unknown-unknown
    cd crates/strata-wasm && wasm-pack build --target web --out-dir ../../apps/desktop/public/wasm --out-name strata_wasm
    which wasm-opt 2>/dev/null && wasm-opt -O3 -o apps/desktop/public/wasm/strata_wasm_bg.wasm apps/desktop/public/wasm/strata_wasm_bg.wasm || echo "wasm-opt not on PATH — skipping manual optimization"

wasm-build-simd:
    rustup target add wasm32-unknown-unknown
    cd crates/strata-wasm && RUSTFLAGS="-C target-feature=+simd128" \
      wasm-pack build --target web --out-dir ../../apps/desktop/public/wasm --out-name strata_wasm_simd
    which wasm-opt 2>/dev/null && wasm-opt -O3 -o apps/desktop/public/wasm/strata_wasm_simd_bg.wasm apps/desktop/public/wasm/strata_wasm_simd_bg.wasm || echo "wasm-opt not on PATH — skipping SIMD optimization"

wasm-check:
    rustup target add wasm32-unknown-unknown
    cargo check --target wasm32-unknown-unknown -p strata-wasm

# --- WASM build (colour engine, for browser print pipeline) ---
wasm-build-colour:
    rustup target add wasm32-unknown-unknown
    cd crates/strata-colour && wasm-pack build --target web --out-dir ../../apps/desktop/public/wasm --out-name strata_colour -- --features wasm
    which wasm-opt 2>/dev/null && wasm-opt -O3 -o apps/desktop/public/wasm/strata_colour_bg.wasm apps/desktop/public/wasm/strata_colour_bg.wasm || echo "wasm-opt not on PATH — skipping manual optimization"

wasm-build-all: wasm-build wasm-build-simd wasm-build-colour

wasm-size:
    ls -lh apps/desktop/public/wasm/strata_wasm_bg.wasm apps/desktop/public/wasm/strata_wasm_simd_bg.wasm apps/desktop/public/wasm/strata_colour_bg.wasm 2>/dev/null

wasm-check-colour:
    rustup target add wasm32-unknown-unknown
    cargo check --target wasm32-unknown-unknown -p strata-colour --features wasm

# --- Tests (TDD-first) ---
test: test-rust test-js
test-rust:
    cargo test --workspace --all-targets
test-js:
    pnpm test

# --- Quality gates ---
lint:
    cargo clippy --workspace --all-targets -- -D warnings
    pnpm lint
format:
    cargo fmt --all
    pnpm format
format-check:
    cargo fmt --all -- --check
    pnpm exec biome ci --formatter-enabled=true --linter-enabled=false .

# Token + emoji + architecture + typecheck-regression gates (Cascade Review, §7)
gates: audit-tokens audit-emoji health-check architecture-check typecheck-regression
audit-tokens:
    pnpm audit:tokens
audit-emoji:
    pnpm audit:emoji
health-check:
    node scripts/audit-health.mjs

# Architecture health: cycles, complexity, layer violations, hub-file budgets
architecture-check:
    node scripts/audit-architecture.mjs --ci

# Prevent typecheck regression: fails if new files have TSC errors beyond baselined set
typecheck-regression:
    node scripts/audit-typecheck-regression.mjs

# --- Icon generation ---
# Canonical master: packages/ui/src/icons/strata-app-icon.svg
# (via apps/desktop/build-icons.sh — do not regenerate launchers from mark-only SVGs)
generate-icons:
    bash apps/desktop/build-icons.sh

# Install FreeDesktop .desktop + hicolor icons for tauri:dev on Wayland/KDE
# so Plasma resolves the Strata icon instead of the Wayland logo.
install-dev-icons:
    bash apps/desktop/scripts/install-dev-icons.sh

# --- Combined pre-commit gate ---
gate: format-check lint test gates
    @echo "Cascade Review gate passed."

# --- CI/CD local tooling ---
install-git-hooks:
    node scripts/install-git-hooks.mjs

install-ci-tooling:
    bash scripts/install-ci-tooling.sh

act-list:
    bash scripts/ci-local-run.sh list

act-run JOB="js" ARGS="":
    bash scripts/ci-local-run.sh run {{JOB}} {{ARGS}}

act-dry WORKFLOW=".github/workflows/build.yml":
    bash scripts/ci-local-run.sh dry-run {{WORKFLOW}}

ci-debug RUN_ID="":
    node scripts/ci-debug.mjs --run-id "{{RUN_ID}}"

# Pipeline health: classify recent run failures (billing block / never-started / real)
ci-health ARGS="":
    node scripts/ci-health.mjs {{ARGS}}

# GitHub Actions supply chain security
pin-actions:
    node scripts/pin-github-actions.mjs --check

pin-actions-verify:
    node scripts/pin-github-actions.mjs --verify

pin-actions-fix:
    node scripts/pin-github-actions.mjs --pin

# CI tooling regression tests (extractor + classifier + pin table integrity)
ci-tools-test:
    node scripts/ci-debug.test.mjs
    node scripts/test-ci-debug.mjs
    node scripts/ci-health.test.mjs
    node scripts/pin-github-actions.test.mjs

validate-workflows:
    node scripts/validate-workflows.mjs

validate-workflows-staged:
    node scripts/validate-workflows.mjs --staged

# --- Packaging ---
#
# NO_STRIP=1 is required for AppImage builds on Arch/CachyOS.
#
# linuxdeploy ships its own binutils `strip` (1-alpha, built 2024-07-26) which
# does not understand the SHT_RELR section type that modern toolchains emit:
#
#   ERROR: Strip call failed: strip: libzstd.so.1: unknown type [0x13] section `.relr.dyn'
#
# Every bundled system library on a current Arch host has `.relr.dyn`, so the
# strip step fails for all of them and linuxdeploy aborts with the unhelpful
# "failed to run linuxdeploy". Skipping the strip costs almost nothing: the
# Strata binary is already stripped by [profile.release] strip = true, and
# distro libraries ship stripped.
#
# IMPORTANT: an AppImage built here is for local smoke-testing only. It bundles
# this host's libraries, including glibc 2.44, so it will NOT run on the
# Ubuntu 22.04 (glibc 2.35) compatibility baseline. Release AppImages must come
# from the ubuntu-latest runner in release.yml.

# Strip ONNX Runtime libraries for other platforms out of the bundle.
# tauri.conf.json globs onnxruntime-libs/** wholesale, so every platform ever
# fetched on this machine ships inside the installer. A .deb built here carried
# 53.9 MB of macOS and Windows libraries out of 74 MB total.
prune-runtimes:
    node scripts/release/prune-foreign-runtimes.mjs

# Build all Linux bundles (AppImage + deb + rpm). Requires Linux + Tauri deps.
package-linux: prune-runtimes
    cd apps/desktop && NO_STRIP=1 pnpm tauri build --bundles appimage,deb,rpm --ci --features ai
    @echo "Bundles written to apps/desktop/src-tauri/target/release/bundle/"

# Build deb only (faster; useful for quick install testing on Debian/Ubuntu).
package-deb: prune-runtimes
    cd apps/desktop && pnpm tauri build --bundles deb --ci --features ai

# Build rpm only.
package-rpm: prune-runtimes
    cd apps/desktop && pnpm tauri build --bundles rpm --ci --features ai

# Build AppImage only. Local smoke-test artifact — see the note above.
package-appimage: prune-runtimes
    cd apps/desktop && NO_STRIP=1 pnpm tauri build --bundles appimage --ci --features ai

# Build macOS dmg (run on macOS only).
package-dmg: prune-runtimes
    cd apps/desktop && pnpm tauri build --bundles dmg --ci --features ai

# Build Windows msi + nsis (run on Windows only).
package-windows: prune-runtimes
    cd apps/desktop && pnpm tauri build --bundles msi,nsis --ci --features ai

# Validate AUR PKGBUILDs using Docker (requires docker; works on any OS).
# Standard AUR CI pattern: useradd non-root builder + makepkg --printsrcinfo.
aur-validate:
    docker run --rm -v "$(pwd)/dist/aur:/aur" archlinux:base-devel bash -c " \
      useradd -m builder && \
      chown -R builder:builder /aur && \
      cd /aur/strata-desktop && su -c 'makepkg --printsrcinfo' builder && echo 'source PKGBUILD OK' && \
      cd /aur/strata-desktop-bin && su -c 'makepkg --printsrcinfo' builder && echo 'bin PKGBUILD OK' \
    "

# Smoke-test AppImage on the current Linux session (Wayland or X11).
# Exits after 5 s to prevent hanging in CI.
appimage-smoke:
    #!/usr/bin/env bash
    set -euo pipefail
    _img=$(find apps/desktop/src-tauri/target/release/bundle/appimage -name '*.AppImage' | head -1)
    if [[ -z "${_img}" ]]; then echo "No AppImage found — run 'just package-appimage' first."; exit 1; fi
    chmod +x "${_img}"
    echo "Launching ${_img} for 5 s smoke test..."
    timeout 5 "${_img}" --no-sandbox || true
    echo "Smoke test complete."
