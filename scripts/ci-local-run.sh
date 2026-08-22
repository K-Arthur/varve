#!/usr/bin/env bash
# Varve local GitHub Actions runner wrapper.
# Research basis: nektos/act (https://github.com/nektos/act) with catthehacker images.
#
# Usage:
#   scripts/ci-local-run.sh list
#   scripts/ci-local-run.sh run <job> [flags]
#   scripts/ci-local-run.sh dry-run <workflow>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACT_BIN="${ACT_BIN:-act}"
ACT_IMAGE="${ACT_IMAGE:-catthehacker/ubuntu:act-latest}"
SECRET_FILE="${REPO_ROOT}/.act-secrets"
ACT_MIN_VERSION="0.2.89"

act_version() {
  "${ACT_BIN}" --version 2>/dev/null |
    sed -nE 's/.*act version ([0-9]+(\.[0-9]+){2}).*/\1/p' |
    head -n 1
}

act_version_is_supported() {
  local installed="$1"
  [[ -n "${installed}" ]] || return 1
  [[ "$(printf '%s\n' "${ACT_MIN_VERSION}" "${installed}" | sort -V | tail -n 1)" = "${installed}" ]]
}

ensure_act() {
  if ! command -v "${ACT_BIN}" >/dev/null 2>&1; then
    echo "act is not installed. Install it with:"
    echo "  sudo pacman -S act    # AUR helper on Arch/CachyOS"
    echo "  or download from https://github.com/nektos/act/releases"
    exit 1
  fi

  local installed
  installed="$(act_version)"
  if ! act_version_is_supported "${installed}"; then
    echo "act ${ACT_MIN_VERSION} or newer is required (found ${installed:-unknown})."
    echo "Upgrade act from https://github.com/nektos/act/releases or with: yay -S act"
    echo "The current workflows use Node 24 actions, which older act releases cannot parse."
    exit 1
  fi
}

ensure_secrets() {
  if [[ -f "${SECRET_FILE}" ]]; then
    return 0
  fi
  cat > "${SECRET_FILE}" <<'EOF'
# GitHub Actions secrets for local act runs.
# GITHUB_TOKEN=<your-token>
EOF
  echo "Created secret stub at ${SECRET_FILE}. Add GITHUB_TOKEN to run workflows that need API access."
}

cmd="${1:-list}"

case "${cmd}" in
  list | ls)
    ensure_act
    "${ACT_BIN}" --list \
      -P "ubuntu-latest=${ACT_IMAGE}"
    ;;

  run)
    job="${2:-js}"
    shift 2 || true
    ensure_act
    ensure_secrets
    "${ACT_BIN}" --job "${job}" \
      -P "ubuntu-latest=${ACT_IMAGE}" \
      --secret-file "${SECRET_FILE}" \
      "$@"
    ;;

  dry-run | dry)
    workflow="${2:-.github/workflows/build.yml}"
    ensure_act
    "${ACT_BIN}" -n \
      -W "${REPO_ROOT}/${workflow}" \
      -P "ubuntu-latest=${ACT_IMAGE}"
    ;;

  *)
    echo "Usage: $0 {list|run <job>|dry-run <workflow>}"
    exit 1
    ;;
esac
