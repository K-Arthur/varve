import { describe, expect, it } from 'vitest';
import {
  bindingMatchesEvent,
  detectCollisions,
  formatShortcut,
  isMac,
  isNativeActivationKeyTarget,
  SHORTCUT_DEFS,
  shortcutFromEvent,
  shouldIgnoreCropShortcutTarget,
  shouldIgnoreHistoryShortcutTarget,
  shouldIgnoreSaveShortcutTarget,
  shouldIgnoreShortcutTarget,
} from './ShortcutManager';

describe('shouldIgnoreShortcutTarget', () => {
  it('keeps tool and history shortcuts live on the editor workspace mode radios', () => {
    document.body.innerHTML = `
      <div role="radiogroup" data-editor-shortcut-scope="workspace-switcher">
        <button role="radio" aria-checked="true"><span id="target">Draw</span></button>
      </div>
    `;
    const target = document.getElementById('target');
    expect(shouldIgnoreShortcutTarget(target)).toBe(false);
    expect(shouldIgnoreHistoryShortcutTarget(target)).toBe(false);
  });

  it.each([
    '<div role="radiogroup"><button role="radio" id="target">Setting</button></div>',
    '<div role="radiogroup" data-editor-shortcut-scope="workspace-switcher"><input id="target" /></div>',
    '<div role="radiogroup" data-editor-shortcut-scope="workspace-switcher"><button role="radio"><span role="textbox" id="target">Text</span></button></div>',
    '<div role="radiogroup" data-editor-shortcut-scope="workspace-switcher" data-shortcut-ignore><button role="radio" id="target">Reserved</button></div>',
    '<div role="listbox"><div role="radiogroup" data-editor-shortcut-scope="workspace-switcher"><button role="radio" id="target">Nested</button></div></div>',
    '<dialog open><div role="radiogroup" data-editor-shortcut-scope="workspace-switcher"><button role="radio" id="target">Dialog</button></div></dialog>',
    '<div role="dialog"><div role="radiogroup" data-editor-shortcut-scope="workspace-switcher"><button role="radio" id="target">Dialog</button></div></div>',
  ])('preserves widget/dialog ownership outside workspace mode buttons: %s', (markup) => {
    document.body.innerHTML = markup;
    const target = document.getElementById('target');
    expect(shouldIgnoreShortcutTarget(target)).toBe(true);
    expect(shouldIgnoreHistoryShortcutTarget(target)).toBe(true);
  });

  it('does not ignore a Layers-panel treeitem, so tool shortcuts still fire after selecting a layer', () => {
    document.body.innerHTML = `
      <div role="tree" aria-label="Layers">
        <div role="treeitem" tabindex="0">Rectangle 1</div>
      </div>
    `;
    const treeitem = document.querySelector('[role="treeitem"]');
    expect(shouldIgnoreShortcutTarget(treeitem)).toBe(false);
  });

  it('ignores an actual rename input inside the tree', () => {
    document.body.innerHTML = `
      <div role="tree" aria-label="Layers">
        <div role="treeitem" tabindex="0"><input value="Rectangle 1" /></div>
      </div>
    `;
    const input = document.querySelector('input');
    expect(shouldIgnoreShortcutTarget(input)).toBe(true);
  });

  it('allows document shortcuts on rows and their labels inside the responsive Layers drawer', () => {
    document.body.innerHTML = `
      <aside role="dialog" aria-modal="true" data-editor-shortcut-scope="layers-tree">
        <div role="tree" aria-label="Layers">
          <div role="treeitem" data-node-id="rect-1" tabindex="0"><span id="label">Rectangle 1</span></div>
        </div>
      </aside>
    `;
    for (const target of [
      document.querySelector('[role="treeitem"]'),
      document.getElementById('label'),
    ]) {
      expect(shouldIgnoreShortcutTarget(target)).toBe(false);
      expect(shouldIgnoreHistoryShortcutTarget(target)).toBe(false);
    }
  });

  it.each([
    '<input id="target" value="Rectangle 1" />',
    '<textarea id="target">Rectangle 1</textarea>',
    '<select id="target"><option>Rectangle 1</option></select>',
    '<button id="target">Visibility</button>',
    '<div role="combobox"><span id="target">Font</span></div>',
    '<div role="slider"><span id="target">Opacity</span></div>',
    '<span id="target" data-shortcut-ignore>Reserved keys</span>',
  ])('keeps drawer row controls protected: %s', (control) => {
    document.body.innerHTML = `
      <aside role="dialog" aria-modal="true" data-editor-shortcut-scope="layers-tree">
        <div role="treeitem" data-node-id="rect-1" tabindex="0">${control}</div>
      </aside>
    `;
    expect(shouldIgnoreShortcutTarget(document.getElementById('target'))).toBe(true);
    expect(shouldIgnoreHistoryShortcutTarget(document.getElementById('target'))).toBe(true);
  });

  it.each([
    '<aside role="dialog" aria-modal="true"><div role="treeitem" data-node-id="rect-1" id="target"></div></aside>',
    '<aside role="dialog" aria-modal="true" data-editor-shortcut-scope="layers-tree"><button id="target">Move</button></aside>',
    '<aside role="dialog" aria-modal="true" data-editor-shortcut-scope="layers-tree"><div role="treeitem" id="target"></div></aside>',
    '<dialog open><aside role="dialog" aria-modal="true" data-editor-shortcut-scope="layers-tree"><div role="treeitem" data-node-id="rect-1" id="target"></div></aside></dialog>',
    '<div role="dialog"><aside role="dialog" aria-modal="true" data-editor-shortcut-scope="layers-tree"><div role="treeitem" data-node-id="rect-1" id="target"></div></aside></div>',
    '<aside role="dialog" aria-modal="true" data-editor-shortcut-scope="layers-tree"><div role="dialog"><div role="treeitem" data-node-id="rect-1" id="target"></div></div></aside>',
  ])('does not broaden the exception to real dialogs or non-row drawer targets: %s', (markup) => {
    document.body.innerHTML = markup;
    expect(shouldIgnoreShortcutTarget(document.getElementById('target'))).toBe(true);
    expect(shouldIgnoreHistoryShortcutTarget(document.getElementById('target'))).toBe(true);
  });

  it('keeps editable drawer row labels protected', () => {
    document.body.innerHTML = `
      <aside role="dialog" aria-modal="true" data-editor-shortcut-scope="layers-tree">
        <div role="treeitem" data-node-id="rect-1"><span id="target" contenteditable="true">Rectangle 1</span></div>
      </aside>
    `;
    const target = document.getElementById('target')!;
    // jsdom does not implement inherited isContentEditable as browsers do.
    Object.defineProperty(target, 'isContentEditable', { value: true });
    expect(shouldIgnoreShortcutTarget(target)).toBe(true);
    expect(shouldIgnoreHistoryShortcutTarget(target)).toBe(true);
  });

  it('allows history shortcuts from a focused checkbox without allowing other shortcuts', () => {
    document.body.innerHTML = `
      <label role="switch">Show layout guide <input type="checkbox" /></label>
    `;
    const input = document.querySelector('input');
    expect(shouldIgnoreHistoryShortcutTarget(input)).toBe(false);
    expect(shouldIgnoreShortcutTarget(input)).toBe(true);
  });

  it('ignores comboboxes, spinbuttons, textboxes, sliders, listboxes, and radiogroups', () => {
    for (const role of ['combobox', 'spinbutton', 'textbox', 'slider', 'listbox', 'radiogroup']) {
      document.body.innerHTML = `<div role="${role}"><span id="inner">x</span></div>`;
      const inner = document.getElementById('inner');
      expect(shouldIgnoreShortcutTarget(inner), `role="${role}"`).toBe(true);
    }
  });

  it('ignores elements opted out via data-shortcut-ignore', () => {
    document.body.innerHTML = `<div data-shortcut-ignore><span id="inner">x</span></div>`;
    expect(shouldIgnoreShortcutTarget(document.getElementById('inner'))).toBe(true);
  });

  it('ignores controls inside an open modal dialog', () => {
    document.body.innerHTML = `
      <dialog open><button id="native-dialog-button">Confirm</button></dialog>
      <div role="dialog" aria-modal="true"><button id="aria-dialog-button">Confirm</button></div>
    `;
    expect(shouldIgnoreShortcutTarget(document.getElementById('native-dialog-button'))).toBe(true);
    expect(shouldIgnoreShortcutTarget(document.getElementById('aria-dialog-button'))).toBe(true);
  });

  it('does not ignore plain canvas/body targets', () => {
    document.body.innerHTML = `<canvas id="c"></canvas>`;
    expect(shouldIgnoreShortcutTarget(document.getElementById('c'))).toBe(false);
    expect(shouldIgnoreShortcutTarget(document.body)).toBe(false);
  });
});

