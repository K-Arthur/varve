/// <reference types="@wdio/globals/types" />

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from '@wdio/globals';
import type {} from '@wdio/tauri-service';

/**
 * Native runtime proof for locally authored DTCG tokens: create a color and
 * same-type alias in the Variables and tokens dialog, bind the alias to real
 * artwork, edit its foundation, and undo that edit. This must run against the
 * current Tauri debug binary with the `wdio` feature enabled; it never seeds
 * editor state through IPC or test-only globals.
 *
 * Run with:
 *   VARVE_WDIO_SPECS=./tests/wdio/token-runtime.e2e.ts wdio run wdio.conf.ts
 */

const SCREENSHOT_DIR = resolve('docs/screenshots/dtcg-native-2026-09-25');
const FOUNDATION_PATH = 'local.brand.foundation';
const ALIAS_PATH = 'local.brand.alias';
const FOUNDATION_COLOR = '#c92a6a';
const EDITED_COLOR = '#1f8f5c';
const FOUNDATION_RGB = [201, 42, 106] as const;
const EDITED_RGB = [31, 143, 92] as const;
type WdioElement = ReturnType<WebdriverIO.Browser['$']>;

async function createDocument(): Promise<void> {
  const newButton = await browser.$('[data-testid="new-file-button"]');
  await newButton.waitForDisplayed({ timeout: 30000 });
  await newButton.click();
  const createButton = await browser.$('[data-testid="create-design-button"]');
  await createButton.waitForDisplayed({ timeout: 10000 });
  await createButton.click();
  await browser.$('[data-testid="editor-canvas"]').waitForDisplayed({ timeout: 30000 });
}

async function openVariablesDialog() {
  const view = await browser.$(
    '//div[@role="menubar" and @aria-label="Application"]/button[@role="menuitem" and normalize-space(.)="View"]',
  );
  await view.waitForDisplayed({ timeout: 10000 });
  await view.click();
  const panels = await browser.$(
    '//div[@role="menu" and @aria-label="View"]//button[@role="menuitem" and .//span[normalize-space()="Panels"]]',
  );
  await panels.waitForDisplayed({ timeout: 5000 });
  await panels.moveTo();
  const variablesItem = await browser.$(
    '//button[@role="menuitem" and contains(normalize-space(.), "Variables and Tokens")]',
  );
  await variablesItem.waitForDisplayed({ timeout: 5000 });
  await variablesItem.click();

  const dialog = await browser.$('dialog.varve-dialog[open]');
  await dialog.waitForDisplayed({ timeout: 10000 });
  await browser.waitUntil(async () => (await dialog.getText()).includes('Token Sync'), {
    timeout: 10000,
    timeoutMsg: 'Variables and tokens dialog did not finish opening',
  });
  await expandDisclosure(dialog, 'variables');
  await expandDisclosure(dialog, 'Token Sync panel');
  return dialog;
}

async function expandDisclosure(dialog: WdioElement, section: string): Promise<void> {
  const showButton = await dialog.$(`button[aria-label="Show ${section}"]`);
  if (await showButton.isDisplayed().catch(() => false)) await showButton.click();
}

async function chooseOption(form: WdioElement, label: string, option: string): Promise<void> {
  const trigger = await form.$(`[role="combobox"][aria-label="${label}"]`);
  await trigger.waitForDisplayed({ timeout: 5000 });
  await trigger.click();
  const choice = await browser.$(`//div[@role="option" and normalize-space(.)="${option}"]`);
  await choice.waitForDisplayed({ timeout: 5000 });
  await choice.click();
}

async function inputForLabel(form: WdioElement, labelText: string) {
  const label = await form.$(`label=${labelText}`);
  await label.waitForDisplayed({ timeout: 5000 });
  const id = await label.getAttribute('for');
  if (!id) throw new Error(`The ${labelText} input is missing its label association.`);
  return form.$(`.//input[@id="${id}"]`);
}

async function waitForFormToClose(form: WdioElement): Promise<void> {
  await browser.waitUntil(async () => !(await form.isDisplayed().catch(() => false)), {
    timeout: 5000,
    timeoutMsg: 'Local token form did not close after creation',
  });
}

