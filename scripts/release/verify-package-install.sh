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
#   ./scripts/release/verify-package-install.sh --bundle-dir <dir>   # CI: downloaded artifacts
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUNDLE_DIR="${REPO_ROOT}/apps/desktop/src-tauri/target/release/bundle"

DEB_ONLY=0
RPM_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --deb-only) DEB_ONLY=1; shift ;;
    --rpm-only) RPM_ONLY=1; shift ;;
    --bundle-dir)
      shift
      BUNDLE_DIR="$(realpath "$1")"
      shift
      ;;
    --bundle-dir=*)
      BUNDLE_DIR="$(realpath "${1#*=}")"
      shift
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Compatibility baselines, not "latest". Testing on the newest Ubuntu would
# prove nothing about the oldest release we claim to support.
DEB_IMAGE="ubuntu:22.04"
RPM_IMAGE="fedora:38"

FAILURES=0
pass() { printf '    \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '    \033[31mFAIL\033[0m  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
info() { printf '    ....  %s\n' "$1"; }

# Prefer podman: it runs rootless by default, so it needs neither a root daemon
# nor membership of a group that is equivalent to root. Falls back to docker.
if command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
  RUNTIME=podman
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  RUNTIME=docker
else
  cat >&2 <<'EOF'
No usable container runtime.

  podman (recommended — rootless, no daemon, no privileged group):
      sudo pacman -S podman
      podman run --rm hello-world

  docker:
      sudo systemctl enable --now docker.socket
      sudo usermod -aG docker "$USER"
      newgrp docker      # the group is not active until you re-login

Note the `docker` group is effectively root: the daemon runs as root and will
bind-mount any path you ask it to. podman avoids that entirely.
EOF
  exit 1
fi

find_artifact() {
  find "${BUNDLE_DIR}" -maxdepth 2 -name "$1" -type f 2>/dev/null | head -1
}

# Tauri names bundles with a space ("Varve_0.1.0_amd64.deb"). podman's
# -v argument parser rejects that outright ("names must match [a-zA-Z0-9]..."),
# so stage a space-free copy rather than fighting the quoting.
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT
stage_artifact() {
  local src="$1" dest="${STAGE}/$2"
  cp "${src}" "${dest}"
  printf '%s' "${dest}"
}

verify_staged_license_payload() {
  local dir="$1"
  if node "${REPO_ROOT}/scripts/release/verify-license-payload.mjs" --resource-root "${dir}"; then
    pass "installed license payload matches source"
  else
    fail "installed license payload is incomplete or changed"
  fi
}

# ── The container-side script. Kept as one heredoc per format so the whole
#    check runs in a single container start rather than a dozen. ──────────────
run_deb_test() {
  local deb="$1"
  local license_output="${STAGE}/deb-license-payload"
  mkdir -p "${license_output}"
  echo
  echo "══ .deb on ${DEB_IMAGE} (glibc baseline) ══"
  info "$(basename "${deb}")"

  local out
  out=$("${RUNTIME}" run --rm -i \
    -v "$(stage_artifact "${deb}" pkg.deb):/tmp/pkg.deb:ro" \
    -v "${license_output}:/license-output" \
    "${DEB_IMAGE}" bash -s <<'CONTAINER'
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
say() { echo "MARK|$1|$2"; }

echo "MARK|glibc-available|$(ldd --version | head -1 | grep -oE '[0-9]+\.[0-9]+$')"

apt-get update -qq >/dev/null 2>&1 || { say deps-update FAIL; exit 1; }

# `apt-get install ./file.deb` resolves declared dependencies from the distro
# repositories — the same path a user takes, and the one that proves the
# `depends` list in tauri.conf.json is both correct and satisfiable on 22.04.
apt-get install -y -qq binutils >/dev/null 2>&1   # objdump, for the glibc check
if apt-get install -y -qq /tmp/pkg.deb >/tmp/install.log 2>&1; then
  say install PASS
else
  say install FAIL
  tail -20 /tmp/install.log | sed 's/^/    | /'
  exit 1
fi

# Tauri installs resources under /usr/lib/<productName> on Linux and maps each
# `..` source path segment to `_up_` in the resource directory. Copy the actual
# installed payload out so the host verifier checks the exact packaged path.
RESOURCE_ROOT=/usr/lib/Varve
LICENSE_DIR="$RESOURCE_ROOT/_up_/_up_/_up_"
if [ ! -d "$LICENSE_DIR" ]; then
  say license-payload-staged "FAIL: missing $LICENSE_DIR"
  exit 1
fi
mkdir -p /license-output/_up_/_up_/_up_/THIRD_PARTY_LICENSES
for file in LICENSE NOTICE THIRD_PARTY_NOTICES; do
  if ! cp "$LICENSE_DIR/$file" /license-output/_up_/_up_/_up_/; then
    say license-payload-staged "FAIL: missing $LICENSE_DIR/$file"
    exit 1
  fi
done
if ! cp -R "$LICENSE_DIR/THIRD_PARTY_LICENSES/." /license-output/_up_/_up_/_up_/THIRD_PARTY_LICENSES/; then
  say license-payload-staged "FAIL: missing $LICENSE_DIR/THIRD_PARTY_LICENSES"
  exit 1
fi
say license-payload-staged PASS

BIN=$(dpkg -L "$(dpkg-deb -f /tmp/pkg.deb Package)" 2>/dev/null | grep -E '/usr/bin/' | head -1)
[ -n "$BIN" ] && say binary-path "$BIN" || say binary-path MISSING

if [ -n "$BIN" ]; then
  # The actual compatibility question: which glibc symbol versions does this
  # binary demand, and does this distro have them?
  NEED=$(objdump -T "$BIN" 2>/dev/null | grep -oE 'GLIBC_[0-9]+\.[0-9]+' | sort -uV | tail -1)
  say glibc-required "${NEED:-unknown}"

  # Two distinct failures share the words "not found":
  #   a missing library      "libfoo.so.1 => not found"
  #   a too-old glibc        "<bin>: libc.so.6: version `GLIBC_2.39' not found"
  # Report the whole line; the reason is the useful part.
  PROBLEM=$(ldd "$BIN" 2>&1 | grep 'not found' | head -2 | tr '\n' '; ')
  if [ -z "$PROBLEM" ]; then say ldd PASS; else say ldd "FAIL: ${PROBLEM}"; fi
fi

for f in /usr/share/applications/*.desktop; do [ -e "$f" ] && say desktop-entry "$(basename "$f")"; done
[ -e /usr/share/mime/packages/dev.varve.desktop.xml ] && say mime PASS || say mime MISSING
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
  verify_staged_license_payload "${license_output}"
}

run_rpm_test() {
  local rpm="$1"
  local license_output="${STAGE}/rpm-license-payload"
  mkdir -p "${license_output}"
  echo
  echo "══ .rpm on ${RPM_IMAGE} ══"
  info "$(basename "${rpm}")"

  local out
  out=$("${RUNTIME}" run --rm -i \
    -v "$(stage_artifact "${rpm}" pkg.rpm):/tmp/pkg.rpm:ro" \
    -v "${license_output}:/license-output" \
    "${RPM_IMAGE}" bash -s <<'CONTAINER'
set -uo pipefail
say() { echo "MARK|$1|$2"; }

echo "MARK|glibc-available|$(ldd --version | head -1 | grep -oE '[0-9]+\.[0-9]+$')"

dnf install -y -q binutils >/dev/null 2>&1        # objdump, for the glibc check
if dnf install -y -q /tmp/pkg.rpm >/tmp/install.log 2>&1; then
  say install PASS
else
  say install FAIL
  tail -20 /tmp/install.log | sed 's/^/    | /'
  exit 1
fi

RESOURCE_ROOT=/usr/lib/Varve
LICENSE_DIR="$RESOURCE_ROOT/_up_/_up_/_up_"
if [ ! -d "$LICENSE_DIR" ]; then
  say license-payload-staged "FAIL: missing $LICENSE_DIR"
  exit 1
fi
mkdir -p /license-output/_up_/_up_/_up_/THIRD_PARTY_LICENSES
for file in LICENSE NOTICE THIRD_PARTY_NOTICES; do
  if ! cp "$LICENSE_DIR/$file" /license-output/_up_/_up_/_up_/; then
    say license-payload-staged "FAIL: missing $LICENSE_DIR/$file"
    exit 1
  fi
done
if ! cp -R "$LICENSE_DIR/THIRD_PARTY_LICENSES/." /license-output/_up_/_up_/_up_/THIRD_PARTY_LICENSES/; then
  say license-payload-staged "FAIL: missing $LICENSE_DIR/THIRD_PARTY_LICENSES"
  exit 1
fi
say license-payload-staged PASS

PKG=$(rpm -qp --qf '%{NAME}' /tmp/pkg.rpm 2>/dev/null)
BIN=$(rpm -ql "$PKG" 2>/dev/null | grep -E '/usr/bin/' | head -1)
[ -n "$BIN" ] && say binary-path "$BIN" || say binary-path MISSING

if [ -n "$BIN" ]; then
  NEED=$(objdump -T "$BIN" 2>/dev/null | grep -oE 'GLIBC_[0-9]+\.[0-9]+' | sort -uV | tail -1)
  say glibc-required "${NEED:-unknown}"
  # Two distinct failures share the words "not found":
  #   a missing library      "libfoo.so.1 => not found"
  #   a too-old glibc        "<bin>: libc.so.6: version `GLIBC_2.39' not found"
  # Report the whole line; the reason is the useful part.
  PROBLEM=$(ldd "$BIN" 2>&1 | grep 'not found' | head -2 | tr '\n' '; ')
  if [ -z "$PROBLEM" ]; then say ldd PASS; else say ldd "FAIL: ${PROBLEM}"; fi
fi

ls /usr/share/applications/*.desktop >/dev/null 2>&1 && say desktop-entry PASS || say desktop-entry MISSING
[ -e /usr/share/mime/packages/dev.varve.desktop.xml ] && say mime PASS || say mime MISSING

dnf remove -y -q "$PKG" >/dev/null 2>&1 && say uninstall PASS || say uninstall FAIL
CONTAINER
  )

  parse_marks "$out"
  verify_staged_license_payload "${license_output}"
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
echo "  runtime:    ${RUNTIME}"
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
