#!/usr/bin/env bash
# update-packaging.sh — Per-release packaging metadata updater.
#
# Run AFTER version.mjs has bumped all version strings and the release
# artifacts are published to GitHub.  This script:
#
#   1. Updates sha256sums in the AUR PKGBUILD from published SHA256SUMS.txt
#   2. Regenerates .SRCINFO from the updated PKGBUILD
#   3. Updates the Flatpak manifest tag + commit
#   4. Optionally regenerates Flatpak vendored sources (Cargo + pnpm)
#
# Usage:
#   scripts/release/update-packaging.sh <version> [options]
#
# Examples:
#   scripts/release/update-packaging.sh 0.3.0
#   scripts/release/update-packaging.sh 0.3.0 --skip-sources
#   scripts/release/update-packaging.sh 0.3.0 --regenerate-sources
#
# Prerequisites:
#   - makepkg (from base-devel)
#   - curl
#   - jq (for parsing GitHub API responses)
#   - For --regenerate-sources: flatpak-cargo-generator, flatpak-node-generator
set -euo pipefail

VERSION="${1:?Usage: $0 <version> [--skip-sources|--regenerate-sources]}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AUR_DIR="$REPO_ROOT/packaging/aur/varve-desktop-bin"
FLATPAK_DIR="$REPO_ROOT/packaging/flatpak"
GITHUB_URL="https://github.com/K-Arthur/varve"
SHA256_URL="$GITHUB_URL/releases/download/v$VERSION/SHA256SUMS.txt"
AUR_SOURCE_NAME="Varve-${VERSION}-linux-x86_64.AppImage"

# Parse options
SKIP_SOURCES=false
REGENERATE_SOURCES=false
for arg in "${@:2}"; do
  case "$arg" in
    --skip-sources) SKIP_SOURCES=true ;;
    --regenerate-sources) REGENERATE_SOURCES=true ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

info() { echo ":: $*"; }
warn() { echo ":: WARNING: $*" >&2; }
die()  { echo ":: ERROR: $*" >&2; exit 1; }

# ── 1. Fetch SHA256SUMS from GitHub release ──────────────────────────────────
info "Fetching SHA256SUMS.txt for v$VERSION..."
SHA256SUMS=$(curl -sfL "$SHA256_URL" 2>/dev/null) || \
  die "Could not fetch $SHA256_URL — release may not be published yet."

AUR_SOURCE_SHA256=$(echo "$SHA256SUMS" | grep "$AUR_SOURCE_NAME" | awk '{print $1}') || \
  die "Could not find $AUR_SOURCE_NAME in SHA256SUMS.txt"

if [[ -z "$AUR_SOURCE_SHA256" ]]; then
  die "Empty sha256 for $AUR_SOURCE_NAME"
fi

info "SHA256 for $AUR_SOURCE_NAME: $AUR_SOURCE_SHA256"

# ── 2. Update AUR PKGBUILD sha256sums ───────────────────────────────────────
info "Updating PKGBUILD sha256sums..."
PKGBUILD="$AUR_DIR/PKGBUILD"
if [[ ! -f "$PKGBUILD" ]]; then
  die "PKGBUILD not found at $PKGBUILD"
fi

# Replace the sha256sums line — the pattern matches the single-quoted hash.
sed -i "s/^sha256sums=('[^']*')/sha256sums=('$AUR_SOURCE_SHA256')/" "$PKGBUILD"

# Verify the replacement
NEW_HASH=$(grep "^sha256sums=" "$PKGBUILD" | sed "s/sha256sums=('//;s/')//" )
if [[ "$NEW_HASH" != "$AUR_SOURCE_SHA256" ]]; then
  die "sha256sums replacement failed — got '$NEW_HASH' instead of '$AUR_SOURCE_SHA256'"
fi

info "PKGBUILD sha256sums updated: $NEW_HASH"

# ── 3. Regenerate .SRCINFO ──────────────────────────────────────────────────
info "Regenerating .SRCINFO..."
(cd "$AUR_DIR" && makepkg --printsrcinfo > .SRCINFO)
info ".SRCINFO regenerated"

# ── 4. Validate PKGBUILD ────────────────────────────────────────────────────
info "Validating PKGBUILD syntax..."
bash -n "$PKGBUILD" || die "PKGBUILD has syntax errors"

info "Verifying source checksums..."
(cd "$AUR_DIR" && makepkg --verifysource 2>&1 | tail -3) || \
  warn "Source verification failed — SHA256 may not match yet (artifacts still uploading?)"

