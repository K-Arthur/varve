// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import {
  getWorkspacePreferences,
  setToolbarPlacementOverride,
  updateWorkspacePreferences,
} from '../../workspace/workspaceStore';
import type { WorkspaceMode } from '../../workspace/workspaceTypes';
import { FloatingToolbar, getFlyoutMenuItems } from './FloatingToolbar';

function SetWorkspaceMode({ mode }: { mode: WorkspaceMode }) {
  const { requestWorkspaceSwitch } = useEditor();
  useEffect(() => {
    requestWorkspaceSwitch(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  return null;
}

function renderInMode(mode: WorkspaceMode) {
  return render(
    <EditorProvider>
      <SetWorkspaceMode mode={mode} />
      <FloatingToolbar />
    </EditorProvider>,
  );
}

describe('FloatingToolbar — per-mode tool adaptation', () => {
  it('Design mode hides raster paint/retouch tools but keeps shape and boolean tools', () => {
    renderInMode('design');
    expect(screen.queryByLabelText('Paint Brush')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Eraser')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Clone Stamp')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Healing Brush')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Pencil')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Shapes menu')).toBeInTheDocument();
    expect(screen.getByLabelText('Boolean operations menu')).toBeInTheDocument();
    expect(screen.getByLabelText('Select')).toBeInTheDocument();
  });

  it('Print mode hides raster paint/retouch tools but keeps shape and boolean tools', () => {
    renderInMode('print');
    expect(screen.queryByLabelText('Paint Brush')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Eraser')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Shapes menu')).toBeInTheDocument();
    expect(screen.getByLabelText('Boolean operations menu')).toBeInTheDocument();
  });

  it('Drawing mode shows paint/retouch tools and hides boolean ops', () => {
    renderInMode('drawing');
    expect(screen.getByLabelText('Paint Brush')).toBeInTheDocument();
    expect(screen.getByLabelText('Eraser')).toBeInTheDocument();
    expect(screen.queryByLabelText('Boolean operations menu')).not.toBeInTheDocument();
  });

  it('moves full brush configuration into a keyboard-accessible tool-options popover', async () => {
    renderInMode('drawing');
    // The workspace switch is asynchronous (requestWorkspaceSwitch). Wait for
    // it to land — Smudge only renders once drawing mode is active.
    await screen.findByLabelText('Smudge');
    fireEvent.click(screen.getByLabelText('Paint Brush'));

    const options = screen.getByRole('button', { name: 'Tool options' });
    // Brush tools auto-open the popover for discoverability, but the implicit
    // open must not take focus off the tool/canvas the user just engaged.
    expect(options).toHaveAttribute('aria-expanded', 'true');
    const dialog = await screen.findByRole('dialog', { name: 'Paint Brush tool options' });
    expect(dialog).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(false);

    // Escape owns dismissal even with focus still on the trigger, and returns
    // focus to the trigger.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Paint Brush tool options' }),
      ).not.toBeInTheDocument();
    });
    expect(options).toHaveAttribute('aria-expanded', 'false');
    expect(options).toHaveFocus();

    // An explicit keyboard activation is a navigation intent: focus moves to
    // the first control so the panel is operable without a pointer. A real
    // browser fires keydown before the synthesized click; jsdom needs both.
    options.focus();
    fireEvent.keyDown(options, { key: 'Enter' });
    fireEvent.click(options);
    const brushButton = await screen.findByRole('button', { name: 'Brush' }, { timeout: 5000 });
    await waitFor(() => expect(brushButton).toHaveFocus());
    expect(options).toHaveAttribute('aria-expanded', 'true');
  });

  it('Image mode hides the frame tool and boolean ops, keeps retouch tools', async () => {
    renderInMode('image');
    expect(screen.queryByLabelText('Frame')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Boolean operations menu')).not.toBeInTheDocument();

    // Retouch is one flyout rather than four permanently visible buttons —
    // Image mode declares 21 tools, so the workspace's declared grouping is
    // what keeps the toolbar readable. Every member stays reachable.
    const retouch = await screen.findByLabelText('Retouch menu');
    expect(screen.getByLabelText('Clone Stamp')).toBeInTheDocument();
    expect(screen.queryByLabelText('Healing Brush')).not.toBeInTheDocument();
    fireEvent.click(retouch);
    const menu = await screen.findByRole('menu', { name: 'Retouch' });
    for (const member of ['Clone Stamp', 'Healing Brush', 'Spot Heal', 'Patch Tool']) {
      expect(within(menu).getByRole('menuitem', { name: member })).toBeInTheDocument();
    }
  });

  it('Image mode exposes the mask tools its workspace declares', async () => {
    // Regression: refineMask/trimapEdit are declared by the Image workspace and
    // implemented as real tools, but the toolbar rendered from a hard-coded
    // list that omitted them, so they were unreachable from the toolbar.
    renderInMode('image');
    fireEvent.click(await screen.findByLabelText('Mask menu'));
    const menu = await screen.findByRole('menu', { name: 'Mask' });
    expect(within(menu).getByRole('menuitem', { name: 'Refine Mask' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Trimap Edit' })).toBeInTheDocument();
  });

  it('Logo mode exposes the node-edit tool its workspace declares', async () => {
    renderInMode('logo');
    expect(await screen.findByLabelText('Node Edit')).toBeInTheDocument();
  });

  it('orders the toolbar the way the workspace declares', async () => {
    // The photo workspace leads with selection and navigation; the previous
    // hard-coded order led every workspace with line/arrow/text.
    renderInMode('image');
    await screen.findByLabelText('Retouch menu');
    const tools = Array.from(document.querySelectorAll('[data-tool]')).map((el) =>
      el.getAttribute('data-tool'),
    );
    expect(tools.slice(0, 4)).toEqual(['select', 'lasso', 'marquee', 'hand']);
  });

  it('disables the boolean operations flyout with a reason when fewer than 2 shapes are selected', async () => {
    // Regression: the flyout's chevron used to stay enabled when the primary
    // button was disabled, opening a menu whose items silently did nothing.
    renderInMode('design');
    const primary = await screen.findByLabelText('Boolean Union');
    const chevron = screen.getByLabelText('Boolean operations menu');

    // Empty document → no shapes → the whole group is disabled.
    expect(primary).toHaveAttribute('aria-disabled', 'true');
    expect(chevron).toBeDisabled();

    fireEvent.click(chevron);
    expect(screen.queryByRole('menu', { name: 'Boolean operations' })).not.toBeInTheDocument();
  });

  it('renders at the built-in bottom placement by default', async () => {
    renderInMode('design');
    const palette = await screen.findByTestId('toolbar');
    expect(palette).toHaveAttribute('data-placement', 'bottom');
    expect(palette).not.toHaveClass('floating-toolbar--top');
  });

  it('renders at the persisted top placement for the active workspace', async () => {
    updateWorkspacePreferences((prefs) => setToolbarPlacementOverride(prefs, 'design', 'top'));
    renderInMode('design');
    const palette = await screen.findByTestId('toolbar');
    await waitFor(() => expect(palette).toHaveAttribute('data-placement', 'top'));
    expect(palette).toHaveClass('floating-toolbar--top');
    // Sparse storage decision: switching back stores nothing, so the default
    // remains free to change in a future release.
    updateWorkspacePreferences((prefs) => setToolbarPlacementOverride(prefs, 'design', 'bottom'));
    await waitFor(() => expect(palette).toHaveAttribute('data-placement', 'bottom'));
    expect(getWorkspacePreferences().design.toolbarPlacement).toBeUndefined();
  });
});

describe('getFlyoutMenuItems — boolean precondition truth', () => {
  const booleanFlyout = {
    kind: 'flyout' as const,
    id: 'boolean',
    label: 'Boolean operations',
    groupStart: true,
    tools: ['booleanUnion', 'booleanSubtract', 'booleanIntersect', 'booleanExclude'],
  };
  const shapesFlyout = {
    kind: 'flyout' as const,
    id: 'shapes',
    label: 'Shapes',
    tools: ['rect', 'ellipse'],
  };
  const activate = () => undefined;
  const onClose = () => undefined;

  it('disables boolean members while the selection precondition fails', () => {
    const items = getFlyoutMenuItems(booleanFlyout as never, false, activate, onClose);
    expect(items).toHaveLength(4);
    expect(items.every((item) => item.disabled === true)).toBe(true);
  });

  it('keeps boolean members enabled once the precondition holds', () => {
    const items = getFlyoutMenuItems(booleanFlyout as never, true, activate, onClose);
    expect(items.every((item) => item.disabled !== true)).toBe(true);
  });

  it('never applies the boolean rule to other flyouts', () => {
    const items = getFlyoutMenuItems(shapesFlyout as never, false, activate, onClose);
    expect(items.every((item) => item.disabled !== true)).toBe(true);
  });

  it('returns no entries when no flyout is open', () => {
    expect(getFlyoutMenuItems(undefined, true, activate, onClose)).toEqual([]);
  });
});
