/**
 * GPU-vs-CPU agreement for the live-effects compute kernels.
 *
 * Runs the harness bundle in a plain page (no app boot — this spec does not
 * need the dev server, but Playwright's baseURL config still points at it;
 * `page.setContent` keeps the test independent of app state).
 *
 * Skips when no WebGPU adapter is available (the runner declines software
 * adapters unless explicitly allowed; the harness allows them so SwiftShader
 * CI machines still exercise the shaders).
 *
 * Env filters:
 *   EFFECTS=bloom,crt          — only these kernels
 *   GPU_AGREEMENT_MODE=report  — print stats without asserting (kernel dev)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const bundlePath = join(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'compositor',
  'dist',
  'effects-harness.js',
);

const ALL_EFFECTS = [
  'bloom',
  'crt',
  'vhs',
  'lightShafts',
  'lensFlare',
  'lightLeak',
  'caustics',
  'rgbSplit',
  'paletteSnap',
];

// Conservative visual-equivalence bounds. Each entry: mean abs per-pixel
// worst-channel delta and max abs delta. These reflect f32 vs f64 math and
// hardware texture filtering; any systematic deviation shows up in meanAbs.
const BOUNDS: Record<string, { mean: number; max: number }> = {
  bloom: { mean: 6, max: 64 },
  crt: { mean: 3, max: 24 },
  vhs: { mean: 4, max: 32 },
  lightShafts: { mean: 5, max: 40 },
  lensFlare: { mean: 5, max: 48 },
  lightLeak: { mean: 3, max: 24 },
  caustics: { mean: 5, max: 40 },
  rgbSplit: { mean: 3, max: 16 },
  paletteSnap: { mean: 3, max: 16 },
};

const REPORT = process.env.GPU_AGREEMENT_MODE === 'report';
const FILTER = (process.env.EFFECTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function buildBundle(): void {
  if (process.env.GPU_AGREEMENT_SKIP_BUILD === '1') return;
  const res = spawnSync('node', ['scripts/build-effects-harness.mjs'], {
    cwd: join(__dirname, '..', '..', '..', 'packages', 'compositor'),
    stdio: 'pipe',
  });
  if (res.status !== 0) {
    throw new Error(`harness build failed:\n${res.stderr?.toString() ?? res.stdout?.toString()}`);
  }
}

test('live effects: WebGPU compute agrees with the CPU kernels', async ({ page }) => {
  buildBundle();
  const effects = FILTER.length > 0 ? FILTER : ALL_EFFECTS;
  const bundle = readFileSync(bundlePath, 'utf8');

  await page.setContent(
    '<html><body><canvas id="probe" width="4" height="4"></canvas></body></html>',
  );
  await page.addScriptTag({ content: bundle });

  const gpuProbe = await page.evaluate(async () => {
    if (!navigator.gpu) return { api: false };
    try {
      const adapter = await navigator.gpu.requestAdapter();
      return { api: true, adapter: adapter ? adapter.info?.vendor : null };
    } catch (error) {
      return { api: true, error: String(error) };
    }
  });
  console.log(`[gpu-agreement] probe: ${JSON.stringify(gpuProbe)}`);
  test.skip(!gpuProbe.api, 'WebGPU unavailable in this browser');
  if ('adapter' in gpuProbe && !gpuProbe.adapter) {
    test.skip(true, 'no WebGPU adapter');
  }

  const result = await page.evaluate(async (names) => {
    return await window.__effectsHarness.run(names);
  }, effects);

  for (const entry of result.entries) {
    if (entry.error) {
      // Unsupported requests (e.g. sequential dither) are legitimate — they
      // fall back to CPU. The harness only includes GPU-capable cases.
      throw new Error(`${entry.effect}: ${entry.error}`);
    }
    if (!entry.stats) {
      throw new Error(`${entry.effect}: no stats produced`);
    }
    const stats = entry.stats;
    const bound = BOUNDS[entry.effect];
    if (!bound) throw new Error(`no bounds for ${entry.effect}`);
    // eslint-disable-next-line no-console
    console.log(
      `[gpu-agreement] ${entry.effect}: meanAbs=${stats.meanAbs.toFixed(2)} maxAbs=${stats.maxAbs} p99=${stats.p99} mismatchPixels=${stats.mismatchPixels}/${stats.totalPixels}`,
    );
    if (!REPORT) {
      expect(stats.meanAbs, `${entry.effect} mean abs delta`).toBeLessThanOrEqual(bound.mean);
      expect(stats.maxAbs, `${entry.effect} max abs delta`).toBeLessThanOrEqual(bound.max);
    }
  }
});
