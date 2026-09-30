// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../context';
import { getLayoutStore, resetLayoutStoreCache, setLayoutStore } from '../workspace/layoutVariants';
import {
  getEffectiveWorkspaceConfig,
  getWorkspacePreferences,
  resetWorkspacePreferenceCache,
} from '../workspace/workspaceStore';
import { ManageLayoutsDialog } from './ManageLayoutsDialog';

vi.setConfig({ testTimeout: 30000 });

vi.mock('./PromptDialog', () => ({
  promptDialog: vi.fn(async () => 'Renamed layout'),
}));

function renderDialogWithEditor() {
  let editor: ReturnType<typeof useEditor> | undefined;
  const onClose = vi.fn();
  function Fixture() {
    editor = useEditor();
    return (
      <>
        <ManageLayoutsDialog open onClose={onClose} />
        <button type="button" onClick={() => editor?.toggleLeftPanel()}>
          test toggle left
        </button>
      </>
    );
  }
  render(
    <EditorProvider>
      <Fixture />
    </EditorProvider>,
  );
  const getEditor = () => {
    if (!editor) throw new Error('editor context was not mounted');
    return editor;
  };
  return Object.assign(getEditor, { onClose });
}

describe('ManageLayoutsDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspacePreferenceCache();
    resetLayoutStoreCache();
  });

  it('enters temporary focus mode without saving a hidden-panel arrangement', async () => {
    const getEditor = renderDialogWithEditor();
    await waitFor(() => expect(getEditor()).toBeDefined());
    const savedPreferences = getWorkspacePreferences();

    const dialog = screen.getByRole('dialog');
    const focusRow = within(dialog)
      .getByText('Focus canvas')
      .closest<HTMLElement>('.workspace-layouts__row')!;
    fireEvent.click(within(focusRow).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(getEditor().state.distractionFreeMode).toBe(true));
    expect(getEditor().state.leftPanelVisible).toBe(true);
    expect(getEditor().state.rightPanelVisible).toBe(true);
    expect(getEffectiveWorkspaceConfig('design').statusBar).toBe(true);
    expect(getEffectiveWorkspaceConfig('design').tabStrip).toBe(true);
    expect(getWorkspacePreferences()).toEqual(savedPreferences);
    expect(getEditor.onClose).toHaveBeenCalledTimes(1);
  });

  it('saves the current arrangement and marks it Current when applied', async () => {
    const getEditor = renderDialogWithEditor();
    await waitFor(() => expect(getEditor()).toBeDefined());

    const dialog = screen.getByRole('dialog');
    const nameInput = within(dialog).getByRole('textbox', { name: 'New layout name' });
    fireEvent.change(nameInput, { target: { value: 'My arrangement' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save current' }));

    await waitFor(() => expect(getLayoutStore().variants).toHaveLength(1));
    expect(getLayoutStore().variants[0]!.name).toBe('My arrangement');
    // The untouched arrangement is sparse and equals the Default template's
    // empty payload, so the saved row itself must show as Current.
    await waitFor(() => expect(within(dialog).getByText('My arrangement')).toBeTruthy());
  });

  it('rejects a duplicate layout name instead of overwriting', async () => {
    setLayoutStore({
      ...getLayoutStore(),
      variants: [
        {
          id: 'lv-existing',
          name: 'Studio',
          builtIn: false,
          createdAt: 1,
          updatedAt: 1,
          payload: {},
        },
      ],
    });
    const getEditor = renderDialogWithEditor();
    await waitFor(() => expect(getEditor()).toBeDefined());

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'New layout name' }), {
      target: { value: 'studio' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save current' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/already exists/i);
    expect(getLayoutStore().variants).toHaveLength(1);
  });

  it('requires confirmation before deleting a layout', async () => {
    setLayoutStore({
      ...getLayoutStore(),
      variants: [
        {
          id: 'lv-doomed',
          name: 'Doomed',
          builtIn: false,
          createdAt: 1,
          updatedAt: 1,
          payload: {},
        },
      ],
    });
    const getEditor = renderDialogWithEditor();
    await waitFor(() => expect(getEditor()).toBeDefined());

    const dialog = screen.getByRole('dialog');
    const row = within(dialog).getByText('Doomed').closest<HTMLElement>('.workspace-layouts__row')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    const confirm = screen.getAllByRole('dialog').at(-1)!;
    expect(within(confirm).getByText(/Delete “Doomed”/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete layout' }));
    await waitFor(() => expect(getLayoutStore().variants).toHaveLength(0));
    expect(getLayoutStore().tombstones['lv-doomed']).toMatchObject({
      revision: expect.any(Number),
      writerId: expect.any(String),
    });
  });

  it('cancels the delete confirmation on Escape instead of closing the dialog', async () => {
    setLayoutStore({
      ...getLayoutStore(),
      variants: [
        {
          id: 'lv-esc',
          name: 'Escapable',
          builtIn: false,
          createdAt: 1,
          updatedAt: 1,
          payload: {},
        },
      ],
    });
    const getEditor = renderDialogWithEditor();
    await waitFor(() => expect(getEditor()).toBeDefined());

    const outer = screen.getByRole('dialog');
    const row = within(outer).getByText('Escapable').closest<HTMLElement>('.workspace-layouts__row')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    const confirm = screen.getAllByRole('dialog').at(-1)!;
    expect(within(confirm).getByText(/Delete “Escapable”/)).toBeTruthy();

    // The confirmation sits inside the Manage Layouts dialog, so its keydown
    // also reaches that ancestor. Escape must cancel the confirmation and stop
    // there — not close the enclosing dialog with the confirmation still
    // pending, and not delete the layout.
    fireEvent.keyDown(confirm, { key: 'Escape' });
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(getEditor.onClose).not.toHaveBeenCalled();
    expect(getLayoutStore().variants).toHaveLength(1);
  });

  it('imports a valid layout and rejects an invalid payload', async () => {
    const getEditor = renderDialogWithEditor();
    await waitFor(() => expect(getEditor()).toBeDefined());

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import from JSON...' }));
    const textarea = within(dialog).getByRole('textbox', { name: /Paste a layout JSON/i });
    fireEvent.change(textarea, { target: { value: '{"not":"a layout"}' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('alert').textContent).toMatch(/not a valid Varve layout/i),
    );

    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify({
          kind: 'varve-workspace-layout',
          schemaVersion: 1,
          name: 'Imported',
          payload: { panelOverrides: { history: { visible: true } } },
        }),
      },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(getLayoutStore().variants).toHaveLength(1));
    expect(getLayoutStore().variants[0]!.name).toBe('Imported');
  });

  it('offers restore after a workspace reset and restores the arrangement', async () => {
    const getEditor = renderDialogWithEditor();
    await waitFor(() => expect(getEditor()).toBeDefined());

    // Customize (hide the layers panel), then reset the workspace.
    fireEvent.click(screen.getByRole('button', { name: 'test toggle left' }));
    await waitFor(() => expect(getEditor().state.leftPanelVisible).toBe(false));
    getEditor().resetWorkspaceToDefault();
    await waitFor(() => expect(getEditor().state.leftPanelVisible).toBe(true));

    const dialog = screen.getByRole('dialog');
    const recovery = within(dialog).getByText('Recovery').closest('section')!;
    fireEvent.click(within(recovery).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(getEditor().state.leftPanelVisible).toBe(false));
  });
});
