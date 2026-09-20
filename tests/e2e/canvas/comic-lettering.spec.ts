import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Comic lettering workflow', () => {
  test('turns a real dialogue line into an editable balloon and reviews fit', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180000);
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'visible', timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas has no bounds');

    // This is intentionally a natural dialogue line rather than a short
    // fixture: it exercises wrapping, padding, and the real text editor.
    await page.keyboard.press('t');
    await page.mouse.click(box.x + 260, box.y + 190);
    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeFocused();
    await page.keyboard.insertText(
      'Wait for me at the station. If the lights go out, take the east stairs and do not look back.',
    );
    await expect(editor).toHaveValue(
      'Wait for me at the station. If the lights go out, take the east stairs and do not look back.',
    );
    await page.keyboard.press('Escape');

    await page.keyboard.press('v');
    const textLayer = page.getByRole('treeitem', { name: /text:/i }).first();
    await expect(textLayer).toBeVisible();
    await textLayer.click();

    const addBalloon = page.getByRole('button', { name: 'Add speech balloon', exact: true });
    await expect(addBalloon).toBeVisible();
    await addBalloon.click();

    // The command selects the new group, then the Layers tree settles on the
    // next editor render. Re-selecting the group mirrors a common lettering
    // pass: create the balloon, then inspect its recipe before adjusting it.
    const balloonLayer = page.getByRole('treeitem', { name: /speech balloon/i }).first();
    await expect(balloonLayer).toBeVisible();
    await balloonLayer.click();

    const balloonSection = page.getByRole('button', { name: /Comic balloon/i });
    await expect(balloonSection).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Balloon fit policy' })).toHaveText(
      'Reflow in balloon',
    );
    const fitStatus = page.locator('[data-callout-fit-status]');
    await expect(fitStatus).toContainText(/dialogue fits|close to|exceeds/i);

    const layers = await page
      .getByRole('treeitem')
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute('aria-label') ?? item.textContent ?? ''),
      );
    expect(layers.some((name) => /balloon/i.test(name))).toBe(true);
    expect(layers.some((name) => /text/i.test(name))).toBe(true);

    await page.getByRole('button', { name: 'Fit balloon to text', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Balloon fit policy' })).toHaveText(
      'Fit balloon to text',
    );
    await expect(fitStatus).toContainText(/dialogue fits|close to|exceeds/i);

    await page.screenshot({
      path: testInfo.outputPath('comic-lettering-balloon-inspector.png'),
      animations: 'disabled',
      fullPage: false,
    });
    await canvas.screenshot({
      path: testInfo.outputPath('comic-lettering-balloon-canvas.png'),
      animations: 'disabled',
    });
  });
});
