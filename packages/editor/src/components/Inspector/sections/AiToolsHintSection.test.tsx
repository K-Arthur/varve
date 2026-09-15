// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../context';
import { AiToolsHintSection } from './AiToolsHintSection';

function ModeReadout() {
  const { state } = useEditor();
  return <span data-testid="mode-readout">{state.workspaceMode}</span>;
}

describe('AiToolsHintSection', () => {
  it('points at Photo mode and names the tools that live there', () => {
    render(
      <EditorProvider>
        <AiToolsHintSection />
      </EditorProvider>,
    );
    expect(screen.getByText(/live in Photo mode/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to photo mode/i })).toBeInTheDocument();
  });

  it('switches the workspace into Photo mode on click', () => {
    render(
      <EditorProvider>
        <ModeReadout />
        <AiToolsHintSection />
      </EditorProvider>,
    );
    expect(screen.getByTestId('mode-readout')).toHaveTextContent('design');
    fireEvent.click(screen.getByRole('button', { name: /switch to photo mode/i }));
    expect(screen.getByTestId('mode-readout')).toHaveTextContent('image');
  });
});
