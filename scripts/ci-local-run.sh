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

ensure_act() {
  if ! command -v "${ACT_BIN}" >/dev/null 2>&1; then
    echo "act is not installed. Install it with:"
    echo "  sudo pacman -S act    # AUR helper on Arch/CachyOS"
    echo "  or download from https://github.com/nektos/act/releases"
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
