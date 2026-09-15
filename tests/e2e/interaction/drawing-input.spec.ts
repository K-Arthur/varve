/**
 * Browser-engine regression coverage for drawing ownership. These are
 * synthetic PointerEvents: they validate DOM routing and document/history
 * invariants, not USI pressure, palm rejection, or Crostini WebKitGTK.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

type PointerPacket = {
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';
  pointerId: number;
  pointerType: 'mouse' | 'pen' | 'touch';
  x: number;
  y: number;
  pressure?: number;
  buttons?: number;
};

async function dispatchPointer(page: Page, packet: PointerPacket): Promise<void> {
  await page.locator('canvas.editor-canvas__content-layer').evaluate((canvas, value) => {
    const rect = canvas.getBoundingClientRect();
    const packet = value as PointerPacket;
    canvas.dispatchEvent(
      new PointerEvent(packet.type, {
        bubbles: true,
        cancelable: true,
        pointerId: packet.pointerId,
        pointerType: packet.pointerType,
        clientX: rect.left + packet.x,
        clientY: rect.top + packet.y,
        button: packet.type === 'pointerdown' ? 0 : -1,
        buttons: packet.buttons ?? (packet.type === 'pointerup' ? 0 : 1),
        pressure: packet.pressure ?? (packet.pointerType === 'mouse' ? 0.5 : 0.4),
        isPrimary: packet.pointerId === 1,
      }),
    );
  }, packet);
}

async function overlayScreenshot(page: Page, name: string): Promise<void> {
  const path = test.info().outputPath(`${name}.png`);
  await page.locator('[data-testid="canvas-overlay"]').screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

test.describe('drawing pointer ownership', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await page.keyboard.press('Shift+p');
  });

  test('a second finger cancels only the provisional stroke and leaves no history artifact', async ({
    page,
  }) => {
    await dispatchPointer(page, {
      type: 'pointerdown',
      pointerId: 1,
      pointerType: 'touch',
      x: 140,
      y: 140,
    });
    await dispatchPointer(page, {
      type: 'pointermove',
      pointerId: 1,
      pointerType: 'touch',
      x: 190,
      y: 170,
    });
    await dispatchPointer(page, {
      type: 'pointerdown',
      pointerId: 2,
      pointerType: 'touch',
      x: 300,
      y: 220,
    });
    await overlayScreenshot(page, 'second-finger-cancel');
    await dispatchPointer(page, {
      type: 'pointermove',
      pointerId: 2,
      pointerType: 'touch',
      x: 320,
      y: 240,
    });
    await dispatchPointer(page, {
      type: 'pointerup',
      pointerId: 2,
      pointerType: 'touch',
      x: 320,
      y: 240,
    });
    await dispatchPointer(page, {
      type: 'pointerup',
      pointerId: 1,
      pointerType: 'touch',
      x: 190,
      y: 170,
    });

    await expect(page.getByRole('treeitem')).toHaveCount(0);
  });

  test('a pen stroke ignores a foreign finger instead of moving or cancelling it', async ({
    page,
  }) => {
    await dispatchPointer(page, {
      type: 'pointerdown',
      pointerId: 7,
      pointerType: 'pen',
      x: 130,
      y: 180,
      pressure: 0.2,
    });
    await dispatchPointer(page, {
      type: 'pointermove',
      pointerId: 7,
      pointerType: 'pen',
      x: 180,
      y: 210,
      pressure: 0.8,
    });
    await dispatchPointer(page, {
      type: 'pointerdown',
      pointerId: 8,
      pointerType: 'touch',
      x: 400,
      y: 260,
    });
    await dispatchPointer(page, {
      type: 'pointermove',
      pointerId: 8,
      pointerType: 'touch',
      x: 450,
      y: 300,
    });
    await dispatchPointer(page, {
      type: 'pointerup',
      pointerId: 8,
      pointerType: 'touch',
      x: 450,
      y: 300,
    });
    await dispatchPointer(page, {
      type: 'pointerup',
      pointerId: 7,
      pointerType: 'pen',
      x: 180,
      y: 210,
      pressure: 0,
    });

    await expect(page.getByRole('treeitem')).toHaveCount(0);
  });

  test('the contact remaining after a pinch does not become an accidental stroke', async ({
    page,
  }) => {
    await dispatchPointer(page, {
      type: 'pointerdown',
      pointerId: 1,
      pointerType: 'touch',
      x: 180,
      y: 180,
    });
    await dispatchPointer(page, {
      type: 'pointerdown',
      pointerId: 2,
      pointerType: 'touch',
      x: 360,
      y: 180,
    });
    await dispatchPointer(page, {
      type: 'pointermove',
      pointerId: 1,
      pointerType: 'touch',
      x: 150,
      y: 180,
    });
    await dispatchPointer(page, {
      type: 'pointermove',
      pointerId: 2,
      pointerType: 'touch',
      x: 390,
      y: 180,
    });
    await dispatchPointer(page, {
      type: 'pointerup',
      pointerId: 2,
      pointerType: 'touch',
      x: 390,
      y: 180,
    });
    await dispatchPointer(page, {
      type: 'pointermove',
      pointerId: 1,
      pointerType: 'touch',
      x: 260,
      y: 250,
    });
    await dispatchPointer(page, {
      type: 'pointerup',
      pointerId: 1,
      pointerType: 'touch',
      x: 260,
      y: 250,
    });

    await expect(page.getByRole('treeitem')).toHaveCount(0);
  });
});
