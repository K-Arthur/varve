/**
 * DocumentPanel canvas background — reset-to-default semantics.
 *
 * The default canvas background is the theme sunken surface; it is not a
 * stored color. Reset must therefore REMOVE Document.canvasBackground, not
 * write white.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../context';
import { DocumentPanel } from './DocumentPanel';

afterEach(cleanup);

/** Reads/writes the document canvas background so tests can drive the flow. */
function BackgroundProbe() {
  const { state, setCanvasBackground, beginTransaction, commitTransaction } = useEditor();
  return (
    <>
      <span data-testid="bg-state">{state.document.canvasBackground ? 'custom' : 'default'}</span>
      <button
        type="button"
        onClick={() => {
          beginTransaction();
          setCanvasBackground({ space: 'rgb', r: 10, g: 20, b: 30, a: 255 });
          commitTransaction();
        }}
      >
        set-custom
      </button>
    </>
  );
}

function renderPanel() {
  return render(
    <EditorProvider>
      <DocumentPanel />
      <BackgroundProbe />
    </EditorProvider>,
  );
}

describe('DocumentPanel canvas background reset', () => {
  it('disables Reset while the document has no custom background', () => {
    renderPanel();
    const reset = screen.getByRole('button', { name: 'Reset canvas background to default' });
    expect(reset).toBeDisabled();
  });

  it('removes the custom color so the canvas falls back to the theme surface', () => {
    renderPanel();
    expect(screen.getByTestId('bg-state')).toHaveTextContent('default');

    fireEvent.click(screen.getByText('set-custom'));
    expect(screen.getByTestId('bg-state')).toHaveTextContent('custom');
    const reset = screen.getByRole('button', { name: 'Reset canvas background to default' });
    expect(reset).toBeEnabled();

    fireEvent.click(reset);
    expect(screen.getByTestId('bg-state')).toHaveTextContent('default');
    expect(reset).toBeDisabled();
  });
});
