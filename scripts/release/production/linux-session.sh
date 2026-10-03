#!/usr/bin/env bash
# Run inside one dbus-run-session/Xvfb session; outer bounded runner owns this tree.
set -euo pipefail
EXE="$1"; OUT="$2"; PROFILE="$3"; VERSION="$4"; ARCH="$5"; INPUT="$6"; SCHEMA="$7"; SEED="${8:-false}"
if [[ "$SEED" == true ]]; then set -- --seed; else set --; fi
mkdir -p "$OUT" "$PROFILE/data" "$PROFILE/config" "$PROFILE/cache"
export XDG_DATA_HOME="$PROFILE/data" XDG_CONFIG_HOME="$PROFILE/config" XDG_CACHE_HOME="$PROFILE/cache"
export TAURI_WEBVIEW_AUTOMATION=true
# This is the unmodified release app and the official external native driver.
tauri-driver --port 4444 --native-driver /usr/bin/WebKitWebDriver >"$OUT/tauri-driver.log" 2>&1 &
DRIVER_PID=$!
trap 'kill "$DRIVER_PID" 2>/dev/null || true; wait "$DRIVER_PID" 2>/dev/null || true' EXIT
node --input-type=module -e 'const deadline=Date.now()+30000;let ok=false;while(Date.now()<deadline){try{const r=await fetch("http://127.0.0.1:4444/status",{signal:AbortSignal.timeout(1000)});if(r.ok){ok=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}if(!ok)throw new Error("External tauri-driver readiness failed");'
node scripts/release/production/linux-production.mjs --exe "$EXE" --input "$INPUT" --out "$OUT" --profile "$PROFILE" --version "$VERSION" --schema "$SCHEMA" --arch "$ARCH" --port 4444 "$@"
