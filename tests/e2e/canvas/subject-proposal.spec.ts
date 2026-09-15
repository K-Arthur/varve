import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Real-photo coverage for the model-backed automatic subject estimate.
 *
 * The bundled U2-Net Light model runs through the real worker/WASM path (no
 * download), so these tests exercise the shipped Fast quality level on
 * photographic content: a still life on a plain background, a portrait with
 * hair, and an interior scene where a foreground estimate is expected to be
 * weak. Assertions are structural plus exported screenshots; the masks are
 * reviewed by eye at the recorded output paths, because a synthetic fixture
 * cannot establish cutout quality.
 */

async function importPhoto(page: import('@playwright/test').Page, fixture: string) {
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve(`tests/e2e/fixtures/${fixture}`));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });
}

async function resetPhotoGateStartup(page: import('@playwright/test').Page) {
  // A previous real-model or image-processing run can leave the shared app's
  // crash-loop markers behind. This only resets startup flags for this fresh
  // Playwright context; it does not touch documents, models, or the profile.
  await page.addInitScript(() => {
    localStorage.setItem('strata-clean-shutdown', 'true');
    localStorage.removeItem('varve:crash-loop');
    localStorage.removeItem('varve:safe-mode');
  });
}

async function openSelectionSources(page: import('@playwright/test').Page) {
  const inspector = page.locator('.editor__inspector-panel');
  // Selection Sources sits on the Properties tab (the default), not on the
  // Adjustments tab that hosts the promptable Object Selection section.
  const trigger = inspector.getByRole('button', { name: 'Selection Sources' });
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await trigger.click();
  return inspector;
}

async function readCandidateCoverage(inspector: import('@playwright/test').Locator) {
  const buttons = inspector.locator('[aria-label$="percent"]');
  const count = await buttons.count();
  const labels: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const label = await buttons.nth(index).getAttribute('aria-label');
    if (label) labels.push(label);
  }
  return labels;
}

