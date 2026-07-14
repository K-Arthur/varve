import { describe, expect, it } from 'vitest';
import {
  bindingMatchesEvent,
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
