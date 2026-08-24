# Varve monorepo task runner. `just -l` lists recipes.
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

# --- Dev utilities ---
boot-watch:
    # Wait until the dev server (http://localhost:1420) serves the editor
    # (checks every 20 s, up to ~10 min, exits 1 on timeout).
    node boot-watch.mjs

# --- Build everything ---
build: build-rust build-js
build-rust:
    cargo build --workspace --all-targets
build-js:
    pnpm -r --filter "./packages/*" run build

# --- WASM build (web engine backend) ---
# The loader prefers SIMD when it is present. Keep both artifacts in lockstep:
# rebuilding only the baseline leaves a stale SIMD binary that the browser will
# select first and can silently exercise an older bridge contract.
wasm-build:
    just wasm-build-base
    just wasm-build-simd

wasm-build-base:
    rustup target add wasm32-unknown-unknown
    cd crates/varve-wasm && wasm-pack build --target web --out-dir ../../apps/desktop/public/wasm --out-name varve_wasm
    which wasm-opt 2>/dev/null && wasm-opt -O3 -o apps/desktop/public/wasm/varve_wasm_bg.wasm apps/desktop/public/wasm/varve_wasm_bg.wasm || echo "wasm-opt not on PATH — skipping manual optimization"

wasm-build-simd:
    rustup target add wasm32-unknown-unknown
    cd crates/varve-wasm && RUSTFLAGS="-C target-feature=+simd128" \
      wasm-pack build --target web --out-dir ../../apps/desktop/public/wasm --out-name varve_wasm_simd
    which wasm-opt 2>/dev/null && wasm-opt -O3 -o apps/desktop/public/wasm/varve_wasm_simd_bg.wasm apps/desktop/public/wasm/varve_wasm_simd_bg.wasm || echo "wasm-opt not on PATH — skipping SIMD optimization"

wasm-check:
    rustup target add wasm32-unknown-unknown
    cargo check --target wasm32-unknown-unknown -p varve-wasm

# --- WASM build (colour engine, for browser print pipeline) ---
wasm-build-colour:
    rustup target add wasm32-unknown-unknown
    cd crates/varve-colour && wasm-pack build --target web --out-dir ../../apps/desktop/public/wasm --out-name varve_colour -- --features wasm
    which wasm-opt 2>/dev/null && wasm-opt -O3 -o apps/desktop/public/wasm/varve_colour_bg.wasm apps/desktop/public/wasm/varve_colour_bg.wasm || echo "wasm-opt not on PATH — skipping manual optimization"

wasm-build-all: wasm-build wasm-build-colour

wasm-size:
    ls -lh apps/desktop/public/wasm/varve_wasm_bg.wasm apps/desktop/public/wasm/varve_wasm_simd_bg.wasm apps/desktop/public/wasm/varve_colour_bg.wasm 2>/dev/null

wasm-check-colour:
    rustup target add wasm32-unknown-unknown
    cargo check --target wasm32-unknown-unknown -p varve-colour --features wasm

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
gates: audit-tokens audit-emoji docs-check health-check architecture-check typecheck-regression
audit-tokens:
    pnpm audit:tokens
audit-emoji:
    pnpm audit:emoji

# Docs drift: stale product names/paths in current-state docs, ADR index gaps, broken links
docs-check:
    pnpm audit:docs
health-check:
    node scripts/audit-health.mjs

# Trust-boundary audits: tracked/artifact secret scans, client-build env guard,
# workflow policy, import boundaries (see docs/security/trust-boundaries.md)
audit-secrets:
    pnpm audit:secrets
audit-clientenv:
    pnpm audit:clientenv
audit-artifacts:
    pnpm audit:artifacts
audit-boundaries:
    pnpm audit:boundaries
security-audits: audit-secrets audit-clientenv audit-artifacts audit-boundaries

# Architecture health: cycles, complexity, layer violations, hub-file budgets
architecture-check:
    node scripts/audit-architecture.mjs --ci

# Prevent typecheck regression: fails if new files have TSC errors beyond baselined set
typecheck-regression:
    node scripts/audit-typecheck-regression.mjs

# --- Icon generation ---
# Canonical master: packages/ui/src/icons/varve-app-icon.svg
# (via apps/desktop/build-icons.sh — do not regenerate launchers from mark-only SVGs)
generate-icons:
    bash apps/desktop/build-icons.sh

