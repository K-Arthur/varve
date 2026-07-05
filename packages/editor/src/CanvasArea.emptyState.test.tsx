import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from './context';
import { CanvasArea } from './CanvasArea';
import type { NodeId } from '@strata/scene';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Helper test component that exposes editor context for assertions. */
function TestShell() {
  return (
    <EditorProvider>
      <CanvasArea />
    </EditorProvider>
  );
}

describe('CanvasArea empty state', () => {
  it('renders empty state on empty document', async () => {
    render(<TestShell />);

    await waitFor(() => {
      expect(screen.getByText('Your canvas is empty')).toBeTruthy();
    });
    expect(
      screen.getByText(/Draw a shape, add some text, or import an image/),
    ).toBeTruthy();
  });

  it('renders three CTA buttons in the empty state', async () => {
    render(<TestShell />);

    await waitFor(() => {
      expect(screen.getByText('Draw a rectangle')).toBeTruthy();
      expect(screen.getByText('Add text')).toBeTruthy();
      expect(screen.getByText('Import...')).toBeTruthy();
    });
  });

  it('Draw a rectangle button calls setTool with rect', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return <CanvasArea />;
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Draw a rectangle')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Draw a rectangle'));

    await waitFor(() => {
      expect(ctx?.state.tool).toBe('rect');
    });
  });

  it('does not render empty state when document has nodes', async () => {
    const { createDocument, makeShapeNode, addNode } = await import('@strata/scene');

    let doc = createDocument('test-doc');
    const node = makeShapeNode(
      'n1' as NodeId,
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { name: 'Rect 1' },
    );
    doc = addNode(doc, node);

    function Test() {
      return (
        <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
          <CanvasArea />
        </EditorProvider>
      );
    }
    render(<Test />);

    await waitFor(() => {
      expect(screen.queryByText('Your canvas is empty')).toBeNull();
    });
  });
});
