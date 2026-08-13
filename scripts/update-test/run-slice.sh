#!/usr/bin/env bash
# End-to-end runner for the packaged AppImage updater vertical slice.
#
#   scripts/update-test/run-slice.sh
#
# Phases:
#   1. build-fixtures.sh --serve-only (feed server must already be up; start
#      it in a separate terminal: `bash scripts/update-test/build-fixtures.sh`)
#   2. wdio spec 1 on the OLD AppImage: consent -> check -> download -> guard
#      -> install -> restart (app relaunches and replaces itself)
#   3. verify-slice.sh: bytes replaced in place, executable bit retained
#   4. swap feed to an INVALID signature for 0.1.3-test
#   5. wdio spec 2 on the REPLACED AppImage: new version reported, no
#      re-consent, invalid signature fails closed
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

echo "==> [1/5] Old AppImage: consent -> check -> download -> install -> restart"
xvfb-run -a dbus-run-session -- "${WDIO[@]}" --spec tests/wdio/updater.e2e.ts

echo "==> [2/5] Verify in-place byte replacement"
bash scripts/update-test/verify-slice.sh

echo "==> [3/5] Swap feed to an invalid signature (0.1.3-test)"
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

echo "==> [4/5] Relaunched AppImage: version, no re-consent, fail-closed"
export VARVE_DESKTOP_BINARY="$OLD_APPIMAGE"  # same path, now new bytes
xvfb-run -a dbus-run-session -- "${WDIO[@]}" --spec tests/wdio/updater-launch.e2e.ts

echo "==> [5/5] Restore the good feed"
node -e "
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
