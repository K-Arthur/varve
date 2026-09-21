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

function expandAiTools() {
  const disclosure = screen.getByRole('button', { name: 'AI Tools' });
  if (disclosure.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(disclosure);
  }
}

describe('AiToolsHintSection', () => {
  it('points at Photo mode and names the tools that live there', () => {
    render(
      <EditorProvider>
        <AiToolsHintSection />
      </EditorProvider>,
    );
    expandAiTools();
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
    expandAiTools();
    expect(screen.getByTestId('mode-readout')).toHaveTextContent('design');
    fireEvent.click(screen.getByRole('button', { name: /switch to photo mode/i }));
    expect(screen.getByTestId('mode-readout')).toHaveTextContent('image');
  });
});
