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
  it('reflects a live InferenceAdmission lease as busy, and clears on release', () => {
    editorState = { upscaleDialogOpen: false };
    render(<AIStatusIndicator />);
    expect(screen.getByRole('status')).toHaveAccessibleName('Local neural engine ready');

    let lease: { release(): void } | null = null;
    act(() => {
      lease = getInferenceAdmission().tryAcquire({ kind: 'background-removal' });
    });
    expect(screen.getByRole('status')).toHaveAccessibleName('AI Processing locally');

    act(() => {
      lease?.release();
    });
    expect(screen.getByRole('status')).toHaveAccessibleName('Local neural engine ready');
  });

  it('stays busy while state.upscaleDialogOpen is true, independent of admission', () => {
    editorState = { upscaleDialogOpen: true };
    render(<AIStatusIndicator />);
    expect(screen.getByRole('status')).toHaveAccessibleName('AI Processing locally');
  });
});
