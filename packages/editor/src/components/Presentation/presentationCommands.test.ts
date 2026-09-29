/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActionRegistry, resetActionRegistryForTesting } from '../../actions/ActionRegistry';
import type { EditorContextValue } from '../../context';
import {
  CREATE_PRESENTATION_FROM_SELECTION_EVENT,
  registerPresentationActions,
} from './presentationCommands';

afterEach(() => {
  resetActionRegistryForTesting();
});

describe('presentation command registration', () => {
  it('makes selected-frame deck creation available to palette and menu dispatch', async () => {
    const editor = {
      state: { workspaceMode: 'design' },
      requestWorkspaceSwitch: vi.fn(),
      setPanelVisible: vi.fn(),
    } as unknown as EditorContextValue;
    registerPresentationActions(editor);
    const action = getActionRegistry().get('createPresentationFromSelection');
    const requested = vi.fn();
    window.addEventListener(CREATE_PRESENTATION_FROM_SELECTION_EVENT, requested);

    action?.handler(undefined);

    expect(action).toMatchObject({
      label: 'Create Presentation from Selected Frames…',
      category: 'file',
      context: 'selection',
    });
    expect(action?.keywords).toContain('slides');
    await vi.waitFor(() => expect(requested).toHaveBeenCalledTimes(1));
    window.removeEventListener(CREATE_PRESENTATION_FROM_SELECTION_EVENT, requested);
  });

  it('switches to Design before requesting the order review from another workspace', async () => {
    const requestWorkspaceSwitch = vi.fn().mockResolvedValue(true);
    const editor = {
      state: { workspaceMode: 'print' },
      requestWorkspaceSwitch,
      setPanelVisible: vi.fn(),
    } as unknown as EditorContextValue;
    registerPresentationActions(editor);
    const requested = vi.fn();
    window.addEventListener(CREATE_PRESENTATION_FROM_SELECTION_EVENT, requested);

    getActionRegistry().get('createPresentationFromSelection')?.handler(undefined);
    await vi.waitFor(() => expect(requested).toHaveBeenCalledTimes(1));

    expect(requestWorkspaceSwitch).toHaveBeenCalledWith('design');
    window.removeEventListener(CREATE_PRESENTATION_FROM_SELECTION_EVENT, requested);
  });
});
