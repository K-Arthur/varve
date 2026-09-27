import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser, expect } from '@wdio/globals';

const packageBytes = readFileSync(
  join(process.cwd(), 'tests/e2e/plugins/fixtures/style-audit.varveplugin'),
).toString('base64');
const renamePackageBytes = readFileSync(
  join(process.cwd(), 'tests/e2e/plugins/fixtures/batch-rename.varveplugin'),
).toString('base64');

async function choosePackage(encoded: string, filename: string) {
  await browser.execute(
    (bytes: string, name: string) => {
      const content = Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([content], name, { type: 'application/zip' }));
      const picker = document.querySelector<HTMLInputElement>(
        'input[aria-label="Choose a .varveplugin package"]',
      );
      if (!picker) throw new Error('Plugin package picker is missing');
      picker.files = transfer.files;
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    },
    encoded,
    filename,
  );
}

async function captureNativeState(name: string) {
  const requestedPath = process.env.VARVE_PLUGIN_NATIVE_SCREENSHOT;
  if (!requestedPath) return;
  const prefix = requestedPath.replace(/\.png$/i, '');
  await browser.saveScreenshot(`${prefix}-${name}.png`);
}

describe('native application plugin path', () => {
  it('installs and runs a local WebAssembly package inside the platform WebView', async () => {
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
    await browser.execute(() => {
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
    await choosePackage(packageBytes, 'style-audit.varveplugin');
    const review = await browser.$('.plugin-manager__review');
    await review.waitForDisplayed({ timeout: 15000 });
    await captureNativeState('permission-review');
    await (await review.$('input[type="checkbox"]')).click();
    await (await review.$('//button[normalize-space()="Install and enable"]')).click();
    const card = await browser.$('.plugin-manager__card');
    await card.waitForDisplayed({ timeout: 15000 });
    await browser.waitUntil(async () => (await card.getText()).includes('Ready'), {
      timeout: 10000,
    });
    const styleArtwork = await card.$('.plugin-manager__artwork img');
    await expect(styleArtwork).toBeDisplayed();
    await expect(styleArtwork).toHaveAttribute(
      'alt',
      'Selected layer cards beside a style summary panel',
    );
    await (await card.$('.plugin-manager__command-row .plugin-manager__button')).click();
    await browser.waitUntil(async () => (await card.getText()).includes('Opacity:'), {
      timeout: 15000,
      timeoutMsg: 'WebKitGTK worker did not return the sample analysis',
    });
    await captureNativeState('analysis-manager');

    await (await browser.$('button[aria-label="Close dialog"]')).click();
    const inspector = await browser.$('.insp-plugin-sections');
    await inspector.waitForDisplayed({ timeout: 10000 });
    await expect(inspector).toHaveText(expect.stringContaining('Selection readiness'));
    await captureNativeState('inspector-analysis');

    await browser.execute(() => window.dispatchEvent(new Event('varve:open-plugin-settings')));
    const renamePicker = await browser.$('input[aria-label="Choose a .varveplugin package"]');
    await renamePicker.waitForDisplayed({ timeout: 10000 });
    await choosePackage(renamePackageBytes, 'batch-rename.varveplugin');
    const renameReview = await browser.$('.plugin-manager__review');
    await renameReview.waitForDisplayed({ timeout: 15000 });
    await (await renameReview.$('input[type="checkbox"]')).click();
    await (await renameReview.$('//button[normalize-space()="Install and enable"]')).click();
    const renameCard = await browser.$('.plugin-manager__card*=Number Selected Layers');
    await renameCard.waitForDisplayed({ timeout: 15000 });
    const renameArtwork = await renameCard.$('.plugin-manager__artwork img');
    await expect(renameArtwork).toBeDisplayed();
    await expect(renameArtwork).toHaveAttribute(
      'alt',
      'Three unnamed layers transform into a numbered list',
    );
    const unavailableRun = await renameCard.$(
      '.plugin-manager__command-row .plugin-manager__button',
    );
    await expect(unavailableRun).toHaveAttribute('aria-disabled', 'true');

    await (await renameCard.$('button*=Access')).click();
    const access = await renameCard.$('.plugin-manager__subsection[aria-label^="Access for"]');
    await access.waitForDisplayed({ timeout: 5000 });
    await (await access.$('input[type="checkbox"][id$="document.write"]')).click();
    await (await access.$('//button[normalize-space()="Save access"]')).click();
    const runRename = await renameCard.$('.plugin-manager__command-row .plugin-manager__button');
    await browser.waitUntil(async () => runRename.isEnabled(), {
      timeout: 10000,
    });
    await runRename.click();
    const preview = await renameCard.$('.plugin-manager__result');
    await preview.waitForDisplayed({ timeout: 15000 });
    await expect(preview).toHaveText(expect.stringContaining('Preview 1 numbered layer names'));
    await captureNativeState('rename-preview');
    await (await preview.$('button*=Apply 1 rename')).click();
    await browser.waitUntil(async () => (await layer.getText()).includes('01 ·'), {
      timeout: 10000,
    });

    await (await browser.$('button[aria-label="Close dialog"]')).click();
    await browser.keys([process.platform === 'darwin' ? 'META' : 'CTRL', 'Z']);
    await browser.waitUntil(async () => (await layer.getText()).includes('Rectangle'), {
      timeout: 10000,
    });
    await browser.keys([
      process.platform === 'darwin' ? 'META' : 'CTRL',
      process.platform === 'darwin' ? 'SHIFT' : 'SHIFT',
      'Z',
    ]);
    await browser.waitUntil(async () => (await layer.getText()).includes('01 ·'), {
      timeout: 10000,
    });
    await captureNativeState('rename-applied');

    await browser.execute(() => window.dispatchEvent(new Event('varve:open-plugin-settings')));
    const installedRenameCard = await browser.$('.plugin-manager__card*=Number Selected Layers');
    await installedRenameCard.waitForDisplayed({ timeout: 10000 });
    await (await installedRenameCard.$('button*=Remove')).click();
    await (await installedRenameCard.$('//button[normalize-space()="Remove plugin"]')).click();
    await browser.waitUntil(async () => (await browser.$$('.plugin-manager__card').length) === 1, {
      timeout: 10000,
    });
    const styleCard = await browser.$('.plugin-manager__card*=Selection Style Readiness');
    await (await styleCard.$('button*=Remove')).click();
    await (await styleCard.$('//button[normalize-space()="Remove plugin"]')).click();
    await browser.waitUntil(async () => (await browser.$$('.plugin-manager__card').length) === 0, {
      timeout: 10000,
    });
    await expect(layer).toHaveText(expect.stringContaining('01 ·'));
    if (process.env.VARVE_PLUGIN_NATIVE_SCREENSHOT) {
      await browser.saveScreenshot(process.env.VARVE_PLUGIN_NATIVE_SCREENSHOT);
    }
  });
});
