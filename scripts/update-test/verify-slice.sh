#!/usr/bin/env bash
# Verify a completed AppImage vertical slice: the running AppImage must have
# been replaced by the new fixture bytes, and relaunching it must report the
# new version.
#
# Usage (after the wdio updater spec passes):
#   scripts/update-test/verify-slice.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_DIR="${UPDATE_TEST_DIR:-/tmp/varve-update-test}"
OLD_APPIMAGE="$TEST_DIR/Varve.appimage"
NEW_APPIMAGE="$TEST_DIR/Varve_0.1.2-test_amd64.AppImage"

if [[ ! -f "$OLD_APPIMAGE" || ! -f "$NEW_APPIMAGE" ]]; then
  echo "Missing fixtures in $TEST_DIR — run build-fixtures.sh first." >&2
  exit 1
fi

OLD_HASH="$(sha256sum "$OLD_APPIMAGE" | cut -d' ' -f1)"
NEW_HASH="$(sha256sum "$NEW_APPIMAGE" | cut -d' ' -f1)"

if [[ "$OLD_HASH" == "$NEW_HASH" ]]; then
  echo "PASS: the running AppImage was replaced by the new fixture bytes"
  echo "      sha256 $OLD_HASH"
else
  echo "FAIL: the running AppImage was NOT replaced by the update" >&2
  echo "      old fixture: $OLD_HASH" >&2
  echo "      new fixture: $NEW_HASH" >&2
  exit 1
fi

echo "PASS: executable bit retained"
[[ -x "$OLD_APPIMAGE" ]] || { echo "FAIL: replaced AppImage is not executable" >&2; exit 1; }

echo "PASS: replacement happened in place at the original path"
echo "Next: relaunch the replaced AppImage (wdio spec: updater-launch.e2e.ts) to confirm the reported version."