# Install FreeDesktop .desktop + hicolor icons for tauri:dev on Wayland/KDE
# so Plasma resolves the Varve icon instead of the Wayland logo.
install-dev-icons:
    bash apps/desktop/scripts/install-dev-icons.sh

# --- Combined pre-commit gate ---
gate: format-check lint test gates
    @echo "Cascade Review gate passed."

# --- Affected-first validation (recommended inner loop) ---
# Print the impact plan for the current changes without running anything.
check-plan:
    pnpm verify:plan

# Tier 0 + Tier 1: format/lint on touched files + directly related tests.
check-quick:
    pnpm verify:quick

# Tiers 0-4: dependency-aware affected validation. Run this instead of the
# full gate for ordinary feature work — it selects tests by impact.
check-affected:
    pnpm verify:affected

# Explicit full repository gate. Reserved for release checkpoints,
# workspace/toolchain changes, and explicit requests. Requires a reason:
#   just gate-full  (prompts)
# VARVE_FULL_GATE_REASON="..." just gate-full
gate-full:
    @if [ -z "$${VARVE_FULL_GATE_REASON:-}" ]; then \
      echo "gate-full requires a reason (VARVE_FULL_GATE_REASON). 'Just to be safe' is not a reason."; \
      exit 2; \
    fi
    pnpm verify:full

# Show what the affected planner would run (dry-run).
plan:
    pnpm verify:plan

# --- CI/CD local tooling ---
install-git-hooks:
    node scripts/install-git-hooks.mjs

install-ci-tooling:
    bash scripts/install-ci-tooling.sh

act-list:
    bash scripts/ci-local-run.sh list

act-run JOB="js" ARGS="":
    bash scripts/ci-local-run.sh run {{ JOB }} {{ ARGS }}

act-dry WORKFLOW=".github/workflows/build.yml":
    bash scripts/ci-local-run.sh dry-run {{ WORKFLOW }}

ci-debug RUN_ID="":
    node scripts/ci-debug.mjs --run-id "{{ RUN_ID }}"

# Pipeline health: classify recent run failures (billing block / runner starvation / real)
ci-health ARGS="":
    node scripts/ci-health.mjs {{ ARGS }}

# GitHub Actions incident status (githubstatus.com)
ci-status:
    node scripts/ci-health.mjs --status

# Rerun runs stuck in the queue past 30 min (runner starvation). Needs --yes.
ci-rerun-stuck:
    node scripts/ci-health.mjs --rerun-stuck

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
# Varve binary is already stripped by [profile.release] strip = true, and
# distro libraries ship stripped.
#
# IMPORTANT: an AppImage built here is for local smoke-testing only. It bundles
# this host's libraries, including glibc 2.44, so it will NOT run on the
# Ubuntu 22.04 (glibc 2.35) compatibility baseline. Release AppImages must come
# from the ubuntu-22.04 runner in release.yml.

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

# Dev/test bundles with a snapshot version (<release>-dev.<short-sha>) instead
# of the committed release version. The tauri config merge overrides only the
# bundle version — nothing committed changes, so the repo stays release-clean
# while test installers are distinguishable from the last release and from
# each other (no ambiguous same-version reinstall of different content).
package-linux-dev: prune-runtimes
    #!/usr/bin/env bash
    set -euo pipefail
    V="$(node scripts/release/version.mjs snapshot)"
    echo "Building dev bundles as ${V}..."
    cd apps/desktop && NO_STRIP=1 pnpm tauri build --bundles appimage,deb --ci --features ai --config "{\"version\":\"${V}\"}"
    echo "Dev bundles written to apps/desktop/src-tauri/target/release/bundle/"

# Build macOS dmg (run on macOS only).
package-dmg: prune-runtimes
    cd apps/desktop && pnpm tauri build --bundles dmg --ci --features ai

# Build Windows msi + nsis (run on Windows only).
package-windows: prune-runtimes
    cd apps/desktop && pnpm tauri build --bundles msi,nsis --ci --features ai

# --- Release tooling ---
#
# `just` always runs from the justfile's directory, so these work from anywhere
# in the tree. Invoking the scripts as `node scripts/release/...` only works
# from the repository root, which is a sharp edge worth removing.

