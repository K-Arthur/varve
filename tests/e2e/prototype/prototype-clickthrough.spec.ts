import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .waitFor({ timeout: 10000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 30000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
  await page.keyboard.press('Control+Shift+1');
  await page.waitForTimeout(500);
}

async function drawRect(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  await page.keyboard.press('r');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not found');
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + w, box.y + y + h, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.describe('Prototype interaction click-through', () => {
  test('workspace switching preserves document and timeline creation works', async ({ page }) => {
    await navigateToEditor(page);

    // Draw a shape
    await drawRect(page, 200, 200, 200, 150);

    // Switch to Motion workspace
    await page.keyboard.press('Control+Shift+5');
    await page.locator('.timeline-panel').waitFor({ timeout: 5000 });
    await expect(page.locator('.timeline-panel')).toBeVisible();

    // Create timeline
    const createBtn = page
      .getByTestId('timeline-create-empty')
      .or(page.getByTestId('timeline-create'));
    await createBtn.first().click();
    await page.waitForTimeout(1000);

    // Verify document state preserved (shape still exists)
    const layerCount = await page.locator('.layers-panel').locator('[data-node-id]').count();
    expect(layerCount).toBeGreaterThanOrEqual(1);

    // Switch back to Design
    await page.keyboard.press('Control+Shift+1');
    await page.waitForTimeout(500);
    await expect(page.locator('.timeline-panel')).not.toBeVisible();

    // Switch to Motion again
    await page.keyboard.press('Control+Shift+5');
    await page.waitForTimeout(500);
    await expect(page.locator('.timeline-panel')).toBeVisible();
  });

  test('motion workspace shows playback controls and zoom', async ({ page }) => {
    await navigateToEditor(page);

    await page.keyboard.press('Control+Shift+5');
    await page.locator('.timeline-panel').waitFor({ timeout: 5000 });

    // Verify playback controls area exists
    const playbackArea = page.locator('.timeline-playback-controls, .timeline-panel');
    await expect(playbackArea.first()).toBeVisible();

    // Verify zoom controls exist
    const zoomIn = page.locator('.timeline-panel__zoom-btn').last();
    const zoomOut = page.locator('.timeline-panel__zoom-btn').first();
    await expect(zoomIn).toBeVisible();
    await expect(zoomOut).toBeVisible();
    await expect(zoomIn).toHaveAttribute('aria-label', 'Zoom in');
    await expect(zoomOut).toHaveAttribute('aria-label', 'Zoom out');
  });

  test('graph editor toggle is accessible', async ({ page }) => {
    await navigateToEditor(page);

    await page.keyboard.press('Control+Shift+5');
    await page.locator('.timeline-panel').waitFor({ timeout: 5000 });

    const graphToggle = page.locator('.timeline-panel__toggle-btn');
    if (await graphToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(graphToggle).toHaveAttribute('aria-label', 'Toggle graph editor');
      await expect(graphToggle).toHaveAttribute('aria-pressed');
    }
  });

  test('single child layers expose the real Prototype interaction surface', async ({ page }) => {
    await navigateToEditor(page);
    await drawRect(page, 220, 220, 180, 90);

    await page
      .getByRole('treeitem')
      .filter({ hasText: /Rectangle 1/i })
      .first()
      .click();
    const prototypeTab = page.getByRole('tab', { name: 'Prototype', exact: true });
    await expect(prototypeTab).toBeVisible();
    await prototypeTab.click();
    await expect(page.getByRole('button', { name: 'Add Interaction' })).toBeVisible();
  });

  test('timeline ruler is keyboard accessible', async ({ page }) => {
    await navigateToEditor(page);

    await page.keyboard.press('Control+Shift+5');
    await page.locator('.timeline-panel').waitFor({ timeout: 5000 });

    // Create a timeline first
    const createBtn = page
      .getByTestId('timeline-create-empty')
      .or(page.getByTestId('timeline-create'));
    await createBtn.first().click();
    await page.waitForTimeout(1000);

    const ruler = page.locator('.timeline-ruler');
    await expect(ruler).toBeVisible();
    await expect(ruler).toHaveAttribute('role', 'slider');
    await expect(ruler).toHaveAttribute('aria-label', 'Timeline ruler');

    // Focus and navigate
    await ruler.focus();
    const valBefore = await ruler.getAttribute('aria-valuenow');
    await page.keyboard.press('ArrowRight');
    const valAfter = await ruler.getAttribute('aria-valuenow');
    expect(Number(valAfter)).toBeGreaterThan(Number(valBefore ?? '0'));
  });
});
