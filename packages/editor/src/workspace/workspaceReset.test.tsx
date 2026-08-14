// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../context';

// EditorProvider mounts the full editor context — heavy on cold machines and
// under parallel load; the jsdom project's default 5s timeout is too tight.
vi.setConfig({ testTimeout: 30000 });

function ResetHarness() {
  const {
    state,
    toggleLeftPanel,
    toggleRightPanel,
    toggleHistoryPanel,
    restoreAllPanels,
    resetWorkspaceToDefault,
  } = useEditor();
  return (
    <div>
      <span data-testid="left">{String(state.leftPanelVisible)}</span>
      <span data-testid="right">{String(state.rightPanelVisible)}</span>
      <span data-testid="history">{String(state.historyPanelVisible)}</span>
      <button type="button" onClick={toggleLeftPanel}>
        toggle left
      </button>
      <button type="button" onClick={toggleRightPanel}>
        toggle right
      </button>
      <button type="button" onClick={toggleHistoryPanel}>
        toggle history
      </button>
      <button type="button" onClick={restoreAllPanels}>
        restore all
      </button>
      <button type="button" onClick={resetWorkspaceToDefault}>
        reset
      </button>
    </div>
  );
}

describe('resetWorkspaceToDefault', () => {
  it('restores the current mode default panel visibility after manual toggles', () => {
    render(
      <EditorProvider>
        <ResetHarness />
      </EditorProvider>,
    );
    // Design mode default: layers + inspector visible, history hidden.
    expect(screen.getByTestId('left')).toHaveTextContent('true');
    expect(screen.getByTestId('right')).toHaveTextContent('true');
    expect(screen.getByTestId('history')).toHaveTextContent('false');

    fireEvent.click(screen.getByRole('button', { name: 'toggle left' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle right' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle history' }));
    expect(screen.getByTestId('left')).toHaveTextContent('false');
    expect(screen.getByTestId('right')).toHaveTextContent('false');
    expect(screen.getByTestId('history')).toHaveTextContent('true');

    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(screen.getByTestId('left')).toHaveTextContent('true');
    expect(screen.getByTestId('right')).toHaveTextContent('true');
    expect(screen.getByTestId('history')).toHaveTextContent('false');
  });

  it('restoreAllPanels reveals every panel, including the history panel', () => {
    render(
      <EditorProvider>
        <ResetHarness />
      </EditorProvider>,
    );
    // Hide everything, then restore.
    fireEvent.click(screen.getByRole('button', { name: 'toggle left' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle right' }));
    expect(screen.getByTestId('left')).toHaveTextContent('false');
    expect(screen.getByTestId('right')).toHaveTextContent('false');

    fireEvent.click(screen.getByRole('button', { name: 'restore all' }));
    expect(screen.getByTestId('left')).toHaveTextContent('true');
    expect(screen.getByTestId('right')).toHaveTextContent('true');
    expect(screen.getByTestId('history')).toHaveTextContent('true');
  });
});
