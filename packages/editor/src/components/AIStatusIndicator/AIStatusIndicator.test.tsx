// @ts-nocheck
import { act, render, screen } from '@testing-library/react';
import { getInferenceAdmission, resetInferenceAdmission } from '@varve/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIStatusIndicator } from './AIStatusIndicator';

let editorState: { upscaleDialogOpen: boolean };

vi.mock('../../context', () => ({
  useEditor: () => ({ state: editorState }),
}));

afterEach(() => {
  editorState = { upscaleDialogOpen: false };
  const snapshot = getInferenceAdmission().getSnapshot();
  if (snapshot.active === 0 && snapshot.pending === 0) resetInferenceAdmission();
});

describe('AIStatusIndicator', () => {
  it('renders no chip when idle — the permanent "On-Device AI" claim was decorative', () => {
    editorState = { upscaleDialogOpen: false };
    render(<AIStatusIndicator />);
    expect(screen.queryByText('Processing')).toBeNull();
    expect(screen.queryByText('On-Device AI')).toBeNull();
    // The live region stays mounted and empty, ready to announce.
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('shows the chip only while a live InferenceAdmission lease is held', () => {
    editorState = { upscaleDialogOpen: false };
    render(<AIStatusIndicator />);
    expect(screen.queryByText('Processing')).toBeNull();

    let lease: { release(): void } | null = null;
    act(() => {
      lease = getInferenceAdmission().tryAcquire({ kind: 'background-removal' });
    });
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('AI processing locally');

    act(() => {
      lease?.release();
    });
    expect(screen.queryByText('Processing')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('stays busy while state.upscaleDialogOpen is true, independent of admission', () => {
    editorState = { upscaleDialogOpen: true };
    render(<AIStatusIndicator />);
    expect(screen.getByText('Processing')).toBeInTheDocument();
  });
});
