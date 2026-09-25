import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@wdio/globals';

const packageBytes = readFileSync(
  join(process.cwd(), 'tests/e2e/plugins/fixtures/style-audit.varveplugin'),
).toString('base64');

describe('Linux native application plugin path', () => {
  it('installs and runs a local WebAssembly package inside WebKitGTK', async () => {
    const newButton = await browser.$('[data-testid="new-file-button"]');
    await newButton.waitForDisplayed({ timeout: 30000 });
    await newButton.click();
    const create = await browser.$('[data-testid="create-design-button"]');
    await create.waitForDisplayed({ timeout: 10000 });
    await create.click();
    const canvas = await browser.$('[data-testid="editor-canvas"]');
    await canvas.waitForDisplayed({ timeout: 30000 });

    const rectangle = await browser.$('[data-tool="rect"]');
    await rectangle.waitForDisplayed({ timeout: 10000 });
    await rectangle.click();
    await browser.pause(100);
    await browser.tauri.execute(() => {
      const target = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
      if (!target) throw new Error('Native editor canvas is missing');
      const bounds = target.getBoundingClientRect();
      const emit = (type: string, x: number, y: number, buttons: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            buttons,
          }),
        );
      const x = bounds.left + bounds.width * 0.28;
      const y = bounds.top + bounds.height * 0.28;
      emit('pointerdown', x, y, 1);
      emit('pointermove', x + 180, y + 120, 1);
      emit('pointerup', x + 180, y + 120, 0);
    });
    const layer = await browser.$('[role="treeitem"]');
    await layer.waitForDisplayed({ timeout: 10000 });
    await expect(layer).toHaveAttribute('aria-selected', 'true');

    await browser.execute(() => window.dispatchEvent(new Event('varve:open-plugin-settings')));
    const packagePicker = await browser.$('input[aria-label="Choose a .varveplugin package"]');
    await packagePicker.waitForDisplayed({ timeout: 10000 });
    await browser.execute((encoded: string) => {
      const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'style-audit.varveplugin', { type: 'application/zip' }));
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Choose a .varveplugin package"]',
      );
      if (!input) throw new Error('Plugin package picker is missing');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, packageBytes);
    const review = await browser.$('.plugin-manager__review');
    await review.waitForDisplayed({ timeout: 15000 });
    await (await review.$('input[type="checkbox"]')).click();
    await (await review.$('//button[normalize-space()="Install and enable"]')).click();
    const card = await browser.$('.plugin-manager__card');
    await card.waitForDisplayed({ timeout: 15000 });
    await browser.waitUntil(async () => (await card.getText()).includes('Ready'), {
      timeout: 10000,
    });
    await (await card.$('.plugin-manager__command-row button')).click();
    await browser.waitUntil(async () => (await card.getText()).includes('Opacity:'), {
      timeout: 15000,
      timeoutMsg: 'WebKitGTK worker did not return the sample analysis',
    });
    if (process.env.VARVE_PLUGIN_NATIVE_SCREENSHOT) {
      await browser.saveScreenshot(process.env.VARVE_PLUGIN_NATIVE_SCREENSHOT);
    }
  });
});
