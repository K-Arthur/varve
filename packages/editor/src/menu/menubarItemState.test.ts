import { describe, expect, it } from 'vitest';
import { getViewMenu } from './defs';
import { menubarItemAriaChecked, menubarItemRole } from './menubarItemState';

const state = {
  canvasMode: 'full',
  workspaceMode: 'email',
  colorBlindnessView: 'none',
  rulerMode: 'artboard',
  logoPanelVisible: false,
};

describe('workspace menu action semantics', () => {
  it('keeps the View menu selectors in switcher order and workflow actions separate', () => {
    const items = getViewMenu(() => {});
    const workspaceSelectors = items.filter(
      (item) => item.group === 'workspace' && item.kind === 'radio',
    );
    const workflowActions = items.filter((item) => item.group === 'workspace-actions');

    expect(workspaceSelectors.map((item) => item.id)).toEqual([
      'workspaceDesign',
      'workspacePrint',
      'workspaceDrawing',
      'workspaceImage',
      'workspaceMotion',
      'workspaceEmail',
    ]);
    expect(
      workspaceSelectors.map((item) => [
        item.accelerator?.key,
        item.accelerator?.ctrl,
        item.accelerator?.shift,
      ]),
    ).toEqual(['1', '2', '3', '4', '5', '6'].map((key) => [key, true, true]));
    expect(workflowActions.map((item) => item.id)).toEqual(['workspaceLogo', 'workspaceCodegen']);
    expect(workflowActions.map((item) => item.accelerator?.key)).toEqual(['7', '8']);
    expect(workflowActions.every((item) => item.kind === 'command')).toBe(true);
  });

  it('treats only the six workspace selectors as radio items', () => {
    expect(menubarItemRole({ action: 'workspaceEmail' })).toBe('menuitemradio');
    expect(menubarItemAriaChecked({ action: 'workspaceEmail' }, state, 'dark')).toBe(true);
    expect(menubarItemRole({ action: 'workspaceLogo' })).toBe('menuitem');
    expect(menubarItemAriaChecked({ action: 'workspaceLogo' }, state, 'dark')).toBeUndefined();
    expect(menubarItemRole({ action: 'workspaceCodegen' })).toBe('menuitem');
    expect(menubarItemAriaChecked({ action: 'workspaceCodegen' }, state, 'dark')).toBeUndefined();
  });
});
