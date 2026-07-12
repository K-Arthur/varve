#!/usr/bin/env bash
# verify-webgpu.sh — manual WebGPU verification script
#
# Validates that the Strata WebGPU compositor path is exercisable on this
# machine.  Prints a checklist, runs the Playwright WebGPU smoke test, and
# captures a screenshot of the compositor diagnostics overlay.
#
# Usage:
#   ./scripts/verify-webgpu.sh              # full run
#   SKIP_PLAYWRIGHT=1 ./scripts/verify-webgpu.sh  # skip Playwright, manual only
#
# Exit code: 0 if all automated checks pass; non-zero with failure summary.

set -euo pipefail
failures=()

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; failures+=("$1"); }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }

echo "=========================================="
echo "  Strata WebGPU Verification"
echo "=========================================="
echo ""

# ---- Prerequisites ----
echo "--- Prerequisites ---"
if command -v npx &>/dev/null; then
  ok "npx found"
else
  fail "npx not found — install Node.js >= 18"
fi

if npx playwright --version &>/dev/null; then
  ok "Playwright $(npx playwright --version) found"
else
  fail "Playwright not installed — run: npx playwright install chromium"
fi

# ---- Check navigator.gpu via Playwright script ----
echo ""
echo "--- WebGPU API check ---"
GPU_CHECK=$(npx playwright eval --browser chromium \
  --launch-args='--enable-unsafe-swiftshader' \
  'navigator.gpu !== undefined' 2>/dev/null || echo "false")

if [ "$GPU_CHECK" = "true" ]; then
  ok "navigator.gpu available in headless Chromium"
else
  warn "navigator.gpu not available — WebGPU may not be supported in this browser/environment"
  warn "The Playwright smoke test will validate what it can."
fi

# ---- Start dev server ----
echo ""
echo "--- Dev server ---"
if [ -n "${SKIP_PLAYWRIGHT:-}" ]; then
  warn "SKIP_PLAYWRIGHT=1 set — skipping automated tests"
else
  echo "Starting dev server..."
  pnpm --filter @strata/desktop dev &
  DEV_PID=$!
  echo "  Dev server PID: $DEV_PID"
  cleanup() {
    echo ""
    echo "Shutting down dev server..."
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  }
  trap cleanup EXIT

  # Wait for the server to be ready
  for i in $(seq 1 30); do
    if curl -s http://localhost:1420 >/dev/null 2>&1; then
      ok "Dev server ready at http://localhost:1420"
      break
    fi
    if [ "$i" -eq 30 ]; then
      fail "Dev server did not start within 30s"
    fi
    sleep 1
  done

  # ---- Run Playwright WebGPU smoke test ----
  echo ""
  echo "--- Playwright WebGPU smoke test ---"
  PW_OUT=$(mktemp)
  if npx playwright test tests/e2e/webgpu/ \
    --project=chromium \
    --reporter=list 2>&1 | tee "$PW_OUT"; then
    ok "Playwright WebGPU smoke test PASSED"
  else
    fail "Playwright WebGPU smoke test FAILED — see output above"
  fi

  # ---- Screenshot ----
  echo ""
  echo "--- Screenshot ---"
  SS_DIR="webgpu-verification-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$SS_DIR"
  cat > /tmp/webgpu-screenshot.mjs << 'SCRIPT'
import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:1420', { waitUntil: 'networkidle' });
  // Click "New" to open the editor
  const newBtn = page.getByRole('button', { name: /^new$/i });
  await newBtn.waitFor({ timeout: 10000 });
  await newBtn.click();
  const createBtn = page.locator('dialog').getByRole('button', { name: /^create$/i });
  await createBtn.waitFor({ timeout: 5000 });
  await createBtn.click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });
  // Dismiss welcome dialog if present
  const closeBtns = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (await closeBtns.first().isVisible({ timeout: 1000 }).catch(() => false))
    await closeBtns.first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: process.argv[1] || 'webgpu-screenshot.png', fullPage: false });
  await browser.close();
})();
SCRIPT
  SS_FILE="$SS_DIR/screenshot.png"
  if node /tmp/webgpu-screenshot.mjs "$SS_FILE" 2>/dev/null; then
    ok "Screenshot saved to $SS_FILE"
  else
    warn "Screenshot capture failed (expected in headless without display)"
  fi
  rm -f /tmp/webgpu-screenshot.mjs

  # ---- Print manual checklist ----
  echo ""
  echo "=========================================="
  echo "  Manual Verification Checklist"
  echo "=========================================="
  echo ""
  echo "If you have a real GPU, open the app manually and verify:"
  echo ""
  echo "  [ ] Primitives render correctly (rect, circle, line)"
  echo "  [ ] Mixed content composites (GPU primitives + CPU text/effects)"
  echo "  [ ] Pan/zoom stays smooth with no vertex corruption"
  echo "  [ ] Window resize does not cause stretched/blank frame"
  echo "  [ ] Force device loss → Canvas2D fallback (not blank)"
  echo "  [ ] pipelineInitMs is not a multi-hundred-ms outlier"
  echo ""
  echo "See docs/architecture/webgpu-manual-verification.md for details."
fi

# ---- Report ----
echo ""
echo "=========================================="
if [ ${#failures[@]} -eq 0 ]; then
  echo -e "  ${GREEN}All checks passed${NC}"
  exit 0
else
  echo -e "  ${RED}${#failures[@]} failure(s):${NC}"
  for f in "${failures[@]}"; do echo "    - $f"; done
  exit 1
fi
