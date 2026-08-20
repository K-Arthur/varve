// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../context';
import { resetWorkspacePreferenceCache } from '../workspace/workspaceStore';
import { WorkspaceCustomizeDialog } from './WorkspaceCustomizeDialog';

// EditorProvider mounts the full editor context — see workspaceReset.test.tsx.
vi.setConfig({ testTimeout: 30000 });

function renderDialog() {
  return render(
    <EditorProvider>
      <WorkspaceCustomizeDialog open onClose={() => {}} />
    </EditorProvider>,
  );
}

describe('WorkspaceCustomizeDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspacePreferenceCache();
  });

  it('lists every panel id with a human label, including History', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    for (const label of [
      'Layers',
      'Inspector',
      'Timeline',
      'Page Navigation',
      'Resources',
      'Code Panel',
      'Logo Panel',
      'History',
    ]) {
      expect(within(dialog).getByText(label)).toBeTruthy();
    }
  });

  it('lists flyout-only tools (boolean operations) as customizable toolbar tools', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    // Boolean operations are not in the design main row, but they must be
    // customizable — hiding them is a supported override. Every member shows
    // its flyout membership so the row reads as a group.
    for (const name of [
      'Boolean Union',
      'Boolean Subtract',
      'Boolean Intersect',
      'Boolean Exclude',
    ]) {
      expect(within(dialog).getByText(new RegExp(name))).toBeTruthy();
    }
    expect(within(dialog).getAllByText(/in Boolean operations/)).toHaveLength(4);
  });

  it('shows human labels for status bar sections, not raw ids', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    for (const label of [
      'Cursor Position',
      'Zoom Controls',
      'Selection Info',
      'Layout Score',
      'Active Tool',
      'Units',
    ]) {
      expect(within(dialog).getByText(label)).toBeTruthy();
    }
    // Raw camelCase ids must not leak into the UI.
    expect(within(dialog).queryByText(/cursor Pos/)).toBeNull();
    expect(within(dialog).queryByText(/layout Score/)).toBeNull();
  });

  it('requires explicit confirmation before resetting all workspaces', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');

    // Customize the design workspace: show the History panel.
    const historyToggle = within(dialog).getByRole('checkbox', { name: /History/ });
    expect((historyToggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(historyToggle);
    expect((historyToggle as HTMLInputElement).checked).toBe(true);

    // First click opens the confirmation dialog instead of resetting.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset All Workspaces' }));
    const confirm = screen.getAllByRole('dialog').at(-1)!;
    expect(within(confirm).getByText(/discards every panel/i)).toBeTruthy();

    // Cancelling leaves the customization in place.
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect((historyToggle as HTMLInputElement).checked).toBe(true);

    // Confirming resets the mode back to its built-in default.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset All Workspaces' }));
    const confirm2 = screen.getAllByRole('dialog').at(-1)!;
    fireEvent.click(within(confirm2).getByRole('button', { name: 'Reset All Workspaces' }));
    expect((historyToggle as HTMLInputElement).checked).toBe(false);
  });

  it('filters tools by registry label and moves an active hidden tool to Select', async () => {
    let editor: ReturnType<typeof useEditor> | undefined;
    function Fixture() {
      editor = useEditor();
      return <WorkspaceCustomizeDialog open onClose={() => {}} />;
    }

    render(
      <EditorProvider>
        <Fixture />
      </EditorProvider>,
    );
    await waitFor(() => expect(editor).toBeDefined());
    if (!editor) throw new Error('editor context was not mounted');
    act(() => editor?.setTool('pen'));
    await waitFor(() => expect(editor?.state.tool).toBe('pen'));

    const dialog = screen.getByRole('dialog');
    const search = within(dialog).getByRole('searchbox', { name: 'Search toolbar tools' });
    fireEvent.change(search, { target: { value: 'boolean' } });
    expect(within(dialog).getByText('Boolean Union')).toBeTruthy();
    expect(within(dialog).queryByText('Rectangle')).toBeNull();

    fireEvent.change(search, { target: { value: 'pen' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Show Pen in Design/ }));
    expect(editor.state.tool).toBe('select');
  });
});
