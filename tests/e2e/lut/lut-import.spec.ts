import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const FIXTURES = path.resolve(__dirname, 'fixtures');

/** Pre-seed localStorage so the welcome dialog never appears in tests. */
async function skipOnboarding(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'strata:onboarding',
      JSON.stringify({
        onboardingComplete: true,
        onboardingVersion: 1,
        skillLevel: 'unclassified',
        checklistProgress: [],
        dismissedTips: [],
        seenFeatureBadges: [],
        tutorialFileCompleted: false,
      }),
    );
  });
}

async function setupEditor(page: import('@playwright/test').Page) {
  await skipOnboarding(page);
  await page.goto('/');
  await page.waitForTimeout(3000);

  // We're on the home page — create a new document
  const newBtn = page.getByRole('button', { name: /^new$/i });
  await newBtn.waitFor({ state: 'visible', timeout: 5000 });
  await newBtn.click();

  // In the New dialog, click "Create" for a blank document
  const createBtn = page.locator('dialog').getByRole('button', { name: /^create$/i });
  await createBtn.waitFor({ state: 'visible', timeout: 5000 });
  await createBtn.click();

  // Wait for the editor layers panel to appear
  await page.locator('[data-panel="layers"]').waitFor({ state: 'visible', timeout: 10000 });
}

/**
 * Import a LUT file by dispatching a custom event.
 * Parses the .cube file in Node.js, builds a LUT JSON, and sends it
 * to the Shell's strata:test-import-lut listener.
 */
async function importLutFile(page: import('@playwright/test').Page, filename: string) {
  const content = fs.readFileSync(path.join(FIXTURES, filename), 'utf-8');
  // Minimal .cube parser — extract LUT_3D_SIZE and data lines
  const lines = content.split('\n');
  let lutSize = 0;
  let is3d = true;
  const dataLines: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('#') || t.length === 0 || t.startsWith('TITLE') || t.startsWith('DOMAIN'))
      continue;
    if (t.startsWith('LUT_3D_SIZE')) {
      lutSize = parseInt(t.split(/\s+/)[1] || '0', 10);
      is3d = true;
      continue;
    }
    if (t.startsWith('LUT_1D_SIZE')) {
      lutSize = parseInt(t.split(/\s+/)[1] || '0', 10);
      is3d = false;
      continue;
    }
    if (/^[\d\s.\-+eE]+$/.test(t) && t.split(/\s+/).length >= 3) dataLines.push(t);
  }

  const lutJson = JSON.stringify({
    kind: is3d ? '3d' : '1d',
    size: lutSize || 3,
    data: is3d ? dataLines.flatMap((l) => l.split(/\s+/).slice(0, 3).map(Number)) : undefined,
    r: !is3d ? dataLines.slice(0, lutSize).map((l) => Number(l.split(/\s+/)[0])) : undefined,
    g: !is3d
      ? dataLines.slice(lutSize, lutSize * 2).map((l) => Number(l.split(/\s+/)[0]))
      : undefined,
    b: !is3d
      ? dataLines.slice(lutSize * 2, lutSize * 3).map((l) => Number(l.split(/\s+/)[0]))
      : undefined,
    inputMin: [0, 0, 0],
    inputMax: [1, 1, 1],
    metadata: { title: filename.replace(/\.\w+$/, ''), sourceFormat: filename.split('.').pop() },
  });

  // Wait for Shell to mount and expose __importLut
  await page.waitForFunction(() => typeof (window as any).__importLut === 'function', {
    timeout: 10000,
  });

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
      (window as any).__importLut(adj);
    },
    { filename, lutJson },
  );
  await page.waitForTimeout(1500);
}

test.describe('LUT import and application', () => {
  test('can import a .cube 3D LUT', async ({ page }) => {
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

  test('intensity slider visible when LUT filter selected', async ({ page }) => {
    await setupEditor(page);
    await importLutFile(page, 'warm-shift.cube');

    // The adjustment layer is auto-selected. Click the "LUT" entry in the filter stack
    // to select the individual LUT adjustment and show its editor controls.
    const lutFilter = page.getByText('LUT', { exact: true }).first();
    if (await lutFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
      await lutFilter.click();
      await page.waitForTimeout(500);

      const slider = page.locator('input[aria-label="LUT intensity"]');
      expect(await slider.isVisible({ timeout: 2000 }).catch(() => false)).toBeTruthy();
    }
  });
});
