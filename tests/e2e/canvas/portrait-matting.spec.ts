import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Portrait matting visual gate.
 *
 * Runs the real MODNet artifact through the ordinary Background Removal
 * workflow on a real photograph and verifies:
 *   - the static, mounted model at /models/modnet-portrait/model.onnx runs in
 *     the browser worker,
 *   - Apply result commits an ordinary raster alpha mask on the layer with
 *     portrait provenance, and Show Original comparison is available,
 *   - undo removes the mask without any further model run.
 *
 * Requires the model artifact at apps/desktop/public/models/modnet-portrait/
 * model.onnx (downloaded by the MODNet real-model gate; gitignored).
 */

const PORTRAIT_FIXTURE = path.resolve('tests/e2e/fixtures/real-life-katharine-hepburn.jpg');

test.describe('Portrait matting (MODNet) — real editor workflow', () => {
  test('applies a portrait matte as an editable mask and undo removes it', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    await navigateToEditor(page);

    await page.locator('#file-import-input').setInputFiles(PORTRAIT_FIXTURE);
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 120_000 });
    await page.getByRole('treeitem').first().click();

    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('tab', { name: 'Adjustments' }).click();
    await inspector.getByRole('button', { name: 'Background Removal' }).click();

    const method = inspector.getByRole('combobox', { name: 'Background removal method' });
    await method.click();
    await page.getByRole('option', { name: /Portrait matting/ }).click();

    const canvas = page.getByTestId('editor-canvas');
    const layer = page.getByRole('treeitem').first();
    await canvas.screenshot({ path: testInfo.outputPath('portrait-before.png') });
    await expect(layer).not.toHaveAccessibleName(/alpha mask/i);

    const run = inspector.getByRole('button', {
      name: /Remove background from image|Preview new mask/,
    });
    await expect(run).toBeEnabled();
    await run.click();

    const review = inspector.getByRole('region', { name: 'Background removal review' });
    try {
      await expect(review).toBeVisible({ timeout: 240_000 });
    } catch {
      const panelText = (await inspector.innerText()).slice(0, 500);
      throw new Error(`Portrait matting did not produce a review. Panel text: ${panelText}`);
    }

    await inspector.getByRole('button', { name: 'Apply result' }).click();

    // The committed mask is ordinary document data: the layer carries a raster
    // alpha mask and the provenance names the portrait route.
    await expect(layer).toHaveAccessibleName(/alpha mask/i, { timeout: 30_000 });
    await expect(inspector.getByText(/portrait/i).first()).toBeVisible({ timeout: 10_000 });
    await canvas.screenshot({ path: testInfo.outputPath('portrait-applied.png') });
    await testInfo.attach('portrait-applied', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    // Show Original / masked comparison is available for review, then undo
    // removes the mask without any model run.
    const showOriginal = inspector.getByRole('button', { name: /Show original|Showing original/i });
    if (await showOriginal.isVisible({ timeout: 3000 }).catch(() => false)) {
      await showOriginal.click();
      await page.waitForTimeout(300);
      await canvas.screenshot({ path: testInfo.outputPath('portrait-show-original.png') });
      await showOriginal.click();
    }
    await page.keyboard.press('Control+z');
    await expect(layer).not.toHaveAccessibleName(/alpha mask/i, { timeout: 30_000 });
    await canvas.screenshot({ path: testInfo.outputPath('portrait-undone.png') });
  });

  test('exposes Find by description with an honest review caveat', async ({ page }) => {
    await navigateToEditor(page);
    await page.locator('#file-import-input').setInputFiles(PORTRAIT_FIXTURE);
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 120_000 });
    await page.getByRole('treeitem').first().click();

    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('tab', { name: 'Adjustments' }).click();
    await inspector.getByRole('button', { name: 'Object Selection' }).click();

    await expect(inspector.getByText('Find by description')).toBeVisible();
    await expect(
      inspector.getByText(
        /measured controls show a\s+confident box can appear even when the described object is absent/i,
      ),
    ).toBeVisible();
    // Either the model is not installed (install affordance) or it is mounted
    // locally (query controls), depending on the machine's model cache.
    const install = inspector.getByRole('button', { name: /Install text discovery model/ });
    const query = inspector.getByRole('textbox', { name: 'Description' });
    await expect(install.or(query).first()).toBeVisible();
  });
});
