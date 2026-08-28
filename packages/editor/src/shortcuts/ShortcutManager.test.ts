import { describe, expect, it } from 'vitest';
import {
  bindingMatchesEvent,
  detectCollisions,
  formatShortcut,
  isMac,
  SHORTCUT_DEFS,
  shortcutFromEvent,
  shouldIgnoreShortcutTarget,
} from './ShortcutManager';

describe('shouldIgnoreShortcutTarget', () => {
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

  it('ignores comboboxes, spinbuttons, textboxes, sliders, and listboxes', () => {
    for (const role of ['combobox', 'spinbutton', 'textbox', 'slider', 'listbox']) {
      document.body.innerHTML = `<div role="${role}"><span id="inner">x</span></div>`;
      const inner = document.getElementById('inner');
      expect(shouldIgnoreShortcutTarget(inner), `role="${role}"`).toBe(true);
    }
  });

  it('ignores elements opted out via data-shortcut-ignore', () => {
    document.body.innerHTML = `<div data-shortcut-ignore><span id="inner">x</span></div>`;
    expect(shouldIgnoreShortcutTarget(document.getElementById('inner'))).toBe(true);
  });

  it('does not ignore plain canvas/body targets', () => {
    document.body.innerHTML = `<canvas id="c"></canvas>`;
    expect(shouldIgnoreShortcutTarget(document.getElementById('c'))).toBe(false);
    expect(shouldIgnoreShortcutTarget(document.body)).toBe(false);
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
  });

  it('each def has required fields', () => {
    for (const [, def] of Object.entries(SHORTCUT_DEFS)) {
      expect(def.binding).toBeDefined();
      expect(typeof def.binding.key).toBe('string');
      expect(typeof def.label).toBe('string');
      expect(typeof def.category).toBe('string');
    }
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
