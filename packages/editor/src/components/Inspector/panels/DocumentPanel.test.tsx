/**
 * DocumentPanel canvas background — reset-to-default semantics.
 *
 * The default canvas background is the theme sunken surface; it is not a
 * stored color. Reset must therefore REMOVE Document.canvasBackground, not
 * write white.
 *
 * Pass 3 (IA-024): the document-grid numerics are NumberFields — APG
 * spinbuttons with commit/clamp semantics rather than raw type="number"
 * inputs. The tests below pin the commit, clamp, and invalid-input paths.
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

/** Reads the document-grid values the migrated fields write. */
function GridProbe() {
  const { state } = useEditor();
  return (
    <span data-testid="grid-state">
      {`${state.documentGrid.spacingX}|${state.documentGrid.spacingY}|${state.documentGrid.subdivisions}|${state.documentGrid.offsetX}|${state.documentGrid.offsetY}`}
    </span>
  );
}

function renderPanel() {
  return render(
    <EditorProvider>
      <DocumentPanel />
      <BackgroundProbe />
      <GridProbe />
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

describe('DocumentPanel grid numerics are spinbuttons', () => {
  function expandDocumentGrid() {
    // Collapsed disclosure panels are unmounted, so aria-controls is absent
    // until expanded; query the trigger by its accessible name instead.
    const trigger = screen.getByRole('button', { name: /document grid/i });
    if (trigger.getAttribute('aria-expanded') === 'false') fireEvent.click(trigger);
  }

  it('commits a typed value on Enter with spinbutton semantics', () => {
    renderPanel();
    expandDocumentGrid();
    const spacingX = screen.getByRole('spinbutton', { name: 'Spacing X (px)' });
    expect(spacingX).toHaveAttribute('aria-valuenow');

    fireEvent.change(spacingX, { target: { value: '42' } });
    fireEvent.keyDown(spacingX, { key: 'Enter' });

    expect(screen.getByTestId('grid-state')).toHaveTextContent(/^42\|/);
  });

  it('clamps a typed value to the field range on commit', () => {
    renderPanel();
    expandDocumentGrid();
    const spacingX = screen.getByRole('spinbutton', { name: 'Spacing X (px)' });

    fireEvent.change(spacingX, { target: { value: '99999' } });
    fireEvent.keyDown(spacingX, { key: 'Enter' });

    expect(screen.getByTestId('grid-state')).toHaveTextContent(/^10000\|/);
  });

  it('rejects an invalid expression without writing the grid', () => {
    renderPanel();
    expandDocumentGrid();
    const before = screen.getByTestId('grid-state').textContent;
    const spacingX = screen.getByRole('spinbutton', { name: 'Spacing X (px)' });

    fireEvent.change(spacingX, { target: { value: 'not a number' } });
    fireEvent.blur(spacingX);

    expect(screen.getByTestId('grid-state')).toHaveTextContent(before ?? '');
    const alerts = screen.getAllByRole('alert').map((element) => element.textContent ?? '');
    expect(alerts.some((text) => text.includes('Not a valid number or expression'))).toBe(true);
  });
});
