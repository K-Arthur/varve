/**
 * E2E: Figma import integration smoke test.
 *
 * Verifies the editor loads correctly with the Figma parser registered
 * and that the file import input accepts .fig files. The actual import
 * pipeline is covered by unit tests in packages/import/src/figma.test.ts.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Figma import integration', () => {
  test('editor loads with Figma parser registered and file input accepts .fig', async ({
    page,
  }) => {
    await navigateToEditor(page);

    // Verify the editor loaded
    await expect(page.locator('.layers-panel')).toBeVisible({ timeout: 30000 });

    // Verify the import input accepts .fig files
    const importInput = page.locator('#file-import-input');
    const accept = await importInput.getAttribute('accept');
    expect(accept).toContain('.fig');

    // Verify the canvas is rendering
    const canvas = page.locator('.editor-canvas canvas, canvas').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    // Take a screenshot for visual verification
    const testResultsDir = process.env.PLAYWRIGHT_TEST_RESULT_DIR ?? 'test-results';
    await page.screenshot({
      path: `${testResultsDir}/figma-import-editor-loaded.png`,
      fullPage: false,
    });
  });
});
