import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from '@wdio/globals';

const review = resolve('reports/ui-review/tonal-native');
const button = (text: string) => browser.$(`//button[normalize-space()="${text}"]`);
const numeric = (name: string) => browser.$(`input[role="spinbutton"][aria-label="${name}"]`);
async function value(name: string, text: string) {
  const field = await numeric(name);
  await field.waitForDisplayed();
  await field.setValue(text);
  await browser.keys('Enter');
}
async function add(name: string) {
  await (await browser.$('button.adj-panel__add-btn')).click();
  await (await browser.$(`//*[@role="menuitem" and normalize-space()="${name}"]`)).click();
}

describe('Tauri WebKitGTK tonal controls', () => {
  it('runs the versioned editors through the native application DOM', async () => {
    mkdirSync(review, { recursive: true });
    await browser.$('[data-testid="new-file-button"]').waitForDisplayed({ timeout: 30000 });
    await browser.$('[data-testid="new-file-button"]').click();
    await browser.$('[data-testid="create-design-button"]').waitForDisplayed();
    await browser.$('[data-testid="create-design-button"]').click();
    await browser.$('[data-testid="editor-canvas"]').waitForDisplayed({ timeout: 30000 });
    // Feed a File through the real DOM import handler in the native webview.
    // This exercises source decoding/storage, not the operating-system picker.
    const fixture = readFileSync(resolve('tests/e2e/fixtures/tonal-reference.png')).toString(
      'base64',
    );
    await browser.tauri.execute((encoded: string) => {
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'tonal-reference.png', { type: 'image/png' }));
      const input = document.querySelector('#file-import-input') as HTMLInputElement;
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, fixture);
    await browser
      .$('//*[@role="treeitem" and contains(@aria-label,"tonal-reference")]')
      .waitForDisplayed({ timeout: 30000 });
    await browser
      .$('//*[@role="menubar"]//*[@role="menuitem" and normalize-space()="Object"]')
      .click();
    await browser
      .$('//*[@role="menuitem" and starts-with(normalize-space(),"New Adjustment Layer")]')
      .click();
    await add('Curves');
    await value('Curve output', '12.5');
    await expect(await numeric('Curve output')).toHaveValue('12.5');
    await browser.saveScreenshot(resolve(review, '01-curves-webkit.png'));
    await add('Channel Mixer');
    await value('Red percent', '70');
    await expect(await numeric('Red percent')).toHaveValue('70');
    await add('White Balance');
    await value('Relative warmth value', '8.5');
    await expect(await numeric('Relative warmth value')).toHaveValue('8.5');
    await add('Split Toning');
    await value('Shadow saturation value (%)', '18');
    await expect(await numeric('Shadow saturation value (%)')).toHaveValue('18');
    await browser.saveScreenshot(resolve(review, '02-split-tone-webkit.png'));
    await add('Sharpen');
    await value('Sharpen radius value (units)', '1.75');
    await value('Sharpen amount value (%)', '65');
    await expect(await numeric('Sharpen radius value (units)')).toHaveValue('1.75');
    await (await button('Reset sharpening')).click();
    await expect(await numeric('Sharpen amount value (%)')).toHaveValue('0');
    await browser.saveScreenshot(resolve(review, '03-sharpen-webkit.png'));
  });
});
