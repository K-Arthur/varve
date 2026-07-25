import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { navigateToEditor } from './shared';

test('select image and check tabs', async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));

  await navigateToEditor(page);

  // Drop an image
  const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
  const pngBuffer = readFileSync(path.join(FIXTURES_DIR, 'caf-test.png'));
  const base64 = pngBuffer.toString('base64');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');

  await page.evaluate(
    ({ cX, cY, b64 }) => {
      const binaryStr = atob(b64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'caf-test.png', { type: 'image/png' }));
      const target = document.querySelector('canvas.editor-canvas__content-layer');
      if (!target) throw new Error('content canvas not found');
      target.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: cX,
          clientY: cY,
          dataTransfer: transfer,
        }),
      );
      target.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: cX,
          clientY: cY,
          dataTransfer: transfer,
        }),
      );
    },
    { cX: box.x + 150, cY: box.y + 150, b64: base64 },
  );

  await page.waitForTimeout(2000);

  // After dropping, the image might be auto-selected. Let's check.
  // If we click the canvas at the image position, it should stay selected.
  await page.mouse.click(box.x + 170, box.y + 170);
  await page.waitForTimeout(500);

  // Check tabs after selection
  const tabInfo = await page.evaluate(() => {
    const tablist = document.querySelector('[role="tablist"][aria-label="Inspector tabs"]');
    if (!tablist) return 'no tablist';
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    return {
      count: tabs.length,
      names: tabs.map((t) => t.textContent?.trim()),
      selected: tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.textContent?.trim(),
    };
  });
  console.log('Tabs:', JSON.stringify(tabInfo));

  // Check if CAF section exists in the DOM
  const cafSection = page.locator('.caf-entry-button');
  console.log('CAF section exists:', await cafSection.isVisible().catch(() => false));

  // Check visibility of specific buttons
  console.log(
    'Crop btn exists:',
    await page
      .getByRole('button', { name: /crop/i })
      .isVisible()
      .catch(() => false),
  );
  console.log(
    'Remove BG btn exists:',
    await page
      .getByRole('button', { name: /remove background/i })
      .isVisible()
      .catch(() => false),
  );

  // Check all buttons with "open" in their name
  const allBtns = await page.getByRole('button').all();
  for (const btn of allBtns) {
    const text = await btn.textContent();
    if (text?.toLowerCase().includes('open')) {
      console.log('Found button with "open":', text.trim());
    }
  }

  // Try to find the ContentAwareFillSection disclosure
  const disclosures = page.locator('.disclosure-section');
  const discCount = await disclosures.count();
  console.log('Disclosure sections:', discCount);
  for (let i = 0; i < discCount; i++) {
    const text = await disclosures.nth(i).textContent();
    if (text?.includes('Content')) {
      console.log('Found CAF disclosure at', i);
    }
  }

  // Check if the Open button exists directly
  const cafEntryBtn = page.locator('.caf-entry-button');
  const cafCount = await cafEntryBtn.count();
  console.log('CAF entry buttons:', cafCount);
  if (cafCount > 0) {
    const text = await cafEntryBtn.first().textContent();
    console.log('CAF btn text:', text);
  }
});
