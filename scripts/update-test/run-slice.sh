#!/usr/bin/env bash
# End-to-end runner for the packaged AppImage updater vertical slice.
#
#   scripts/update-test/run-slice.sh
#
# Phases:
#   1. wdio spec 1 on the OLD AppImage: consent -> check -> download -> guard
#      -> install -> restart (app relaunches and replaces itself)
#   2. verify-slice.sh: bytes replaced in place, executable bit retained
#   3. swap feed to an INVALID signature for 0.1.3-test
#   4. wdio spec 2 on the REPLACED AppImage: new version reported, no
#      re-consent, invalid signature fails closed
#   5. swap feed to a VALID signature for 0.1.3-test, make the AppImage
#      directory read-only mid-session; install must fail safely
#   6. restore the good feed
#
# Env: UPDATE_TEST_DIR, FEED_PORT (defaults match build-fixtures.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_DIR="${UPDATE_TEST_DIR:-/tmp/varve-update-test}"
OLD_APPIMAGE="$TEST_DIR/Varve.appimage"
NEW_APPIMAGE="$TEST_DIR/Varve_0.1.2-test_amd64.AppImage"
FEED_PORT="${FEED_PORT:-8899}"

for file in "$OLD_APPIMAGE" "$NEW_APPIMAGE" "$TEST_DIR/feed.json"; do
  [[ -f "$file" ]] || { echo "Missing $file — run build-fixtures.sh first." >&2; exit 1; }
done

WDIO=(pnpm exec wdio run wdio.conf.ts)
export VARVE_DESKTOP_BINARY="$OLD_APPIMAGE"
export WEBKIT_DISABLE_COMPOSITING_MODE=1
# The AppImage runs via self-extraction (no FUSE dependency on the host).
export APPIMAGE_EXTRACT_AND_RUN=1
# Isolate app-data so every phase sees a pristine first-run state (the
# consent prompt must not inherit localStorage from a previous phase or from
# debug-build smoke tests that share dev.varve.desktop's data dir).
export XDG_DATA_HOME="$TEST_DIR/xdg-data"
export XDG_CONFIG_HOME="$TEST_DIR/xdg-config"
export XDG_CACHE_HOME="$TEST_DIR/xdg-cache"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"

echo "==> [1/6] Old AppImage: consent -> check -> download -> install -> restart"
xvfb-run -a dbus-run-session -- "${WDIO[@]}" --spec tests/wdio/updater.e2e.ts

echo "==> [2/6] Verify in-place byte replacement"
bash scripts/update-test/verify-slice.sh

echo "==> [3/6] Swap feed to an invalid signature (0.1.3-test)"
node -e "
  const fs = require('fs');
  const feed = {
    version: '0.1.3-test',
    notes: 'Invalid signature fixture',
    platforms: {
      'linux-x86_64': {
        url: 'http://127.0.0.1:$FEED_PORT/$(basename "$NEW_APPIMAGE")',
        signature: 'invalid-signature-content-for-testing',
      },
    },
  };
  fs.writeFileSync('$TEST_DIR/feed.json', JSON.stringify(feed, null, 2));
"

echo "==> [4/6] Relaunched AppImage: version, no re-consent, fail-closed"
export VARVE_DESKTOP_BINARY="$OLD_APPIMAGE"  # same path, now new bytes
xvfb-run -a dbus-run-session -- "${WDIO[@]}" --spec tests/wdio/updater-launch.e2e.ts

echo "==> [5/6] Swap feed to a VALID signature for 0.1.3-test (read-only dir phase)"
node -e "
  const fs = require('fs');
  const sig = fs.readFileSync('$NEW_APPIMAGE.sig', 'utf8').trim();
  const feed = {
    version: '0.1.3-test',
    notes: 'Read-only directory fixture. Payload reuses the new-fixture bytes with their real signature.',
    platforms: {
      'linux-x86_64': {
        url: 'http://127.0.0.1:$FEED_PORT/$(basename "$NEW_APPIMAGE")',
        signature: sig,
      },
    },
  };
  fs.writeFileSync('$TEST_DIR/feed.json', JSON.stringify(feed, null, 2));
"
xvfb-run -a dbus-run-session -- "${WDIO[@]}" --spec tests/wdio/updater-launch.e2e.ts --grep "not writable"

echo "==> [6/6] Restore the good feed"node -e "
  const fs = require('fs');
  const sig = fs.readFileSync('$NEW_APPIMAGE.sig', 'utf8').trim();
  const feed = {
    version: '0.1.2-test',
    notes: 'Vertical-slice fixture release. Verifies the packaged AppImage upgrade path.',
    platforms: {
      'linux-x86_64': {
        url: 'http://127.0.0.1:$FEED_PORT/$(basename "$NEW_APPIMAGE")',
        signature: sig,
      },
    },
  };
  fs.writeFileSync('$TEST_DIR/feed.json', JSON.stringify(feed, null, 2));
"
echo "AppImage vertical slice: ALL PASSED"
