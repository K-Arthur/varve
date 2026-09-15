import path from 'node:path';
import { test as base, chromium, expect } from '@playwright/test';

/**
 * MobileSAM real-artifact gate.
 *
 * This is intentionally separate from the SAM2 gate. MobileSAM is a pinned,
 * split ONNX provider, not a drop-in replacement: it has four candidates,
 * raw predicted-IoU scores, and a different encoder preprocessing contract.
 * The scenario uses a real wildlife photograph rather than a synthetic mask
 * so a successful graph execution is not mistaken for useful object choice.
 *
 * Set VARVE_MOBILE_SAM_REAL_MODEL=1 to run. The test downloads the optional
 * local model into a persistent profile and writes screenshots to the normal
 * Playwright output directory.
 */
const PROFILE_DIR =
  process.env.VARVE_MOBILE_SAM_PROFILE_DIR ?? 'test-results/profile-mobile-sam-real';
const BASE_URL =
  process.env.VARVE_MOBILE_SAM_BASE_URL ??
  `http://localhost:${process.env.VARVE_E2E_PORT ?? '1420'}`;

const test = base.extend({
  page: async ({ browser }, use) => {
    void browser;
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      channel: 'chromium',
      viewport: { width: 1440, height: 900 },
      args: [],
    });
    // A prior gated run may be terminated by the browser/ORT worker while
    // collecting a real-model artifact. Reset only the test profile's startup
    // recovery markers before the app boot sequence so a stale safe-mode
    // decision cannot disable the very model this gate is meant to exercise.
    await context.addInitScript(() => {
      localStorage.setItem('strata-clean-shutdown', 'true');
      localStorage.removeItem('varve:crash-loop');
      localStorage.removeItem('varve:safe-mode');
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
    await page.evaluate(() => localStorage.setItem('strata-clean-shutdown', 'true'));
    await context.close();
  },
});

async function navigateToEditorSlow(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL, { timeout: 600000, waitUntil: 'domcontentloaded' });
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

async function openObjectSelection(page: import('@playwright/test').Page) {
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/real-life-elephant.jpg'));
  await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 120000 });
  await page.getByRole('treeitem').first().click();

  const inspector = page.locator('.editor__inspector-panel');
  await inspector.getByRole('tab', { name: 'Adjustments' }).click();
  await inspector.getByRole('button', { name: 'Object Selection' }).click();
  return { inspector, canvas: page.getByTestId('editor-canvas') };
}

