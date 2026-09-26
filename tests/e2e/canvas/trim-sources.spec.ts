import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Trim sources — Mask / Alpha / Combined.
 *
 * Alpha is the no-model path: a pixel scan of the source image's own
 * transparency. Before the 2026-09-26 repair the Source control only rendered
 * when a selection mask existed and the Trim action was disabled without one,
 * so a transparent PNG could not be trimmed at all (the section only offered
 * DETR detection, which downloads a model) — and selecting Alpha *with* a
 * mask fell through to resetToSourceBounds, silently un-cropping the image.
 *
 * This fixture is genuinely transparent: synth-shapes.png is 800x600 with an
 * alpha bounding box of (100, 90)-(796, 510), verified from the file bytes.
 */
const TRANSPARENT_FIXTURE = path.resolve(
  'tests/fixtures/bg-removal-corpus/synthetic/synth-shapes.png',
);

test.describe('Trim sources', () => {
  test('Alpha trim works on a transparent image that has no selection mask', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await navigateToEditor(page);
    await page.locator('#file-import-input').setInputFiles(TRANSPARENT_FIXTURE);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });
    await page.getByRole('treeitem').first().click();

    const inspector = page.locator('.editor__inspector-panel');
    const cropToggle = inspector.getByRole('button', { name: 'Crop & Bounds', exact: true });
    await cropToggle.scrollIntoViewIfNeeded();
    await expect(cropToggle).toBeVisible({ timeout: 10000 });
    if ((await cropToggle.getAttribute('aria-expanded')) === 'false') {
      await cropToggle.click();
    }

    const trimSection = inspector.locator(
      '.insp-disclosure[data-section-id="image-crop"][data-subsection-id="trimToSubject"]',
    );
    await expect(trimSection).toBeVisible({ timeout: 10000 });
    await trimSection.scrollIntoViewIfNeeded();
    const subsectionToggle = trimSection
      .getByRole('button', { name: 'Trim to Subject', exact: true })
      .first();
    if ((await subsectionToggle.getAttribute('aria-expanded')) === 'false') {
      await subsectionToggle.click();
    }

    // Regression: the source control must be offered without a mask, and it
    // must default to the only source that exists for this image.
    const sourceGroup = trimSection.getByRole('radiogroup', { name: 'Trim source' });
    await expect(sourceGroup).toBeVisible({ timeout: 10000 });
    await expect(sourceGroup.getByRole('radio', { name: 'Alpha' })).toBeChecked();

    const trimButton = trimSection
      .locator('button.insp-btn-sm')
      .filter({ hasText: 'Trim to Subject' })
      .first();
    await expect(trimButton).toBeEnabled({ timeout: 5000 });

    const canvas = page.getByTestId('editor-canvas');
    const before = await canvas.screenshot();

    await trimButton.click();

    // A failed/empty scan reports instead of mutating (or silently resetting)
    // the document — an alert is a legitimate outcome, a hang is not.
    await expect(trimButton).toHaveText('Trim to Subject', { timeout: 30000 });
    const alerts = trimSection.getByRole('alert');
    const alertCount = await alerts.count();
    const alertText = alertCount > 0 ? ((await alerts.first().textContent()) ?? '') : '';
    await testInfo.attach('alpha-trim-status', {
      body: `alerts=${alertCount} text=${alertText}`,
      contentType: 'text/plain',
    });
    expect(alertCount, `trim reported an error: ${alertText}`).toBe(0);

    const after = await canvas.screenshot({ path: testInfo.outputPath('alpha-trim-after.png') });
    await testInfo.attach('alpha-trim-after', { body: after, contentType: 'image/png' });
    // The trim actually cropped: the visible artwork changed.
    expect(before.equals(after)).toBe(false);

    // Undo must restore the previous bounds — trim is one document update.
    await page.keyboard.press('Control+z');
    const undone = await canvas.screenshot({ path: testInfo.outputPath('alpha-trim-undo.png') });
    await testInfo.attach('alpha-trim-undo', { body: undone, contentType: 'image/png' });
    expect(undone.equals(after)).toBe(false);
  });
});
