import { fireEvent, render, screen } from '@testing-library/react';
import type { LayerState } from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerStatesSection } from './LayerStatesSection';

const handlers = {
  captureLayerState: vi.fn(() => ({
    id: 'new',
    name: 'State 1',
    categories: [] as string[],
    captured: {},
    createdAt: '2026-01-01T00:00:00.000Z',
  })),
  applyLayerState: vi.fn(() => 0),
  recaptureLayerState: vi.fn(),
  renameLayerState: vi.fn(),
  deleteLayerState: vi.fn(),
  duplicateLayerState: vi.fn(),
  announce: vi.fn(),
};

// `mock`-prefixed so vitest hoists it for the factory below.
const mockState = {
  document: { layerStates: [] as LayerState[] },
  selection: [] as string[],
};

vi.mock('../../context', () => ({
  useEditor: () => ({ state: mockState, ...handlers }),
}));

function setState(states: LayerState[], selection: string[]) {
  mockState.document = { layerStates: states };
  mockState.selection = selection;
}

beforeEach(() => {
  vi.clearAllMocks();
  setState([], []);
});

describe('LayerStatesSection', () => {
  it('renders nothing when there are no states and no selection', () => {
    const { container } = render(<LayerStatesSection />);
    expect(container.firstChild).toBeNull();
  });

  it('exposes a capture button when a selection exists', () => {
    setState([], ['a']);
    render(<LayerStatesSection />);
    const btn = screen.getByLabelText(/Capture state from selection/);
    fireEvent.click(btn);
    expect(handlers.captureLayerState).toHaveBeenCalledTimes(1);
  });

  it('applies, recaptures, duplicates, renames, and deletes an existing state', () => {
    const existing: LayerState = {
      id: 's1',
      name: 'Wireframe',
      categories: ['visibility', 'transforms'],
      captured: { visibility: { a: true } },
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    setState([existing], ['a']);
    render(<LayerStatesSection />);

    expect(screen.getByText('Wireframe')).toBeTruthy();

    fireEvent.click(screen.getByText('Wireframe'));
    expect(handlers.applyLayerState).toHaveBeenCalledWith('s1');

    fireEvent.click(screen.getByLabelText('Recapture Wireframe from selection'));
    expect(handlers.recaptureLayerState).toHaveBeenCalledWith('s1');

    fireEvent.click(screen.getByLabelText('Duplicate Wireframe'));
    expect(handlers.duplicateLayerState).toHaveBeenCalledWith('s1');

    fireEvent.click(screen.getByLabelText('Delete Wireframe'));
    expect(handlers.deleteLayerState).toHaveBeenCalledWith('s1');

    fireEvent.click(screen.getByLabelText('Rename Wireframe'));
    const input = screen.getByDisplayValue('Wireframe') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Final' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handlers.renameLayerState).toHaveBeenCalledWith('s1', 'Final');
  });

  it('surfaces a conflict notice when a state references deleted nodes', () => {
    const existing: LayerState = {
      id: 's1',
      name: 'Wireframe',
      categories: ['visibility'],
      captured: { visibility: { a: true } },
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    setState([existing], ['a']);
    handlers.applyLayerState.mockReturnValue(2);
    render(<LayerStatesSection />);

    fireEvent.click(screen.getByText('Wireframe'));
    expect(handlers.applyLayerState).toHaveBeenCalledWith('s1');

    const notice = screen.getByRole('status');
    expect(notice.textContent).toMatch(/2 nodes in this state no longer exist/);

    fireEvent.click(screen.getByLabelText('Dismiss conflict notice'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not show a conflict notice when every referenced node still exists', () => {
    const existing: LayerState = {
      id: 's1',
      name: 'Wireframe',
      categories: ['visibility'],
      captured: { visibility: { a: true } },
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    setState([existing], ['a']);
    handlers.applyLayerState.mockReturnValue(0);
    render(<LayerStatesSection />);

    fireEvent.click(screen.getByText('Wireframe'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