# Pre-flight: bundled assets, model catalog agreement, download checksums.
release-check:
    node scripts/release/check-bundled-assets.mjs

# Show the version every manifest reports; pass a tag to assert they match it.
release-version TAG="":
    node scripts/release/version.mjs verify {{ TAG }}

# Set the release version across all manifests (then refresh the lockfiles).
release-set-version VERSION:
    node scripts/release/version.mjs set {{ VERSION }}
    @echo "Now run: cargo check --workspace && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml"

# Bump MAJOR/MINOR/PATCH across all manifests (0.1.0 -> bump patch -> 0.1.1).
release-bump PART:
    node scripts/release/version.mjs bump {{ PART }}
    @echo "Now run: cargo check --workspace && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml"

# Full release-prep: bump version, refresh lockfiles, verify agreement, and
# print the exact remaining steps (changelog, tag, push). Does NOT tag or
# push — those stay human decisions.
release-prep PART:
    #!/usr/bin/env bash
    set -euo pipefail
    node scripts/release/version.mjs bump "{{ PART }}"
    echo "── Refreshing Cargo lockfiles for the new version ──"
    cargo check --workspace
    cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
    node scripts/release/version.mjs verify
    NEW="$(node scripts/release/version.mjs get)"
    echo ""
    echo "Version bumped to ${NEW} and verified across all manifests."
    echo "Remaining human steps:"
    echo "  1. Add/update the '## [${NEW}]' section in CHANGELOG.md"
    echo "  2. Commit the bump + changelog"
    echo "  3. git tag v${NEW} && git push origin master --tags"
    echo "  4. release.yml builds a DRAFT; verify the draft, then publish"

# Deterministic dev-build version for the current HEAD (read-only):
# <release>-dev.<short-sha>. Test bundles built with it never collide with a
# released version, so installers/upgrades are unambiguous.
release-snapshot:
    node scripts/release/version.mjs snapshot

# Upload the large on-demand AI models to the models-v1 release.
# Needs `git lfs pull --include="models-source/*.onnx"` first.
release-publish-models *ARGS:
    node scripts/release/publish-model-assets.mjs {{ ARGS }}

# Collect built bundles into dist/release with checksums and a manifest.
release-collect *ARGS:
    node scripts/release/collect-artifacts.mjs {{ ARGS }}

# Verify dist/release against its manifest and checksum file.
release-verify *ARGS:
    node scripts/release/verify-artifacts.mjs {{ ARGS }}

# Generate the CycloneDX SBOM.
release-sbom OUT="dist/release/sbom.cdx.json":
    node scripts/release/generate-sbom.mjs --out {{ OUT }}

# Point the website download page at a published release.
release-website TAG:
    node scripts/release/update-website-manifest.mjs --manifest dist/release/release-manifest.json --tag {{ TAG }}

# Validate AUR PKGBUILDs using Docker (requires docker; works on any OS).
# Standard AUR CI pattern: useradd non-root builder + makepkg --printsrcinfo.
aur-validate:
    #!/usr/bin/env bash
    # PKGBUILDs live in packaging/aur/, not dist/aur/ — `dist` is gitignored, so
    # the old path pointed at a directory that never existed in a fresh clone.
    # That is what made the publish workflow's aur-validate job fail on every
    # run and, because the release job depended on it, why no release was ever
    # produced (audit RB-2).
    set -euo pipefail
    for pkg in packaging/aur/*/; do
      name=$(basename "${pkg}")
      echo "── ${name} ──"
      "${CONTAINER_RUNTIME:-$(command -v podman >/dev/null && echo podman || echo docker)}" \
        run --rm -v "$(pwd)/${pkg}:/pkg:ro" archlinux:base-devel bash -c '
        set -e
        pacman -Sy --noconfirm --needed namcap >/dev/null 2>&1 || true
        useradd -m builder
        cp -r /pkg /home/builder/build && chown -R builder:builder /home/builder/build
        cd /home/builder/build
        su builder -c "makepkg --printsrcinfo > .SRCINFO" && echo "  .SRCINFO generated"
        su builder -c "namcap PKGBUILD" || true
      '
    done

# Install-test the built .deb and .rpm in clean non-Arch containers.
# Proves the glibc baseline claim that nothing else in the repo can check.
verify-packages *ARGS:
    bash scripts/release/verify-package-install.sh {{ ARGS }}

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
