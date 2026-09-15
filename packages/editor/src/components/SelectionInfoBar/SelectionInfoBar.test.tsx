/**
 * SelectionInfoBar tests — selection feedback strip rendering.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { addChild, createDesignCanvas, createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import {
  countActivePageLayers,
  getDisplayAncestorChain,
  getSelectionAnnouncement,
  SelectionInfoBar,
} from './SelectionInfoBar';

describe('SelectionInfoBar', () => {
  it('renders without crashing', () => {
    function Test() {
      return <SelectionInfoBar />;
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );
    expect(screen.getByText('0 layers')).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Selection information' });
    expect(region).toBeInTheDocument();
    expect(within(region).getByRole('status')).toHaveTextContent('No selection.');
  });

  it('announces selection identity without pointer-move geometry', () => {
    const document = createDocument('Announcements');
    const rectangle = makeShapeNode('rectangle', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });

    expect(getSelectionAnnouncement(document, [rectangle])).toBe(
      `${rectangle.name}, Rectangle selected.`,
    );
    expect(getSelectionAnnouncement(document, [rectangle, rectangle])).toBe('2 objects selected.');
    expect(getSelectionAnnouncement(document, [])).toContain('No selection.');
    expect(getSelectionAnnouncement(document, [rectangle])).not.toMatch(/100|80|X:|Y:/);
  });

  it('does not count or expose page content roots as user layers', () => {
    let document = createDocument('Paged');
    const page = document.pages?.[0];
    if (!page) throw new Error('default page missing');
    const rectangle = makeShapeNode('rectangle', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });
    document = addChild(document, page.contentRoot, rectangle);

    expect(countActivePageLayers(document)).toBe(1);
    expect(getDisplayAncestorChain(document, rectangle.id).map((node) => node.name)).toEqual([
      rectangle.name,
    ]);
  });

  it('does not count the Design Canvas content root as a user layer', () => {
    let document = createDesignCanvas(createDocument('Design', true), { name: 'Canvas 1' });
    const canvas = document.designCanvases?.[0];
    if (!canvas) throw new Error('Design Canvas missing');
    const rectangle = makeShapeNode('canvas-rectangle', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });
    document = addChild(document, canvas.contentRoot, rectangle);

    expect(countActivePageLayers(document)).toBe(1);
  });

  it('renders restore buttons when panels are collapsed and restores them on click', () => {
    function TestToggle() {
      const { toggleLeftPanel, toggleRightPanel, state } = useEditor();
      return (
        <div>
          <button type="button" onClick={toggleLeftPanel}>
            Toggle Left
          </button>
          <button type="button" onClick={toggleRightPanel}>
            Toggle Right
          </button>
          <span data-testid="left-state">{String(state.leftPanelVisible)}</span>
          <span data-testid="right-state">{String(state.rightPanelVisible)}</span>
          <SelectionInfoBar />
        </div>
      );
    }
    render(
      <EditorProvider>
        <TestToggle />
      </EditorProvider>,
    );
    expect(screen.queryByTestId('restore-left-panel')).toBeNull();
    expect(screen.queryByTestId('restore-right-panel')).toBeNull();

    // Collapse left panel
    fireEvent.click(screen.getByText('Toggle Left'));
    expect(screen.getByTestId('left-state')).toHaveTextContent('false');
    const restoreLeft = screen.getByTestId('restore-left-panel');
    expect(restoreLeft).toBeInTheDocument();
    expect(restoreLeft).toHaveAttribute('aria-label', 'Expand layers panel (Ctrl+B)');

    // Click restore button to expand left panel
    fireEvent.click(restoreLeft);
    expect(screen.getByTestId('left-state')).toHaveTextContent('true');
    expect(screen.queryByTestId('restore-left-panel')).toBeNull();

    // Collapse right panel
    fireEvent.click(screen.getByText('Toggle Right'));
    expect(screen.getByTestId('right-state')).toHaveTextContent('false');
    const restoreRight = screen.getByTestId('restore-right-panel');
    expect(restoreRight).toBeInTheDocument();
    expect(restoreRight).toHaveAttribute('aria-label', 'Expand inspector panel (Ctrl+Shift+B)');

    // Click restore button to expand right panel
    fireEvent.click(restoreRight);
    expect(screen.getByTestId('right-state')).toHaveTextContent('true');
    expect(screen.queryByTestId('restore-right-panel')).toBeNull();
  });
});