test.describe('Automatic subject estimate on real photographs', () => {
  test('still life: Fast estimate previews, applies as selection, and applies as a mask', async ({
    page,
  }, testInfo) => {
    await resetPhotoGateStartup(page);
    await navigateToEditor(page, '/', { startupTimeout: 180000 });
    await importPhoto(page, 'real-life-still-life.jpg');
    const inspector = await openSelectionSources(page);

    await expect(
      inspector.getByRole('combobox', { name: 'Subject estimate quality' }),
    ).toBeVisible();
    await inspector.getByRole('button', { name: /^Select subject$/ }).click();

    const proposals = inspector.getByLabel('Subject proposals');
    await expect(proposals).toBeVisible({ timeout: 120000 });
    await expect(proposals.getByText(/U²-Net Light estimate/)).toBeVisible();

    const coverage = await readCandidateCoverage(inspector);
    expect(coverage.length).toBeGreaterThan(0);
    for (const label of coverage) {
      const match = /covers (\d+) percent/.exec(label);
      expect(match).not.toBeNull();
      const percent = Number(match![1]);
      expect(percent).toBeGreaterThan(0);
      expect(percent).toBeLessThan(100);
    }
    writeFileSync(testInfo.outputPath('subject-still-life-coverage.txt'), coverage.join('\n'));
    await testInfo.attach('subject-still-life-coverage', {
      body: coverage.join('\n'),
      contentType: 'text/plain',
    });

    const canvas = page.getByTestId('editor-canvas');
    const firstProposal = proposals.locator('button[aria-label$="percent"]').first();
    await firstProposal.click();
    await expect(inspector.getByRole('button', { name: 'Apply as mask' })).toBeDisabled();
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(400);
    await canvas.screenshot({
      path: testInfo.outputPath('subject-still-life-unconfirmed-preview.png'),
    });
    await testInfo.attach('subject-still-life-unconfirmed-preview', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await inspector
      .getByRole('checkbox', { name: 'I reviewed the highlighted subject before applying' })
      .check();
    await expect(inspector.getByRole('button', { name: 'Apply as mask' })).toBeEnabled();
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(400);
    await canvas.screenshot({
      path: testInfo.outputPath('subject-still-life-preview.png'),
    });
    await testInfo.attach('subject-still-life-preview', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    // Review the highlighted proposal before committing it. A proposal is not
    // an area selection until the user explicitly confirms this action.
    await inspector.getByRole('button', { name: 'Use selected candidate' }).click();
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      /selected \(U²-Net Light estimate\)/i,
      { timeout: 10000 },
    );
    await expect(inspector.getByText('Refine selection')).toBeVisible({ timeout: 10000 });
    await expect(inspector.getByRole('button', { name: 'Save selection' })).toBeEnabled();

    // Re-review the same candidate before creating the separate persistent
    // mask output. The two commit paths must not share a hidden auto-apply.
    await inspector
      .getByLabel('Subject proposals')
      .locator('button[aria-label$="percent"]')
      .first()
      .click();
    await inspector
      .getByRole('checkbox', { name: 'I reviewed the highlighted subject before applying' })
      .check();
    await inspector.getByRole('button', { name: 'Apply as mask' }).click();
    await expect(
      page
        .getByText(/Selection applied as a mask|subject.*applied as a mask|applied as a mask/i)
        .first(),
    ).toBeVisible({ timeout: 10000 });
    await canvas.screenshot({
      path: testInfo.outputPath('subject-still-life-mask.png'),
    });
    await testInfo.attach('subject-still-life-mask', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
  });

  test('portrait with hair: Fast estimate produces a reviewable proposal and mask', async ({
    page,
  }, testInfo) => {
    await resetPhotoGateStartup(page);
    await navigateToEditor(page, '/', { startupTimeout: 180000 });
    await importPhoto(page, 'real-life-braided-portrait.jpg');
    const inspector = await openSelectionSources(page);

    await inspector.getByRole('button', { name: /^Select subject$/ }).click();
    const proposals = inspector.getByLabel('Subject proposals');
    await expect(proposals).toBeVisible({ timeout: 120000 });
    await expect(proposals.getByText(/U²-Net Light estimate/)).toBeVisible();
    await proposals.locator('button[aria-label$="percent"]').first().click();
    await expect(inspector.getByRole('button', { name: 'Apply as mask' })).toBeDisabled();
    await inspector
      .getByRole('checkbox', { name: 'I reviewed the highlighted subject before applying' })
      .check();
    await expect(inspector.getByRole('button', { name: 'Apply as mask' })).toBeEnabled();

    const canvas = page.getByTestId('editor-canvas');
    // Frame the subject before capturing so the overlay and the applied mask
    // are judged at a useful zoom rather than a corner crop.
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(400);
    await canvas.screenshot({
      path: testInfo.outputPath('subject-portrait-hair-preview.png'),
    });
    await testInfo.attach('subject-portrait-hair-preview', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    await inspector.getByRole('button', { name: 'Apply as mask' }).click();
    await page.waitForTimeout(500);
    await canvas.screenshot({
      path: testInfo.outputPath('subject-portrait-hair-mask.png'),
    });
    await testInfo.attach('subject-portrait-hair-mask', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await expect(canvas).toBeVisible();
  });

  test('interior scene: the estimate stays reviewable and honest about its limits', async ({
    page,
  }, testInfo) => {
    await resetPhotoGateStartup(page);
    await navigateToEditor(page, '/', { startupTimeout: 180000 });
    await importPhoto(page, 'real-life-interior-room.jpg');
    const inspector = await openSelectionSources(page);

    await inspector.getByRole('button', { name: /^Select subject$/ }).click();

    const proposals = inspector.getByLabel('Subject proposals');
    const failure = inspector.locator('.insp-selection-sources__error');
    await expect(proposals.or(failure)).toBeVisible({ timeout: 120000 });

    const canvas = page.getByTestId('editor-canvas');
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(400);
    await canvas.screenshot({
      path: testInfo.outputPath('subject-interior-room-outcome.png'),
    });
    await testInfo.attach('subject-interior-room-outcome', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    if (await proposals.isVisible()) {
      // Honest copy is required whether the model ran or the model-free
      // fallback was used: the hint must never claim semantic recognition.
      await expect(
        proposals.getByText(/Review it before applying|model-free estimate/i),
      ).toBeVisible();
    } else {
      await expect(failure).toContainText(/subject|foreground/i);
    }
  });
});