describe('Inspector drawer history ownership', () => {
  it.each([
    '<button id="target">Swap orientation</button>',
    '<button><span id="target">Swap orientation</span></button>',
    '<label role="switch">Show safe area <input type="checkbox" id="target" /></label>',
    '<label>Show guides <input type="radio" id="target" /></label>',
  ])('delegates only history from non-editing Inspector controls: %s', (control) => {
    document.body.innerHTML = `
      <aside role="dialog" data-editor-shortcut-scope="inspector-history">
        ${control}
      </aside>
    `;
    const target = document.getElementById('target');
    expect(shouldIgnoreHistoryShortcutTarget(target)).toBe(false);
    expect(shouldIgnoreShortcutTarget(target)).toBe(true);
  });

  it.each([
    '<input id="target" value="1920" />',
    '<input id="target" type="number" value="1920" />',
    '<textarea id="target">Page title</textarea>',
    '<select id="target"><option>Portrait</option></select>',
    '<div role="combobox"><button id="target">Preset</button></div>',
    '<div role="listbox"><button id="target">Preset</button></div>',
    '<div role="spinbutton"><span id="target">Width</span></div>',
    '<div role="textbox"><span id="target">Title</span></div>',
    '<div role="slider"><span id="target">Scale</span></div>',
    '<div role="radiogroup"><button id="target">Orientation</button></div>',
    '<div data-shortcut-ignore><button id="target">Reserved</button></div>',
    '<div role="dialog"><button id="target">Confirm</button></div>',
    '<div role="alertdialog" aria-modal="true"><button id="target">Confirm</button></div>',
    '<div role="alertdialog" aria-modal="false"><button id="target">Confirm</button></div>',
    '<dialog open><button id="target">Confirm</button></dialog>',
  ])('preserves native editing, widget and nested dialog ownership: %s', (control) => {
    document.body.innerHTML = `
      <aside role="dialog" data-editor-shortcut-scope="inspector-history">
        ${control}
      </aside>
    `;
    expect(shouldIgnoreHistoryShortcutTarget(document.getElementById('target'))).toBe(true);
  });

  it('preserves editable text ownership inside the Inspector drawer', () => {
    document.body.innerHTML = `
      <aside role="dialog" data-editor-shortcut-scope="inspector-history">
        <span id="target" contenteditable="true">Page title</span>
      </aside>
    `;
    const target = document.getElementById('target')!;
    Object.defineProperty(target, 'isContentEditable', { value: true });
    expect(shouldIgnoreHistoryShortcutTarget(target)).toBe(true);
  });

  it.each([
    '<aside role="dialog"><button id="target">Swap orientation</button></aside>',
    '<dialog open><aside role="dialog" data-editor-shortcut-scope="inspector-history"><button id="target">Swap orientation</button></aside></dialog>',
    '<div role="dialog"><aside role="dialog" data-editor-shortcut-scope="inspector-history"><button id="target">Swap orientation</button></aside></div>',
    '<div role="alertdialog" aria-modal="true"><aside role="dialog" data-editor-shortcut-scope="inspector-history"><button id="target">Swap orientation</button></aside></div>',
  ])('does not delegate through unmarked or enclosing dialogs: %s', (markup) => {
    document.body.innerHTML = markup;
    expect(shouldIgnoreHistoryShortcutTarget(document.getElementById('target'))).toBe(true);
  });
});

