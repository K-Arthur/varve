import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const FIXTURE = path.resolve(__dirname, '../fixtures/test-image.png');

test.describe('Image perspective transform', () => {
  test('edits a four-corner image transform with real pointer input', async ({ page }) => {
    test.setTimeout(90000);
    await navigateToEditor(page);

    const input = page.locator('#file-import-input');
    await input.setInputFiles(FIXTURE);
    const layer = page.getByRole('treeitem').first();
    await layer.waitFor({ timeout: 15000 });
    await layer.click();

    // Perspective has an explicit modifier binding so it cannot collide with
    // the ordinary Pen shortcut (or the colour-blindness view commands).
    await page.keyboard.press('Alt+Shift+w');
    const handles = page.locator('button[aria-label^="Perspective corner"]');
    await expect(handles).toHaveCount(4, { timeout: 10000 });

    const topRight = handles.nth(1);
    const before = await topRight.boundingBox();
    expect(before).toBeTruthy();
    const startX = before!.x + before!.width / 2;
    const startY = before!.y + before!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 36, startY + 12, { steps: 4 });
    await page.mouse.up();

    const after = await topRight.boundingBox();
    expect(after).toBeTruthy();
    expect(after!.x).toBeGreaterThan(before!.x + 20);
    expect(after!.y).toBeGreaterThan(before!.y + 2);

    await page.keyboard.press('Enter');
    await expect(handles).toHaveCount(0);

    // Cancel a second session after changing a corner: the overlay should
    // disappear without leaving a second visible interaction surface.
    await page.keyboard.press('Alt+Shift+w');
    await expect(handles).toHaveCount(4, { timeout: 10000 });
    await page.keyboard.press('Escape');
    await expect(handles).toHaveCount(0);
  });
});
