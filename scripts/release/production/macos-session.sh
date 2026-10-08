#!/usr/bin/env bash
# External Appium/Mac2 server only. No app rebuild/plugin or permission bypass.
set -euo pipefail
SESSION_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP="$1"; OUT="$2"; VERSION="$3"; INPUT="$4"; SCHEMA="$5"; SEED="${6:-false}"
if [[ "$SEED" == true ]]; then set -- --seed; else set --; fi
mkdir -p "$OUT"
export APPIUM_HOME="$RUNNER_TEMP/varve-appium-home"
export VARVE_MACOS_PROFILE_SNAPSHOT="$SESSION_DIR/macos-profile-snapshot.py"
"$RUNNER_TEMP/varve-appium/node_modules/.bin/appium" --address 127.0.0.1 --port 4723 --log "$OUT/appium.log" >"$OUT/appium-stdout.log" 2>&1 &
SERVER_PID=$!
finish_session() {
  python3 "$SESSION_DIR/macos-profile-snapshot.py" --out "$OUT/profile-after-session.json" || true
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap finish_session EXIT
node --input-type=module -e 'const deadline=Date.now()+30000;let ok=false;while(Date.now()<deadline){try{const r=await fetch("http://127.0.0.1:4723/status",{signal:AbortSignal.timeout(1000)});if(r.ok){ok=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}if(!ok)throw new Error("External Appium server readiness failed");'
# Probe failure remains a failure; full qualification is a distinct mandatory command.
python3 "$SESSION_DIR/macos-profile-snapshot.py" --out "$OUT/profile-before-session.json"
node "$SESSION_DIR/macos-ax-probe.mjs" --app "$APP" --out "$OUT/probe" --server http://127.0.0.1:4723
node "$SESSION_DIR/macos-production.mjs" --app "$APP" --input "$INPUT" --out "$OUT/functional" --version "$VERSION" --schema "$SCHEMA" --server http://127.0.0.1:4723 "$@"
