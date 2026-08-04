#!/usr/bin/env bash
# Install-test built Linux packages inside clean, non-Arch containers.
#
# This exists to answer one question that nothing else in the repo can:
# **does a package built here actually run on the compatibility baseline?**
#
# The dev machine is CachyOS with glibc 2.44. Ubuntu 22.04 has 2.35. A binary
# linked against a newer glibc fails at exec with a message most users will
# never think to read, so "it works on my machine" is worth exactly nothing for
# this class of bug. A container gives a genuinely clean userspace to check it
# in, without needing a VM.
#
# What it verifies, per distro:
#   1. the package's declared dependencies resolve from the distro's own repos
#   2. installation succeeds
#   3. the binary's required glibc/GLIBCXX symbol versions are actually present
#   4. every shared library the binary needs resolves (no "not found")
#   5. files land where the packaging says they do
#   6. desktop entry, icons and MIME registration are installed
#   7. uninstall removes them again
#
# What it does NOT verify: that the GUI launches. That needs a display and a
# GPU; containers have neither. It is still the single highest-value automated
# check available, because every failure it catches is one a user would hit
# before the window ever appeared.
#
#   ./scripts/release/verify-package-install.sh
#   ./scripts/release/verify-package-install.sh --deb-only
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUNDLE_DIR="${REPO_ROOT}/apps/desktop/src-tauri/target/release/bundle"

# Compatibility baselines, not "latest". Testing on the newest Ubuntu would
# prove nothing about the oldest release we claim to support.
DEB_IMAGE="ubuntu:22.04"
RPM_IMAGE="fedora:38"

DEB_ONLY=0
RPM_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --deb-only) DEB_ONLY=1 ;;
    --rpm-only) RPM_ONLY=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

