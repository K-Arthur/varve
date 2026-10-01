/**
 * GPU-vs-CPU agreement for the live-effects compute kernels.
 *
 * Runs the harness bundle in a plain document after establishing a localhost
 * origin. WebGPU is origin-gated; calling `page.setContent` from the initial
 * about:blank document makes `navigator.gpu` disappear even when Chromium was
 * launched with the Vulkan flags. The initial navigation is only an origin
 * bootstrap; the app DOM is replaced before the harness runs.
 *
 * Skips when no WebGPU adapter is available (the runner declines software
 * adapters unless explicitly allowed; the harness allows them so SwiftShader
 * CI machines still exercise the shaders).
 *
 * Env filters:
 *   EFFECTS=bloom,crt          — only these kernels (agreement + timing)
 *   GPU_AGREEMENT_MODE=report  — print stats without asserting (kernel dev)
 *   GPU_TIMING_SIZES / GPU_TIMING_ITERATIONS — timing report shape
 *
 * The second test is a report-only CPU-vs-GPU wall-time table written to
 * reports/gpu-effects-timing.json (no timing thresholds asserted here).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

// Visual-equivalence bounds. Baseline measured on 48x32 gradient+noise
// input (2026-08-07, Chromium 1228 + RADV): worst-channel mean/max deltas
// between the CPU reference kernels and the GPU compute kernels. These are
// dominated by the effects' intrinsic strength (the CPU applies the same
// change); f32-vs-f64 math and algorithmic differences (full-res field eval,
// 2-level bloom pyramid) add the remainder. A GPU bug producing garbage
// lands at meanAbs 255 — far above every bound.
const BOUNDS: Record<string, { mean: number; max: number }> = {
  bloom: { mean: 60, max: 160 },
  crt: { mean: 115, max: 245 },
  vhs: { mean: 75, max: 245 },
  lightShafts: { mean: 20, max: 130 },
  lensFlare: { mean: 20, max: 200 },
  lightLeak: { mean: 30, max: 200 },
  caustics: { mean: 190, max: 255 },
  rgbSplit: { mean: 45, max: 170 },
  paletteSnap: { mean: 50, max: 200 },
};

const REPORT = process.env.GPU_AGREEMENT_MODE === 'report';
const FILTER = (process.env.EFFECTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

declare global {
  interface Window {
    __effectsHarness: {
      run(
        names: string[],
        options?: { width?: number; height?: number; concurrent?: boolean },
      ): Promise<{
        entries: Array<{
          effect: string;
          gpuReady: boolean;
          stats: {
            meanAbs: number;
            maxAbs: number;
            p99: number;
            mismatchPixels: number;
            totalPixels: number;
            samples: number;
          } | null;
          error?: string;
        }>;
      }>;
      effectNames(): string[];
    };
  }
}

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

interface GpuProbe {
  api: boolean;
  adapter?: string | null;
  error?: string;
}

/**
 * Origin bootstrap, harness injection, and adapter probe shared by the
 * agreement and timing tests (WebGPU is origin-gated; see the header).
 * Skips the calling test with a reason when the adapter cannot measure.
 */
async function openHarness(page: import('@playwright/test').Page): Promise<GpuProbe> {
  buildBundle();
  const bundle = readFileSync(bundlePath, 'utf8');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
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
  test.skip(!gpuProbe.api, 'WebGPU unavailable in this browser');
  if ('adapter' in gpuProbe && !gpuProbe.adapter) {
    test.skip(true, 'no WebGPU adapter');
  }
  return gpuProbe;
}

