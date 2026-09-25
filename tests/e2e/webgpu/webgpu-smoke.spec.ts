import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

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
    // --enable-unsafe-webgpu is what actually exposes an adapter. Without it
    // navigator.gpu still exists on a secure context but requestAdapter()
    // resolves null, so "returns a non-null adapter" could not pass on any
    // machine — the SwiftShader flags alone are not enough. Verified locally:
    // with this flag the adapter reports vendor "google" / "swiftshader",
    // which is the software adapter this spec is written against.
    args: [
      '--enable-unsafe-webgpu',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
    ],
  },
});

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
    // The desktop app does not expose compositor as a browser package entry:
    // it reaches it through @varve/editor's workspace dependency. Vite still
    // serves that source through its /@fs route, which lets this test exercise
    // the real module without adding a test-only production global or a
    // second compositor implementation.
    const compositorModuleUrl = `/@fs${path.resolve(
      process.cwd(),
      'packages/compositor/src/index.ts',
    )}`;
    const result = await page.evaluate(async (moduleUrl) => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      try {
        const mod = (await import(
          /* @vite-ignore */ moduleUrl
        )) as typeof import('@varve/compositor');
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
    }, compositorModuleUrl);

    // SwiftShader exposes WebGPU, but ADR-0003 deliberately declines software
    // adapters and routes rendering to Canvas2D. This proves both halves of
    // the path: detection sees the adapter, policy rejects it, and fallback
    // initialization still succeeds.
    // Carry the thrown reason into the assertion: without it a failure here
    // reports only "expected true, received false" and the actual error stays
    // trapped in the page context.
    expect(result.ok, result.reason ?? 'createCompositorBackend failed').toBe(true);
    expect(result.backendId).toBe('canvas2d');
    expect(result.webgpu).toBe(false);
    expect(result.isFallback).toBe(true);
  });

  test('diagnostics display renders in StatusBar', async ({ page }) => {
    const backendLabel = page.locator('.editor-status__diagnostic');
    await expect(backendLabel).toBeVisible({ timeout: 15000 });
    await expect(backendLabel).toHaveText('Canvas2D');
  });

  test('a WebGPU preference persists and reports a declined software adapter', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
      const file = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === 'File',
      );
      (file as HTMLElement | undefined)?.click();
    });
    await page.getByRole('menuitem', { name: /Settings/ }).click();
    const settings = page.locator('dialog.varve-dialog--settings[open]');
    const preference = settings.getByRole('switch', { name: 'Prefer WebGPU when available' });
    await preference.click();
    await expect(preference).toBeChecked();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('varve-editor-settings') ?? '{}'),
    );
    expect(saved.render?.preferWebGpu).toBe(true);

    await navigateToEditor(page);
    const warning = page.locator('.editor-status__meta--warning');
    await expect(warning).toHaveText('GPU unavailable · Canvas2D', { timeout: 15000 });
    await expect(warning).toHaveAttribute('title', /software WebGPU adapter declined/);
    await page.screenshot({ path: '/tmp/varve-gpu-status-fallback.png' });

    await page.evaluate(() => {
      const file = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === 'File',
      );
      (file as HTMLElement | undefined)?.click();
    });
    await page.getByRole('menuitem', { name: /Settings/ }).click();
    const reopenedSettings = page.locator('dialog.varve-dialog--settings[open]');
    await reopenedSettings.getByRole('tab', { name: 'Performance' }).click();
    await expect(
      reopenedSettings.getByText(
        /WebGPU preference fell back to Canvas2D: software WebGPU adapter declined/,
      ),
    ).toBeVisible();
    await page.screenshot({ path: '/tmp/varve-gpu-performance-fallback.png' });
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
