/**
 * E2E: Figma import integration smoke test.
 *
 * Verifies the editor loads correctly with the Figma parser registered
 * and that the file import input accepts .fig files. The actual import
 * pipeline is covered by unit tests in packages/import/src/figma.test.ts.
 */

import path from 'node:path';
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

  test('imports editable Figma JSON through the file picker without a report for a clean file', async ({
    page,
  }) => {
    await navigateToEditor(page);
    const fixture = {
      name: 'Basic Figma UI',
      document: {
        type: 'DOCUMENT',
        children: [
          {
            id: 'page:1',
            type: 'CANVAS',
            name: 'Design',
            absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
            children: [
              {
                id: 'frame:1',
                type: 'FRAME',
                name: 'Auto Layout card',
                absoluteBoundingBox: { x: 40, y: 40, width: 280, height: 140 },
                layoutMode: 'VERTICAL',
                itemSpacing: 12,
                paddingTop: 16,
                paddingRight: 16,
                paddingBottom: 16,
                paddingLeft: 16,
                children: [
                  {
                    id: 'text:1',
                    type: 'TEXT',
                    name: 'Title',
                    characters: 'Imported text remains editable',
                    absoluteBoundingBox: { x: 56, y: 56, width: 248, height: 24 },
                    style: { fontFamily: 'Inter', fontSize: 18, fontWeight: 600 },
                  },
                  {
                    id: 'shape:1',
                    type: 'RECTANGLE',
                    name: 'Button',
                    absoluteBoundingBox: { x: 56, y: 92, width: 120, height: 40 },
                    rectangleCornerRadii: [8, 8, 8, 8],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    await page.locator('#file-import-input').setInputFiles({
      name: 'basic.fig',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(fixture), 'utf8'),
    });
    await expect(page.locator('.layers-panel')).toContainText('Auto Layout card', {
      timeout: 30000,
    });
    await expect(page.locator('.import-results-overlay')).toHaveCount(0);
    await expect(page.locator('.editor-canvas canvas, canvas').first()).toBeVisible();
    const testResultsDir = process.env.PLAYWRIGHT_TEST_RESULT_DIR ?? 'test-results';
    await page.screenshot({
      path: `${testResultsDir}/figma-import-basic-ui.png`,
      fullPage: false,
    });
  });

  test('imports the checked-in native .fig fixture through the real file picker', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve(process.cwd(), 'packages/import/test-fixtures/OpenFigs.fig'));
    await expect(page.locator('.layers-panel')).toContainText('WhiteOpenFigOutlinedIcon', {
      timeout: 30000,
    });
    await expect(page.locator('.import-results-overlay')).toHaveCount(0);
    await expect(page.locator('.editor-canvas canvas, canvas').first()).toBeVisible();
  });

  test('shows the fidelity report when source semantics are degraded', async ({ page }) => {
    await navigateToEditor(page);
    const fixture = {
      document: {
        type: 'DOCUMENT',
        children: [
          {
            id: 'page:1',
            type: 'CANVAS',
            name: 'Design',
            children: [
              {
                id: 'boolean:1',
                type: 'BOOLEAN_OPERATION',
                name: 'Unsupported union',
                booleanOperation: 'UNION',
                absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
                children: [],
              },
            ],
          },
        ],
      },
    };
    await page.locator('#file-import-input').setInputFiles({
      name: 'degraded.fig',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(fixture), 'utf8'),
    });
    const report = page.locator('.import-results-overlay');
    await expect(report).toBeVisible({ timeout: 30000 });
    await expect(report).toContainText('Import Results');
    await report.getByRole('button', { name: /show details/i }).click();
    await expect(report).toContainText('Boolean operation');
  });

  test('opens font replacement for a missing rich-text run and applies it globally', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    const fixture = {
      name: 'Rich text font replacement',
      document: {
        type: 'DOCUMENT',
        children: [
          {
            id: 'page:1',
            type: 'CANVAS',
            name: 'Typography',
            children: [
              {
                id: 'frame:1',
                type: 'FRAME',
                name: 'Font replacement fixture',
                absoluteBoundingBox: { x: 40, y: 40, width: 420, height: 160 },
                children: [
                  {
                    id: 'text:1',
                    type: 'TEXT',
                    name: 'Rich text',
                    characters: 'This run needs a replacement',
                    absoluteBoundingBox: { x: 56, y: 56, width: 388, height: 32 },
                    style: { fontFamily: 'Inter', fontSize: 20, fontWeight: 400 },
                    characterStyleOverrides: Array.from(
                      { length: 'This run needs a replacement'.length },
                      () => 1,
                    ),
                    styleOverrideTable: {
                      '1': { fontFamily: 'Missing Display', fontSize: 20, fontWeight: 700 },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    await page.locator('#file-import-input').setInputFiles({
      name: 'rich-font.fig',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(fixture), 'utf8'),
    });

    const dialog = page.getByRole('dialog', { name: 'Missing Fonts' });
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await expect(dialog).toContainText('Missing Display');
    await expect(dialog).toContainText('rich-text runs');
    await page.screenshot({ path: testInfo.outputPath('font-replacement-dialog.png') });
    await expect(dialog.getByRole('button', { name: 'Replace All' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Replace All' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.layers-panel')).toContainText('Rich text');
  });
});
