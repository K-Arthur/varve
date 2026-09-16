// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import {
  addChild,
  addNode,
  createDesignCanvas,
  createDocument,
  designCanvasContentRoot,
  makeFrameNode,
  makeShapeNode,
} from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ useEditor: vi.fn() }));

vi.mock('../../../context', () => ({ useEditor: mocks.useEditor }));
vi.mock('../../AlignmentOverlay/AlignmentGuideOverlay', () => ({
  showAlignmentGuidesFromResult: vi.fn(),
}));

import { AlignDistributeBar } from './AlignDistributeBar';

afterEach(() => vi.clearAllMocks());

function editorForSelection(
  selection: string[],
  alignToPage = false,
  lockedA = false,
  primaryId = selection[0] ?? null,
  workspaceMode = 'design',
) {
  let document = createDocument('align controls');
  for (const id of ['a', 'b', 'c']) {
    document = addNode(
      document,
      makeShapeNode(
        id,
        { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
        { name: id, locked: lockedA && id === 'a' },
      ),
    );
  }
  return {
    state: { document, selection, primaryId, workspaceMode },
    alignSelected: vi.fn(),
    obbAlignSelected: vi.fn(),
    distributeSelected: vi.fn(),
    distributeWithGap: vi.fn(),
    distributeWithMode: vi.fn(),
    tidySelected: vi.fn(),
    setKeyObject: vi.fn(),
    keyObjectId: null,
    alignToPage,
    setAlignToPage: vi.fn(),
  };
}

describe('AlignDistributeBar', () => {
  it('uses shared capability rules for disabled controls', () => {
    mocks.useEditor.mockReturnValue(editorForSelection(['a', 'b']));
    render(<AlignDistributeBar />);

    // The align commands name the live reference in their accessible name.
    expect(screen.getByRole('button', { name: 'Align left edges to selection' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Distribute horizontal spacing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Set key object from selection' })).toBeEnabled();
  });

  it('aligns a single root selection to the page and hides relative-only commands', () => {
    mocks.useEditor.mockReturnValue(editorForSelection(['a']));
    render(<AlignDistributeBar />);

    expect(screen.getByRole('heading', { name: 'Align & distribute' })).toBeVisible();
    // Single root selection has exactly one meaningful target (the page), so
    // the align commands are live rather than rendering a dead toolbar.
    expect(screen.getByRole('button', { name: 'Align left edges to page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Align to page (active)' })).toBeEnabled();
    // The other references stay visible but announce themselves unavailable,
    // so the alignment mode is never a hidden state.
    expect(screen.getByRole('button', { name: 'Align to selection bounds' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Align to parent frame' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // Key object, distribute, gap, tidy and OBB need 2+ layers: omitted.
    expect(screen.queryByRole('button', { name: 'Set key object from selection' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Distribute horizontal spacing' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Distribution options' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tidy up grid' })).toBeNull();
  });

  it('names the surface Canvas and aligns to its content in design workspaces', () => {
    const editor = editorForSelection(['a']);
    let document = createDesignCanvas(createDocument('canvas align controls'));
    const rootId = designCanvasContentRoot(document);
    if (!rootId) throw new Error('Expected a design canvas content root');
    document = addChild(
      document,
      rootId,
      makeShapeNode(
        'a',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
        { name: 'a', transform: [1, 0, 0, 1, 10, 15] },
      ),
    );
    editor.state.document = document;
    editor.state.workspaceMode = 'design';
    mocks.useEditor.mockReturnValue(editor);
    render(<AlignDistributeBar />);

    expect(screen.getByRole('button', { name: 'Align to canvas (active)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Align left edges to canvas' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Align left edges to canvas' }));
    expect(editor.alignSelected).toHaveBeenCalledWith('left', 'page');
  });

  it('keeps Page as the surface in print workspaces', () => {
    const editor = editorForSelection(['a'], false, false, 'a', 'print');
    mocks.useEditor.mockReturnValue(editor);
    render(<AlignDistributeBar />);

    expect(screen.getByRole('button', { name: 'Align to page (active)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Align left edges to page' })).toBeEnabled();
  });

  it('uses the explicit primary node when setting a key object', () => {
    const editor = editorForSelection(['a', 'b'], false, false, 'b');
    mocks.useEditor.mockReturnValue(editor);
    render(<AlignDistributeBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Set key object from selection' }));

    expect(editor.setKeyObject).toHaveBeenCalledWith('b');
  });

  it('honours the stored page preference for a single selection', () => {
    mocks.useEditor.mockReturnValue(editorForSelection(['a'], true));
    render(<AlignDistributeBar />);

    expect(screen.getByRole('button', { name: 'Align left edges to page' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Distribute horizontal spacing' })).toBeNull();
  });

  it('prefers the nearest frame for a single child selection', () => {
    const editor = editorForSelection(['child']);
    const frame = makeFrameNode('frame', { w: 240, h: 160 });
    const child = makeShapeNode('child', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 });
    editor.state.document = addChild(addNode(editor.state.document, frame), frame.id, child);
    mocks.useEditor.mockReturnValue(editor);
    render(<AlignDistributeBar />);

    // The only sensible target for one child is its frame, so it is active
    // immediately and relative-only commands are not rendered at all.
    expect(screen.getByRole('button', { name: 'Align to parent frame (active)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Align to selection bounds' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Align left edges to parent frame' }));
    expect(editor.alignSelected).toHaveBeenCalledWith('left', 'container');
    expect(screen.queryByRole('button', { name: 'Set key object from selection' })).toBeNull();
  });

  it('shows the selection reference only once two layers are selected', () => {
    const editor = editorForSelection(['child1', 'child2']);
    const frame = makeFrameNode('frame', { w: 240, h: 160 });
    let document = addNode(editor.state.document, frame);
    document = addChild(
      document,
      frame.id,
      makeShapeNode('child1', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
    );
    document = addChild(
      document,
      frame.id,
      makeShapeNode('child2', { kind: 'rect', x: 40, y: 0, w: 20, h: 20 }),
    );
    editor.state.document = document;
    mocks.useEditor.mockReturnValue(editor);
    render(<AlignDistributeBar />);

    expect(
      screen.getByRole('button', { name: 'Align to selection bounds (active)' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Align to parent frame' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Align to page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Set key object from selection' })).toBeEnabled();
  });

  it('exposes fixed and negative gap distribution settings', () => {
    const editor = editorForSelection(['a', 'b', 'c']);
    mocks.useEditor.mockReturnValue(editor);
    render(<AlignDistributeBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Distribution options' }));
    fireEvent.click(screen.getByLabelText('Fixed gap'));
    fireEvent.change(screen.getByLabelText('Gap (px)'), { target: { value: '-12' } });
    fireEvent.blur(screen.getByLabelText('Gap (px)'));
    fireEvent.click(screen.getByRole('button', { name: 'Distribute horizontal spacing' }));

    expect(editor.distributeWithGap).toHaveBeenCalledWith('horizontal', -12);
  });

  it('offers explicit gap entry for two selected objects while disabling distribution modes', () => {
    const editor = editorForSelection(['a', 'b']);
    mocks.useEditor.mockReturnValue(editor);
    render(<AlignDistributeBar />);

    expect(screen.getByRole('button', { name: 'Distribution options' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Distribute horizontal spacing' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Distribution options' }));
    fireEvent.click(screen.getByLabelText('Fixed gap'));
    fireEvent.change(screen.getByLabelText('Gap (px)'), { target: { value: '24' } });
    fireEvent.blur(screen.getByLabelText('Gap (px)'));
    fireEvent.click(screen.getByRole('button', { name: 'Distribute horizontal spacing' }));

    expect(editor.distributeWithGap).toHaveBeenCalledWith('horizontal', 24);
  });

  it('offers explicit row and column spacing for one-time Tidy Up', async () => {
    const editor = editorForSelection(['a', 'b', 'c']);
    mocks.useEditor.mockReturnValue(editor);
    render(<AlignDistributeBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Tidy up grid' }));
    expect(await screen.findByRole('dialog', { name: 'Tidy up options' })).toBeVisible();
    expect(screen.getByText('Columns')).toBeVisible();
    expect(screen.getByText('Column gap')).toBeVisible();
    expect(screen.getByText('Row gap')).toBeVisible();
    const columns = screen.getByLabelText('Columns');
    fireEvent.change(columns, { target: { value: '3' } });
    fireEvent.keyDown(columns, { key: 'Enter' });
    const columnGap = screen.getByLabelText('Column gap (px)');
    fireEvent.change(columnGap, { target: { value: '16' } });
    fireEvent.keyDown(columnGap, { key: 'Enter' });
    const rowGap = screen.getByLabelText('Row gap (px)');
    fireEvent.change(rowGap, { target: { value: '24' } });
    fireEvent.keyDown(rowGap, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Tidy Up' }));

    expect(editor.tidySelected).toHaveBeenCalledWith(3, { rowGap: 24, columnGap: 16 });
  });

  it('does not show manual alignment for a wholly ineligible selection', () => {
    mocks.useEditor.mockReturnValue(editorForSelection(['a'], false, true));
    render(<AlignDistributeBar />);

    expect(screen.queryByRole('heading', { name: 'Align & distribute' })).toBeNull();
  });
});
