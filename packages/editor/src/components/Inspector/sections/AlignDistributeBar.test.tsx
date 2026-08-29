// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ useEditor: vi.fn() }));

vi.mock('../../../context', () => ({ useEditor: mocks.useEditor }));
vi.mock('../../AlignmentOverlay/AlignmentGuideOverlay', () => ({
  showAlignmentGuidesFromSelection: vi.fn(),
}));

import { AlignDistributeBar } from './AlignDistributeBar';

afterEach(() => vi.clearAllMocks());

function editorForSelection(
  selection: string[],
  alignToPage = false,
  lockedA = false,
  primaryId = selection[0] ?? null,
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
    state: { document, selection, primaryId },
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

    expect(screen.getByRole('button', { name: 'Align left edges' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Distribute horizontal spacing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Set key object from selection' })).toBeEnabled();
  });

  it('shows page alignment for a single selection while keeping relative commands disabled', () => {
    mocks.useEditor.mockReturnValue(editorForSelection(['a']));
    render(<AlignDistributeBar />);

    expect(screen.getByRole('heading', { name: 'Align & distribute' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Align left edges' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Align to page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Set key object from selection' })).toBeDisabled();
    const distribute = screen.getByRole('button', { name: 'Distribute horizontal spacing' });
    expect(distribute).toBeDisabled();
    expect(distribute.querySelectorAll('svg')).toHaveLength(1);
  });

  it('uses the explicit primary node when setting a key object', () => {
    const editor = editorForSelection(['a', 'b'], false, false, 'b');
    mocks.useEditor.mockReturnValue(editor);
    render(<AlignDistributeBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Set key object from selection' }));

    expect(editor.setKeyObject).toHaveBeenCalledWith('b');
  });

  it('enables an eligible single selection after the page target is chosen', () => {
    mocks.useEditor.mockReturnValue(editorForSelection(['a'], true));
    render(<AlignDistributeBar />);

    expect(screen.getByRole('button', { name: 'Align left edges' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Distribute horizontal spacing' })).toBeDisabled();
  });

  it('offers the nearest frame as an explicit alignment reference', () => {
    const editor = editorForSelection(['child']);
    const frame = makeFrameNode('frame', { w: 240, h: 160 });
    const child = makeShapeNode('child', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 });
    editor.state.document = addChild(addNode(editor.state.document, frame), frame.id, child);
    mocks.useEditor.mockReturnValue(editor);
    render(<AlignDistributeBar />);

    expect(screen.getByRole('button', { name: 'Align to parent frame' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Align left edges' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Align to parent frame' }));
    expect(screen.getByRole('button', { name: 'Align left edges' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Align left edges' }));
    expect(editor.alignSelected).toHaveBeenCalledWith('left', 'container');
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

  it('does not show manual alignment for a wholly ineligible selection', () => {
    mocks.useEditor.mockReturnValue(editorForSelection(['a'], false, true));
    render(<AlignDistributeBar />);

    expect(screen.queryByRole('heading', { name: 'Align & distribute' })).toBeNull();
  });
});
