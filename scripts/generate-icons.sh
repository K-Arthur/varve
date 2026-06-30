#!/usr/bin/env bash
# Strata icon generation script.
# Generates ALL platform-specific icon assets from master SVGs.
#
# Requirements: rsvg-convert (librsvg), magick (ImageMagick 7), python3
#
# Usage: bash scripts/generate-icons.sh
# Run from repo root.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICONS_SRC="$REPO_ROOT/packages/ui/src/icons"
TAURI_ICONS="$REPO_ROOT/apps/desktop/src-tauri/icons"
PUBLIC_ICONS="$REPO_ROOT/apps/desktop/public/icons"
HICOLOR="$TAURI_ICONS/hicolor"

echo "==> Strata icon generator"
echo "    Source: $ICONS_SRC"
echo ""

# ── 1. Setup directories ──────────────────────────────────────────────
echo "==> Creating output directories..."
mkdir -p "$TAURI_ICONS"
mkdir -p "$PUBLIC_ICONS"

# Linux hicolor tree
for size in 16 22 24 32 48 64 96 128 256 512; do
  mkdir -p "$HICOLOR/${size}x${size}/apps"
done
mkdir -p "$HICOLOR/scalable/apps"
mkdir -p "$HICOLOR/symbolic/apps"

# ── 2. Detect available tools ─────────────────────────────────────────
HAS_RSVG=0
HAS_MAGICK=0
command -v rsvg-convert >/dev/null 2>&1 && HAS_RSVG=1 || echo "WARN: rsvg-convert not found; install librsvg"
command -v magick >/dev/null 2>&1 && HAS_MAGICK=1 || echo "WARN: magick not found; install ImageMagick 7"

if [ "$HAS_RSVG" -eq 0 ] && [ "$HAS_MAGICK" -eq 0 ]; then
  echo "ERROR: need rsvg-convert OR magick for SVG→PNG rendering"
  exit 1
fi

# Helper: render SVG to PNG at given width/height
render_png() {
  local svg="$1"
  local out="$2"
  local size="$3"
  mkdir -p "$(dirname "$out")"
  if [ "$HAS_RSVG" -eq 1 ]; then
    rsvg-convert "$svg" -w "$size" -h "$size" -o "$out"
  else
    magick convert -background none "$svg" -resize "${size}x${size}^" -gravity center -extent "${size}x${size}" "$out"
  fi
}

# ── 3. Generate app icon PNG ladder ───────────────────────────────────
echo "==> Generating app icon PNG ladder (app-icon SVG)..."

APP_SVG="$ICONS_SRC/strata-app-icon.svg"
INVERT_SVG="$ICONS_SRC/strata-wordmark-dark.svg"
SYMBOLIC_SVG="$ICONS_SRC/strata-icon-symbolic.svg"

# Tauri-standard sizes (legacy naming, kept for compatibility)
for size in 32 64 128 256 512; do
  out="$TAURI_ICONS/${size}x${size}.png"
  render_png "$APP_SVG" "$out" "$size"
  echo "  $out"
done
# 256 → 128x128@2x
if [ "$HAS_MAGICK" -eq 1 ]; then
  magick convert "$TAURI_ICONS/256x256.png" "$TAURI_ICONS/128x128@2x.png"
  echo "  $TAURI_ICONS/128x128@2x.png (copy from 256)"
fi
render_png "$APP_SVG" "$TAURI_ICONS/icon.png" 512
echo "  $TAURI_ICONS/icon.png"

# 1024 source (master export)
render_png "$ICONS_SRC/strata-icon.svg" "$TAURI_ICONS/strata-icon-source.png" 1024
echo "  $TAURI_ICONS/strata-icon-source.png (1024)"

# ── 4. Linux hicolor PNG ladder ──────────────────────────────────────
echo "==> Generating Linux hicolor PNG ladder..."
for size in 16 22 24 32 48 64 96 128 256 512; do
  out="$HICOLOR/${size}x${size}/apps/dev.strata.desktop.png"
  render_png "$APP_SVG" "$out" "$size"
  echo "  $out"
done

