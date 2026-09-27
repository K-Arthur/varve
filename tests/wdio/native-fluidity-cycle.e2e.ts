import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect } from '@wdio/globals';

interface CycleEvidence {
  schemaVersion: 1;
  type: 'cycleComplete';
  index: number;
  phases: { open: 'completed'; interact: 'completed'; save: 'completed'; close: 'completed' };
  input: { source: 'webdriver-dom-synthetic'; trusted: false };
  webview: { visible: boolean; width: number; height: number };
  pixels: { before: number; after: number; changed: boolean };
  screenshot: { path: string; bytes: number };
  completedAt: string;
}

async function createDocument(): Promise<void> {
  const newButton = await browser.$('[data-testid="new-file-button"]');
  await newButton.waitForDisplayed({ timeout: 30000 });
  await newButton.click();
  const create = await browser.$('[data-testid="create-design-button"]');
  await create.waitForDisplayed({ timeout: 10000 });
  await create.click();
  await browser.$('[data-testid="editor-canvas"]').waitForDisplayed({ timeout: 30000 });
}

async function dispatchCanvasInput(): Promise<void> {
  await browser.tauri.execute(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
    if (!canvas) throw new Error('native editor canvas is not available');
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || document.visibilityState !== 'visible') {
      throw new Error('editor WebView is hidden or has no drawable surface');
    }
    const points = [
      [box.left + box.width * 0.42, box.top + box.height * 0.48],
      [box.left + box.width * 0.44, box.top + box.height * 0.49],
      [box.left + box.width * 0.46, box.top + box.height * 0.5],
      [box.left + box.width * 0.48, box.top + box.height * 0.51],
      [box.left + box.width * 0.5, box.top + box.height * 0.52],
      [box.left + box.width * 0.52, box.top + box.height * 0.53],
      [box.left + box.width * 0.54, box.top + box.height * 0.54],
    ];
    const emit = (
      type: 'pointerdown' | 'pointermove' | 'pointerup',
      [clientX, clientY]: number[],
      buttons: number,
      pressure: number,
    ) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          pointerId: 91,
          pointerType: 'pen',
          isPrimary: true,
          buttons,
          pressure,
        }),
      );
    emit('pointerdown', points[0]!, 1, 0.3);
    for (const point of points.slice(1)) emit('pointermove', point, 1, 0.55);
    emit('pointerup', points.at(-1)!, 0, 0);

    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        deltaY: 12,
      }),
    );
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        deltaY: -24,
        ctrlKey: true,
      }),
    );
  });
}

describe('Tauri fluidity workflow cycles — synthetic WebDriver input', () => {
  it('opens, edits, navigates, paints, saves, and closes every completed cycle', async function () {
    const cycles = Math.max(1, Number(process.env.VARVE_NATIVE_FLUIDITY_CYCLES ?? 1));
    const eventPath = process.env.VARVE_NATIVE_FLUIDITY_EVENTS;
    const artifactDirectory = process.env.VARVE_NATIVE_FLUIDITY_SCREENSHOTS;
    if (!eventPath || !artifactDirectory) {
      throw new Error('workflow evidence and screenshot output paths are required');
    }
    this.timeout(Math.max(120000, cycles * 12000));
    mkdirSync(dirname(eventPath), { recursive: true });
    mkdirSync(artifactDirectory, { recursive: true });

    for (let index = 1; index <= cycles; index++) {
      await createDocument();
      const viewport = await browser.tauri.execute(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
        if (!canvas) throw new Error('native editor canvas is not available');
        const box = canvas.getBoundingClientRect();
        if (document.visibilityState !== 'visible' || box.width <= 0 || box.height <= 0) {
          throw new Error('editor WebView is hidden or has no drawable surface');
        }
        const context = canvas.getContext('2d');
        if (!context) throw new Error('native canvas 2D readback is unavailable');
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        for (let offset = 0; offset < pixels.length; offset += 16) {
          hash ^= pixels[offset] ?? 0;
          hash = Math.imul(hash, 16777619);
          hash ^= pixels[offset + 1] ?? 0;
          hash = Math.imul(hash, 16777619);
          hash ^= pixels[offset + 2] ?? 0;
          hash = Math.imul(hash, 16777619);
        }
        return {
          visible: document.visibilityState === 'visible',
          width: box.width,
          height: box.height,
          fingerprint: hash >>> 0,
        };
      });
      expect(viewport.visible).toBe(true);

      const rectTool = await browser.$('[data-tool="rect"]');
      await rectTool.waitForDisplayed({ timeout: 10000 });
      await rectTool.click();
      await dispatchCanvasInput();

      await browser.keys(['Control', 'Shift', '3']);
      const paintTool = await browser.$('[data-tool="paint"]');
      await paintTool.waitForDisplayed({ timeout: 10000 });
      await paintTool.click();
      await dispatchCanvasInput();
      await browser.pause(250);
      expect((await browser.$$('[role="treeitem"]')).length).toBeGreaterThan(0);

      const currentPixels = await browser.tauri.execute(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
        const context = canvas?.getContext('2d');
        if (!canvas || !context) throw new Error('native canvas readback unavailable');
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        for (let offset = 0; offset < pixels.length; offset += 16) {
          hash ^= pixels[offset] ?? 0;
          hash = Math.imul(hash, 16777619);
          hash ^= pixels[offset + 1] ?? 0;
          hash = Math.imul(hash, 16777619);
          hash ^= pixels[offset + 2] ?? 0;
          hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
      });
      const changed = currentPixels !== viewport.fingerprint;
      expect(changed, 'editing and painting must change the canvas surface').toBe(true);

      await browser.keys(['Control', 's']);
      await (await browser.$('.save-status')).waitForDisplayed({ timeout: 30000 });
      await browser.waitUntil(
        async () => /saved/i.test(await (await browser.$('.save-status')).getText()),
        { timeout: 30000, timeoutMsg: 'native local save did not settle' },
      );

      const screenshotPath = join(artifactDirectory, `cycle-${String(index).padStart(3, '0')}.png`);
      await browser.saveScreenshot(screenshotPath);
      const screenshotBytes = statSync(screenshotPath).size;
      expect(screenshotBytes).toBeGreaterThan(1024);

      const closeButton = await browser.$('[role="tablist"] button[aria-label^="Close "]');
      await closeButton.waitForDisplayed({ timeout: 10000 });
      await closeButton.click();
      await browser.$('[data-testid="new-file-button"]').waitForDisplayed({ timeout: 15000 });

      const event: CycleEvidence = {
        schemaVersion: 1,
        type: 'cycleComplete',
        index,
        phases: { open: 'completed', interact: 'completed', save: 'completed', close: 'completed' },
        input: { source: 'webdriver-dom-synthetic', trusted: false },
        webview: { visible: viewport.visible, width: viewport.width, height: viewport.height },
        pixels: { before: viewport.fingerprint, after: currentPixels, changed },
        screenshot: { path: screenshotPath, bytes: screenshotBytes },
        completedAt: new Date().toISOString(),
      };
      appendFileSync(eventPath, `${JSON.stringify(event)}\n`);
    }
  });
});