test('live effects: WebGPU compute agrees with the CPU kernels', async ({ page }, testInfo) => {
  // verify.mjs routes direct-file lanes to the plain `chromium` project;
  // these specs need the chromium-gpu flags (see the project comment in
  // playwright.config.ts). Skip with an explicit reason rather than
  // silently passing or failing in an environment that never had a chance.
  test.skip(
    testInfo.project.name !== 'chromium-gpu',
    'GPU compute specs require --project=chromium-gpu',
  );
  const effects = FILTER.length > 0 ? FILTER : ALL_EFFECTS;
  const gpuProbe = await openHarness(page);
  console.log(`[gpu-agreement] probe: ${JSON.stringify(gpuProbe)}`);

  const result = await page.evaluate(async (names) => {
    return await window.__effectsHarness.run(names, {
      width: 48,
      height: 32,
      concurrent: true,
    });
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

test('Color Halftone: 48px rows survive padded WebGPU readback', async ({ page }, testInfo) => {
  // Demands real WebGPU output; see the project-routing note above.
  test.skip(
    testInfo.project.name !== 'chromium-gpu',
    'GPU compute specs require --project=chromium-gpu',
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // Establish the localhost origin, then replace the app DOM before the
  // dynamic module import. The loading shell may finish booting after
  // DOMContentLoaded and navigate/re-render underneath an evaluation.
  await page.setContent('<html><body></body></html>');
  const moduleUrl = `/@fs${join(process.cwd(), 'packages/engine/src/gpu/colorHalftoneGpu.ts')}`;

  const result = await page.evaluate(async (url) => {
    const mod = (await import(/* @vite-ignore */ url)) as {
      applyColorHalftoneGpu: (
        data: ImageData,
        params: import('@varve/engine').ColorHalftoneParams,
      ) => Promise<ImageData>;
      getColorHalftoneGpuDiagnostics: () => {
        backend: 'webgpu' | 'cpu';
        width: number;
        height: number;
        reason: string;
      };
    };
    const data = new Uint8ClampedArray(48 * 32 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (i / 4) % 251;
      data[i + 1] = 180;
      data[i + 2] = 220;
      data[i + 3] = 255;
    }
    const output = await mod.applyColorHalftoneGpu(new ImageData(data, 48, 32), {
      screenSize: 12,
      angle: 0,
      dotShape: 'round',
      mode: 'cmyk',
      intensity: 1,
      inkColor: [0, 0, 0, 255],
      algorithmVersion: 1,
    });
    const diagnostics = mod.getColorHalftoneGpuDiagnostics();
    const canvas = document.createElement('canvas');
    canvas.id = 'halftone-probe';
    canvas.width = 48;
    canvas.height = 32;
    canvas.getContext('2d')?.putImageData(output, 0, 0);
    document.body.append(canvas);
    return {
      diagnostics,
      outputLength: output.data.length,
      alpha: output.data[3],
      redMin: Math.min(...output.data.filter((_, index) => index % 4 === 0)),
      redMax: Math.max(...output.data.filter((_, index) => index % 4 === 0)),
      firstPixel: Array.from(output.data.slice(0, 4)),
    };
  }, moduleUrl);

  await page.locator('#halftone-probe').screenshot({
    path: testInfo.outputPath('color-halftone-48x32.png'),
  });
  expect(result.diagnostics.backend, result.diagnostics.reason).toBe('webgpu');
  expect(result.diagnostics.width).toBe(48);
  expect(result.diagnostics.height).toBe(32);
  expect(result.outputLength).toBe(48 * 32 * 4);
  expect(result.alpha).toBe(255);
  expect(result.redMax, 'readback should contain rendered pixels').toBeGreaterThan(result.redMin);
  expect(result.firstPixel).not.toEqual([242, 245, 251, 255]);
});

// ---------------------------------------------------------------------------
// Wall-clock timing (report-only): GPU vs CPU per kernel, end to end.
//
// Prints a per-effect table and writes `reports/gpu-effects-timing.json`.
// No timing thresholds are asserted — a single host cannot pin tail
// percentiles — only that both paths produced results at each size.
// Agreement (correctness) bounds live in the first test above. The GPU
// sample includes upload, dispatch, and readback: exactly what an export
// consumer would pay. Cold first-use samples (pipeline compilation) are
// reported separately from warmed medians.
//
// Env: EFFECTS=bloom,crt — subset; GPU_TIMING_SIZES=512,1024 — square
// sizes (default 512,1024,2048); GPU_TIMING_ITERATIONS=7 — samples per
// effect/size. Full-table history: docs/perf/ledger.md.

const TIMING_SIZES = (process.env.GPU_TIMING_SIZES ?? '512,1024,2048')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const TIMING_ITERATIONS = Number(process.env.GPU_TIMING_ITERATIONS ?? 7);
const TIMING_REPORT_PATH = join(__dirname, '..', '..', '..', 'reports', 'gpu-effects-timing.json');

interface HarnessTimingLike {
  cpuFirstMs: number;
  gpuFirstMs: number;
  cpuMs: number[];
  gpuMs: number[];
}

interface HarnessTimingEntry {
  effect: string;
  gpuReady: boolean;
  stats: { meanAbs: number } | null;
  error?: string;
  timing?: HarnessTimingLike;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return Number.NaN;
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

test('live effects: GPU compute wall time vs CPU kernels (report)', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  test.skip(
    testInfo.project.name !== 'chromium-gpu',
    'GPU compute specs require --project=chromium-gpu',
  );
  const effects = FILTER.length > 0 ? FILTER : ALL_EFFECTS;
  const gpuProbe = await openHarness(page);
  console.log(`[gpu-timing] probe: ${JSON.stringify(gpuProbe)}`);

  const rows: Array<{
    effect: string;
    size: number;
    cpuFirstMs: number;
    gpuFirstMs: number;
    cpuMedianMs: number;
    cpuMinMs: number;
    gpuMedianMs: number;
    gpuMinMs: number;
    speedupMedian: number;
    statsMeanAbs: number | null;
  }> = [];

  for (const size of TIMING_SIZES) {
    const result = (await page.evaluate(
      async ({ names, square, iterations }) => {
        const harness = (
          window as unknown as {
            __effectsHarness: {
              run(
                effects: string[],
                options: {
                  width: number;
                  height: number;
                  timing: { iterations: number };
                  requireHardwareAdapter: boolean;
                },
              ): Promise<{ entries: HarnessTimingEntry[] }>;
            };
          }
        ).__effectsHarness;
        return await harness.run(names, {
          width: square,
          height: square,
          timing: { iterations },
          requireHardwareAdapter: true,
        });
      },
      { names: effects, square: size, iterations: TIMING_ITERATIONS },
    )) as { entries: HarnessTimingEntry[] };

    for (const entry of result.entries) {
      expect(entry.error, `${entry.effect}@${size}: ${entry.error ?? ''}`).toBeUndefined();
      expect(entry.gpuReady, `${entry.effect}@${size}: gpuReady`).toBe(true);
      expect(entry.stats, `${entry.effect}@${size}: agreement stats`).not.toBeNull();
      expect(entry.timing, `${entry.effect}@${size}: timing samples`).toBeTruthy();
      const timing = entry.timing;
      if (!timing) continue;
      const cpuMedian = median(timing.cpuMs);
      const gpuMedian = median(timing.gpuMs);
      rows.push({
        effect: entry.effect,
        size,
        cpuFirstMs: timing.cpuFirstMs,
        gpuFirstMs: timing.gpuFirstMs,
        cpuMedianMs: cpuMedian,
        cpuMinMs: Math.min(...timing.cpuMs),
        gpuMedianMs: gpuMedian,
        gpuMinMs: Math.min(...timing.gpuMs),
        speedupMedian: cpuMedian / gpuMedian,
        statsMeanAbs: entry.stats?.meanAbs ?? null,
      });
      console.log(
        `[gpu-timing] ${entry.effect}@${size}: cpu med=${cpuMedian.toFixed(1)}ms ` +
          `min=${Math.min(...timing.cpuMs).toFixed(1)}ms cold=${timing.cpuFirstMs.toFixed(1)}ms | ` +
          `gpu med=${gpuMedian.toFixed(1)}ms min=${Math.min(...timing.gpuMs).toFixed(1)}ms ` +
          `cold=${timing.gpuFirstMs.toFixed(1)}ms | x${(cpuMedian / gpuMedian).toFixed(2)}`,
      );
    }
  }

  expect(rows.length, 'every effect produced timing rows').toBe(
    effects.length * TIMING_SIZES.length,
  );
  mkdirSync(dirname(TIMING_REPORT_PATH), { recursive: true });
  writeFileSync(
    TIMING_REPORT_PATH,
    `${JSON.stringify(
      {
        date: new Date().toISOString(),
        adapter: gpuProbe,
        iterations: TIMING_ITERATIONS,
        sizes: TIMING_SIZES,
        rows,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`[gpu-timing] wrote ${TIMING_REPORT_PATH}`);
});
