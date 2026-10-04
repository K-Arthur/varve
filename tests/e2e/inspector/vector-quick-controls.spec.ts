import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('vector quick controls', () => {
  test('edits stacked fill and stroke from the contextual toolbar and keeps Inspector values in sync', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 850 });
    await navigateToEditor(page);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 170, 160, 400, 360);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const contextBar = page.locator('.context-control-bar');
    // Add Fill is the disclosure header action (a sibling of the labelled
    // Fill group), while the paint rows themselves live inside that group.
    const fillSection = page.locator('.insp-disclosure[data-section-id="fills"]');
    const addFill = fillSection.getByRole('button', { name: 'Add fill' });
    await addFill.click();
    await page.getByRole('menuitem', { name: 'Solid', exact: true }).click();
    await expect(page.locator('.insp-fill-row')).toHaveCount(2);
    // Keep the stack non-empty while exposing the first row's color on the
    // canvas; otherwise the newly added opaque top fill hides the changed
    // primary fill even when the edit is correctly persisted.
    await page.getByRole('switch', { name: 'Hide Fill 2' }).click();

    // Use a real pointer in the contextual toolbar. Editing fill[0] used to
    // write only node.fill, which is ignored whenever a non-empty fills[] stack
    // exists. The Inspector row is the persisted-value oracle for this path.
    await contextBar.getByRole('button', { name: 'Fill colour' }).click();
    let picker = page.getByRole('dialog', { name: /pick fill colour/i });
    await expect(picker).toBeVisible();
    const fillHex = picker.getByRole('textbox', { name: 'Hex color' });
    await fillHex.fill('#aa22dd');
    await fillHex.press('Enter');
    await page.getByRole('button', { name: /^done$/i }).click();

    const inspectorFill = fillSection.locator('.insp-fill-row').first();
    await expect(inspectorFill.locator('.insp-swatch__value')).toHaveText('#AA22DD');
    await inspectorFill.getByRole('button', { name: 'Fill colour' }).click();
    picker = page.getByRole('dialog', { name: /pick fill colour/i });
    await expect(picker.getByRole('textbox', { name: 'Hex color' })).toHaveValue(/#aa22dd/i);
    await page.keyboard.press('Escape');

    await contextBar.getByRole('button', { name: 'Add stroke' }).click();
    await expect(contextBar.getByRole('button', { name: 'Stroke colour' })).toBeVisible();
    await contextBar.getByRole('button', { name: 'Stroke colour' }).click();
    const strokePicker = page.getByRole('dialog', { name: /pick stroke colour/i });
    await expect(strokePicker).toBeVisible();
    const strokeHex = strokePicker.getByRole('textbox', { name: 'Hex color' });
    await strokeHex.fill('#12ab34');
    await strokeHex.press('Enter');
    await page.getByRole('button', { name: /^done$/i }).click();

    const strokeSection = page.getByRole('group', { name: 'Stroke' });
    const inspectorStroke = strokeSection.locator('.insp-stroke-row').first();
    await inspectorStroke.getByRole('button', { name: 'Stroke colour' }).click();
    const persistedStrokePicker = page.getByRole('dialog', { name: /pick stroke colour/i });
    await expect(persistedStrokePicker.getByRole('textbox', { name: 'Hex color' })).toHaveValue(
      /#12ab34/i,
    );
    await page.keyboard.press('Escape');

    const quickStrokeWidth = contextBar.getByRole('spinbutton', { name: 'Stroke width' });
    await quickStrokeWidth.fill('6.5');
    await quickStrokeWidth.press('Enter');
    await quickStrokeWidth.blur();
    await expect(
      strokeSection.getByRole('spinbutton', { name: /Stroke weight \(px\)/i }),
    ).toHaveValue('6.5');

    const screenshot = test.info().outputPath('vector-quick-controls-persisted.png');
    await page.screenshot({ path: screenshot, animations: 'disabled' });
    await test.info().attach('vector-quick-controls-persisted', {
      path: screenshot,
      contentType: 'image/png',
    });
  });
});
