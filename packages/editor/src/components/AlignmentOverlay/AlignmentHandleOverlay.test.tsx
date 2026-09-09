/**
 * AlignmentHandleOverlay tests — handle positions and visibility.
 *
 * Research basis: TDD for interaction overlay completeness.
 */

import { fireEvent, render } from '@testing-library/react';
import type { Document, SceneNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { useEditor } from '../../context';
import { nodeWorldBounds } from '../../scene/world';
import { AlignmentHandleOverlay } from './AlignmentHandleOverlay';

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

vi.mock('../../scene/world', () => ({
  nodeWorldBounds: vi.fn(),
  nodeWorldTransform: vi.fn((_doc: Document, id: string) => {
    const transform = (_doc.nodes[id] as SceneNode | undefined)?.transform;
    return transform ?? [1, 0, 0, 1, 0, 0];
  }),
}));

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    selection: [],
    document: { nodes: {}, pages: [], version: '1.0' } as unknown as Document,
    zoom: 1,
    pan: { x: 0, y: 0 },
    ...overrides,
  };
}

function makeNode(id: string, x: number, y: number, w: number, h: number): SceneNode {
  return {
    id,
    kind: 'shape',
    shape: { kind: 'rect', w, h },
    x,
    y,
    w,
    h,
    transform: [1, 0, 0, 1, x, y] as [number, number, number, number, number, number],
    parent: undefined,
    children: undefined,
  } as unknown as SceneNode;
}

describe('AlignmentHandleOverlay', () => {
  it('renders nothing when selection is empty', () => {
    vi.mocked(useEditor).mockReturnValue({
      state: makeState({ selection: [] }),
      distributeWithGap: vi.fn(),
    } as unknown as ReturnType<typeof useEditor>);

    const { container } = render(<AlignmentHandleOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when selection has 1 item', () => {
    vi.mocked(useEditor).mockReturnValue({
      state: makeState({ selection: ['a'] }),
      distributeWithGap: vi.fn(),
    } as unknown as ReturnType<typeof useEditor>);

    const { container } = render(<AlignmentHandleOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('renders SVG handles when 3 items are selected', () => {
    vi.mocked(nodeWorldBounds).mockImplementation((_doc: Document, id: string) => {
      switch (id) {
        case 'a':
          return { x: 0, y: 0, w: 50, h: 50 };
        case 'b':
          return { x: 100, y: 0, w: 50, h: 50 };
        case 'c':
          return { x: 200, y: 0, w: 50, h: 50 };
        default:
          return null;
      }
    });

    const doc = {
      nodes: {
        a: makeNode('a', 0, 0, 50, 50),
        b: makeNode('b', 100, 0, 50, 50),
        c: makeNode('c', 200, 0, 50, 50),
      },
      pages: [],
      version: '1.0',
    } as unknown as Document;

    vi.mocked(useEditor).mockReturnValue({
      state: makeState({ selection: ['a', 'b', 'c'], document: doc }),
      distributeWithGap: vi.fn(),
    } as unknown as ReturnType<typeof useEditor>);

    const { container } = render(<AlignmentHandleOverlay />);
    const svg = container.querySelector('svg.alignment-handle-overlay');
    expect(svg).not.toBeNull();

    const dots = container.querySelectorAll('.alignment-handle__dot');
    // 3 items → 2 horizontal gaps with dots
    expect(dots.length).toBeGreaterThanOrEqual(2);
  });

  it('computes correct gap labels between items', () => {
    vi.mocked(nodeWorldBounds).mockImplementation((_doc: Document, id: string) => {
      switch (id) {
        case 'a':
          return { x: 0, y: 0, w: 50, h: 50 };
        case 'b':
          return { x: 100, y: 0, w: 50, h: 50 };
        case 'c':
          return { x: 250, y: 0, w: 50, h: 50 };
        default:
          return null;
      }
    });

    const doc = {
      nodes: {
        a: makeNode('a', 0, 0, 50, 50),
        b: makeNode('b', 100, 0, 50, 50),
        c: makeNode('c', 250, 0, 50, 50),
      },
      pages: [],
      version: '1.0',
    } as unknown as Document;

    vi.mocked(useEditor).mockReturnValue({
      state: makeState({ selection: ['a', 'b', 'c'], document: doc }),
      distributeWithGap: vi.fn(),
    } as unknown as ReturnType<typeof useEditor>);

    const { container } = render(<AlignmentHandleOverlay />);
    const labels = container.querySelectorAll('.alignment-handle__label');
    expect(labels.length).toBeGreaterThanOrEqual(2);

    // Gap between a and b: 100 - 50 = 50px
    // Gap between b and c: 250 - 150 = 100px
    const textContents = Array.from(labels).map((el) => el.textContent);
    expect(textContents).toContain('50px');
    expect(textContents).toContain('100px');
  });

  it('keeps a two-item explicit gap handle connected to the preview transaction', () => {
    vi.mocked(nodeWorldBounds).mockImplementation((_doc: Document, id: string) => {
      if (id === 'a') return { x: 0, y: 0, w: 20, h: 20 };
      if (id === 'b') return { x: 60, y: 0, w: 30, h: 20 };
      return null;
    });

    const doc = {
      nodes: { a: makeNode('a', 0, 0, 20, 20), b: makeNode('b', 60, 0, 30, 20) },
      pages: [],
      version: '1.0',
    } as unknown as Document;
    const updateDoc = vi.fn((fn: (current: Document) => Document) => fn(doc));
    const beginTransaction = vi.fn();
    const commitTransaction = vi.fn();
    const abortTransaction = vi.fn();
    vi.mocked(useEditor).mockReturnValue({
      state: makeState({ selection: ['a', 'b'], document: doc }),
      distributeWithGap: vi.fn(),
      updateDoc,
      beginTransaction,
      commitTransaction,
      abortTransaction,
    } as unknown as ReturnType<typeof useEditor>);

    const { container } = render(<AlignmentHandleOverlay />);
    const dot = container.querySelector('.alignment-handle__dot');
    if (!dot) throw new Error('Expected an explicit-gap handle');

    const setPointerCapture = vi.fn();
    const hasPointerCapture = vi.fn(() => true);
    const releasePointerCapture = vi.fn();
    Object.assign(dot, { setPointerCapture, hasPointerCapture, releasePointerCapture });
    fireEvent.pointerDown(dot, { pointerId: 7, clientX: 50, clientY: 10 });
    fireEvent.pointerMove(dot, { pointerId: 7, clientX: 70, clientY: 10 });

    expect(beginTransaction).toHaveBeenCalledWith('preview');
    expect(updateDoc).toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(abortTransaction).toHaveBeenCalledTimes(1);
    expect(commitTransaction).not.toHaveBeenCalled();
  });
});
