#!/usr/bin/env bash
# Mirror the verified DDColor ONNX artifacts to a HuggingFace model repo.
#
# Browser downloads require a CORS-enabled host; GitHub release assets do not
# send Access-Control-Allow-Origin headers, so the web and Tauri builds fetch
# from HuggingFace instead (the desktop app can also use the native download
# path, but the HF mirror keeps one verified source for every platform).
#
# Usage:
#   HF_TOKEN=hf_... tools/ddcolor-export/mirror-to-hf.sh
#
# Env:
#   HF_TOKEN               required, write access to the target repo
#   VARVE_DDCOLOR_HF_REPO  optional, defaults to K-Arthur/varve-ddcolor-onnx
#
# After the upload, add the repo URL as the first source in
# packages/engine/src/inference/modelCatalog.ts and verify with:
#   curl -sIL -H "Origin: http://localhost:1420" \
#     "https://huggingface.co/<repo>/resolve/main/ddcolor-tiny.onnx" | grep -i access-control

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
target_repo="${VARVE_DDCOLOR_HF_REPO:-K-Arthur/varve-ddcolor-onnx}"
tiny="$repo_root/models-source/ddcolor-tiny.onnx"
large="$repo_root/models-source/ddcolor.onnx"
card="$repo_root/tools/ddcolor-export/hf-model-card.md"

if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "HF_TOKEN is required (fine-grained token with write access to ${target_repo})." >&2
  exit 1
fi

for file in "$tiny" "$large"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing $file — produce it with tools/ddcolor-export/export_ddcolor.py first." >&2
    exit 1
  fi
done

python_bin="${PYTHON:-python3}"
if command -v hf >/dev/null 2>&1; then
  cli="hf"
else
  venv="${TMPDIR:-/tmp}/varve-hf-venv"
  "$python_bin" -m venv "$venv"
  "$venv/bin/pip" install --quiet "huggingface_hub[cli]"
  cli="$venv/bin/hf"
fi

export HF_TOKEN
"$cli" repo create "$target_repo" --repo-type model --exist-ok

"$cli" upload "$target_repo" "$card" README.md --repo-type model
"$cli" upload "$target_repo" "$tiny" ddcolor-tiny.onnx --repo-type model
"$cli" upload "$target_repo" "$large" ddcolor.onnx --repo-type model

echo "Uploaded to https://huggingface.co/${target_repo}"
echo "Next: add the HF URL as the first catalog source and re-verify the CORS headers."
