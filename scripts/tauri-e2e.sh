#!/usr/bin/env bash
# Optional native Tauri E2E — requires tauri-driver + WebDriver (geckodriver/chromedriver).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v tauri-driver >/dev/null 2>&1; then
  echo "tauri-driver not found. Install: cargo install tauri-driver --locked"
  exit 1
fi

export VARVE_TAURI_E2E=1
exec pnpm exec playwright test tests/e2e/tauri --project=tauri --reporter=list
