#!/usr/bin/env bash
# Install FreeDesktop desktop entry + hicolor icons for local tauri:dev.
# On KDE Plasma + Wayland the window icon comes from matching app_id →
# ~/.local/share/applications/<app_id>.desktop → Icon= → hicolor theme.
#
# Usage (from repo root): just install-dev-icons
# Master art: packages/ui/src/icons/varve-app-icon.svg (via hicolor ladder)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP_ID="dev.varve.desktop"
ICON_SRC="$REPO_ROOT/apps/desktop/src-tauri/icons/hicolor"
DESKTOP_SRC="$REPO_ROOT/apps/desktop/src-tauri/linux/${APP_ID}.installed.desktop"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"

if [[ ! -d "$ICON_SRC" ]]; then
  echo "ERROR: hicolor icons missing at $ICON_SRC"
  echo "Run: just generate-icons"
  exit 1
fi

if [[ ! -f "$DESKTOP_SRC" ]]; then
  echo "ERROR: desktop entry missing at $DESKTOP_SRC"
  exit 1
fi

mkdir -p "$DATA_HOME" 2>/dev/null || true
if [[ ! -w "$DATA_HOME" ]]; then
  echo "ERROR: cannot write to $DATA_HOME"
  echo "If icons/ is root-owned (common after sudo installs), fix with:"
  echo "  sudo chown -R \"\$USER:\$USER\" \"$DATA_HOME/icons\" \"$DATA_HOME/applications\""
  exit 1
fi

mkdir -p "$APPS_DIR" "$ICONS_DIR"

echo "==> Installing hicolor icons → $ICONS_DIR"
errors=0
while IFS= read -r -d '' src; do
  rel="${src#"$ICON_SRC"/}"
  dest="$ICONS_DIR/$rel"
  if ! mkdir -p "$(dirname "$dest")" 2>/dev/null; then
    echo "  WARN: cannot create $(dirname "$dest")"
    errors=$((errors + 1))
    continue
  fi
  if ! cp -f "$src" "$dest" 2>/dev/null; then
    echo "  WARN: cannot copy $rel"
    errors=$((errors + 1))
    continue
  fi
done < <(find "$ICON_SRC" -type f \( -name "${APP_ID}.png" -o -name "${APP_ID}.svg" -o -name "${APP_ID}-symbolic.svg" \) -print0)

if [[ "$errors" -gt 0 ]]; then
  echo "ERROR: failed to install $errors icon file(s)."
  echo "Fix ownership then re-run:"
  echo "  sudo chown -R \"\$USER:\$USER\" \"${XDG_DATA_HOME:-$HOME/.local/share}/icons\""
  exit 1
fi

echo "==> Installing desktop entry → $APPS_DIR/${APP_ID}.desktop"
cp -f "$DESKTOP_SRC" "$APPS_DIR/${APP_ID}.desktop"

# Alias for Cargo binary app_id fallback (varve-desktop) — NoDisplay so menus stay single.
{
  echo "[Desktop Entry]"
  echo "Name=Varve"
  echo "GenericName=Design Tool"
  echo "Comment=Local-first, cross-platform design suite"
  echo "Exec=varve-desktop %F"
  echo "Icon=${APP_ID}"
  echo "Type=Application"
  echo "Categories=Graphics;2DGraphics;VectorGraphics;"
  echo "Keywords=design;ui;vector;graphics;print;"
  echo "Terminal=false"
  echo "StartupNotify=true"
  echo "StartupWMClass=varve-desktop"
  echo "MimeType=application/x-varve;application/x-strata;"
  echo "NoDisplay=true"
} > "$APPS_DIR/varve-desktop.desktop"

echo "==> Refreshing icon / desktop caches"
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$ICONS_DIR" 2>/dev/null || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" 2>/dev/null || true
fi
if command -v kbuildsycoca6 >/dev/null 2>&1; then
  kbuildsycoca6 --noincremental 2>/dev/null || true
elif command -v kbuildsycoca5 >/dev/null 2>&1; then
  kbuildsycoca5 --noincremental 2>/dev/null || true
fi

echo ""
echo "==> Done."
echo "    Desktop: $APPS_DIR/${APP_ID}.desktop"
echo "    Icons:   $ICONS_DIR/.../apps/${APP_ID}.{png,svg}"
echo ""
echo "    Restart or re-run: pnpm tauri:dev"
echo "    Verify Wayland app_id via KDE System Settings → Window Rules → Detect Window Properties"
echo "    Expected Window class / app_id: ${APP_ID} (Rust sets glib prgname on Linux)"
