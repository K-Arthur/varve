// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import type { WorkspaceMode } from '../../workspace/workspaceTypes';
import { FloatingToolbar } from './FloatingToolbar';

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
    // it to land — Smudge only renders once drawing mode is active — or its
    // tool reset closes the popover mid-test (see ToolOptionsPopover's
    // close-on-tool-change effect), making the Brush button unreachable.
    await screen.findByLabelText('Smudge');
    fireEvent.click(screen.getByLabelText('Paint Brush'));

    const options = screen.getByRole('button', { name: 'Tool options' });
    expect(options).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(options);

    expect(await screen.findByRole('dialog', { name: 'paint tool options' })).toBeInTheDocument();
    const brushButton = await screen.findByRole('button', { name: 'Brush' }, { timeout: 5000 });
    await waitFor(() => expect(brushButton).toHaveFocus());
    expect(options).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'paint tool options' })).not.toBeInTheDocument();
    expect(options).toHaveFocus();
  });

  it('Image mode hides the frame tool and boolean ops, keeps retouch tools', () => {
    renderInMode('image');
    expect(screen.queryByLabelText('Frame')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Boolean operations menu')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Clone Stamp')).toBeInTheDocument();
    expect(screen.getByLabelText('Healing Brush')).toBeInTheDocument();
    expect(screen.getByLabelText('Spot Heal')).toBeInTheDocument();
    // Shape tool remains available (useful for selection marquees on a photo).
    expect(screen.getByLabelText('Shapes menu')).toBeInTheDocument();
  });
});
