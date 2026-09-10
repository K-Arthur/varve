import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@wdio/globals';

let nativeFrameIndex = 0;

async function captureHold(label: string, durationMs: number): Promise<void> {
  const frameDir = process.env.VARVE_NATIVE_CAPTURE_FRAMES_DIR;
  if (!frameDir) {
    await browser.pause(durationMs);
    return;
  }
  mkdirSync(frameDir, { recursive: true });
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    const filename = `${String(nativeFrameIndex++).padStart(4, '0')}-${label}.png`;
    await browser.saveScreenshot(join(frameDir, filename));
    await browser.pause(500);
  }
}

/**
 * Native Linux capture flow. This is deliberately a WDIO/Tauri spec rather
 * than a browser spec: startup, WebKitGTK, native IPC and persistence all run
 * in the desktop binary selected by wdio.conf.ts.
 */
describe('Linux first document — native Tauri path', () => {
  async function createDocument(): Promise<void> {
    const newButton = await browser.$('[data-testid="new-file-button"]');
    await newButton.waitForDisplayed({ timeout: 30000 });
    await newButton.click();
    const create = await browser.$('[data-testid="create-design-button"]');
    await create.waitForDisplayed({ timeout: 10000 });
    await create.click();
    await browser.$('[data-testid="editor-canvas"]').waitForDisplayed({ timeout: 30000 });
  }

  it('creates and edits the first document in a clean native profile', async () => {
    await createDocument();
    await captureHold('first-document', 5000);
    const canvas = await browser.$('[data-testid="editor-canvas"]');
    const rectTool = await browser.$('[data-tool="rect"]');
    await rectTool.waitForDisplayed({ timeout: 10000 });
    await rectTool.click();
    await browser.tauri.execute(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
      if (!canvas) throw new Error('native editor canvas not found');
      const box = canvas.getBoundingClientRect();
      const points = [
        [box.left + box.width * 0.28, box.top + box.height * 0.28],
        [box.left + box.width * 0.62, box.top + box.height * 0.62],
      ];
      const emit = (type: string, [clientX, clientY]: number[], buttons: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            buttons,
          }),
        );
      emit('pointerdown', points[0]!, 1);
      emit('pointermove', points[1]!, 1);
      emit('pointerup', points[1]!, 0);
    });
    await browser.pause(900);
    await expect(canvas).toBeDisplayed();
    expect((await browser.$$('[role="treeitem"]')).length).toBeGreaterThanOrEqual(1);
    await captureHold('shape', 5000);

    const textTool = await browser.$('[data-tool="text"]');
    if (await textTool.isDisplayed().catch(() => false)) {
      await textTool.click();
      await browser.tauri.execute(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
        if (!canvas) throw new Error('native editor canvas not found');
        const box = canvas.getBoundingClientRect();
        const clientX = box.left + box.width * 0.25;
        const clientY = box.top + box.height * 0.72;
        canvas.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            clientX,
            clientY,
            pointerId: 2,
            pointerType: 'mouse',
            isPrimary: true,
            buttons: 1,
          }),
        );
        canvas.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            clientX,
            clientY,
            pointerId: 2,
            pointerType: 'mouse',
            isPrimary: true,
            buttons: 0,
          }),
        );
      });
      const textEditor = await browser.$('textarea[aria-label^="Editing text"]');
      await textEditor.waitForDisplayed({ timeout: 5000 });
      await browser.keys('Escape');
      const items = await browser.$$('[role="treeitem"]');
      expect(items.length).toBeGreaterThanOrEqual(2);
      const typography = await browser.$('//button[normalize-space(.)="Typography"]');
      if (await typography.isExisting()) {
        if ((await typography.getAttribute('aria-expanded')) !== 'true') await typography.click();
      }
      const plainText = await browser.$('[aria-label="Text content"]');
      if (await plainText.isDisplayed().catch(() => false)) {
        await plainText.click();
        await browser.keys(['Control', 'a']);
        await browser.keys(['L', 'I', 'N', 'U', 'X']);
        expect(await plainText.getValue()).toBe('LINUX');
        await browser.keys('Tab');
      } else {
        const richText = await browser.$('[aria-label="Rich text content"]');
        await richText.waitForDisplayed({ timeout: 5000 });
        await richText.click();
        await browser.keys(['Control', 'a']);
        await browser.keys(['L', 'I', 'N', 'U', 'X']);
        expect(await richText.getText()).toContain('LINUX');
        await browser.keys('Tab');
      }
      await captureHold('text', 5000);
    }

    await captureHold('ready-to-save', 5000);

    // New documents are persisted through the native app's local store. The
    // status indicator is the user-visible acknowledgement of that save.
    await browser.keys(['Control', 's']);
    await browser.pause(1200);
    await captureHold('saved', 5000);
    await captureHold('final-document', 5000);
    const bodyText = await browser.tauri.execute(() => document.body.innerText);
    expect(bodyText).toMatch(/saved|saving|local/i);
    if (process.env.VARVE_NATIVE_CAPTURE_SCREENSHOT) {
      await browser.saveScreenshot(process.env.VARVE_NATIVE_CAPTURE_SCREENSHOT);
    }
    if (process.env.VARVE_NATIVE_CAPTURE_PASS_MARKER) {
      writeFileSync(process.env.VARVE_NATIVE_CAPTURE_PASS_MARKER, 'passed\n');
    }
  });
});
