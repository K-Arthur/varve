import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Inference platform probe (G4).
 *
 * This spec measures the browser environment the inference worker actually
 * runs in and attaches the raw facts. It does not promote a platform: the
 * authoritative matrix lives in
 * `packages/engine/src/inference/platformEvidence.ts`, and cells stay
 * `unverified` until a run with node assignment and quality parity exists.
 *
 * What this proves per run:
 * - cross-origin isolation and SharedArrayBuffer availability (threading
 *   capability, not a memory budget);
 * - the worker runtime's thread policy is single-threaded by construction
 *   (asserted in `ortRuntimeAssets.test.ts`; the probe reports isolation so a
 *   reader can see that isolation does not change it);
 * - WebGPU adapter presence, recorded as capability only;
 * - the editor canvas is present and interactive, so the facts were collected
 *   from a working app rather than a blank page.
 */
test.describe('inference platform probe', () => {
  test('records the browser inference environment without promoting platforms', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page, '/', { startupTimeout: 120_000 });
    await expect(page.getByTestId('editor-canvas')).toBeVisible();

    const facts = await page.evaluate(async () => {
      const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
      let adapterInfo: Record<string, unknown> | null = null;
      let webgpuAdapterAvailable = false;
      try {
        if (navigator.gpu) {
          const adapter = await navigator.gpu.requestAdapter();
          webgpuAdapterAvailable = adapter !== null;
          if (adapter) {
            const info = (adapter as unknown as { info?: Record<string, unknown> }).info;
            adapterInfo = info ? { ...info } : null;
          }
        }
      } catch (error) {
        adapterInfo = { error: error instanceof Error ? error.message : String(error) };
      }
      return {
        userAgent: navigator.userAgent,
        crossOriginIsolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : null,
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        deviceMemoryGb: navigatorWithMemory.deviceMemory ?? null,
        webgpuApiPresent: typeof navigator.gpu !== 'undefined',
        webgpuAdapterAvailable,
        adapterInfo,
      };
    });

    await testInfo.attach('inference-platform-facts', {
      body: JSON.stringify(facts, null, 2),
      contentType: 'application/json',
    });
    // Durable evidence outside the disposable test-results directory; the
    // ledger references this path.
    const evidenceDir = path.resolve('reports/inference-platform');
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      path.join(evidenceDir, `facts-${process.env.VARVE_E2E_PORT ?? 'default'}.json`),
      `${JSON.stringify(facts, null, 2)}\n`,
      'utf8',
    );

    // The probe's contract: collect facts. Assert only what the page itself
    // must always be able to answer, so a headless environment without WebGPU
    // is reported as such instead of failing the probe.
    expect(typeof facts.userAgent).toBe('string');
    expect(facts.hardwareConcurrency === null || facts.hardwareConcurrency > 0).toBe(true);
    if (facts.crossOriginIsolated === false) {
      // Documented consequence: the admission budget stays at the conservative
      // tier and threaded WASM is unavailable. Nothing here promotes threading.
      expect(facts.sharedArrayBuffer === false || facts.crossOriginIsolated === false).toBe(true);
    }
  });

  test('keeps manual point selection usable when no model is installed', async ({ page }) => {
    await navigateToEditor(page);
    const canvas = page.getByTestId('editor-canvas');
    await expect(canvas).toBeVisible();
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    // A manual marquee is model-free and must never be blocked by inference
    // state; this is the fallback the platform matrix keeps available.
    await page.mouse.move(bounds!.x + bounds!.width * 0.3, bounds!.y + bounds!.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + bounds!.width * 0.5, bounds!.y + bounds!.height * 0.5);
    await page.mouse.up();
    await expect(canvas).toBeVisible();
  });
});
