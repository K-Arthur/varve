import { expect } from '@wdio/globals';

async function openNewDocument(): Promise<void> {
  // Pin the session to the main webview before querying elements. This also
  // disables the service's repeated focus-recovery IPC calls, which are not
  // available in the embedded WebKitGTK provider on this desktop.
  await browser.tauri.switchWindow('main');
  const homeButton = await browser.$('.editor-menubar__home');
  if (await homeButton.isDisplayed().catch(() => false)) {
    await homeButton.click();
  }
  const newButton = await browser.$('[data-testid="new-file-button"]');
  await newButton.waitForDisplayed({ timeout: 30000 });
  await newButton.click();
  const createButton = await browser.$('[data-testid="create-design-button"]');
  await createButton.waitForDisplayed({ timeout: 5000 });
  await createButton.click();
  await browser.$('[data-testid="editor-canvas"]').waitForDisplayed({ timeout: 30000 });
}

async function createRectangle(): Promise<void> {
  await openNewDocument();
  // The compact native viewport puts the shape tools in the context bar;
  // wider browser viewports expose the same command through the floating
  // toolbar. Resolve the action by its accessible name so this lane exercises
  // the user-visible command in either layout.
  const rectTool = await browser.$('[aria-label="Draw rectangle"]');
  if (!(await rectTool.isDisplayed().catch(() => false))) {
    const floatingRectTool = await browser.$('[data-tool="rect"]');
    await floatingRectTool.waitForDisplayed({ timeout: 10000 });
    await floatingRectTool.click();
  } else {
    await rectTool.click();
  }
  await browser.pause(100);
  await browser.execute(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
    if (!canvas) throw new Error('editor canvas not found');
    const box = canvas.getBoundingClientRect();
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
    dispatch('pointerdown', box.left + box.width * 0.25, box.top + box.height * 0.25, 1);
    dispatch('pointermove', box.left + box.width * 0.5, box.top + box.height * 0.5, 1);
    dispatch('pointerup', box.left + box.width * 0.5, box.top + box.height * 0.5, 0);
  });
  await browser.waitUntil(async () => (await browser.$$('[role="treeitem"]')).length === 1, {
    timeout: 10000,
  });
}

async function copyAndClearSelection(): Promise<void> {
  await browser.$('[role="treeitem"]').click();
  // Exercise the same command surface as a user. Calling the React context
  // from a test bypassed menu ownership, clipboard permission handling, and
  // the real native write path this suite is intended to qualify.
  const edit = await browser.$(
    '//div[@role="menubar"]//*[@role="menuitem" and normalize-space()="Edit"]',
  );
  await edit.waitForDisplayed({ timeout: 5000 });
  await edit.click();
  const menu = await browser.$('[role="menu"][aria-label="Edit"]');
  await menu.waitForDisplayed({ timeout: 5000 });
  await menu.$('//button[@role="menuitem" and .//span[normalize-space()="Copy"]]').click();
  // Escape is the canvas selection command after the menu has closed. Keep
  // the clipboard contents untouched while removing the source target so the
  // subsequent paste assertions exercise viewport placement.
  await browser.keys(['Escape']);
  await browser.pause(700);
}

describe('Tauri desktop: Wayland clipboard', () => {
  it('writes and reads an editable Varve MIME payload through the native bridge', async () => {
    await createRectangle();
    await copyAndClearSelection();

    const nativePayload = await browser.tauri.execute(async () => {
      const invoke = window.__TAURI__?.core?.invoke;
      if (!invoke) throw new Error('Tauri invoke bridge not available');
      return invoke('read_clipboard_data', {
        mimeTypes: ['application/vnd.varve+json'],
      }) as Promise<{ mimeType: string; data: number[] } | null>;
    });

    expect(nativePayload?.mimeType).toBe('application/vnd.varve+json');
    expect(nativePayload?.data.length).toBeGreaterThan(0);
  });

  it('pastes through the canvas right-click context menu', async () => {
    await createRectangle();
    await copyAndClearSelection();

    const canvas = await browser.$('[data-testid="editor-canvas"]');
    // The embedded WebDriver provider's right-button action does not emit a
    // DOM contextmenu event on WebKitGTK/Wayland. Dispatch the same browser
    // event that the real pointer path delivers; Playwright covers the actual
    // right-click gesture in the browser E2E suite.
    await canvas.click();
    await browser.execute(() => {
      const target = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
      if (!target) throw new Error('editor canvas not found');
      const box = target.getBoundingClientRect();
      target.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: box.left + box.width / 2,
          clientY: box.top + box.height / 2,
        }),
      );
    });
    const menu = await browser.$('[role="menu"][aria-label="Canvas context menu"]');
    await menu.waitForDisplayed({ timeout: 5000 });
    await menu.$('//button[@role="menuitem" and normalize-space()="Paste"]').click();

    await browser.waitUntil(async () => (await browser.$$('[role="treeitem"]')).length === 2, {
      timeout: 15000,
      timeoutMsg: 'Right-click Paste did not insert the copied layer',
    });
  });

  it('pastes through Ctrl+V on the non-editable canvas', async () => {
    await createRectangle();
    await copyAndClearSelection();

    const canvas = await browser.$('[data-testid="editor-canvas"]');
    await canvas.click();
    await browser.keys(['Control', 'v']);

    await browser.waitUntil(async () => (await browser.$$('[role="treeitem"]')).length === 2, {
      timeout: 15000,
      timeoutMsg: 'Ctrl+V did not insert the copied layer',
    });
  });
});
