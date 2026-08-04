#!/usr/bin/env bash
# Varve icon build script — deterministic platform asset generation.
# Source: packages/ui/src/icons/varve-app-icon.svg (1024×1024 master)
# Requires: rsvg-convert (librsvg), magick (ImageMagick ≥7), tauri CLI
# Run from repo root: bash apps/desktop/build-icons.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ICON_DIR="$REPO_ROOT/apps/desktop/src-tauri/icons"
HICOLOR_DIR="$ICON_DIR/hicolor"
SRC_SVG="$REPO_ROOT/packages/ui/src/icons/varve-app-icon.svg"
MARK_SVG="$REPO_ROOT/packages/ui/src/icons/varve-icon.svg"
SYMBOLIC_SRC="$REPO_ROOT/packages/ui/src/icons/varve-icon-symbolic.svg"
TAURI="$REPO_ROOT/apps/desktop/node_modules/.bin/tauri"
TMP="$(mktemp -d)"

echo "==> Varve icon build"
echo "    Source: $SRC_SVG"
echo "    Output: $ICON_DIR"
echo ""

# ── 0. Clean stale files from previous naming conventions ────────────────────
echo "--> Cleaning stale icon assets"
# Remove strata.png files from hicolor (old naming convention, superseded by
# dev.varve.desktop.png matching the Tauri app identifier).
find "$HICOLOR_DIR" -name "strata.png" -delete 2>/dev/null || true
# Also clean any .DS_Store or macOS metadata artifacts that might interfere.
find "$HICOLOR_DIR" -name ".DS_Store" -delete 2>/dev/null || true

# ── 1. Export 1024px master PNG ──────────────────────────────────────────────
echo "--> Exporting 1024px master PNG"
rsvg-convert -w 1024 -h 1024 "$SRC_SVG" -o "$TMP/app-icon-1024.png"

# ── 2. Tauri — generates .icns, .ico, Windows tiles, and Tauri PNG sizes ────
echo "--> Running tauri icon (icns / ico / Windows tiles / Tauri PNGs)"
cd "$REPO_ROOT/apps/desktop"
$TAURI icon "$TMP/app-icon-1024.png" \
  --output "$ICON_DIR" \
  --ios-color "#FAFAF8"
cd "$REPO_ROOT"

# ── 3. Linux hicolor PNG ladder (freedesktop) ────────────────────────────────
echo "--> Building Linux hicolor PNG ladder"
HICOLOR_SIZES=(16 22 24 32 48 64 96 128 256 512 1024)
APP_ID="dev.varve.desktop"

for SIZE in "${HICOLOR_SIZES[@]}"; do
  TARGET_DIR="$HICOLOR_DIR/${SIZE}x${SIZE}/apps"
  mkdir -p "$TARGET_DIR"
  rsvg-convert -w "$SIZE" -h "$SIZE" "$SRC_SVG" -o "$TARGET_DIR/${APP_ID}.png"
done
echo "    Exported ${#HICOLOR_SIZES[@]} sizes: ${HICOLOR_SIZES[*]}"

# ── 4. Scalable + symbolic SVGs ───────────────────────────────────────────────
echo "--> Installing scalable + symbolic SVGs"
SCALABLE_DIR="$HICOLOR_DIR/scalable/apps"
mkdir -p "$SCALABLE_DIR"
# Colourful scalable launcher — same master as PNG ladder (with plate/bg).
cp "$SRC_SVG" "$SCALABLE_DIR/${APP_ID}.svg"

SYMBOLIC_DIR="$HICOLOR_DIR/symbolic/apps"
mkdir -p "$SYMBOLIC_DIR"
cp "$SYMBOLIC_SRC" "$SYMBOLIC_DIR/${APP_ID}-symbolic.svg"

# ── 5. Web / PWA assets ──────────────────────────────────────────────────────
echo "--> Building web / PWA favicons"
WEB_DIR="$REPO_ROOT/apps/desktop/public/icons"
mkdir -p "$WEB_DIR"

# favicon.ico — multi-res (16, 32, 48)
rsvg-convert -w 16  -h 16  "$MARK_SVG" -o "$TMP/fav16.png"
rsvg-convert -w 32  -h 32  "$MARK_SVG" -o "$TMP/fav32.png"
rsvg-convert -w 48  -h 48  "$MARK_SVG" -o "$TMP/fav48.png"
magick "$TMP/fav16.png" "$TMP/fav32.png" "$TMP/fav48.png" "$WEB_DIR/favicon.ico"

# favicon.svg — mark only (browsers use this for tab/bookmarks)
cp "$MARK_SVG" "$WEB_DIR/favicon.svg"

# apple-touch-icon (180×180 — mark on bg, no transparency)
rsvg-convert -w 180 -h 180 "$SRC_SVG" -o "$WEB_DIR/apple-touch-icon.png"

# PWA maskable (512×512 and 192×192) — safe zone already respected in SRC_SVG
rsvg-convert -w 512 -h 512 "$SRC_SVG" -o "$WEB_DIR/icon-512-maskable.png"
rsvg-convert -w 192 -h 192 "$SRC_SVG" -o "$WEB_DIR/icon-192-maskable.png"

# Standard PWA (without maskable)
rsvg-convert -w 512 -h 512 "$MARK_SVG" -o "$WEB_DIR/icon-512.png"
rsvg-convert -w 192 -h 192 "$MARK_SVG" -o "$WEB_DIR/icon-192.png"

# ── 6. Verification rasterise at critical sizes ───────────────────────────────
echo "--> Rendering verification samples"
VERIFY_DIR="$TMP/verify"
mkdir -p "$VERIFY_DIR"
for SIZE in 1024 48 16; do
  rsvg-convert -w "$SIZE" -h "$SIZE" "$MARK_SVG" -o "$VERIFY_DIR/mark-${SIZE}px-colour.png"
  # Mono: convert to greyscale
  magick "$VERIFY_DIR/mark-${SIZE}px-colour.png" -colorspace Gray "$VERIFY_DIR/mark-${SIZE}px-mono.png"
done
echo "    Verification PNGs written to: $VERIFY_DIR"
echo "    Open them to confirm legibility at each size, colour and mono."

# ── 7. Cleanup ────────────────────────────────────────────────────────────────
echo ""
echo "==> Done. Summary:"
echo "    Tauri icons:    $ICON_DIR/"
echo "    hicolor ladder: $HICOLOR_DIR/"
echo "    Web/PWA assets: $WEB_DIR/"
echo "    Verify at:      $VERIFY_DIR/"
rm -rf "$TMP"
