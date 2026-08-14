import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Object Selection workflow', () => {
  test('shows the promptable selection surface and remains usable without a downloaded model', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });

    const inspector = page.locator('.editor__inspector-panel');
    // Object Selection lives on the Adjustments tab, which is auto-added for
    // image selections in every workspace (see PropertiesPanel tab logic).
    await inspector.getByRole('tab', { name: 'Adjustments' }).click();
    const section = inspector.getByText('Object Selection', { exact: true });
    await expect(section).toBeVisible();
    // The disclosure is collapsed until a session exists; expand it to reach
    // the controls (APG Disclosure trigger carries the title as its name).
    await inspector.getByRole('button', { name: 'Object Selection' }).click();
    await expect(inspector.getByRole('button', { name: 'Select Object' })).toBeVisible();
    await testInfo.attach('object-selection-editor-before', {
      body: await page.getByTestId('editor-canvas').screenshot(),
      contentType: 'image/png',
    });

    await inspector.getByRole('button', { name: 'Select Object' }).click();
    await expect(page.getByRole('button', { name: 'Select Subject' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const canvas = page.getByTestId('editor-canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);

    // A clean install has no model files yet. The interaction should surface
    // the explicit download requirement without throwing or corrupting the
    // canvas; model-backed preview coverage belongs to the release corpus.
    await expect(page.getByText(/one-time download|download.*AI model/i).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(canvas).toBeVisible();
    await testInfo.attach('object-selection-editor-after', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
  });
});
