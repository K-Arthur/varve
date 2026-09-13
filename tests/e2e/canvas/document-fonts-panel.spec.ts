import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Document fonts panel', () => {
  test('shows page-scoped usage and remains readable in a narrow dark inspector', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    const editorShell = page.locator('.editor-shell');
    const toolbarRoot = page.getByTestId('toolbar');
    if (!(await editorShell.isVisible({ timeout: 1500 }).catch(() => false))) {
      const recentFile = page.getByRole('gridcell').first();
      if (await recentFile.isVisible({ timeout: 1500 }).catch(() => false)) {
        await recentFile.click({ timeout: 10000 });
        await editorShell.waitFor({ state: 'visible', timeout: 60000 });
      }
    }
    await editorShell.waitFor({ state: 'visible', timeout: 60000 });
    await toolbarRoot.waitFor({ state: 'visible', timeout: 60000 });
    // Use the rendered tool action so the test does not depend on whichever
    // element retained focus after startup.
    const textTool = toolbarRoot.locator('[data-tool="text"]');
    await textTool.waitFor({ state: 'visible', timeout: 15000 });
    await textTool.click({ timeout: 15000 });
    // The empty-state card owns the middle of a blank canvas. Keep the drag
    // above it so the text tool receives the real pointer sequence instead of
    // the card swallowing the start event.
    await dragOnCanvas(page, 80, 100, 300, 160);
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    await page.keyboard.press('Control+Alt+f');
    const panel = page.locator('.document-fonts-panel').first();
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(panel.getByRole('heading', { name: 'Document fonts' })).toBeVisible();
    await expect(panel.getByRole('tab', { name: /Page|canvas/i })).toBeVisible();
    await expect(panel.getByText(/face[s]? in/)).toBeVisible();

    await page.setViewportSize({ width: 560, height: 760 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    const bounds = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        right: rect.right,
        viewport: window.innerWidth,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
    await page.screenshot({
      path: testInfo.outputPath('document-fonts-narrow-dark.png'),
      fullPage: true,
    });
  });
});