test.describe('Object Selection MobileSAM real-model gate', () => {
  test.skip(
    !process.env.VARVE_MOBILE_SAM_REAL_MODEL,
    'Set VARVE_MOBILE_SAM_REAL_MODEL=1 (model download + COOP/COEP server required)',
  );

  test('corrects a wildlife click, reviews four candidates, and applies the reviewed mask', async ({
    page,
  }, testInfo) => {
    test.setTimeout(1_200_000);
    page.on('console', (message) => {
      if (
        message.type() === 'error' ||
        /inference|model|worker|onnx|\[object-selection\]/i.test(message.text())
      ) {
        console.log(`[browser ${message.type()}] ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => console.log(`[browser pageerror] ${error.message}`));
    await navigateToEditorSlow(page);
    const { inspector, canvas } = await openObjectSelection(page);

    const installMobile = inspector.getByRole('button', {
      name: 'Install Object Selection model',
      exact: true,
    });
    const installText = (await installMobile.textContent()) ?? '';
    if (!/installed/i.test(installText)) {
      await installMobile.click();
      await expect(installMobile).toHaveText(/Faster local model installed/i, {
        timeout: 900000,
      });
    }

    // MobileSAM is intentionally experimental for automatic routing. Choose
    // it explicitly so this gate proves the real provider path rather than a
    // hidden downgrade from the measured Auto policy.
    const modelPreference = inspector.getByRole('combobox', {
      name: 'Object Selection model preference',
    });
    await modelPreference.click();
    await page.getByRole('option', { name: /Faster local — MobileSAM/i }).click();

    await inspector.getByRole('button', { name: 'Select Object' }).click();
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(400);
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();

    // The elephant occupies the centre of the public-domain photograph. Keep
    // the include point well inside the body: a point on the lower textured
    // edge is an intentionally documented MobileSAM ambiguity and can return
    // a high-scoring ground patch. The follow-up Shift-click lands on the
    // actually selected grass, so this tests a correction that a real user
    // can make rather than a decorative second prompt.
    await page.mouse.click(bounds!.x + bounds!.width * 0.42, bounds!.y + bounds!.height * 0.48);
    const firstPreview = inspector.getByText(/Preview ready/).first();
    const firstFailure = inspector.getByText(/Object selection failed/i).first();
    await expect(firstPreview.or(firstFailure)).toBeVisible({ timeout: 120000 });
    await expect(firstFailure).toBeHidden({ timeout: 1000 });
    const firstText = (await firstPreview.textContent()) ?? '';
    expect(firstText).toMatch(
      /predicted IoU score [\d.]+ · prompt match 100% · 4 candidate masks/i,
    );
    await canvas.screenshot({ path: testInfo.outputPath('mobile-elephant-click-preview.png') });
    await testInfo.attach('mobile-elephant-click-preview', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    await page.keyboard.down('Shift');
    await page.mouse.click(bounds!.x + bounds!.width * 0.12, bounds!.y + bounds!.height * 0.7);
    await page.keyboard.up('Shift');
    const correctedPreview = inspector.getByText(/Preview ready/).first();
    await correctedPreview.waitFor({ timeout: 120000 });
    const correctedText = (await correctedPreview.textContent()) ?? '';
    expect(correctedText).toMatch(
      /predicted IoU score [\d.]+ · prompt match 100% · 4 candidate masks/i,
    );
    await page.screenshot({ path: testInfo.outputPath('mobile-elephant-negative-correction.png') });
    await testInfo.attach('mobile-elephant-negative-correction', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    const nextCandidate = inspector.getByRole('button', {
      name: 'Next object-selection candidate',
    });
    await expect(nextCandidate).toBeVisible();
    const candidateLabel = inspector.getByText(/Candidate \d+ of 4/).first();
    await expect(candidateLabel).toBeVisible();
    const currentCandidate = Number.parseInt(
      (await candidateLabel.textContent())?.match(/Candidate (\d+) of 4/)?.[1] ?? '',
      10,
    );
    expect(currentCandidate).toBeGreaterThanOrEqual(1);
    await nextCandidate.click();
    const nextCandidateNumber = (currentCandidate % 4) + 1;
    await expect(inspector.getByText(`Candidate ${nextCandidateNumber} of 4`)).toBeVisible();

    // Review a second candidate, then return to the candidate that was
    // previewed as the best-ranked result. Applying an arbitrary alternative
    // would make the visual gate test a deliberately poor user choice rather
    // than the preview-to-commit identity contract.
    await inspector.getByRole('button', { name: 'Previous object-selection candidate' }).click();
    await expect(inspector.getByText(`Candidate ${currentCandidate} of 4`)).toBeVisible();
    const reviewedText = (await correctedPreview.textContent()) ?? '';
    const reviewedScore = reviewedText.match(
      /(?:predicted IoU score|heuristic score) [\d.]+/i,
    )?.[0];
    expect(reviewedScore).toBeTruthy();

    const targetReview = inspector.getByRole('checkbox', {
      name: 'I reviewed the highlighted target before applying',
    });
    await expect(targetReview).toBeVisible();
    await targetReview.check();

    await inspector.getByRole('button', { name: 'Apply as mask' }).click();
    await expect(
      inspector.getByRole('button', { name: 'Background Removal', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(inspector.getByText(reviewedScore!, { exact: false }).first()).toBeVisible({
      timeout: 120000,
    });
    await canvas.screenshot({ path: testInfo.outputPath('mobile-elephant-applied-mask.png') });
    await testInfo.attach('mobile-elephant-applied-mask', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
  });
});
