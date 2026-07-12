import { expect, test } from '@playwright/test';

/**
 * WebGPU init-path smoke test — validates the TypeScript code path is
 * exercisable without a real GPU, using SwiftShader software WebGPU in
 * headless Chromium.
 *
 * The app-level gate (ADR-0003) declines software-emulated adapters, so
 * createCompositorBackend may fall back to Canvas2D.  This test still
 * proves the detection path fires and nothing throws.
 */

test.use({
  launchOptions: {
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  },
});

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .waitFor({ timeout: 5000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

test.describe('WebGPU smoke test', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('navigator.gpu.requestAdapter returns a non-null adapter', async ({ page }) => {
    const hasAdapter = await page.evaluate(async () => {
      const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
      if (!gpu) return { available: false, reason: 'navigator.gpu undefined' };
      try {
        const adapter = await gpu.requestAdapter();
        return { available: !!adapter, reason: adapter ? 'ok' : 'adapter null' };
      } catch (e) {
        return { available: false, reason: String(e) };
      }
    });
    expect(hasAdapter.available).toBe(true);
  });

  test('createCompositorBackend exercises the WebGPU init path', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      try {
        const mod = await import('@strata/compositor');
        const { backend, capabilities } = await mod.createCompositorBackend(canvas, {
          preferWebGpu: true,
        });
        return {
          ok: true,
          backendId: backend.id,
          webgpu: capabilities.webgpu,
          isFallback: capabilities.isFallbackAdapter ?? false,
          reason: null,
        };
      } catch (e) {
        return { ok: false, backendId: null, webgpu: false, isFallback: false, reason: String(e) };
      }
    });

    // The backend id is 'webgpu' even when the software-adapter gate
    // (ADR-0003) later falls back to Canvas2D internally.
    expect(result.ok).toBe(true);
    expect(result.backendId).toBe('webgpu');
    // capabilities.webgpu may be true or false depending on the CI runner.
    // In headless Chromium with --enable-unsafe-swiftshader it should be
    // true; on runners without the flag it may be false.  Both are valid.
  });

  test('diagnostics display renders in StatusBar', async ({ page }) => {
    const backendLabel = page.locator('.editor-status__info').first();
    await expect(backendLabel).toBeVisible({ timeout: 10000 });
    const text = await backendLabel.textContent();
    expect(text).toMatch(/^(webgpu|webgpu \(cpu\)|canvas2d \(cpu\))$/);
  });

  test('no unhandled console errors for WebGPU / WebGL / context loss', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const t = msg.text().toLowerCase();
        if (
          t.includes('webgpu') ||
          t.includes('webgl') ||
          t.includes('context') ||
          t.includes('gpu')
        )
          errors.push(msg.text());
      }
    });
    // Interact with the canvas to trigger backend initialization.
    const canvas = page.locator('canvas').first();
    await canvas.click({ position: { x: 100, y: 100 } });
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });
});
