/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest';
import { menubarItemAriaChecked, menubarItemRole } from './menubarItemState';

afterEach(() => {
  delete document.documentElement.dataset.layoutPreference;
});

describe('workspace layout menu semantics', () => {
  it('exposes the three layout choices as a selected radio option', () => {
    document.documentElement.dataset.layoutPreference = 'tablet';
    const tablet = { action: 'layoutPreference:tablet' };
    const desktop = { action: 'layoutPreference:desktop' };

    expect(menubarItemRole(tablet)).toBe('menuitemradio');
    expect(menubarItemAriaChecked(tablet, {} as never, 'light')).toBe(true);
    expect(menubarItemAriaChecked(desktop, {} as never, 'light')).toBe(false);
  });
});