describe('shouldIgnoreCropShortcutTarget', () => {
  it('delegates consumed tool keys from the crop overlay and handles without enabling app keys', () => {
    document.body.innerHTML = `
      <div role="dialog" data-editor-shortcut-scope="crop" id="overlay">
        <button id="handle">Resize crop e</button>
      </div>
    `;
    for (const id of ['overlay', 'handle']) {
      const target = document.getElementById(id);
      expect(shouldIgnoreCropShortcutTarget(target)).toBe(false);
      expect(shouldIgnoreShortcutTarget(target)).toBe(true);
      expect(shouldIgnoreHistoryShortcutTarget(target)).toBe(true);
    }
  });

  it.each([
    '<input id="target" />',
    '<textarea id="target"></textarea>',
    '<select id="target"><option>Fit</option></select>',
    '<div role="combobox"><span id="target">Fit</span></div>',
    '<div role="slider"><span id="target">Angle</span></div>',
    '<div role="radiogroup"><button role="radio" id="target">Ratio</button></div>',
    '<div role="textbox"><span id="target">Name</span></div>',
    '<div role="dialog"><button id="target">Confirm</button></div>',
    '<div data-shortcut-ignore><button id="target">Reserved</button></div>',
  ])('keeps crop inputs and nested widgets/dialogs protected: %s', (control) => {
    document.body.innerHTML = `<div role="dialog" data-editor-shortcut-scope="crop">${control}</div>`;
    expect(shouldIgnoreCropShortcutTarget(document.getElementById('target'))).toBe(true);
  });

  it('preserves editable crop text ownership', () => {
    document.body.innerHTML =
      '<div role="dialog" data-editor-shortcut-scope="crop"><span id="target" contenteditable="true">Name</span></div>';
    const target = document.getElementById('target')!;
    Object.defineProperty(target, 'isContentEditable', { value: true });
    expect(shouldIgnoreCropShortcutTarget(target)).toBe(true);
  });

  it.each([
    '<dialog open><div role="dialog" data-editor-shortcut-scope="crop"><button id="target">Crop</button></div></dialog>',
    '<div role="dialog"><div role="dialog" data-editor-shortcut-scope="crop"><button id="target">Crop</button></div></div>',
    '<div role="alertdialog" aria-modal="true"><div role="dialog" data-editor-shortcut-scope="crop"><button id="target">Crop</button></div></div>',
    '<div role="dialog"><button id="target">Settings</button></div>',
  ])('does not delegate tool keys through another dialog: %s', (markup) => {
    document.body.innerHTML = markup;
    expect(shouldIgnoreCropShortcutTarget(document.getElementById('target'))).toBe(true);
  });
});

