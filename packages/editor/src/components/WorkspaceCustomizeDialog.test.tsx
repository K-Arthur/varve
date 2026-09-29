// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Platform } from '@varve/platform';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../context';
import { validateDockLayout } from '../workspace/dock/dockOps';
import { registerBuiltinPanels } from '../workspace/panelDefinitions';
import { resetPanelRegistry } from '../workspace/panelRegistry';
import {
  attachWorkspacePreferencePlatform,
  flushWorkspacePreferences,
  getEffectiveWorkspaceConfig,
  getWorkspacePreferences,
  resetWorkspacePreferenceCache,
  setPanelOverride,
  updateWorkspacePreferences,
} from '../workspace/workspaceStore';
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
    resetPanelRegistry();
    registerBuiltinPanels();
  });

  it('lists every panel id with a human label, including History', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    const panels = within(dialog).getByRole('heading', { name: 'Panels' }).parentElement!;
    for (const label of [
      'Layers',
      'Inspector',
      'Timeline',
      'Page Navigator',
      'Resources',
      'Code Panel',
      'Logo Panel',
      'History',
    ]) {
      expect(within(panels).getByText(label)).toBeTruthy();
    }
  });

  it('lists flyout-only tools (boolean operations) as customizable toolbar tools', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    const toolbarTools = within(dialog).getByRole('heading', { name: 'Toolbar Tools' })
      .parentElement!;
    // Boolean operations are not in the design main row, but they must be
    // customizable — hiding them is a supported override. Every member shows
    // its flyout membership so the row reads as a group.
    for (const name of [
      'Boolean Union',
      'Boolean Subtract',
      'Boolean Intersect',
      'Boolean Exclude',
    ]) {
      expect(within(toolbarTools).getByText(new RegExp(name))).toBeTruthy();
    }
    expect(within(toolbarTools).getAllByText(/in Boolean operations/)).toHaveLength(4);
  });

  it('shows human labels for status bar sections, not raw ids', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    for (const label of [
      'Cursor Position',
      'Zoom Controls',
      'Document Health',
      'Renderer Status',
      'View Toggles',
      'Fit Controls',
      'Save Status',
      'Units',
    ]) {
      expect(within(dialog).getByText(label)).toBeTruthy();
    }
    // Raw camelCase ids must not leak into the UI.
    expect(within(dialog).queryByText(/cursor Pos/)).toBeNull();
    expect(within(dialog).queryByText(/document Health/)).toBeNull();
    // Save status exists as a row so the list describes the whole bar, but it
    // is clamped visible: a workspace may not hide save state.
    const saveToggle = within(dialog).getByRole('checkbox', { name: /Save Status/ });
    expect((saveToggle as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).getByText(/Always shown/)).toBeTruthy();
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

  it('applies a panel toggle to the live editor state immediately', async () => {
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
    expect(editor.state.historyPanelVisible).toBe(false);

    // The override alone only changes the next projection; the control must
    // change the live surface in the same interaction.
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /History/ }));
    await waitFor(() => expect(editor?.state.historyPanelVisible).toBe(true));

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /History/ }));
    await waitFor(() => expect(editor?.state.historyPanelVisible).toBe(false));
  });

  it('surfaces durable-save failures and clears the warning after a successful retry', async () => {
    renderDialog();
    let shouldFail = true;
    const platform = {
      getAppSetting: vi.fn(async () => null),
      setAppSetting: vi.fn(async () => {
        if (shouldFail) throw new Error('disk is read-only');
      }),
    } as unknown as Platform;
    attachWorkspacePreferencePlatform(platform);
    act(() => {
      updateWorkspacePreferences((current) =>
        setPanelOverride(current, 'design', 'history', { visible: true }),
      );
    });
    await act(async () => {
      await flushWorkspacePreferences();
    });

    const alert = screen
      .getByText(/Workspace preferences could not be saved to/i)
      .closest<HTMLElement>('[role="alert"]');
    if (!alert) throw new Error('Missing workspace preference save warning.');
    expect(alert).toHaveTextContent(/could not be saved to platform storage/i);
    expect(alert).toHaveTextContent('disk is read-only');
    expect(getWorkspacePreferences().design.panelOverrides?.history?.visible).toBe(true);

    shouldFail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry saving' }));
    await waitFor(() =>
      expect(document.querySelector('.workspace-customize__save-error')).not.toBeInTheDocument(),
    );
  });

  it('moves a panel through the accessible controls and persists the validated dock tree', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Panel to move' }), {
      target: { value: 'layers' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Panel placement' }), {
      target: { value: 'below' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Panel move target' }), {
      target: { value: 'inspector' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move panel' }));

    const moveSection = dialog.querySelector<HTMLElement>(
      '[aria-labelledby="workspace-dock-move-title"]',
    )!;
    expect(within(moveSection).getByRole('status')).toHaveTextContent('Layers moved.');
    const layout = Object.values(getWorkspacePreferences()).find(
      (preference) => preference.dockLayout,
    )?.dockLayout;
    expect(layout).toBeDefined();
    expect(validateDockLayout(layout!)).toEqual([]);
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
    const toolbarTools = within(dialog).getByRole('heading', { name: 'Toolbar Tools' })
      .parentElement!;
    const search = within(dialog).getByRole('searchbox', { name: 'Search toolbar tools' });
    fireEvent.change(search, { target: { value: 'boolean' } });
    expect(within(toolbarTools).getByText('Boolean Union')).toBeTruthy();
    expect(within(toolbarTools).queryByText('Rectangle')).toBeNull();

    fireEvent.change(search, { target: { value: 'pen' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Show Pen in Design/ }));
    expect(editor.state.tool).toBe('select');
  });

  it('supports non-drag toolbar ordering, flyout reassignment, and overflow pinning', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    const before = getEffectiveWorkspaceConfig('design');
    const beforeIds = before.toolbar.tools.map((item) => item.toolId);
    const rectangleIndex = beforeIds.indexOf('rect');
    expect(rectangleIndex).toBe(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Move Rectangle later' }));
    const afterMove = getEffectiveWorkspaceConfig('design');
    expect(afterMove.toolbar.tools.findIndex((item) => item.toolId === 'rect')).toBe(
      rectangleIndex + 1,
    );

    const location = within(dialog).getByRole('combobox', { name: 'Show Pen in' });
    fireEvent.change(location, { target: { value: 'boolean' } });
    const afterMoveToFlyout = getEffectiveWorkspaceConfig('design');
    expect(afterMoveToFlyout.toolbar.tools.map((item) => item.toolId)).not.toContain('pen');
    expect(
      afterMoveToFlyout.toolbar.flyouts?.find((flyout) => flyout.id === 'boolean')?.tools,
    ).toContain('pen');

    const selectLocation = within(dialog).getByRole('combobox', { name: 'Show Select in' });
    expect(selectLocation).toBeDisabled();
    const pin = within(dialog).getByRole('checkbox', {
      name: 'Keep Rectangle visible when the toolbar overflows',
    });
    fireEvent.click(pin);
    expect(getWorkspacePreferences().design.toolbarPinnedToolIds).toContain('rect');
  });
});
