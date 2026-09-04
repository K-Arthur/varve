import path from 'node:path';
import { test as base, chromium, expect } from '@playwright/test';

/**
 * Real-model Object Selection gate.
 *
 * This spec exercises the actual SAM2-Hiera-Tiny pipeline end to end:
 * click -> prompt -> encoder + decoder inference -> preview -> candidate
 * cycling -> Apply as mask (one undoable document operation) -> undo/redo.
 *
 * Requirements (see docs/quality/object-selection-parity.md):
 * - Set VARVE_SAM2_REAL_MODEL=1 to enable.
 * - The repaired encoder + decoder must be served at /models/ (install them
 *   via Settings > Offline Models, or place the repaired files in the web root's
 *   models directory).
 * - The app must run on a server that sends COOP/COEP headers
 *   (crossOriginIsolated) OR a browser that reports navigator.deviceMemory;
 *   otherwise the conservative wasm memory gate blocks the encoder.
 * - A persistent profile is used so the app bundle is served from the disk
 *   cache and navigation stays within the shared helper's goto budget.
 */
const PROFILE_DIR = process.env.VARVE_SAM2_PROFILE_DIR ?? 'test-results/profile-sam2-real';
const BASE_URL =
  process.env.VARVE_SAM2_BASE_URL ?? `http://localhost:${process.env.VARVE_E2E_PORT ?? '1420'}`;

const test = base.extend({
  page: async ({ browser }, use) => {
    void browser;
    const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      channel: 'chromium',
      viewport: { width: 1440, height: 900 },
      args: [],
    });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await use(page);
    await page.evaluate(() => localStorage.setItem('strata-clean-shutdown', 'true'));
    await ctx.close();
  },
});

async function navigateToEditorSlow(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL, { timeout: 600000, waitUntil: 'domcontentloaded' });
  const recovery = page.locator('dialog[open]').filter({
    hasText: /closed unexpectedly|recover unsaved|recover your documents/i,
  });
  if (
    await recovery
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false)
  ) {
    await recovery
      .getByRole('button', { name: /close|dismiss|got it|not now/i })
      .first()
      .click();
  }
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 600000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .waitFor({ timeout: 300000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 900000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

test.describe('Object Selection real-model gate', () => {
  test.skip(
    !process.env.VARVE_SAM2_REAL_MODEL,
    'Set VARVE_SAM2_REAL_MODEL=1 (model files + COOP/COEP server required)',
  );

  test('clicks an object, gets a real mask preview, applies it, and survives undo/redo', async ({
    page,
  }, testInfo) => {
    test.setTimeout(1_200_000);
    await navigateToEditorSlow(page);
    // Use the verified portrait fixture: cat.jpg is mislabelled in the legacy
    // background-removal corpus and is actually a coastal landscape, so its
    // centre point prompts sky/sea rather than an object.
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/fixtures/bg-removal-corpus/human.jpg'));
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 120000 });

    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('tab', { name: 'Adjustments' }).click();
    await inspector.getByRole('button', { name: 'Object Selection' }).click();
    const installModel = inspector.getByRole('button', {
      name: /Install Object Selection model|Retry Object Selection model/i,
    });
    if (await installModel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await installModel.click();
      await expect(inspector.getByText(/Object Selection model ready/i)).toBeVisible({
        timeout: 900000,
      });
    }
    await inspector.getByRole('button', { name: 'Select Object' }).click();
    await expect(
      page.getByTestId('toolbar').getByRole('button', { name: 'Object Selection' }),
    ).toHaveAttribute('aria-pressed', 'true');

    const canvas = page.getByTestId('editor-canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();

    // Session 1: cold path (model load + image encode + decoder).
    const t0 = Date.now();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    const status = inspector.getByText(/Preview ready/).first();
    await status.waitFor({ timeout: 600000 });
    const statusText = (await status.textContent()) ?? '';
    console.log(
      'COLD PREVIEW:',
      statusText,
      '| latency:',
      `${Math.round((Date.now() - t0) / 1000)}s`,
    );
    expect(statusText).toMatch(/Preview ready · \d+% model confidence · \d+ candidate masks?/);
    expect(statusText).not.toMatch(/0 candidate mask/);
    await testInfo.attach('real-model-preview', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await canvas.screenshot({ path: testInfo.outputPath('real-model-preview.png') });

    // Candidate cycling wraps. Return to the initial candidate before Apply;
    // a later candidate may intentionally be a lower-confidence alternative.
    const nextBtn = inspector.getByRole('button', { name: 'Next object-selection candidate' });
    if (await nextBtn.count().then((n) => n > 0)) {
      const before = (await inspector.getByText(/Candidate \d+ of \d+/).textContent()) ?? '';
      const total = Number(before.match(/of (\d+)/)?.[1] ?? 0);
      expect(total).toBeGreaterThan(1);
      for (let index = 0; index < total; index += 1) {
        await nextBtn.click();
      }
      await page.waitForTimeout(1000);
      const after = (await inspector.getByText(/Candidate \d+ of \d+/).textContent()) ?? '';
      expect(after).toBe(before);
      console.log('CANDIDATE CYCLE:', before, '->', after, '(wrapped)');
    }

    // Apply as mask -> one undoable document operation; the apply path reveals
    // the Background Removal disclosure so provenance is immediately visible.
    await inspector.getByRole('button', { name: 'Apply as mask' }).click();
    const backgroundRemovalToggle = inspector.getByRole('button', {
      name: 'Background Removal',
      exact: true,
    });
    await expect(backgroundRemovalToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(inspector.getByText(/Confidence \d+%/).first()).toBeVisible({ timeout: 120000 });
    console.log(
      'APPLIED PROVENANCE:',
      await inspector
        .getByText(/Confidence \d+%/)
        .first()
        .textContent(),
    );
    await testInfo.attach('real-model-applied', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await canvas.screenshot({ path: testInfo.outputPath('real-model-applied.png') });

    // Undo removes the committed mask; redo restores it.
    await page.keyboard.press('Control+KeyZ');
    await expect(inspector.getByText(/Confidence \d+%/).first()).toBeHidden({ timeout: 60000 });
    await page.keyboard.press('Control+Shift+KeyZ');
    // Undo/redo restores the document snapshot and may return the Inspector
    // to its Design tab; return to the adjustment surface before reviewing
    // the restored mask provenance.
    await inspector.getByRole('tab', { name: 'Adjustments' }).click();
    await expect(inspector.getByText(/Confidence \d+%/).first()).toBeVisible({ timeout: 60000 });
    console.log('UNDO/REDO OK');

    // Session 2: same image, warm embedding cache — the encoder must be
    // reused (prompt-only latency, well under the cold path).
    await inspector.getByRole('button', { name: 'Select Object' }).click();
    const t1 = Date.now();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    const warm = inspector.getByText(/Preview ready/).first();
    await warm.waitFor({ timeout: 120000 });
    const warmText = (await warm.textContent()) ?? '';
    const warmLatency = Date.now() - t1;
    console.log('WARM PREVIEW:', warmText, '| latency:', `${Math.round(warmLatency / 1000)}s`);
    expect(warmLatency).toBeLessThan(60000);
  });
});