# ── 5. Linux scalable + symbolic ──────────────────────────────────────
echo "==> Generating Linux scalable + symbolic..."
cp "$ICONS_SRC/strata-app-icon.svg" "$HICOLOR/scalable/apps/dev.strata.desktop.svg"
echo "  $HICOLOR/scalable/apps/dev.strata.desktop.svg"
cp "$SYMBOLIC_SVG" "$HICOLOR/symbolic/apps/dev.strata.desktop-symbolic.svg"
echo "  $HICOLOR/symbolic/apps/dev.strata.desktop-symbolic.svg"

# ── 6. Windows .ico (multi-resolution) ────────────────────────────────
echo "==> Generating Windows .ico..."
if [ "$HAS_MAGICK" -eq 1 ]; then
  # Collect all sizes for .ico
  ICO_DIR=$(mktemp -d)
  for size in 16 24 32 48 64 96 256; do
    render_png "$APP_SVG" "$ICO_DIR/ico_${size}.png" "$size"
  done
  magick convert "$ICO_DIR/ico_16.png" "$ICO_DIR/ico_24.png" "$ICO_DIR/ico_32.png" \
    "$ICO_DIR/ico_48.png" "$ICO_DIR/ico_64.png" "$ICO_DIR/ico_96.png" \
    "$ICO_DIR/ico_256.png" "$TAURI_ICONS/icon.ico"
  rm -rf "$ICO_DIR"
  echo "  $TAURI_ICONS/icon.ico (16,24,32,48,64,96,256)"
else
  cp "$TAURI_ICONS/icon.ico" "$TAURI_ICONS/icon.ico.bak" 2>/dev/null || true
  echo "  WARN: magick not available; icon.ico not regenerated"
fi

# Windows Store / tile assets
echo "==> Generating Windows tile assets..."
for size in 30 44 71 89 107 142 150 284 310; do
  out="$TAURI_ICONS/Square${size}x${size}Logo.png"
  render_png "$APP_SVG" "$out" "$size"
  echo "  $out"
done
render_png "$APP_SVG" "$TAURI_ICONS/StoreLogo.png" 50
echo "  $TAURI_ICONS/StoreLogo.png"

# Windows AppList targetsize PNGs
echo "==> Generating Windows AppList targetsize PNGs..."
APP_LIST="$TAURI_ICONS/AppList"
mkdir -p "$APP_LIST"
for size in 16 20 24 30 32 36 40 48 60 64 72 80 96 256; do
  out="$APP_LIST/AppList.targetsize-${size}.png"
  render_png "$APP_SVG" "$out" "$size"
  echo "  $out"
done

# ── 7. macOS .icns ────────────────────────────────────────────────────
echo "==> Generating macOS .icns..."
ICONSET_DIR=$(mktemp -d)
ICONSET="$ICONSET_DIR/Strata.iconset"
mkdir -p "$ICONSET"

# iconset requires specific naming: icon_{16,32,128,256,512}x{...}.png and @2x variants
declare -A ICONSET_MAP=(
  ["icon_16x16.png"]=16
  ["icon_16x16@2x.png"]=32
  ["icon_32x32.png"]=32
  ["icon_32x32@2x.png"]=64
  ["icon_128x128.png"]=128
  ["icon_128x128@2x.png"]=256
  ["icon_256x256.png"]=256
  ["icon_256x256@2x.png"]=512
  ["icon_512x512.png"]=512
  ["icon_512x512@2x.png"]=1024
)

for filename in "${!ICONSET_MAP[@]}"; do
  size="${ICONSET_MAP[$filename]}"
  render_png "$APP_SVG" "$ICONSET/$filename" "$size"
done

echo "  iconset created at $ICONSET"

# Try to use iconutil (macOS), otherwise Python fallback
ICNS_OUT="$TAURI_ICONS/icon.icns"
if command -v iconutil >/dev/null 2>&1; then
  iconutil -c icns "$ICONSET" -o "$ICNS_OUT"
  echo "  $ICNS_OUT (via iconutil)"
else
  # Python fallback — build .icns binary manually
  # .icns format: magic('icns') + total_size + icon_entries(type+size+data)
  python3 -c "