async function createFoundationColor(dialog: WdioElement): Promise<void> {
  const panel = await dialog.$('.token-sync-panel');
  await (await panel.$('button=Create token')).click();
  const form = await dialog.$('form[aria-label="Create local token"]');
  await form.waitForDisplayed({ timeout: 5000 });
  await (await inputForLabel(form, 'Full token path')).setValue(FOUNDATION_PATH);
  await chooseOption(form, 'Token type', 'Color');
  await (await inputForLabel(form, 'Hex color value')).setValue(FOUNDATION_COLOR);
  await (await form.$('button[type="submit"]')).click();
  await waitForFormToClose(form);

  const foundationRow = await dialog.$(
    `//tr[contains(@class, "variable-panel__table-row")][.//*[normalize-space(.)="${FOUNDATION_PATH}"]]`,
  );
  await foundationRow.waitForDisplayed({ timeout: 5000 });
}

async function createColorAlias(dialog: WdioElement): Promise<void> {
  const panel = await dialog.$('.token-sync-panel');
  await (await panel.$('button=Create token')).click();
  const form = await dialog.$('form[aria-label="Create local token"]');
  await form.waitForDisplayed({ timeout: 5000 });
  await (await inputForLabel(form, 'Full token path')).setValue(ALIAS_PATH);
  await chooseOption(form, 'Token type', 'Color');
  await (await form.$('button[aria-label="Create as alias"]')).click();
  await chooseOption(form, 'Alias target', FOUNDATION_PATH);
  await (await form.$('button[type="submit"]')).click();
  await waitForFormToClose(form);

  const aliasRow = await dialog.$(
    `//tr[contains(@class, "variable-panel__table-row")][.//*[normalize-space(.)="${ALIAS_PATH}"]]`,
  );
  await aliasRow.waitForDisplayed({ timeout: 5000 });
}

async function drawRectangle(): Promise<void> {
  const rectangleTool = await browser.$('[data-tool="rect"]');
  if (await rectangleTool.isDisplayed().catch(() => false)) {
    await rectangleTool.click();
  } else {
    const moreTools = await browser.$('[data-testid="toolbar-more-tools"]');
    await moreTools.waitForDisplayed({ timeout: 5000 });
    await moreTools.click();
    const shapesCategory = await browser.$(
      '//div[@role="menu" and @aria-label="More tools"]//button[@role="menuitem" and .//span[normalize-space()="Shapes"]]',
    );
    await shapesCategory.waitForDisplayed({ timeout: 5000 });
    await shapesCategory.click();
    const rectangleItem = await browser.$(
      '//div[@role="menu" and contains(@aria-label, "submenu")]//button[@role="menuitem" and .//span[normalize-space()="Rectangle"]]',
    );
    await rectangleItem.waitForDisplayed({ timeout: 5000 });
    await rectangleItem.click();
  }

  await browser.pause(100);
  await browser.tauri.execute(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
    if (!canvas) throw new Error('Native editor canvas was not found');
    const box = canvas.getBoundingClientRect();
    const startX = box.left + box.width * 0.28;
    const startY = box.top + box.height * 0.28;
    const endX = box.left + box.width * 0.62;
    const endY = box.top + box.height * 0.62;
    const dispatch = (type: string, clientX: number, clientY: number, buttons: number) =>
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
    dispatch('pointerdown', startX, startY, 1);
    dispatch('pointermove', endX, endY, 1);
    dispatch('pointerup', endX, endY, 0);
  });
  await browser.$('[role="treeitem"]').waitForDisplayed({ timeout: 10000 });
}

async function ensureFillSectionExpanded(): Promise<void> {
  const section = await browser.$('[data-section-id="fills"]');
  await section.waitForDisplayed({ timeout: 10000 });
  const disclosure = await section.$('.insp-disclosure__trigger');
  await disclosure.waitForDisplayed({ timeout: 5000 });
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  await section.$('.insp-fill-row').waitForDisplayed({ timeout: 5000 });
}

