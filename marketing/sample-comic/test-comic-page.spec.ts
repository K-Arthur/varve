/**
 * Test the generated comic page in the web build
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test.describe('Halloween Cookies Comic Page', () => {
  test('should load and render the comic page', async ({ page }) => {
    // Start at the demo page
    await page.goto('http://localhost:5173/try/');

    // Wait for the app to be ready
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Read the document file
    const docPath = path.join('/workspace/marketing/sample-comic/halloween-cookies.varve');
    const docContent = await readFile(docPath, 'utf-8');
    const doc = JSON.parse(docContent);

    // Inject the document into the app via the platform API
    // This simulates opening a file
    await page.evaluate((docData) => {
      // Access the editor context if available
      if (window.__varve && window.__varve.loadDocument) {
        window.__varve.loadDocument(docData);
      } else {
        console.log('Loading document into localStorage for demo mode');
        localStorage.setItem('varve-demo-document', JSON.stringify(docData));
        location.reload();
      }
    }, doc);

    // Wait for render
    await page.waitForTimeout(3000);

    // Take a screenshot
    const screenshot = await page.screenshot({
      path: '/workspace/marketing/sample-comic/halloween-cookies-test.png',
      fullPage: true,
    });

    console.log('Screenshot saved to halloween-cookies-test.png');

    // Check that panels are visible
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    // Basic assertion that the page loaded
    expect(screenshot.length).toBeGreaterThan(1000);
  });
});
