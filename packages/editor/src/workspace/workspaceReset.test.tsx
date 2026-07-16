// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../context';

function ResetHarness() {
  const { state, toggleLeftPanel, toggleRightPanel, resetWorkspaceToDefault } = useEditor();
  return (
    <div>
      <span data-testid="left">{String(state.leftPanelVisible)}</span>
      <span data-testid="right">{String(state.rightPanelVisible)}</span>
      <button type="button" onClick={toggleLeftPanel}>
        toggle left
      </button>
      <button type="button" onClick={toggleRightPanel}>
        toggle right
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
    // Design mode default: both panels visible.
    expect(screen.getByTestId('left')).toHaveTextContent('true');
    expect(screen.getByTestId('right')).toHaveTextContent('true');

    fireEvent.click(screen.getByRole('button', { name: 'toggle left' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle right' }));
    expect(screen.getByTestId('left')).toHaveTextContent('false');
    expect(screen.getByTestId('right')).toHaveTextContent('false');

    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(screen.getByTestId('left')).toHaveTextContent('true');
    expect(screen.getByTestId('right')).toHaveTextContent('true');
  });
});
