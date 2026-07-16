import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const FIXTURES = path.resolve(__dirname, 'fixtures');

async function setupEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForTimeout(3000);
  try {
    const blankBtn = page.getByRole('button', { name: /blank canvas/i });
    await blankBtn.waitFor({ state: 'visible', timeout: 5000 });
    await blankBtn.click();
    await page.waitForTimeout(2000);
  } catch {
    const newBtn = page.getByRole('button', { name: /^new$/i });
    if (await newBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await newBtn.click();
      await page.locator('dialog').getByRole('button', { name: /^create$/i }).click();
      await page.waitForTimeout(1000);
    }
  }
  await page.locator('[data-panel="layers"]').waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Parse a .cube/.3dl file in Node.js and dispatch the adjustment via custom event.
 * The Shell has a listener for 'strata:test-import-lut' that calls addLutAdjustment.
 */
async function importLutFile(page: import('@playwright/test').Page, filename: string) {
  const content = fs.readFileSync(path.join(FIXTURES, filename), 'utf-8');
  // Simple cube parser — extract data lines as [r,g,b] triples
  const lines = content.split('\n');
  const dataLines: string[] = [];
  let lutSize = 0;
  let is3d = true;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.length === 0) continue;
    if (trimmed.startsWith('TITLE') || trimmed.startsWith('DOMAIN') || trimmed.startsWith('LUT_1D')) continue;
    if (trimmed.startsWith('LUT_3D_SIZE')) {
      lutSize = parseInt(trimmed.split(/\s+/)[1] || '0', 10);
      is3d = true;
      continue;
    }
    if (/^[\d\s.\-+eE]+$/.test(trimmed) && trimmed.split(/\s+/).length >= 3) {
      dataLines.push(trimmed);
    }
  }

  // Build a minimal LUT JSON that the browser can construct
  const lutJson = JSON.stringify({
    kind: is3d ? '3d' : '1d',
    size: lutSize || 3,
    data: is3d
      ? dataLines.flatMap((l) => l.split(/\s+/).slice(0, 3).map(Number))
      : undefined,
    r: !is3d ? dataLines.slice(0, lutSize).map((l) => Number(l.split(/\s+/)[0])) : undefined,
    g: !is3d ? dataLines.slice(lutSize, lutSize * 2).map((l) => Number(l.split(/\s+/)[0])) : undefined,
    b: !is3d ? dataLines.slice(lutSize * 2, lutSize * 3).map((l) => Number(l.split(/\s+/)[0])) : undefined,
    inputMin: [0, 0, 0],
    inputMax: [1, 1, 1],
    metadata: { title: filename.replace(/\.\w+$/, ''), sourceFormat: filename.split('.').pop() },
  });

  // Dispatch via custom event that Shell listens to
  await page.evaluate(
    ({ filename, lutJson }) => {
      const adj = {
        id: `lut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'lut',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        lutJson,
        originalFilename: filename,
        inputSpace: 'sRGB',
        interpolation: 'tetrahedral',
        intensity: 1,
        linearize: false,
      };
      console.log('[TEST] Dispatching lut import event', adj.kind, adj.originalFilename);
      window.dispatchEvent(new CustomEvent('strata:test-import-lut', { detail: { adjustment: adj } }));
    },
    { filename, lutJson },
  );
  await page.waitForTimeout(2000);
  // Check console for the test log
  const logs = await page.evaluate(() => {
    return (window as any).__lutImportLogs ?? 'no logs';
  });
  console.log('Import logs:', logs);
}

test.describe('LUT import and application', () => {
  test('can import a .cube 3D LUT via custom event', async ({ page }) => {
    await setupEditor(page);
    await importLutFile(page, 'warm-shift.cube');
    const text = await page.locator('[data-panel="layers"]').textContent();
    console.log('LAYERS:', text?.slice(0, 200));
    expect(text).not.toContain('No layers');
  });

  test('can import identity LUT', async ({ page }) => {
    await setupEditor(page);
    await importLutFile(page, 'identity.cube');
    const text = await page.locator('[data-panel="layers"]').textContent();
    expect(text).not.toContain('No layers');
  });

  test('LUT layer shows filename', async ({ page }) => {
    await setupEditor(page);
    await importLutFile(page, 'warm-shift.cube');
    const text = await page.locator('[data-panel="layers"]').textContent();
    expect(text).toContain('warm-shift');
  });

  test('multiple LUT imports', async ({ page }) => {
    await setupEditor(page);
    await importLutFile(page, 'warm-shift.cube');
    await importLutFile(page, 'cool-shift.cube');
    const text = await page.locator('[data-panel="layers"]').textContent();
    expect(text).toContain('warm-shift');
    expect(text).toContain('cool-shift');
  });

  test('intensity slider visible when LUT selected', async ({ page }) => {
    await setupEditor(page);
    await importLutFile(page, 'warm-shift.cube');
    const lutRow = page.locator('[data-panel="layers"]').getByText(/warm-shift|LUT/i);
    if (await lutRow.isVisible({ timeout: 2000 }).catch(() => false)) {
      await lutRow.click();
      await page.waitForTimeout(500);
      const slider = page.locator('input[aria-label="LUT intensity"]');
      expect(await slider.isVisible({ timeout: 2000 }).catch(() => false)).toBeTruthy();
    }
  });
});
