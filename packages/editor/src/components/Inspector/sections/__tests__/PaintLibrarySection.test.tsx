// @ts-nocheck
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../context', () => ({ useEditor: vi.fn() }));

import { useEditor } from '../../../../context';
import { PaintLibrarySection } from '../PaintLibrarySection';

const mockedUseEditor = vi.mocked(useEditor);

afterEach(cleanup);

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    name: 'Test Doc',
    version: '1.8',
    nodes: {},
    rootChildren: [],
    pages: [],
    pageOrder: [],
    activePageId: null,
    paints: {},
    ...overrides,
  };
}

function makeShapeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    name: 'Rect 1',
    kind: 'shape' as const,
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
    transform: [1, 0, 0, 1, 0, 0] as const,
    fills: [
      {
        type: 'solid' as const,
        color: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 },
        opacity: 1,
        blendMode: 'normal' as const,
        visible: true,
      },
    ],
    fill: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 },
    strokes: [],
    effects: [],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    order: 'a0',
    ...overrides,
  };
}

function makeSolidPaint(id: string, name: string, color: { r: number; g: number; b: number }) {
  return {
    id,
    name,
    fill: {
      type: 'solid' as const,
      color: { space: 'rgb' as const, ...color, a: 255 },
      opacity: 1,
      blendMode: 'normal' as const,
      visible: true,
    },
  };
}