import struct, os, sys

icns_dir = '$ICONSET'
icns_files = [
    ('ic07', 'icon_16x16.png'),
    ('ic08', 'icon_32x32.png'),
    ('ic09', 'icon_128x128.png'),
    ('ic10', 'icon_256x256.png'),
    ('ic11', 'icon_512x512.png'),
    ('ic12', 'icon_512x512@2x.png'),
    ('ic13', 'icon_16x16@2x.png'),
    ('ic14', 'icon_32x32@2x.png'),
]

entries = b''
for (ostype, fname) in icns_files:
    fpath = os.path.join(icns_dir, fname)
    if not os.path.exists(fpath):
        continue
    with open(fpath, 'rb') as f:
        png_data = f.read()
    icon_entry = struct.pack('>4sII', ostype.encode(), 8 + len(png_data), 0) + png_data
    entries += icon_entry

total_size = 8 + len(entries)
with open('$ICNS_OUT', 'wb') as f:
    f.write(struct.pack('>4sI', b'icns', total_size))
    f.write(entries)

print(f'  \$ICNS_OUT (Python builder, {len(entries)} bytes icon data)')
"
fi

rm -rf "$ICONSET_DIR"

# ── 8. Web / PWA icons ────────────────────────────────────────────────
echo "==> Generating web / PWA icons..."

# Standard PWA icons
for size in 192 512; do
  render_png "$APP_SVG" "$PUBLIC_ICONS/icon-${size}.png" "$size"
  echo "  $PUBLIC_ICONS/icon-${size}.png"
done

# Maskable PWA icons: same source but we ensure it fits within the maskable safe zone.
# The strata mark is already within the inner 80% safe zone by design.
for size in 192 512; do
  render_png "$APP_SVG" "$PUBLIC_ICONS/icon-maskable-${size}.png" "$size"
  echo "  $PUBLIC_ICONS/icon-maskable-${size}.png"
done

# Apple touch icon
render_png "$APP_SVG" "$PUBLIC_ICONS/apple-touch-icon.png" 180
echo "  $PUBLIC_ICONS/apple-touch-icon.png"

# Favicon .ico (multi-size)
if [ "$HAS_MAGICK" -eq 1 ]; then
  FAV_DIR=$(mktemp -d)
  for size in 16 32 48; do
    render_png "$APP_SVG" "$FAV_DIR/fav_${size}.png" "$size"
  done
  magick convert "$FAV_DIR/fav_16.png" "$FAV_DIR/fav_32.png" "$FAV_DIR/fav_48.png" \
    "$PUBLIC_ICONS/favicon.ico"
  rm -rf "$FAV_DIR"
  echo "  $PUBLIC_ICONS/favicon.ico"
  # Also copy to root for easy access
  cp "$PUBLIC_ICONS/favicon.ico" "$REPO_ROOT/apps/desktop/public/favicon.ico" 2>/dev/null || true
fi

# PNG favicons
for size in 32 192; do
  render_png "$APP_SVG" "$PUBLIC_ICONS/favicon-${size}.png" "$size"
  echo "  $PUBLIC_ICONS/favicon-${size}.png"
done

# ── 9. Copy in-app SVGs to public ─────────────────────────────────────
echo "==> Copying in-app SVGs..."
mkdir -p "$REPO_ROOT/apps/desktop/public/icons"
cp "$ICONS_SRC/strata-icon.svg" "$REPO_ROOT/apps/desktop/public/icons/strata-icon.svg"
cp "$ICONS_SRC/strata-wordmark-only.svg" "$REPO_ROOT/apps/desktop/public/icons/strata-wordmark.svg"
echo "  $REPO_ROOT/apps/desktop/public/icons/"

# Also copy the SVG master to TAURI icons for reference
cp "$ICONS_SRC/strata-icon.svg" "$TAURI_ICONS/strata-icon.svg"

echo ""
echo "==> Done! All icons generated."
echo "    Source: $ICONS_SRC"
echo "    Tauri icons: $TAURI_ICONS"
echo "    Public icons: $PUBLIC_ICONS"
echo "    Hicolor: $HICOLOR"