describe('isNativeActivationKeyTarget', () => {
  it('recognises controls whose native activation uses Space', () => {
    document.body.innerHTML = `
      <button id="btn">Toggle</button>
      <details><summary id="sum">Question</summary><p>Answer</p></details>
      <div role="switch" id="switch"><span id="switch-inner">On</span></div>
      <div role="checkbox" id="check"><span id="check-inner">Checked</span></div>
    `;
    for (const id of ['btn', 'sum', 'switch', 'switch-inner', 'check', 'check-inner']) {
      expect(isNativeActivationKeyTarget(document.getElementById(id)), `#${id}`).toBe(true);
    }
  });

  it('leaves canvas and body targets alone so Play/Pause still works there', () => {
    document.body.innerHTML = `<canvas id="c"></canvas>`;
    expect(isNativeActivationKeyTarget(document.getElementById('c'))).toBe(false);
    expect(isNativeActivationKeyTarget(document.body)).toBe(false);
    expect(isNativeActivationKeyTarget(null)).toBe(false);
  });
});

describe('isMac', () => {
  it('detects non-Mac platform', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true,
    });
    expect(isMac()).toBe(false);
  });
});

describe('shortcutFromEvent', () => {
  it('extracts key and modifiers', () => {
    const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });
    const result = shortcutFromEvent(e);
    expect(result.key).toBe('z');
    expect(result.ctrl).toBe(true);
    expect(result.shift).toBe(false);
  });

  it('normalizes Backspace key', () => {
    const e = new KeyboardEvent('keydown', { key: 'Backspace' });
    const result = shortcutFromEvent(e);
    expect(result.key).toBe('Backspace');
  });

  it('normalizes Delete key to Backspace', () => {
    const e = new KeyboardEvent('keydown', { key: 'Delete' });
    const result = shortcutFromEvent(e);
    expect(result.key).toBe('Backspace');
  });
});

