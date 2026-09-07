// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { makePathNode } from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../context', () => ({
  useEditor: vi.fn(),
}));

import { useEditor } from '../../../context';
import { AdjustmentsPanel } from './AdjustmentsPanel';

describe('AdjustmentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the Effect Studio entry point available for vector selections', () => {
    const openEffectStudioDialog = vi.fn();
    const path = makePathNode('vector-path', {
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 120, y: 0, handleIn: null, handleOut: null },
        { x: 60, y: 100, handleIn: null, handleOut: null },
      ],
      closed: true,
    });
    vi.mocked(useEditor).mockReturnValue({
      selectedNodes: () => [path],
      openCafDialog: vi.fn(),
      openEffectStudioDialog,
    } as unknown as ReturnType<typeof useEditor>);

    render(<AdjustmentsPanel />);

    expect(screen.getByText('Image Tuning is raster-only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Effect Studio' }));
    expect(openEffectStudioDialog).toHaveBeenCalledOnce();
  });
});