async function bindAliasToFill(): Promise<void> {
  await ensureFillSectionExpanded();
  const fillRow = await browser.$('.insp-fill-row');
  await (await fillRow.$('button[aria-label="Fill actions"]')).click();
  const linkItem = await browser.$(
    '//button[@role="menuitem" and normalize-space(.)="Link to variable"]',
  );
  await linkItem.waitForDisplayed({ timeout: 5000 });
  await linkItem.click();

  const picker = await browser.$('.binding-menu');
  await picker.waitForDisplayed({ timeout: 5000 });
  const search = await picker.$('input[aria-label="Search variables"]');
  await search.setValue(ALIAS_PATH);
  const candidate = await picker.$(
    `//div[@role="option" and contains(normalize-space(.), "${ALIAS_PATH}")]`,
  );
  await candidate.waitForDisplayed({ timeout: 5000 });
  await candidate.click();
  const badge = await browser.$(`button[aria-label^="Linked to ${ALIAS_PATH}"]`);
  await badge.waitForDisplayed({ timeout: 10000 });
}

async function readCanvasRgb(): Promise<number[] | null> {
  return browser.tauri.execute(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    const context = canvas?.getContext('2d');
    if (!canvas || !context || canvas.clientWidth === 0 || canvas.clientHeight === 0) return null;
    // The shape spans 28–62% of the canvas, so 45% samples its interior.
    const cssX = canvas.clientWidth * 0.45;
    const cssY = canvas.clientHeight * 0.45;
    const x = Math.max(
      0,
      Math.min(canvas.width - 1, Math.round((cssX * canvas.width) / canvas.clientWidth)),
    );
    const y = Math.max(
      0,
      Math.min(canvas.height - 1, Math.round((cssY * canvas.height) / canvas.clientHeight)),
    );
    return Array.from(context.getImageData(x, y, 1, 1).data).slice(0, 3);
  });
}

async function waitForCanvasRgb(expected: readonly number[], label: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      const actual = await readCanvasRgb();
      return (
        actual !== null &&
        expected.every((channel, index) => Math.abs((actual[index] ?? 0) - channel) <= 10)
      );
    },
    { timeout: 15000, interval: 100, timeoutMsg: `Canvas did not paint ${label}` },
  );
}

async function editFoundationColor(dialog: WdioElement): Promise<void> {
  const row = await dialog.$(
    `//tr[contains(@class, "variable-panel__table-row")][.//*[normalize-space(.)="${FOUNDATION_PATH}"]]`,
  );
  await row.waitForDisplayed({ timeout: 5000 });
  await (await row.$('.variable-panel__value-btn')).click();
  const edit = await row.$('.variable-panel__edit-input');
  await edit.waitForDisplayed({ timeout: 5000 });
  await edit.setValue(EDITED_COLOR);
  await browser.keys('Enter');
  await browser.waitUntil(async () => !(await edit.isDisplayed().catch(() => false)), {
    timeout: 5000,
    timeoutMsg: 'Foundation color edit did not commit',
  });
}

async function closeVariablesDialog(dialog: WdioElement): Promise<void> {
  await (await dialog.$('button[aria-label="Close dialog"]')).click();
  await dialog.waitForDisplayed({ reverse: true, timeout: 5000 });
}

describe('Tauri desktop: local DTCG token runtime', () => {
  it('creates a color and alias, binds artwork, edits the foundation, and undoes the edit', async () => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await createDocument();
    await drawRectangle();

    let dialog = await openVariablesDialog();
    await createFoundationColor(dialog);
    await createColorAlias(dialog);
    await closeVariablesDialog(dialog);

    await bindAliasToFill();
    await waitForCanvasRgb(FOUNDATION_RGB, 'the locally authored alias color');
    await browser.saveScreenshot(resolve(SCREENSHOT_DIR, 'local-alias-bound.png'));

    dialog = await openVariablesDialog();
    await editFoundationColor(dialog);
    await closeVariablesDialog(dialog);
    await waitForCanvasRgb(EDITED_RGB, 'the edited foundation color through its alias');
    await browser.saveScreenshot(resolve(SCREENSHOT_DIR, 'local-alias-edited.png'));

    await browser.keys(['Control', 'z']);
    await waitForCanvasRgb(FOUNDATION_RGB, 'the foundation color restored by undo');
    await browser.saveScreenshot(resolve(SCREENSHOT_DIR, 'local-alias-undo.png'));

    // This is a direct native IPC list call. It proves command reachability;
    // it does not claim that a file watcher or change notification fired.
    const files = await browser.tauri.execute(async () => {
      const invoke = window.__TAURI__?.core?.invoke;
      if (!invoke) throw new Error('Tauri invoke API is unavailable');
      return invoke('home_list_files');
    });
    expect(Array.isArray(files)).toBe(true);
  });
});
