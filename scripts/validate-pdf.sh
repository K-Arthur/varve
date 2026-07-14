#!/usr/bin/env bash
# Reproducible PDF/A and PDF/X validation using veraPDF
#
# Usage:
#   ./scripts/validate-pdf.sh <pdf-file> [profile] [output-format]
#
# Profiles:
#   a1b    - PDF/A-1b (default)
#   a2b    - PDF/A-2b
#   a3b    - PDF/A-3b
#   x1a    - PDF/X-1a
#   x4     - PDF/X-4
#
# Output format:
#   text   - Human-readable (default)
#   xml    - Machine-readable XML
#   json   - Machine-readable JSON
#
# Exit codes:
#   0 - PDF is valid for the chosen profile
#   1 - veraPDF not found
#   2 - Invalid PDF or validation failure
#   3 - Invalid arguments

set -euo pipefail

VERAPDF_CMD="${VERAPDF_CMD:-verapdf}"
VALIDATOR_DIR="${VALIDATOR_DIR:-}"
PROFILE="${2:-a1b}"
OUTPUT_FORMAT="${3:-text}"

# Try to find veraPDF
if command -v "$VERAPDF_CMD" &>/dev/null; then
    VERAPDF="$VERAPDF_CMD"
elif [ -n "$VALIDATOR_DIR" ] && [ -f "$VALIDATOR_DIR/verapdf" ]; then
    VERAPDF="$VALIDATOR_DIR/verapdf"
else
    echo "ERROR: veraPDF not found on PATH or at VERAPDF_CMD/VERIFIED_DIR."
    echo ""
    echo "Install veraPDF:"
    echo "  Linux:   Download from https://github.com/veraPDF/veraPDF-apps/releases"
    echo "  macOS:   brew install verapdf"
    echo "  Docker:  docker pull openpreserve/verapdf"
    echo ""
    echo "Or use Docker:"
    echo "  docker run --rm -v $(pwd):/pdfs openpreserve/verapdf verapdf /pdfs/<file>"
    exit 1
fi

PDF_FILE="$1"
if [ ! -f "$PDF_FILE" ]; then
    echo "ERROR: PDF file not found: $PDF_FILE"
    exit 2
fi

# Map profile names to veraPDF flags
case "$PROFILE" in
    a1b)   PROFILE_FLAG="--profile 1b" ;;
    a2b)   PROFILE_FLAG="--profile 2b" ;;
    a3b)   PROFILE_FLAG="--profile 3b" ;;
    x1a)   PROFILE_FLAG="--profile x1a" ;;
    x4)    PROFILE_FLAG="--profile x4" ;;
    *)
        echo "ERROR: Unknown profile: $PROFILE"
        echo "Valid profiles: a1b, a2b, a3b, x1a, x4"
        exit 3
        ;;
esac

OUTPUT_FLAG=""
case "$OUTPUT_FORMAT" in
    text) OUTPUT_FLAG="" ;;
    xml)  OUTPUT_FLAG="--format mrr" ;;
    json) OUTPUT_FLAG="--format json" ;;
esac

echo "Validating: $PDF_FILE"
echo "Profile:    $PROFILE"
echo ""

# Run veraPDF
if [ "$OUTPUT_FORMAT" = "text" ]; then
    "$VERAPDF" $PROFILE_FLAG "$PDF_FILE" 2>&1 || {
        EXIT_CODE=$?
        if [ "$EXIT_CODE" -ne 0 ]; then
            echo ""
            echo "VALIDATION FAILED (exit code: $EXIT_CODE)"
            exit 2
        fi
    }
else
    "$VERAPDF" $PROFILE_FLAG $OUTPUT_FLAG "$PDF_FILE" 2>/dev/null || {
        echo "VALIDATION FAILED"
        exit 2
    }
fi

echo ""
echo "VALIDATION PASSED"
exit 0
