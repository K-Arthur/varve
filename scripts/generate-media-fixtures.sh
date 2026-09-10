#!/usr/bin/env bash
# Generates the deterministic animated-image fixture corpus committed under
# packages/engine/src/media/__fixtures__/.
#
# - ImageMagick (magick): GIF corpus + static WebP (partial frames, dispose,
#   transparency).
# - ffmpeg (libwebp_anim): animated WebP.
# - Node (scripts/generate-media-fixtures.mjs): APNG (subrects, variable
#   timing, dispose/blend ops) and GIF edge cases (interlaced, dispose
#   previous, finite loop, zero delay) that ImageMagick cannot emit precisely.
#
# All fixtures use flat solid colors so decode tests can assert exact pixels.
#
# Regenerate with: bash scripts/generate-media-fixtures.sh
set -euo pipefail

OUT="packages/engine/src/media/__fixtures__"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

work() { (cd "$TMP" && "$@"); }

node scripts/generate-media-fixtures.mjs

# --- GIF corpus -------------------------------------------------------------
# gif-basic / gif-delta / gif-transparent / gif-alpha-blue / GIF edge cases
# are emitted by generate-media-fixtures.mjs with exact colors; ImageMagick
# quantizes palettes and dithers alpha, so it only contributes:
#   gif-single: one frame — must be detected as static.
work magick -size 64x64 xc:red gif-single.gif

# --- WebP corpus (ffmpeg/libwebp for animation; IM for static) --------------
work magick -size 64x64 xc:red webp-static.webp
work ffmpeg -y -f lavfi -i "color=c=red:s=64x64:d=0.04" \
  -f lavfi -i "color=c=green:s=64x64:d=0.10" \
  -f lavfi -i "color=c=blue:s=64x64:d=0.02" \
  -filter_complex "[0][1][2]concat=n=3:v=1:a=0,format=rgba" \
  -loop 0 -lossless 1 -c:v libwebp_anim webp-animated.webp 2>/dev/null

# --- Copy into the repo -----------------------------------------------------
# Node-generated fixtures (APNG + GIF corpus + GIF edge cases) are written to
# $OUT directly by generate-media-fixtures.mjs; only the tool-generated files
# need copying from the temp dir.
for f in gif-single.gif webp-animated.webp webp-static.webp; do
  cp "$TMP/$f" "$OUT/$f"
done

echo "Fixtures written to $OUT:"
ls -la "$OUT"