describe('bindingMatchesEvent', () => {
  it('matches simple key with no modifiers', () => {
    const e = new KeyboardEvent('keydown', { key: 'v' });
    expect(bindingMatchesEvent(e, { key: 'v' })).toBe(true);
  });

  it('matches ctrl+z', () => {
    const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });
    expect(bindingMatchesEvent(e, { key: 'z', ctrl: true })).toBe(true);
  });

  it('matches the printed colon from Ctrl+Shift+; for Quick Actions', () => {
    const e = new KeyboardEvent('keydown', {
      key: ':',
      code: 'Semicolon',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(bindingMatchesEvent(e, SHORTCUT_DEFS.quickActions.binding)).toBe(true);
  });

  it('does not match when modifier missing', () => {
    const e = new KeyboardEvent('keydown', { key: 'z' });
    expect(bindingMatchesEvent(e, { key: 'z', ctrl: true })).toBe(false);
  });

  it('matches Shift+1 fit-all on a real US layout where key is "!"', () => {
    // Real US-layout Shift+1 reports key '!'; the binding is declared as
    // { key: '1', shift: true }. Matching must resolve through the physical
    // code (Digit1), not the printed key.
    const e = new KeyboardEvent('keydown', {
      key: '!',
      code: 'Digit1',
      shiftKey: true,
    });
    expect(bindingMatchesEvent(e, { key: '1', shift: true })).toBe(true);
  });

  it('matches Ctrl+= zoom-in and accepts the "+" physical-key alias', () => {
    const eq = new KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true });
    expect(bindingMatchesEvent(eq, { key: '=', ctrl: true })).toBe(true);

    // Numpad + reports key '+' (code NumpadAdd); + is the same physical key
    // family as = on most layouts.
    const np = new KeyboardEvent('keydown', { key: '+', code: 'NumpadAdd', ctrlKey: true });
    expect(bindingMatchesEvent(np, { key: '=', ctrl: true })).toBe(true);
  });

  it('matches numpad digit shortcuts with NumLock on', () => {
    // NumLock on: the numpad reports the digit as the printed key.
    const e = new KeyboardEvent('keydown', { key: '1', code: 'Numpad1' });
    expect(bindingMatchesEvent(e, { key: '1' })).toBe(true);
  });

  it('does NOT treat NumLock-off numpad keys as digit shortcuts', () => {
    // NumLock off: Numpad1 reports key 'End' — a navigation key, not the digit
    // '1'. It must not trigger the zoom-50% shortcut.
    const e = new KeyboardEvent('keydown', { key: 'End', code: 'Numpad1' });
    expect(bindingMatchesEvent(e, { key: '1' })).toBe(false);
  });

  it('still requires the exact modifier set for shifted digits', () => {
    const shifted = new KeyboardEvent('keydown', {
      key: '!',
      code: 'Digit1',
      shiftKey: true,
    });
    // Plain (unshifted) zoom-to-50% binding must NOT match Shift+1.
    expect(bindingMatchesEvent(shifted, { key: '1' })).toBe(false);
    expect(bindingMatchesEvent(shifted, { key: '1', shift: true })).toBe(true);
  });
});

describe('formatShortcut', () => {
  it('formats Ctrl+Z on Linux', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true,
    });
    expect(formatShortcut({ key: 'z', ctrl: true })).toBe('Ctrl+Z');
  });

  it('formats Ctrl+Shift+S on Linux', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true,
    });
    expect(formatShortcut({ key: 's', ctrl: true, shift: true })).toBe('Ctrl+Shift+S');
  });

  it('formats Backspace', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true,
    });
    const result = formatShortcut({ key: 'Backspace' });
    expect(result).toBe('\u232B');
  });
});