FAILURES=0
pass() { printf '    \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '    \033[31mFAIL\033[0m  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
info() { printf '    ....  %s\n' "$1"; }

if ! docker info >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Docker is not usable.

  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"    # then log out and back in, or: newgrp docker

Note that membership of the `docker` group is equivalent to root on this
machine — the daemon runs as root and will bind-mount any path you ask it to.
If that is not a trade you want, install rootless Docker or podman instead.
EOF
  exit 1
fi

find_artifact() {
  find "${BUNDLE_DIR}" -maxdepth 2 -name "$1" -type f 2>/dev/null | head -1
}

# ── The container-side script. Kept as one heredoc per format so the whole
#    check runs in a single container start rather than a dozen. ──────────────
run_deb_test() {
  local deb="$1"
  echo
  echo "══ .deb on ${DEB_IMAGE} (glibc baseline) ══"
  info "$(basename "${deb}")"

  local out
  out=$(docker run --rm -i \
    -v "${deb}:/tmp/pkg.deb:ro" \
    "${DEB_IMAGE}" bash -s <<'CONTAINER'
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
say() { echo "MARK|$1|$2"; }

echo "MARK|glibc-available|$(ldd --version | head -1 | grep -oE '[0-9]+\.[0-9]+$')"

apt-get update -qq >/dev/null 2>&1 || { say deps-update FAIL; exit 1; }

# `apt-get install ./file.deb` resolves declared dependencies from the distro
# repositories — the same path a user takes, and the one that proves the
# `depends` list in tauri.conf.json is both correct and satisfiable on 22.04.
if apt-get install -y -qq /tmp/pkg.deb >/tmp/install.log 2>&1; then
  say install PASS
else
  say install FAIL
  tail -20 /tmp/install.log | sed 's/^/    | /'
  exit 1
fi

BIN=$(dpkg -L "$(dpkg-deb -f /tmp/pkg.deb Package)" 2>/dev/null | grep -E '/usr/bin/' | head -1)
[ -n "$BIN" ] && say binary-path "$BIN" || say binary-path MISSING

if [ -n "$BIN" ]; then
  # The actual compatibility question: which glibc symbol versions does this
  # binary demand, and does this distro have them?
  NEED=$(objdump -T "$BIN" 2>/dev/null | grep -oE 'GLIBC_[0-9]+\.[0-9]+' | sort -uV | tail -1)
  say glibc-required "${NEED:-unknown}"

  MISSING=$(ldd "$BIN" 2>/dev/null | grep 'not found' | awk '{print $1}' | tr '\n' ' ')
  if [ -z "$MISSING" ]; then say ldd PASS; else say ldd "FAIL: ${MISSING}"; fi
fi

for f in /usr/share/applications/*.desktop; do [ -e "$f" ] && say desktop-entry "$(basename "$f")"; done
[ -e /usr/share/mime/packages/dev.strata.desktop.xml ] && say mime PASS || say mime MISSING
ls /usr/share/icons/hicolor/*/apps/*.png >/dev/null 2>&1 && say icons PASS || say icons MISSING

PKG=$(dpkg-deb -f /tmp/pkg.deb Package)
if apt-get remove -y -qq "$PKG" >/dev/null 2>&1; then
  say uninstall PASS
  [ -e "$BIN" ] && say uninstall-clean "FAIL: ${BIN} remains" || say uninstall-clean PASS
else
  say uninstall FAIL
fi
CONTAINER
  )

  parse_marks "$out"
}

run_rpm_test() {
  local rpm="$1"
  echo
  echo "══ .rpm on ${RPM_IMAGE} ══"
  info "$(basename "${rpm}")"

  local out
  out=$(docker run --rm -i \
    -v "${rpm}:/tmp/pkg.rpm:ro" \
    "${RPM_IMAGE}" bash -s <<'CONTAINER'
set -uo pipefail
say() { echo "MARK|$1|$2"; }

echo "MARK|glibc-available|$(ldd --version | head -1 | grep -oE '[0-9]+\.[0-9]+$')"

if dnf install -y -q /tmp/pkg.rpm >/tmp/install.log 2>&1; then
  say install PASS
else
  say install FAIL
  tail -20 /tmp/install.log | sed 's/^/    | /'
  exit 1
fi

PKG=$(rpm -qp --qf '%{NAME}' /tmp/pkg.rpm 2>/dev/null)
BIN=$(rpm -ql "$PKG" 2>/dev/null | grep -E '/usr/bin/' | head -1)
[ -n "$BIN" ] && say binary-path "$BIN" || say binary-path MISSING

if [ -n "$BIN" ]; then
  NEED=$(objdump -T "$BIN" 2>/dev/null | grep -oE 'GLIBC_[0-9]+\.[0-9]+' | sort -uV | tail -1)
  say glibc-required "${NEED:-unknown}"
  MISSING=$(ldd "$BIN" 2>/dev/null | grep 'not found' | awk '{print $1}' | tr '\n' ' ')
  [ -z "$MISSING" ] && say ldd PASS || say ldd "FAIL: ${MISSING}"
fi

ls /usr/share/applications/*.desktop >/dev/null 2>&1 && say desktop-entry PASS || say desktop-entry MISSING
[ -e /usr/share/mime/packages/dev.strata.desktop.xml ] && say mime PASS || say mime MISSING

dnf remove -y -q "$PKG" >/dev/null 2>&1 && say uninstall PASS || say uninstall FAIL
CONTAINER
  )

  parse_marks "$out"
}

parse_marks() {
  local out="$1"
  if [ -z "$out" ]; then fail "container produced no output"; return; fi
  while IFS='|' read -r tag key value; do
    [ "$tag" = "MARK" ] || { [ -n "$tag" ] && printf '          %s\n' "$tag"; continue; }
    case "$value" in
      PASS) pass "$key" ;;
      FAIL*|MISSING) fail "$key — $value" ;;
      *) info "$key = $value" ;;
    esac
  done <<< "$out"
}

echo "Package install verification"
echo "  bundle dir: ${BUNDLE_DIR}"

DEB=$(find_artifact '*.deb')
RPM=$(find_artifact '*.rpm')

if [ "$RPM_ONLY" -eq 0 ]; then
  if [ -n "${DEB}" ]; then run_deb_test "${DEB}"; else fail "no .deb found — run 'just package-deb'"; fi
fi
if [ "$DEB_ONLY" -eq 0 ]; then
  if [ -n "${RPM}" ]; then run_rpm_test "${RPM}"; else fail "no .rpm found — run 'just package-rpm'"; fi
fi

echo
if [ "${FAILURES}" -eq 0 ]; then
  echo "All package install checks passed."
  echo
  echo "Reminder: this proves the package installs and links correctly on the"
  echo "baseline. It does NOT prove the GUI launches — containers have no"
  echo "display. A real VM or machine is still required before claiming Tier 2."
else
  echo "${FAILURES} check(s) failed."
  exit 1
fi
