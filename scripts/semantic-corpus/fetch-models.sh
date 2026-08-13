#!/usr/bin/env bash
# Fetch the semantic-similarity evaluation models into $VARVE_MODEL_CACHE
# (default ~/.cache/varve/models) with SHA-256 verification.
#
# These weights are NOT committed to the repository. They are needed only
# by the parity/evaluation harness (dev tooling); the production app
# downloads them through its own verified model manager.
set -euo pipefail

CACHE="${VARVE_MODEL_CACHE:-$HOME/.cache/varve/models}"
mkdir -p "$CACHE"

fetch() {
  local url="$1" file="$2" sha="$3"
  if [ -f "$CACHE/$file" ] && [ "$(sha256sum "$CACHE/$file" | cut -d' ' -f1)" = "$sha" ]; then
    echo "present: $file"
    return 0
  fi
  echo "downloading $file..."
  curl -L --fail --silent --show-error -o "$CACHE/$file.tmp" "$url"
  local actual
  actual="$(sha256sum "$CACHE/$file.tmp" | cut -d' ' -f1)"
  if [ "$actual" != "$sha" ]; then
    rm -f "$CACHE/$file.tmp"
    echo "SHA-256 mismatch for $file: expected $sha got $actual" >&2
    exit 1
  fi
  mv "$CACHE/$file.tmp" "$CACHE/$file"
  echo "verified: $file"
}

fetch \
  "https://huggingface.co/Xenova/siglip-base-patch16-224/resolve/main/onnx/model_quantized.onnx" \
  "siglip-base-patch16-224.onnx" \
  "9171eb00c38b9ec82f924877356d008b79e3285dbac7cd10965827bee30c9a99"

fetch \
  "https://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model.onnx" \
  "dinov2-small.onnx" \
  "83141175ec78b4ff9a2bb58a4c7c264ba0054d1c2e122e5a8114b79a8d4179ea"

echo "models ready in $CACHE"
