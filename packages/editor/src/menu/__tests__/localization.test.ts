/**
 * Localization integrity tests.
 *
 * Guarantees that the release-blocking defect "raw label keys rendered in the
 * UI" cannot regress:
 *  - every `labelKey` referenced by the menu definitions resolves through
 *    `formatLabel` to a display string (never the raw dotted key),
 *  - the resolution boundary never leaks `menu.*` keys,
 *  - dynamic (non-menu) labels pass through unchanged,
 *  - interpolation behaves correctly.
 */

import { describe, expect, it } from 'vitest';
import { getAllMenuDefs } from '../defs';
import {
  clearMissingKeys,
  formatLabel,
  formatLabelWithValues,
  isMenuLabelKey,
  MENU_LABELS,
} from '../localization';
import type { MenuItemDef } from '../types';

function collectLabelKeys(items: MenuItemDef[]): string[] {
  const keys: string[] = [];
  const walk = (list: MenuItemDef[]) => {
    for (const item of list) {
      if (item.labelKey) keys.push(item.labelKey);
      if (Array.isArray(item.items)) walk(item.items);
    }
  };
  walk(items);
  return keys;
}

describe('localization — label resolution', () => {
  it('resolves known menu keys to their English label', () => {
    expect(formatLabel('menu.file')).toBe('File');
    expect(formatLabel('menu.edit')).toBe('Edit');
    expect(formatLabel('menu.help')).toBe('Help');
    expect(formatLabel('menu.file.new')).toBe('New');
    expect(formatLabel('menu.edit.undo')).toBe('Undo');
    expect(formatLabel('menu.view.workspaceDesign')).toBe('Workspace: Design');
  });

  it('never returns a raw menu.* key, even for unknown menu keys', () => {
    clearMissingKeys();
    const label = formatLabel('menu.view.someFutureCommand');
    expect(label).not.toContain('menu.');
    expect(label).toBe('Some Future Command');
  });

  it('passes dynamic non-menu labels through unchanged', () => {
    // Recent-file labels and other dynamic strings must not be mangled.
    expect(formatLabel('my-document.strata')).toBe('my-document.strata');
    expect(formatLabel('Untitled')).toBe('Untitled');
    expect(formatLabel('')).toBe('');
  });

  it('humanizes camelCase final segments', () => {
    expect(formatLabel('menu.object.addLuminanceMask')).toBe('Add Luminance Mask');
    expect(formatLabel('menu.view.beforeAfterCompare')).toBe('Before/After Compare');
  });

  it('detects menu label keys', () => {
    expect(isMenuLabelKey('menu.file')).toBe(true);
    expect(isMenuLabelKey('menu.edit.cut')).toBe(true);
    expect(isMenuLabelKey('my-document.strata')).toBe(false);
  });

  it('interpolates values after resolution', () => {
    expect(formatLabelWithValues('menu.edit.undo', {})).toBe('Undo');
    // Unknown keys still resolve to a humanized label, never a raw key.
    expect(formatLabelWithValues('menu.file.undoN', {})).toBe('Undo N');
    // Placeholders in the resolved/passed-through text are substituted.
    expect(formatLabelWithValues('Open {n} files', { n: 3 })).toBe('Open 3 files');
    expect(formatLabelWithValues('Delete {n} items', { n: 1 })).toBe('Delete 1 items');
  });

  it('dictionary contains no raw dotted values', () => {
    for (const [key, value] of Object.entries(MENU_LABELS)) {
      expect(value, `label for ${key} must not be the raw key`).not.toBe(key);
      expect(value, `label for ${key} must not contain 'menu.'`).not.toContain('menu.');
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

describe('localization — menu definition integrity', () => {
  it('every labelKey in the menu definitions resolves to a display string', () => {
    const defs = getAllMenuDefs({ runAction: () => {} });
    const keys = collectLabelKeys(defs);
    expect(keys.length).toBeGreaterThan(0);

    const unresolved: string[] = [];
    for (const key of keys) {
      const label = formatLabel(key);
      if (isMenuLabelKey(key) && (label === key || label.includes('menu.'))) {
        unresolved.push(key);
      }
    }
    expect(unresolved, `raw keys that would leak to the UI:\n${unresolved.join('\n')}`).toEqual([]);
  });

  it('dynamic label keys (recent files, etc.) are not menu.* keys', () => {
    const defs = getAllMenuDefs({ runAction: () => {} });
    const keys = collectLabelKeys(defs);
    // These keys are populated at runtime with real display strings.
    const dynamicKeys = keys.filter((k) => !isMenuLabelKey(k));
    for (const key of dynamicKeys) {
      expect(formatLabel(key), key).toBe(key);
    }
  });
});
