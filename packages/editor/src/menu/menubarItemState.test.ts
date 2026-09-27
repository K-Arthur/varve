import { describe, expect, it } from 'vitest';
import { menubarItemAriaChecked, menubarItemRole } from './menubarItemState';

const state = {
  canvasMode: 'full',
  workspaceMode: 'email',
  colorBlindnessView: 'none',
  rulerMode: 'artboard',
  logoPanelVisible: false,
};

describe('workspace menu action semantics', () => {
  it('treats only the six workspace selectors as radio items', () => {
    expect(menubarItemRole({ action: 'workspaceEmail' })).toBe('menuitemradio');
    expect(menubarItemAriaChecked({ action: 'workspaceEmail' }, state, 'dark')).toBe(true);
    expect(menubarItemRole({ action: 'workspaceLogo' })).toBe('menuitem');
    expect(menubarItemAriaChecked({ action: 'workspaceLogo' }, state, 'dark')).toBeUndefined();
    expect(menubarItemRole({ action: 'workspaceCodegen' })).toBe('menuitem');
    expect(menubarItemAriaChecked({ action: 'workspaceCodegen' }, state, 'dark')).toBeUndefined();
  });
});
