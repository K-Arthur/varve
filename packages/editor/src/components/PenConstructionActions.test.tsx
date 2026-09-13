// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PenConstructionDraft } from '../tools/types';
import { PenConstructionActions } from './PenConstructionActions';

afterEach(cleanup);

const draft: PenConstructionDraft = {
  kind: 'bezier-path',
  points: [
    { x: 10, y: 10, handleIn: null, handleOut: null },
    { x: 80, y: 40, handleIn: null, handleOut: null },
  ],
  activePointIndex: 1,
  pointer: null,
  closedPreview: false,
  isDragging: false,
  undoAnchorAvailable: true,
};

describe('PenConstructionActions', () => {
  it('exposes labeled touch actions and dispatches each action', () => {
    const onAction = vi.fn();
    render(<PenConstructionActions draft={draft} onAction={onAction} />);

    expect(screen.getByRole('toolbar', { name: 'Pen path actions' })).toBeInTheDocument();
    for (const label of ['Finish open path', 'Close path', 'Undo last anchor', 'Cancel path']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Finish open path' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close path' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo last anchor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel path' }));

    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      'finish',
      'close',
      'undo-anchor',
      'cancel',
    ]);
  });

  it('disables close and undo when the draft cannot perform them', () => {
    const oneAnchor: PenConstructionDraft = {
      ...draft,
      points: [draft.points[0]!],
      activePointIndex: 0,
      undoAnchorAvailable: false,
    };
    render(<PenConstructionActions draft={oneAnchor} onAction={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Close path' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Undo last anchor' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Finish open path' })).toBeEnabled();
  });
});
