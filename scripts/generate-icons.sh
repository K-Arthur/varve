#!/usr/bin/env bash
# Compatibility shim — launcher icons are generated exclusively from
# packages/ui/src/icons/strata-app-icon.svg via apps/desktop/build-icons.sh.
# Prefer: just generate-icons
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$REPO_ROOT/apps/desktop/build-icons.sh"
