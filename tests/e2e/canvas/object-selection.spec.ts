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
    await expect(
      page.getByTestId('toolbar').getByRole('button', { name: 'Object Selection' }),
    ).toHaveAttribute('aria-pressed', 'true');

    const canvas = page.getByTestId('editor-canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();

    // Exercise the real pointer path before inference. The draft box must be
    // visible immediately even on a clean install without SAM2 model files.
    await page.mouse.move(bounds!.x + bounds!.width * 0.3, bounds!.y + bounds!.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + bounds!.width * 0.7, bounds!.y + bounds!.height * 0.7);
    await page.mouse.up();
    await expect(inspector.getByRole('button', { name: 'Clear prompts' })).toBeVisible();
    await testInfo.attach('object-selection-draft-box', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await page
      .locator('.editor-canvas')
      .screenshot({ path: testInfo.outputPath('object-selection-draft-box.png') });
    await inspector.getByRole('button', { name: 'Clear prompts' }).click();

    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);

    // A clean install surfaces the explicit download requirement. A shared
    // local profile may already have the model, in which case the honest
    // alternative is the local-ready state (model-backed quality is covered
    // separately by the real-model gate).
    await expect(
      page
        .getByText(
          /one-time model download|download.*AI model|Object Selection model ready|safe inference budget/i,
        )
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(canvas).toBeVisible();
    await testInfo.attach('object-selection-editor-after', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
  });

  test('keeps a real photo usable when the browser reports 2 GB of memory', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'deviceMemory', {
        configurable: true,
        value: 2,
      });
    });
    await navigateToEditor(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/real-life-portrait.jpg'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });

    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('tab', { name: 'Adjustments' }).click();
    await inspector.getByRole('button', { name: 'Object Selection' }).click();
    await inspector.getByRole('button', { name: 'Select Object' }).click();

    const canvas = page.getByTestId('editor-canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);

    await expect(
      inspector.getByText(/Object Selection needs about .*safe inference budget/i),
    ).toBeVisible({ timeout: 30000 });
    await expect(canvas).toBeVisible();
    await testInfo.attach('object-selection-low-memory-real-photo', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await canvas.screenshot({
      path: testInfo.outputPath('object-selection-low-memory-real-photo.png'),
    });
  });

  test('removes one specific prompt marker by tapping it', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });

    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('tab', { name: 'Adjustments' }).click();
    await inspector.getByRole('button', { name: 'Object Selection' }).click();
    await inspector.getByRole('button', { name: 'Select Object' }).click();

    const canvas = page.getByTestId('editor-canvas');
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(400);
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const first = { x: bounds!.x + bounds!.width * 0.45, y: bounds!.y + bounds!.height * 0.45 };
    const second = { x: bounds!.x + bounds!.width * 0.55, y: bounds!.y + bounds!.height * 0.55 };

    await page.mouse.click(first.x, first.y);
    await page.mouse.click(second.x, second.y);
    await expect(inspector.getByTestId('object-selection-prompt-count')).toHaveText('2 prompts');
    await testInfo.attach('object-selection-two-prompts', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    // Tapping the first marker removes only that prompt; the second stays.
    await page.mouse.click(first.x, first.y);
    await expect(inspector.getByTestId('object-selection-prompt-count')).toHaveText('1 prompt', {
      timeout: 5000,
    });
    await testInfo.attach('object-selection-one-prompt', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await canvas.screenshot({ path: testInfo.outputPath('object-selection-one-prompt.png') });
    await expect(canvas).toBeVisible();
  });

  test('exposes separate prompt polarity and two-tap box controls', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });

    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('tab', { name: 'Adjustments' }).click();
    await inspector.getByRole('button', { name: 'Object Selection' }).click();
    await expect(
      inspector.getByRole('combobox', { name: 'Object Selection prompt input' }),
    ).toBeVisible();
    await expect(
      inspector.getByRole('combobox', { name: 'Object Selection prompt polarity' }),
    ).toBeVisible();
    await expect(
      inspector.getByRole('combobox', { name: 'Object Selection output combination' }),
    ).toBeVisible();

    const promptInput = inspector.getByRole('combobox', {
      name: 'Object Selection prompt input',
    });
    await promptInput.click();
    await page.getByRole('option', { name: 'Box hint — two taps or drag' }).click();
    const polarity = inspector.getByRole('combobox', {
      name: 'Object Selection prompt polarity',
    });
    await polarity.click();
    await page.getByRole('option', { name: 'Exclude new points' }).click();

    await inspector.getByRole('button', { name: 'Select Object' }).click();
    const canvas = page.getByTestId('editor-canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const first = { x: bounds!.x + bounds!.width * 0.25, y: bounds!.y + bounds!.height * 0.25 };
    const second = { x: bounds!.x + bounds!.width * 0.65, y: bounds!.y + bounds!.height * 0.7 };

    await page.mouse.click(first.x, first.y);
    await expect(inspector.getByTestId('object-selection-prompt-count')).toHaveText('1 prompt');
    await testInfo.attach('object-selection-box-first-corner', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    await page.mouse.click(second.x, second.y);
    await expect(inspector.getByTestId('object-selection-prompt-count')).toHaveText('1 prompt');
    await expect(canvas).toBeVisible();
    await testInfo.attach('object-selection-box-two-tap', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
  });
});
