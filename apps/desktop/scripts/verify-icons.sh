#!/usr/bin/env bash
# Verify Varve desktop icon assets: existence, dimensions, formats, and
# cross-reference with tauri.conf.json bundle.icon and Linux .desktop entry.
# Run from repo root: bash apps/desktop/scripts/verify-icons.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ICON_DIR="$REPO_ROOT/apps/desktop/src-tauri/icons"
HICOLOR_DIR="$ICON_DIR/hicolor"
TAURI_CONF="$REPO_ROOT/apps/desktop/src-tauri/tauri.conf.json"
errors=0

red='\033[0;31m'; green='\033[0;32m'; nc='\033[0m'
pass() { echo -e "  ${green}PASS${nc} $1"; }
fail() { echo -e "  ${red}FAIL${nc} $1"; errors=$((errors + 1)); }

echo "==> Varve icon asset verification"
echo ""

# ── 1. bundle.icon entries from tauri.conf.json ─────────────────────────
echo "--> 1. Verifying bundle.icon entries from tauri.conf.json"

BUNDLE_ICONS=$(python3 -c "
import json, sys
with open('$TAURI_CONF') as f:
    cfg = json.load(f)
for path in cfg.get('bundle', {}).get('icon', []):
    print(path)
" 2>/dev/null) || BUNDLE_ICONS=$(grep -oP '"icons/[^"]+' "$TAURI_CONF" | sed 's/"//' | sort -u)

for entry in $BUNDLE_ICONS; do
  full="$ICON_DIR/$(basename "$entry")"
  if [ -f "$full" ]; then
    pass "bundle.icon entry exists: $entry"
  else
    fail "bundle.icon entry MISSING: $entry (expected at $full)"
  fi
done

# ── 2. PNG dimensions (bundle PNGs) ─────────────────────────────────────
echo ""
echo "--> 2. Verifying PNG icon dimensions"

EXPECTED_DIMS=(
  "32x32.png:32x32"
  "128x128.png:128x128"
  "128x128@2x.png:256x256"
  "icon.png:512x512"
)

for dim_entry in "${EXPECTED_DIMS[@]}"; do
  file="${dim_entry%%:*}"
  expected="${dim_entry##*:}"
  full="$ICON_DIR/$file"
  if [ -f "$full" ]; then
    actual=$(identify -format "%wx%h" "$full" 2>/dev/null) || actual="UNREADABLE"
    if [ "$actual" = "$expected" ]; then
      pass "$file is ${expected}"
    else
      fail "$file expected ${expected} but got ${actual}"
    fi
  else
    fail "$file does not exist"
  fi
done

# ── 3. Windows .ico format ──────────────────────────────────────────────
echo ""
echo "--> 3. Verifying Windows .ico"

if [ -f "$ICON_DIR/icon.ico" ]; then
  ico_count=$(identify "$ICON_DIR/icon.ico" 2>/dev/null | wc -l)
  if [ "$ico_count" -ge 4 ]; then
    pass "icon.ico has $ico_count embedded resolutions"
  else
    fail "icon.ico only has $ico_count embedded resolutions (expected >= 4)"
  fi
else
  fail "icon.ico does not exist"
fi

# ── 4. macOS .icns format ───────────────────────────────────────────────
echo ""
echo "--> 4. Verifying macOS .icns"

if [ -f "$ICON_DIR/icon.icns" ]; then
  icns_size=$(stat -c%s "$ICON_DIR/icon.icns" 2>/dev/null || stat -f%z "$ICON_DIR/icon.icns" 2>/dev/null)
  if [ "$icns_size" -gt 10000 ]; then
    pass "icon.icns exists ($icns_size bytes)"
  else
    fail "icon.icns suspiciously small ($icns_size bytes)"
  fi
else
  fail "icon.icns does not exist"
fi

# ── 5. Linux hicolor ladder ─────────────────────────────────────────────
echo ""
echo "--> 5. Verifying Linux hicolor ladder"

HICOLOR_SIZES=(16 22 24 32 48 64 96 128 256 512 1024)
export APP_ID="dev.varve.desktop"

for SIZE in "${HICOLOR_SIZES[@]}"; do
  icon="$HICOLOR_DIR/${SIZE}x${SIZE}/apps/${APP_ID}.png"
  if [ -f "$icon" ]; then
    actual=$(identify -format "%wx%h" "$icon" 2>/dev/null) || actual="UNREADABLE"
    expected="${SIZE}x${SIZE}"
    if [ "$actual" = "$expected" ]; then
      pass "hicolor ${SIZE}x${SIZE}/apps/${APP_ID}.png is ${expected}"
    else
      fail "hicolor ${SIZE}x${SIZE}/apps/${APP_ID}.png expected ${expected} but got ${actual}"
    fi
  else
    fail "hicolor ${SIZE}x${SIZE}/apps/${APP_ID}.png MISSING"
  fi
done

# Scalable SVG
scalable="$HICOLOR_DIR/scalable/apps/${APP_ID}.svg"
if [ -f "$scalable" ]; then
  pass "scalable SVG exists: ${APP_ID}.svg"
else
  fail "scalable SVG MISSING: $scalable"
fi

# Symbolic SVG
symbolic="$HICOLOR_DIR/symbolic/apps/${APP_ID}-symbolic.svg"
if [ -f "$symbolic" ]; then
  pass "symbolic SVG exists: ${APP_ID}-symbolic.svg"
else
  fail "symbolic SVG MISSING: $symbolic"
fi

# ── 6. Linux .desktop file ──────────────────────────────────────────────
echo ""
echo "--> 6. Verifying Linux .desktop templates"

DESKTOP_TEMPLATE="$REPO_ROOT/apps/desktop/src-tauri/linux/${APP_ID}.desktop"
DESKTOP_INSTALLED="$REPO_ROOT/apps/desktop/src-tauri/linux/${APP_ID}.installed.desktop"

for df in "$DESKTOP_TEMPLATE" "$DESKTOP_INSTALLED"; do
  base=$(basename "$df")
  if [ -f "$df" ]; then
    if grep -q "^Icon=${APP_ID}" "$df" 2>/dev/null; then
      pass "$base has Icon=${APP_ID}"
    else
      fail "$base missing Icon=${APP_ID}"
    fi
    if grep -q "StartupWMClass=${APP_ID}" "$df" 2>/dev/null || grep -q "StartupWMClass=varve-desktop" "$df" 2>/dev/null; then
      pass "$base has StartupWMClass"
    else
      fail "$base missing StartupWMClass"
    fi
  else
    fail "$base MISSING"
  fi
done

# ── 7. No stale strata.png files ────────────────────────────────────────
echo ""
echo "--> 7. Checking for stale strata.png files"

stale=$(find "$HICOLOR_DIR" -name "strata.png" 2>/dev/null)
if [ -z "$stale" ]; then
  pass "No stale strata.png files in hicolor"
else
  fail "Found stale strata.png files:"
  echo "$stale" | while IFS= read -r f; do echo "       $f"; done
fi

# ── 8. App identifier consistency ───────────────────────────────────────
echo ""
echo "--> 8. Verifying app identifier consistency"

CONF_ID=$(python3 -c "
import json
with open('$TAURI_CONF') as f:
    print(json.load(f).get('identifier', ''))
" 2>/dev/null) || true

if [ "$CONF_ID" = "$APP_ID" ]; then
  pass "tauri.conf.json identifier matches hicolor naming: ${APP_ID}"
else
  fail "tauri.conf.json identifier is '${CONF_ID}' but hicolor uses '${APP_ID}'"
fi

# ── 9. Dev-mode installation check ──────────────────────────────────────
echo ""
echo "--> 9. Checking dev-mode icon installation"

USER_APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
USER_ICONS="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"

dev_desktop="$USER_APPS/${APP_ID}.desktop"
if [ -f "$dev_desktop" ]; then
  pass "Dev desktop entry installed: $dev_desktop"
else
  fail "Dev desktop entry NOT installed. Run: just install-dev-icons"
fi

dev_icon="$USER_ICONS/32x32/apps/${APP_ID}.png"
if [ -f "$dev_icon" ]; then
  pass "Dev hicolor icons installed (e.g. $dev_icon)"
else
  warn "Dev hicolor icons NOT installed. Run: just install-dev-icons"
fi

echo ""
if [ "$errors" -eq 0 ]; then
  echo -e "${green}All checks passed.${nc}"
else
  echo -e "${red}$errors check(s) FAILED.${nc}"
  exit 1
fi
