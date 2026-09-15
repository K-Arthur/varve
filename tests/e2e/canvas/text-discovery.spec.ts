import path from 'node:path';
import { test as base, chromium, expect } from '@playwright/test';

/**
 * Text-discovery real-model gate.
 *
 * Exercises the shipped vertical slice on a real photograph:
 *   description -> Grounding DINO detections -> review list -> choose a box
 *   -> shared prompted router (SAM2) -> candidate preview -> Apply as mask.
 *
 * Requirements:
 * - Set VARVE_GROUNDING_DINO_REAL_MODEL=1 to enable.
 * - The app must be able to install (or already have installed) the pinned
 *   Grounding DINO int8 graph and vocab, plus the SAM2 pair for the
 *   segmentation half. Downloads are explicit; the spec clicks the panel's
 *   install buttons and waits.
 * - Run on a machine with enough memory for the detector (~2.4 GB measured in
 *   WASM) plus the SAM2 encoder; the app refuses and explains if it cannot.
 */
const PROFILE_DIR =
  process.env.VARVE_TEXT_DISCOVERY_PROFILE_DIR ?? 'test-results/profile-text-discovery';
const BASE_URL =
  process.env.VARVE_TEXT_DISCOVERY_BASE_URL ??
  `http://localhost:${process.env.VARVE_E2E_PORT ?? '1420'}`;

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
  const safeMode = page.getByRole('alertdialog').filter({ hasText: /safe mode/i });
  if (
    await safeMode
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false)
  ) {
    await safeMode.getByRole('button', { name: /continue normal startup/i }).click();
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

test.describe('Text discovery real-model gate', () => {
  test.skip(
    !process.env.VARVE_GROUNDING_DINO_REAL_MODEL,
    'Set VARVE_GROUNDING_DINO_REAL_MODEL=1 (detector + SAM2 models + memory required)',
  );

  test('finds a described object in a real still life, reviews detections, and segments the chosen box', async ({
    page,
  }, testInfo) => {
    test.setTimeout(1_800_000);
    await navigateToEditorSlow(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/real-life-still-life.jpg'));
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 120000 });
    await page.getByRole('treeitem').first().click();

    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('tab', { name: 'Adjustments' }).click();
    await inspector.getByRole('button', { name: 'Object Selection' }).click();

    const discovery = inspector.getByRole('region', { name: 'Find objects by description' });
    await expect(discovery).toBeVisible({ timeout: 60000 });

    // The detector is an optional explicit download; install it if missing.
    const installDetector = discovery.getByRole('button', {
      name: /Install text discovery model/i,
    });
    if (await installDetector.isVisible({ timeout: 5000 }).catch(() => false)) {
      await installDetector.click();
      await expect(discovery.getByRole('textbox', { name: 'Description' })).toBeVisible({
        timeout: 900000,
      });
    }

    await discovery.getByRole('textbox', { name: 'Description' }).fill('apple');
    await discovery.getByRole('button', { name: 'Find regions' }).click();
    console.log('DISCOVERY RUNNING (measured ~40 s single-threaded WASM)');

    const regions = discovery.getByRole('radiogroup', { name: 'Discovered regions' });
    const discoveryError = discovery.locator('[role="alert"]');
    await expect(regions.or(discoveryError)).toBeVisible({ timeout: 900000 });
    if (await discoveryError.isVisible().catch(() => false)) {
      throw new Error(`Discovery refused: ${await discoveryError.textContent()}`);
    }
    const radios = regions.getByRole('radio');
    const count = await radios.count();
    const labels = await regions.locator('span').allTextContents();
    console.log('DETECTIONS:', count, labels.join(' | '));
    expect(count).toBeGreaterThan(0);
    expect(labels.some((label) => /apple/i.test(label))).toBe(true);
    await testInfo.attach('text-discovery-detections', {
      body: await page.getByTestId('editor-canvas').screenshot(),
      contentType: 'image/png',
    });
    await page
      .getByTestId('editor-canvas')
      .screenshot({ path: testInfo.outputPath('text-discovery-detections.png') });

    // Choose the best apple-labelled detection; the list is ranked by score.
    const appleIndex = labels.findIndex((label) => /apple/i.test(label));
    await radios.nth(Math.max(0, appleIndex)).check();
    await expect(discovery.getByTestId('text-discovery-selection-preview')).toBeVisible();
    const detectionReview = discovery.getByRole('checkbox', {
      name: 'I verified the highlighted region is the intended object',
    });
    await expect(detectionReview).toBeVisible();
    await expect(discovery.getByRole('button', { name: 'Segment selected region' })).toBeDisabled();
    await detectionReview.check();

    // The detector must not have committed a mask: no Apply action exists yet.
    await expect(inspector.getByRole('button', { name: 'Apply as mask' })).toHaveCount(0);

    await discovery.getByRole('button', { name: 'Segment selected region' }).click();

    // The selected box goes through the normal promptable router. Auto may
    // resolve to either provider, so match the install offer for both labels.
    const installSam = inspector.getByRole('button', {
      name: /Install (?:higher-detail )?Object Selection model|Retry (?:higher-detail )?local model/i,
    });
    if (await installSam.isVisible({ timeout: 5000 }).catch(() => false)) {
      await installSam.click();
      await expect(inspector.getByText(/Object Selection model ready/i)).toBeVisible({
        timeout: 900000,
      });
    }

    const preview = inspector.getByText(/Preview ready/).first();
    const previewFailure = inspector
      .getByText(/(?:needs an optional local model|needs more memory|could not allocate)/i)
      .first();
    await expect(preview.or(previewFailure)).toBeVisible({ timeout: 900000 });
    if (await previewFailure.isVisible().catch(() => false)) {
      throw new Error(`Segmentation failed: ${await previewFailure.textContent()}`);
    }
    const previewText = (await preview.textContent()) ?? '';
    console.log('TEXT->MASK PREVIEW:', previewText);
    expect(previewText).toMatch(
      /Preview ready · predicted IoU score [\d.]+ · prompt match 100% · \d+ candidate masks?/i,
    );
    await page
      .getByTestId('editor-canvas')
      .screenshot({ path: testInfo.outputPath('text-discovery-segmented.png') });

    await inspector
      .getByRole('checkbox', { name: 'I reviewed the highlighted target before applying' })
      .check();
    await inspector.getByRole('button', { name: 'Apply as mask' }).click();
    await expect(
      inspector.getByRole('button', { name: 'Background Removal', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(inspector.getByText(/(?:predicted IoU score|mask score)/i).first()).toBeVisible({
      timeout: 120000,
    });
    await testInfo.attach('text-discovery-applied', {
      body: await page.getByTestId('editor-canvas').screenshot(),
      contentType: 'image/png',
    });
    await page
      .getByTestId('editor-canvas')
      .screenshot({ path: testInfo.outputPath('text-discovery-applied.png') });
  });
});
