// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { addNode, createDocument, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ useEditor: vi.fn() }));

vi.mock('../../../context', () => ({ useEditor: mocks.useEditor }));
vi.mock('../../AlignmentOverlay/AlignmentGuideOverlay', () => ({
  showAlignmentGuidesFromSelection: vi.fn(),
}));

import { AlignDistributeBar } from './AlignDistributeBar';

afterEach(() => vi.clearAllMocks());

function editorForSelection(selection: string[]) {
  let document = createDocument('align controls');
  for (const id of ['a', 'b', 'c']) {
    document = addNode(
      document,
      makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }, { name: id }),
    );
  }
  return {
    state: { document, selection },
    alignSelected: vi.fn(),
    obbAlignSelected: vi.fn(),
    distributeSelected: vi.fn(),
    tidySelected: vi.fn(),
    setKeyObject: vi.fn(),
    keyObjectId: null,
    alignToPage: false,
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

  it('disables all alignment operations for a single selection and renders one horizontal icon', () => {
    mocks.useEditor.mockReturnValue(editorForSelection(['a']));
    render(<AlignDistributeBar />);

    expect(screen.getByRole('button', { name: 'Align left edges' })).toBeDisabled();
    const distribute = screen.getByRole('button', { name: 'Distribute horizontal spacing' });
    expect(distribute).toBeDisabled();
    expect(distribute.querySelectorAll('svg')).toHaveLength(1);
  });
});
