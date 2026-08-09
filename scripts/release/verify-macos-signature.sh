#!/usr/bin/env bash
# Verify a macOS artifact's Developer ID signature, notarization and stapled
# ticket by inspecting the actual artifact bytes (not the build log).
#
# Runs, against the DMG and the .app inside it:
#   codesign --verify --deep --strict   nested code + signature validity
#   codesign -dv                        Team ID, hardened-runtime flag, authority
#   spctl -a -t exec -vv                Gatekeeper assessment (notarization)
#   xcrun stapler validate              stapled ticket on .app and .dmg
#
# Output: a machine-readable JSON report consumed by the release pipeline:
#   {
#     "platform": "macos",
#     "artifact": "Varve-0.1.0-macos-aarch64.dmg",
#     "signed": true,
#     "notarized": true,
#     "stapled": true,
#     "hardenedRuntime": true,
#     "teamId": "XXXXXXXXXX",
#     "publisher": "Developer ID Application: ...",
#     "details": ["..."],
#     "checkedAt": "..."
#   }
#
# Exit codes:
#   0 — verification passed (signed+notarized+stapled, or honestly unsigned
#       when --expect-signed is not given)
#   1 — signature INVALID (present but failing)
#   2 — signing was expected (--expect-signed) but the artifact is unsigned
#   3 — verification tooling failure
#
# Usage:
#   bash scripts/release/verify-macos-signature.sh \
#     --dmg /path/to/Varve-0.1.0-macos-aarch64.dmg \
#     [--expect-signed] [--report /path/to/report.json]
set -euo pipefail

DMG=""
EXPECT_SIGNED=0
REPORT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dmg) DMG="$2"; shift 2 ;;
    --expect-signed) EXPECT_SIGNED=1; shift ;;
    --report) REPORT="$2"; shift 2 ;;
    *) echo "::error::Unknown argument: $1" >&2; exit 3 ;;
  esac
done

if [[ -z "$DMG" || ! -f "$DMG" ]]; then
  echo "::error::DMG not found: ${DMG:-<empty>}" >&2
  exit 3
fi

REPORT_JSON=""
fail_report() { # $1 = exit code
  if [[ -n "$REPORT" ]]; then printf '%s\n' "$REPORT_JSON" > "$REPORT"; fi
  exit "$1"
}

run_checked() { # $1 label, rest command
  local label="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    echo "  $label: PASSED"
    return 0
  else
    echo "  $label: FAILED"
    echo "$out" | sed 's/^/    /'
    return 1
  fi
}

echo "Verifying $DMG"
MOUNT_POINT="$(mktemp -d /tmp/varve-verify.XXXXXX)"
trap 'hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true; rm -rf "$MOUNT_POINT"' EXIT

if ! hdiutil attach "$DMG" -nobrowse -mountpoint "$MOUNT_POINT" >/dev/null 2>&1; then
  echo "::error::hdiutil attach failed for $DMG" >&2
  exit 3
fi
APP="$(find "$MOUNT_POINT" -maxdepth 1 -name '*.app' | head -1)"
if [[ -z "$APP" ]]; then
  echo "::error::No .app bundle inside $DMG" >&2
  exit 3
fi

DETAILS=()
SIGNED=0
NOTARIZED=0
STAPLED=0
HARDENED=0
TEAM_ID=""
PUBLISHER=""

# ── 1. Signature validity + nested code ────────────────────────────────────
if run_checked "codesign --verify --deep --strict" codesign --verify --deep --strict --verbose=2 "$APP"; then
  SIGNED=1
  DETAILS+=("codesign --verify --deep --strict: PASSED")
else
  DETAILS+=("codesign --verify --deep --strict: FAILED")
fi

# ── 2. Signature details: authority, Team ID, hardened runtime ─────────────
DV_OUT="$(codesign -dv --verbose=4 "$APP" 2>&1 || true)"
TEAM_ID="$(echo "$DV_OUT" | sed -n 's/^TeamIdentifier=//p' | head -1)"
if echo "$DV_OUT" | grep -q 'flags=0x10000(runtime)'; then
  HARDENED=1
fi
PUBLISHER="$(echo "$DV_OUT" | grep '^Authority=' | head -1 | sed 's/^Authority=//' || true)"
DETAILS+=("codesign -dv: TeamIdentifier=${TEAM_ID:-none} hardened_runtime=$([ "$HARDENED" = 1 ] && echo yes || echo no)")

# ── 3. Gatekeeper assessment (covers notarization) ─────────────────────────
if spctl_out="$(spctl -a -t exec -vv "$APP" 2>&1)"; then
  NOTARIZED=1
  DETAILS+=("spctl -a -t exec -vv: accepted")
else
  DETAILS+=("spctl -a -t exec -vv: rejected - $spctl_out")
fi

# ── 4. Stapled ticket on .app and .dmg ─────────────────────────────────────
if xcrun stapler validate "$APP" >/dev/null 2>&1; then
  STAPLED=1
  DETAILS+=("stapler validate .app: stapled")
else
  DETAILS+=("stapler validate .app: no ticket")
fi
DMG_STAPLED=0
if xcrun stapler validate "$DMG" >/dev/null 2>&1; then
  DMG_STAPLED=1
  DETAILS+=("stapler validate .dmg: stapled")
else
  DETAILS+=("stapler validate .dmg: no ticket")
fi
# Notarization tickets are stapled to the DMG by Tauri; if only the .app has
# one, the shipped DMG is not stapled.
[[ "$DMG_STAPLED" = 1 ]] && STAPLED=1

if ! command -v jq >/dev/null 2>&1; then
  echo "::error::jq is required to emit the machine-readable report (preinstalled on GitHub macOS runners)." >&2
  exit 3
fi
REPORT_JSON="$(jq -n \
  --arg artifact "$(basename "$DMG")" \
  --argjson signed "$SIGNED" \
  --argjson notarized "$NOTARIZED" \
  --argjson stapled "$STAPLED" \
  --argjson hardened "$HARDENED" \
  --arg teamId "${TEAM_ID:-}" \
  --arg publisher "$PUBLISHER" \
  --argjson details "$(printf '%s\0' "${DETAILS[@]}" | jq -R -s -c 'split("\u0000") | map(select(length > 0))')" \
  --arg checkedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{platform: "macos", artifact: $artifact, signed: $signed, notarized: $notarized,
    stapled: $stapled, hardenedRuntime: $hardened, teamId: $teamId, publisher: $publisher,
    details: $details, checkedAt: $checkedAt}')"

echo ""
echo "macOS verification summary:"
echo "  signed:          $SIGNED"
echo "  notarized:       $NOTARIZED"
echo "  stapled:         $STAPLED"
echo "  hardened runtime:$HARDENED"
echo "  team id:         ${TEAM_ID:-<none>}"
echo "  publisher:       ${PUBLISHER:-<none>}"

if [[ "$SIGNED" = 1 && "$NOTARIZED" = 0 ]]; then
  echo "::error::Signature present but not notarized — a signed-but-unnotarized app is not releasable." >&2
  fail_report 1
fi
if [[ "$SIGNED" = 0 ]]; then
  if [[ "$EXPECT_SIGNED" = 1 ]]; then
    echo "::error::Signing was expected but the artifact is unsigned." >&2
    fail_report 2
  fi
  echo "::notice::Artifact is unsigned (allowed when signing is not expected)." >&2
  fail_report 0
fi
if [[ "$STAPLED" = 0 ]]; then
  echo "::error::Notarization ticket is not stapled to the artifact." >&2
  fail_report 1
fi
echo "macOS artifact VERIFIED: signed, notarized, stapled."
fail_report 0
