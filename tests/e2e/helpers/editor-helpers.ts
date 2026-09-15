/**
 * E2E helpers for image import, constraint manipulation, and crop workflows.
 *
 * These helpers operate through the public UI (keyboard shortcuts, pointer
 * events, DOM queries) — they never reach into React internals or private state.
 */

import * as path from 'node:path';
import type { Page } from '@playwright/test';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

/**
 * Import an image into the editor via the hidden file input.
 * After import, waits for the image to appear in the layers tree.
 */
export async function importImageFile(
  page: Page,
  fixtureName: string = 'test-image.png',
  timeout = 15000,
): Promise<void> {
  const filePath = path.join(FIXTURES_DIR, fixtureName);
  const fileInput = page.locator('#file-import-input');
  await fileInput.setInputFiles(filePath);
  // Wait for the image to appear as a tree item
  await page.getByRole('treeitem').first().waitFor({ timeout });
}

/**
 * Drop an image file onto the canvas via synthetic DragEvent.
 * Uses a real fixture file read from disk.
 */
export async function dropImageOnCanvas(
  page: Page,
  fixtureName: string = 'test-image.png',
  canvasX = 300,
  canvasY = 300,
): Promise<void> {
  const filePath = path.join(FIXTURES_DIR, fixtureName);
  const fs = await import('node:fs');
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');
  const ext = fixtureName.split('.').pop()?.toLowerCase() ?? 'png';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');

  await page.evaluate(
    ({ clientX, clientY, b64, fileName, mimeType }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], fileName, { type: mimeType }));
      const target = document.querySelector('canvas.editor-canvas__content-layer');
      if (!target) throw new Error('content canvas not found');
      target.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          dataTransfer: transfer,
        }),
      );
      target.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          dataTransfer: transfer,
        }),
      );
    },
    {
      clientX: box.x + canvasX,
      clientY: box.y + canvasY,
      b64: base64,
      fileName: fixtureName,
      mimeType: mime,
    },
  );
}

/**
 * Create a frame with a child rectangle inside it.
 * Returns the canvas bounding box.
 */
export async function createFrameWithChild(
  page: Page,
): Promise<NonNullable<Awaited<ReturnType<ReturnType<Page['locator']>['boundingBox']>>>> {
  // Create frame
  await page.keyboard.press('f');
  const box = await dragOnCanvasSimple(page, 100, 100, 500, 400);
  // Create child rect inside the frame
  await page.keyboard.press('r');
  await dragOnCanvasSimple(page, 150, 150, 300, 250);
  // Select the child
  await page.keyboard.press('v');
  await page.waitForTimeout(200);
  await page.mouse.click(box.x + 225, box.y + 200);
  await page.waitForTimeout(200);
  return box;
}

/**
 * Create a frame with a child rectangle and select the child.
 */
export async function createFrameWithChildAndSelect(page: Page): Promise<{
  canvasBox: NonNullable<Awaited<ReturnType<ReturnType<Page['locator']>['boundingBox']>>>;
  childCenter: { x: number; y: number };
}> {
  // Create frame
  await page.keyboard.press('f');
  const canvasBox = await dragOnCanvasSimple(page, 100, 100, 500, 400);
  // Create child rect inside the frame
  await page.keyboard.press('r');
  const childBox = await dragOnCanvasSimple(page, 150, 150, 300, 250);
  const childCenter = {
    x: childBox.x + 225,
    y: childBox.y + 200,
  };
  // Select the child
  await page.keyboard.press('v');
  await page.waitForTimeout(200);
  await page.mouse.click(childCenter.x, childCenter.y);
  await page.waitForTimeout(200);
  return { canvasBox, childCenter };
}

/**
 * Select an image node by clicking on it (assumes it's the only layer).
 */
export async function selectImageNode(page: Page): Promise<void> {
  await page.keyboard.press('v');
  await page.waitForTimeout(200);
  const treeItem = page.getByRole('treeitem').first();
  await treeItem.click();
  await page.waitForTimeout(200);
}

/**
 * Enter crop mode for the currently selected node.
 */
export async function enterCropMode(page: Page): Promise<void> {
  await page.keyboard.press('c');
}

/**
 * Drag a crop handle from one position to another.
 * handle: 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se'
 */
export async function dragCropHandle(
  page: Page,
  handle: string,
  dx: number,
  dy: number,
): Promise<void> {
  const handleBtn = page.getByRole('button', { name: `Resize crop ${handle}`, exact: true });
  const box = await handleBtn.boundingBox();
  if (!box) throw new Error(`crop handle ${handle} not found`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy);
  await page.mouse.up();
}

/**
 * Set the inspector width/height fields for the selected node.
 */
export async function setInspectorSize(page: Page, width: number, height: number): Promise<void> {
  const wField = page.getByRole('spinbutton', { name: 'W (px)', exact: true });
  await wField.fill(String(width));
  await wField.press('Enter');
  const hField = page.getByRole('spinbutton', { name: 'H (px)', exact: true });
  await hField.fill(String(height));
  await hField.press('Enter');
  await page.waitForTimeout(200);
}

/**
 * Set a constraint via the dropdown.
 */
export async function setConstraintViaDropdown(
  page: Page,
  axis: 'horizontal' | 'vertical',
  value: string,
): Promise<void> {
  const label = axis === 'horizontal' ? 'Horizontal constraint' : 'Vertical constraint';
  const select = page.getByRole('combobox', { name: label });
  await select.click();
  await page.getByRole('option', { name: value, exact: true }).click();
  await page.waitForTimeout(100);
}

/**
 * Click a pin in the visual constraint control.
 */
export async function clickConstraintPin(page: Page, pinLabel: string): Promise<void> {
  const pin = page.getByRole('button', { name: pinLabel, exact: true });
  await pin.click();
  await page.waitForTimeout(100);
}

/**
 * Get the node count from the layers tree.
 */
export async function getNodeCount(page: Page): Promise<number> {
  const items = page.getByRole('treeitem');
  return await items.count();
}

/**
 * Simple drag helper (reuses the same logic as shared.ts but standalone).
 */
async function dragOnCanvasSimple(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  const sx = box.x + fromX;
  const sy = box.y + fromY;
  const ex = box.x + toX;
  const ey = box.y + toY;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(Math.round((sx + ex) / 2), Math.round((sy + ey) / 2));
  await page.mouse.move(ex, ey);
  await page.mouse.up();
  return box;
}