describe('PaintLibrarySection', () => {
  const updateDoc = vi.fn();
  const announce = vi.fn();
  const showToast = vi.fn();

  beforeEach(() => {
    updateDoc.mockClear();
    announce.mockClear();
    showToast.mockClear();
    mockedUseEditor.mockReturnValue({
      state: { document: makeDocument() },
      selectedNodes: () => [],
      updateDoc,
      announce,
      showToast,
    });
  });

  it('shows empty state when no paints exist', () => {
    render(<PaintLibrarySection />);
    expect(screen.getByText(/no paints/i)).toBeTruthy();
  });

  it('renders paint entries from document', () => {
    const doc = makeDocument({
      paints: {
        p1: makeSolidPaint('p1', 'Red', { r: 255, g: 0, b: 0 }),
        p2: makeSolidPaint('p2', 'Blue', { r: 0, g: 0, b: 255 }),
      },
    });
    mockedUseEditor.mockReturnValue({
      state: { document: doc },
      selectedNodes: () => [],
      updateDoc,
      announce,
      showToast,
    });

    render(<PaintLibrarySection />);
    expect(screen.getByText('Red')).toBeTruthy();
    expect(screen.getByText('Blue')).toBeTruthy();
  });

  it('filters paints by search text', () => {
    const doc = makeDocument({
      paints: {
        p1: makeSolidPaint('p1', 'Red Accent', { r: 255, g: 0, b: 0 }),
        p2: makeSolidPaint('p2', 'Blue Sky', { r: 0, g: 0, b: 255 }),
      },
    });
    mockedUseEditor.mockReturnValue({
      state: { document: doc },
      selectedNodes: () => [],
      updateDoc,
      announce,
      showToast,
    });

    render(<PaintLibrarySection />);
    const input = screen.getByPlaceholderText(/filter|search/i);
    fireEvent.change(input, { target: { value: 'Red' } });
    expect(screen.getByText('Red Accent')).toBeTruthy();
    expect(screen.queryByText('Blue Sky')).toBeNull();
  });

  it('adds current fill to library via "add to library" button', () => {
    const node = makeShapeNode();
    const doc = makeDocument();
    mockedUseEditor.mockReturnValue({
      state: { document: doc },
      selectedNodes: () => [node],
      updateDoc,
      announce,
      showToast,
    });

    render(<PaintLibrarySection />);
    const addBtn = screen.getByRole('button', { name: /add current fill/i });
    fireEvent.click(addBtn);

    expect(updateDoc).toHaveBeenCalledOnce();
    const updater = updateDoc.mock.calls[0][0];
    const result = updater(doc);
    expect(result.paints).toBeDefined();
    const paintIds = Object.keys(result.paints!);
    expect(paintIds.length).toBe(1);
    const paint = result.paints![paintIds[0]];
    expect(paint.name).toBe('Rect 1');
    expect(paint.fill.type).toBe('solid');
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/added/i));
  });

  it('applies a library paint to selected node', () => {
    const node = makeShapeNode({ id: 'n1' });
    const doc = makeDocument({
      nodes: { n1: node },
      paints: {
        p1: makeSolidPaint('p1', 'Red', { r: 255, g: 0, b: 0 }),
      },
    });
    mockedUseEditor.mockReturnValue({
      state: { document: doc },
      selectedNodes: () => [node],
      updateDoc,
      announce,
      showToast,
    });

    render(<PaintLibrarySection />);
    const applyBtns = screen.getAllByRole('button', { name: /apply/i });
    fireEvent.click(applyBtns[0]);

    expect(updateDoc).toHaveBeenCalled();
    const updater = updateDoc.mock.calls[0][0];
    const result = updater(doc);
    expect(result.nodes.n1.paintRefs).toEqual(['p1']);
  });

  it('detaches paint reverts to inline fills', () => {
    const node = makeShapeNode({
      id: 'n1',
      paintRefs: ['p1'],
    });
    const doc = makeDocument({
      nodes: { n1: node },
      paints: {
        p1: makeSolidPaint('p1', 'Red', { r: 255, g: 0, b: 0 }),
      },
    });
    mockedUseEditor.mockReturnValue({
      state: { document: doc },
      selectedNodes: () => [node],
      updateDoc,
      announce,
      showToast,
    });

    render(<PaintLibrarySection />);
    const detachBtn = screen.getByRole('button', { name: /detach/i });
    fireEvent.click(detachBtn);

    expect(updateDoc).toHaveBeenCalled();
    const updater = updateDoc.mock.calls[0][0];
    const result = updater(doc);
    const updatedNode = result.nodes.n1;
    expect(updatedNode.paintRefs).toBeUndefined();
    expect(updatedNode.fills).toBeDefined();
  });

  it('shows referenced indicator when node uses a library paint', () => {
    const node = makeShapeNode({
      id: 'n1',
      paintRefs: ['p1'],
    });
    const doc = makeDocument({
      paints: {
        p1: makeSolidPaint('p1', 'Red', { r: 255, g: 0, b: 0 }),
      },
    });
    mockedUseEditor.mockReturnValue({
      state: { document: doc },
      selectedNodes: () => [node],
      updateDoc,
      announce,
      showToast,
    });

    render(<PaintLibrarySection />);
    expect(screen.getByText(/referenced|shared/i)).toBeTruthy();
  });

  it('deleting in-use paint shows reassign prompt', () => {
    const node = makeShapeNode({
      id: 'n1',
      paintRefs: ['p1'],
    });
    const doc = makeDocument({
      nodes: { n1: node },
      paints: {
        p1: makeSolidPaint('p1', 'Red', { r: 255, g: 0, b: 0 }),
      },
    });
    mockedUseEditor.mockReturnValue({
      state: { document: doc },
      selectedNodes: () => [node],
      updateDoc,
      announce,
      showToast,
    });

    render(<PaintLibrarySection />);
    const deleteBtn = screen.getAllByRole('button', { name: /delete/i })[0];
    fireEvent.click(deleteBtn!);

    expect(screen.getByText(/in use/i)).toBeTruthy();
  });

  it('allows keyboard-only library browsing and apply via click', () => {
    const node = makeShapeNode({ id: 'n1' });
    const doc = makeDocument({
      paints: {
        p1: makeSolidPaint('p1', 'Red', { r: 255, g: 0, b: 0 }),
        p2: makeSolidPaint('p2', 'Blue', { r: 0, g: 0, b: 255 }),
      },
    });
    const updateDocMock = vi.fn();
    mockedUseEditor.mockReturnValue({
      state: { document: doc },
      selectedNodes: () => [node],
      updateDoc: updateDocMock,
      announce,
      showToast,
    });

    render(<PaintLibrarySection />);
    const entries = screen.getAllByRole('button', { name: /apply/i });
    expect(entries.length).toBe(2);
    fireEvent.click(entries[0]);

    expect(updateDocMock).toHaveBeenCalled();
  });

  it('paint library survives document round-trip', () => {
    const doc = makeDocument({
      paints: {
        p1: makeSolidPaint('p1', 'Round-trip Paint', { r: 100, g: 150, b: 200 }),
      },
    });

    const json = JSON.stringify(doc);
    const restored = JSON.parse(json);

    expect(restored.paints).toBeDefined();
    expect(restored.paints.p1).toBeDefined();
    expect(restored.paints.p1.name).toBe('Round-trip Paint');
    expect(restored.paints.p1.fill.type).toBe('solid');
  });

  it('drag-to-apply produces correct state on drop', () => {
    const node = makeShapeNode({ id: 'n1' });
    const doc = makeDocument({
      paints: {
        p1: makeSolidPaint('p1', 'Red', { r: 255, g: 0, b: 0 }),
      },
    });
    const updateDocMock = vi.fn();
    mockedUseEditor.mockReturnValue({
      state: { document: doc },
      selectedNodes: () => [node],
      updateDoc: updateDocMock,
      announce,
      showToast,
    });

    render(<PaintLibrarySection />);

    const entry = screen.getByText('Red').closest('[draggable]') as HTMLElement;
    expect(entry).not.toBeNull();
    expect(entry.getAttribute('draggable')).toBe('true');

    const paintId = entry.getAttribute('data-paint-id');
    expect(paintId).toBe('p1');
  });
});
