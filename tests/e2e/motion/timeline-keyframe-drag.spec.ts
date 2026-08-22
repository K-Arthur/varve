import { expect, test } from '@playwright/test';
import { createTimelineInEditor, navigateToEditor } from './helpers';

test.describe('Timeline keyframe editing', () => {
  test('dragging a keyframe updates its authored progress', async ({ page }) => {
    await navigateToEditor(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('content canvas not found');
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 180, box.y + 160);
    await page.mouse.down();
    await page.mouse.move(box.x + 360, box.y + 300, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.press('v');
    await createTimelineInEditor(page);
    await page.getByRole('treeitem').first().click();

    await page.keyboard.press('Alt+p');
    const ruler = page.getByRole('slider', { name: 'Timeline ruler' });
    await ruler.focus();
    for (let i = 0; i < 5; i += 1) await ruler.press('Shift+ArrowRight');
    await page.mouse.click(box.x + 240, box.y + 220);
    await page.mouse.move(box.x + 240, box.y + 220);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 180, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press('Alt+p');

    const keyframes = page.locator('.timeline-track-row__keyframe');
    await expect(keyframes).toHaveCount(2);
    const second = keyframes.nth(1);
    const before = await second.getAttribute('aria-label');
    await second.scrollIntoViewIfNeeded();
    const keyBox = await second.boundingBox();
    if (!keyBox) throw new Error('second keyframe not laid out');
    const keyCenter = {
      x: keyBox.x + keyBox.width / 2,
      y: keyBox.y + keyBox.height / 2,
    };
    await page.mouse.move(keyCenter.x, keyCenter.y);
    await page.mouse.down();
    await page.mouse.move(keyCenter.x + 80, keyCenter.y, { steps: 10 });
    await page.mouse.up();
    await expect(keyframes.nth(1)).not.toHaveAttribute('aria-label', before ?? '');
  });
});
