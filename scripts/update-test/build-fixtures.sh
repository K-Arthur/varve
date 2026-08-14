#!/usr/bin/env bash
# Packaged AppImage updater vertical slice — build, sign, serve.
#
# Builds two RELEASE AppImages that differ only by version:
#   old: 0.1.1-test   (the "installed" app, wdio feature so WebDriver drives it)
#   new: 0.1.2-test   (the update payload)
#
# Both embed the TEST-ONLY updater public key and a localhost feed endpoint
# (apps/desktop/src-tauri/tauri.update.test.json). Signatures use the
# TEST-ONLY key ~/.varve/updater-test.key — never the working/production key,
# and never a CI credential. The feed is served over plain HTTP on an
# isolated port with dangerousInsecureTransportProtocol enabled only in this
# test config.
#
# Usage:
#   scripts/update-test/build-fixtures.sh            # build + sign + serve
#   scripts/update-test/build-fixtures.sh --serve-only
#
# Env: UPDATE_TEST_DIR (default /tmp/varve-update-test), FEED_PORT (8899).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAURI="$ROOT/apps/desktop/node_modules/.bin/tauri"
TEST_KEY="${UPDATE_TEST_KEY:-$HOME/.varve/updater-test.key}"
TEST_DIR="${UPDATE_TEST_DIR:-/tmp/varve-update-test}"
FEED_PORT="${FEED_PORT:-8899}"
OLD_VERSION="0.1.1-test"
NEW_VERSION="0.1.2-test"

mkdir -p "$TEST_DIR"

# The old fixture must be able to replace itself: a writable directory.
OLD_APPIMAGE="$TEST_DIR/Varve.appimage"
NEW_APPIMAGE="$TEST_DIR/Varve_${NEW_VERSION}_amd64.AppImage"

if [[ "${1:-}" != "--serve-only" ]]; then
  if [[ ! -f "$TEST_KEY" || ! -f "$TEST_KEY.pub" ]]; then
    echo "Test signing key missing at $TEST_KEY — run:" >&2
    echo "  $TAURI signer generate -w $TEST_KEY -p \"\"" >&2
    exit 1
  fi
  PUBKEY="$(cat "$TEST_KEY.pub")"
  EMBEDDED="$(node -e "const c=require('$ROOT/apps/desktop/src-tauri/tauri.update.test.json');process.stdout.write(c.plugins.updater.pubkey)")"
  if [[ "$PUBKEY" != "$EMBEDDED" ]]; then
    echo "tauri.update.test.json pubkey does not match $TEST_KEY.pub — regenerate the config:" >&2
    echo "  \"pubkey\": \"$PUBKEY\"" >&2
    exit 1
  fi

  # Frontend must be built with --mode wdio: main.tsx only loads the wdio
  # bridge plugin when Vite's mode is 'wdio', and without it WebDriver cannot
  # call browser.tauri.execute in the webview. tsc is skipped (can fail on
  # unrelated in-flight workspace edits); tauri's beforeBuildCommand is
  # overridden to a no-op so it never re-runs the repo's `pnpm build`.
  # NO_STRIP mirrors the release runner: linuxdeploy's bundled strip chokes on
  # newer .relr.dyn sections and would otherwise fail the AppImage bundle.
  echo "==> Building frontend dist (vite --mode wdio, no tsc)"
  (cd "$ROOT/apps/desktop" && pnpm exec vite build --mode wdio)
  export NO_STRIP=1 CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
  node -e "require('fs').writeFileSync('$TEST_DIR/fixture-build.json', JSON.stringify({build:{beforeBuildCommand:'echo fixture frontend prebuilt'}}))"

  for spec in "old:$OLD_VERSION" "new:$NEW_VERSION"; do
    label="${spec%%:*}"
    version="${spec##*:}"
    config="$TEST_DIR/$label.version.json"
    node -e "require('fs').writeFileSync('$config', JSON.stringify({version:'$version'}))"
    echo "==> Building $label fixture ($version, release, wdio, appimage)"
    (cd "$ROOT/apps/desktop" && pnpm tauri build \
      --bundles appimage \
      --features wdio \
      --config src-tauri/tauri.update.test.json \
      --config "$config" \
      --config "$TEST_DIR/fixture-build.json")
  done

  # Locate the freshly built AppImages (Tauri names them Product_Version_arch).
  OLD_BUILT="$(ls "$ROOT"/apps/desktop/src-tauri/target/release/bundle/appimage/Varve_${OLD_VERSION}_*.AppImage | head -1)"
  NEW_BUILT="$(ls "$ROOT"/apps/desktop/src-tauri/target/release/bundle/appimage/Varve_${NEW_VERSION}_*.AppImage | head -1)"
  [[ -n "$OLD_BUILT" && -n "$NEW_BUILT" ]]

  echo "==> Signing fixtures with the TEST-ONLY key"
  export TAURI_SIGNING_PRIVATE_KEY_PATH="$TEST_KEY"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
  "$TAURI" signer sign -f "$OLD_BUILT"
  "$TAURI" signer sign -f "$NEW_BUILT"

  # The old app must run from the writable test dir under its AppImage path.
  cp "$OLD_BUILT" "$OLD_APPIMAGE"
  cp "$NEW_BUILT" "$NEW_APPIMAGE"
  cp "$NEW_BUILT.sig" "$NEW_APPIMAGE.sig"
  chmod +x "$OLD_APPIMAGE" "$NEW_APPIMAGE"

  # Feed served from the test dir; url must match the AppImage filename.
  node -e "
    const fs = require('fs');
    const sig = fs.readFileSync('$NEW_APPIMAGE.sig', 'utf8').trim();
    const feed = {
      version: '$NEW_VERSION',
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
fi

echo "==> Serving feed + payload at http://127.0.0.1:$FEED_PORT (Ctrl-C to stop)"
echo "    old: $OLD_APPIMAGE  new: $NEW_APPIMAGE"
python3 -m http.server "$FEED_PORT" --bind 127.0.0.1 --directory "$TEST_DIR"
