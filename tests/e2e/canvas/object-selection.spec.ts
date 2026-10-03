import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function activateInspectorTab(page: import('@playwright/test').Page, label: string) {
  const inspector = page.locator('.editor__inspector-panel');
  const tab = inspector.getByRole('tab', { name: label, exact: true });

  if (await tab.isVisible()) {
    await tab.click();
  } else {
    const overflow = inspector.getByRole('button', { name: /^More inspector tabs/ });
    await expect(overflow).toBeVisible();
    await overflow.click();
    await page
      .getByRole('menu', { name: 'More inspector tabs' })
      .getByRole('menuitem', { name: label, exact: true })
      .click();
  }

  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

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
    await activateInspectorTab(page, 'Adjustments');
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
          /one-time model download|download.*AI model|Object Selection model ready|safe inference budget|not installed locally/i,
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
    await activateInspectorTab(page, 'Adjustments');
    await inspector.getByRole('button', { name: 'Object Selection' }).click();
    await inspector.getByRole('button', { name: 'Select Object' }).click();

    const canvas = page.getByTestId('editor-canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);

    // A constrained device must get an actionable refusal, whichever honest
    // reason routing reports first: the measured budget rejection, or an
    // explicit not-installed rejection for the smaller model that would fit.
    await expect(
      inspector
        .getByText(
          /Object Selection needs about .*safe inference budget|not installed locally\. Install or download it explicitly/i,
        )
        .first(),
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
    await activateInspectorTab(page, 'Adjustments');
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

    // Dragging a marker moves only that prompt; the second stays.
    const moved = { x: first.x + 32, y: first.y + 18 };
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(moved.x, moved.y, { steps: 3 });
    await page.mouse.up();
    await expect(inspector.getByTestId('object-selection-prompt-count')).toHaveText('2 prompts');
    await testInfo.attach('object-selection-moved-prompt', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await canvas.screenshot({ path: testInfo.outputPath('object-selection-moved-prompt.png') });

    // Tapping the moved marker removes only that prompt; the second stays.
    await page.mouse.click(moved.x, moved.y);
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
    await activateInspectorTab(page, 'Adjustments');
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

  test('accepts a box dragged in the reverse direction through the real pointer path', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });

    const inspector = page.locator('.editor__inspector-panel');
    await activateInspectorTab(page, 'Adjustments');
    await inspector.getByRole('button', { name: 'Object Selection' }).click();
    const promptInput = inspector.getByRole('combobox', {
      name: 'Object Selection prompt input',
    });
    await promptInput.click();
    await page.getByRole('option', { name: 'Box hint — two taps or drag' }).click();
    await inspector.getByRole('button', { name: 'Select Object' }).click();

    const canvas = page.getByTestId('editor-canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    // Start at the bottom-right corner and drag up-left: the committed box
    // must normalize its corners instead of collapsing to a degenerate
    // rectangle (this direction only had unit coverage before).
    const start = { x: bounds!.x + bounds!.width * 0.7, y: bounds!.y + bounds!.height * 0.75 };
    const end = { x: bounds!.x + bounds!.width * 0.3, y: bounds!.y + bounds!.height * 0.3 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();

    await expect(inspector.getByTestId('object-selection-prompt-count')).toHaveText('1 prompt');
    await testInfo.attach('object-selection-box-reverse-drag', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await canvas.screenshot({
      path: testInfo.outputPath('object-selection-box-reverse-drag.png'),
    });
  });

  test('keeps sub-threshold jitter a point and turns real drags into a box', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });

    const inspector = page.locator('.editor__inspector-panel');
    await activateInspectorTab(page, 'Adjustments');
    await inspector.getByRole('button', { name: 'Object Selection' }).click();
    await inspector.getByRole('button', { name: 'Select Object' }).click();

    const canvas = page.getByTestId('editor-canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const anchor = { x: bounds!.x + bounds!.width * 0.35, y: bounds!.y + bounds!.height * 0.35 };

    // Two CSS pixels of jitter sit below the 3 CSS px click threshold and
    // must still commit a point, not a two-pixel box.
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.down();
    await page.mouse.move(anchor.x + 2, anchor.y);
    await page.mouse.up();
    await expect(inspector.getByTestId('object-selection-prompt-count')).toHaveText('1 prompt');

    // A clearly suprathreshold drag in point mode commits a box on top of the
    // existing point: the total becomes two prompts. The drag must START away
    // from the existing marker — a press on the marker is the move gesture by
    // design. Had the jitter above been misread as a drag, the box here would
    // have replaced it and the total would stay at one.
    const dragStart = { x: bounds!.x + bounds!.width * 0.55, y: bounds!.y + bounds!.height * 0.55 };
    const dragEnd = { x: bounds!.x + bounds!.width * 0.75, y: bounds!.y + bounds!.height * 0.75 };
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 4 });
    await page.mouse.up();
    await expect(inspector.getByTestId('object-selection-prompt-count')).toHaveText('2 prompts');
    await testInfo.attach('object-selection-click-vs-drag-threshold', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await canvas.screenshot({
      path: testInfo.outputPath('object-selection-click-vs-drag-threshold.png'),
    });
  });

  test('refuses to run against a multi-selection with an actionable announcement', async ({
    page,
  }) => {
    await navigateToEditor(page);
    const input = page.locator('#file-import-input');
    await input.setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });
    await input.setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 15000 });

    // Activate the tool on the single selection first: with two images
    // selected the Adjustments panel swaps to the multi-edit surface and no
    // longer offers the Object Selection section at all.
    const inspector = page.locator('.editor__inspector-panel');
    await activateInspectorTab(page, 'Adjustments');
    await inspector.getByRole('button', { name: 'Object Selection', exact: true }).click();
    await inspector.getByRole('button', { name: 'Select Object', exact: true }).click();

    // Extend the selection to the second image while the tool is active;
    // layers-panel clicks are selection gestures, not prompts.
    const items = page.getByRole('treeitem');
    await items.nth(1).click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(2);

    const canvas = page.getByTestId('editor-canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();

    // One pointer-up with a multi-selection reaches the entry gate and must
    // announce the refusal instead of stranding the session mid-inference.
    await page.mouse.click(bounds!.x + bounds!.width * 0.4, bounds!.y + bounds!.height * 0.4);
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      /one image at a time/i,
      { timeout: 5000 },
    );
  });
});