describe('SHORTCUT_DEFS', () => {
  it('has all expected shortcuts', () => {
    const ids = Object.keys(SHORTCUT_DEFS);
    expect(ids).toContain('undo');
    expect(ids).toContain('redo');
    expect(ids).toContain('delete');
    expect(ids).toContain('save');
    expect(ids).toContain('exportSvg');
    expect(ids).toContain('openAppearancePanel');
  });

  it('each def has required fields', () => {
    for (const [, def] of Object.entries(SHORTCUT_DEFS)) {
      expect(def.binding).toBeDefined();
      expect(typeof def.binding.key).toBe('string');
      expect(typeof def.label).toBe('string');
      expect(typeof def.category).toBe('string');
    }
  });

  it('keeps the legacy Codegen action ids but presents the shared Code panel name', () => {
    expect(SHORTCUT_DEFS.workspaceCodegen.label).toBe('Show Code Panel');
    expect(SHORTCUT_DEFS.workspaceCodegen.binding).toMatchObject({
      key: '8',
      ctrl: true,
      shift: true,
    });
    expect(SHORTCUT_DEFS.toggleCodegenPanel.label).toBe('Toggle Code Panel');
  });
});

describe('Knife and Export Region shortcuts', () => {
  it('gives the Knife N and leaves Export Region on K', () => {
    // K stayed with the export region because documents and workspace
    // toolbars already reference that binding; the new tool took a free key.
    expect(SHORTCUT_DEFS.toolSlice.binding).toEqual({ key: 'k' });
    expect(SHORTCUT_DEFS.toolKnife.binding).toEqual({ key: 'n' });
  });

  it('labels them so neither reads as the other', () => {
    expect(SHORTCUT_DEFS.toolSlice.label).toBe('Export Region tool');
    expect(SHORTCUT_DEFS.toolKnife.label).toBe('Knife tool');
  });

  it('introduces no collision', () => {
    const collisions = detectCollisions();
    const involved = collisions.filter((c) =>
      ['toolKnife', 'toolSlice'].some((id) => c.id1 === id || c.id2 === id),
    );
    expect(involved).toEqual([]);
  });
});

describe('Inspector drawer Save ownership', () => {
  it.each([
    '<button id="target">Effect Studio</button>',
    '<button><span id="target">Customize sections</span></button>',
  ])('delegates Save from a non-editing drawer command: %s', (control) => {
    document.body.innerHTML = `<aside role="dialog" data-editor-shortcut-scope="inspector-history">${control}</aside>`;
    const target = document.getElementById('target');
    expect(shouldIgnoreShortcutTarget(target)).toBe(true);
    expect(shouldIgnoreSaveShortcutTarget(target)).toBe(false);
  });

  it.each([
    '<input id="target" value="1920" />',
    '<textarea id="target">Title</textarea>',
    '<select id="target"><option>Portrait</option></select>',
    '<div role="combobox"><button id="target">Preset</button></div>',
    '<div role="slider"><span id="target">Scale</span></div>',
    '<div data-shortcut-ignore><button id="target">Reserved</button></div>',
    '<div role="dialog"><button id="target">Confirm</button></div>',
    '<div role="alertdialog"><button id="target">Confirm</button></div>',
    '<dialog open><button id="target">Confirm</button></dialog>',
  ])('preserves native editing and nested widget ownership: %s', (control) => {
    document.body.innerHTML = `<aside role="dialog" data-editor-shortcut-scope="inspector-history">${control}</aside>`;
    expect(shouldIgnoreSaveShortcutTarget(document.getElementById('target'))).toBe(true);
  });

  it.each([
    '<aside role="dialog"><button id="target">Command</button></aside>',
    '<dialog open><aside role="dialog" data-editor-shortcut-scope="inspector-history"><button id="target">Command</button></aside></dialog>',
    '<div role="dialog"><aside role="dialog" data-editor-shortcut-scope="inspector-history"><button id="target">Command</button></aside></div>',
    '<div role="alertdialog"><aside role="dialog" data-editor-shortcut-scope="inspector-history"><button id="target">Command</button></aside></div>',
  ])('does not delegate through unmarked or enclosing dialogs: %s', (markup) => {
    document.body.innerHTML = markup;
    expect(shouldIgnoreSaveShortcutTarget(document.getElementById('target'))).toBe(true);
  });
});