# ── 5. Update Flatpak manifest ──────────────────────────────────────────────
MANIFEST="$FLATPAK_DIR/dev.varve.desktop.yml"
if [[ -f "$MANIFEST" ]]; then
  info "Updating Flatpak manifest tag and commit..."

  # Fetch the commit hash for the tag from GitHub
  TAG="v$VERSION"
  COMMIT=$(curl -sfL "https://api.github.com/repos/K-Arthur/varve/git/ref/tags/$TAG" 2>/dev/null | \
    grep '"sha"' | head -1 | sed 's/.*"sha": *"//;s/".*//' || true)

  if [[ -z "$COMMIT" ]]; then
    warn "Could not fetch commit for tag $TAG from GitHub API"
    warn "You will need to manually update the Flatpak manifest commit"
  else
    info "Tag $TAG -> commit $COMMIT"

    # Update the tag field
    sed -i "s|tag: v[0-9]*\.[0-9]*\.[0-9]*|tag: $TAG|g" "$MANIFEST"

    # Update the commit field (64-char hex)
    sed -i "s|commit: [0-9a-f]\{40\}|commit: $COMMIT|g" "$MANIFEST"

    info "Flatpak manifest updated: tag=$TAG commit=${COMMIT:0:12}..."
  fi

  # Validate the manifest YAML
  if command -v flatpak-builder &>/dev/null; then
    info "Validating Flatpak manifest..."
    flatpak-builder --show-manifest "$MANIFEST" >/dev/null 2>&1 || \
      warn "Flatpak manifest validation failed"
  fi
else
  warn "Flatpak manifest not found at $MANIFEST — skipping"
fi

# ── 6. Regenerate Flatpak vendored sources (optional) ───────────────────────
if $REGENERATE_SOURCES; then
  info "Regenerating Flatpak vendored sources..."

  # Find the flatpak-builder-tools (expected at /tmp/opencode/flatpak-builder-tools
  # or a configured path)
  TOOLS_DIR="${FLATPAK_BUILDER_TOOLS:-/tmp/opencode/flatpak-builder-tools}"
  if [[ ! -d "$TOOLS_DIR/cargo" ]]; then
    die "flatpak-builder-tools not found at $TOOLS_DIR — clone from https://github.com/flatpak/flatpak-builder-tools"
  fi

  # Regenerate Cargo sources
  info "Regenerating cargo-sources.json..."
  python3 "$TOOLS_DIR/cargo/flatpak-cargo-generator.py" \
    "$REPO_ROOT/apps/desktop/src-tauri/Cargo.lock" \
    -o "$FLATPAK_DIR/cargo-sources.json"
  info "cargo-sources.json regenerated ($(wc -l < "$FLATPAK_DIR/cargo-sources.json") lines)"

  # Regenerate pnpm sources
  info "Regenerating pnpm-sources.json..."
  (cd "$TOOLS_DIR/node" && uv run --with . python -m flatpak_node_generator pnpm \
    "$REPO_ROOT/pnpm-lock.yaml" \
    -o "$FLATPAK_DIR/pnpm-sources.json")
  info "pnpm-sources.json regenerated ($(wc -l < "$FLATPAK_DIR/pnpm-sources.json") lines)"
elif ! $SKIP_SOURCES; then
  info "Skipping Flatpak source regeneration (use --regenerate-sources to include)"
  info "Sources only need regeneration when Cargo.lock or pnpm-lock.yaml change"
fi

# ── 7. Summary ──────────────────────────────────────────────────────────────
echo ""
info "=== Packaging update complete for v$VERSION ==="
echo ""
echo "  AUR PKGBUILD:  sha256sums=$NEW_HASH"
echo "  AUR .SRCINFO:  regenerated"
echo "  Flatpak tag:   ${COMMIT:+$TAG ($COMMIT)}"
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff packaging/"
echo "  2. Commit: git add packaging/ && git commit -m 'packaging: update for v$VERSION'"
echo "  3. AUR publish (requires AUR account):"
echo "     git clone ssh://aur@aur.archlinux.org/varve-desktop-bin.git /tmp/varve-aur"
echo "     cp $AUR_DIR/{PKGBUILD,.SRCINFO} /tmp/varve-aur/"
echo "     cd /tmp/varve-aur && git add -A && git commit -m 'varve-desktop-bin $VERSION' && git push"
echo "  4. Flathub PR (requires human-authored submission):"
echo "     Fork flathub/flathub, add manifest + sources, open PR"
