// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useEditor: vi.fn(),
}));

vi.mock('../../../context', () => ({
  useEditor: mocks.useEditor,
}));

vi.mock('../controls/FramePresetDropdown', () => ({
  FramePresetDropdown: () => <div data-testid="mock-frame-preset-dropdown" />,
}));

import { PositionSizeSection } from './PositionSizeSection';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function createMockEditor(doc: any) {
  return {
    state: {
      document: doc,
      sectionVisibility: { 'position-size': { collapsed: false } },
    },
    toggleSectionCollapse: vi.fn(),
    toggleSubSectionCollapse: vi.fn(),
    hideInspectorSection: vi.fn(),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    setSelectedW: vi.fn(),
    setSelectedH: vi.fn(),
    setSelectedX: vi.fn(),
    setSelectedY: vi.fn(),
    setSelectedRotation: vi.fn(),
    setSelectedFlipH: vi.fn(),
    setSelectedFlipV: vi.fn(),
    setBindingField: vi.fn(),
    bindingField: null,
  };
}

describe('PositionSizeSection', () => {
  it('renders orientation swap button and preset dropdown for a single frame', () => {
    const doc = createDocument('test doc');
    const editor = createMockEditor(doc);
    mocks.useEditor.mockReturnValue(editor);

    const frame = makeFrameNode('frame-1', {
      transform: [1, 0, 0, 1, 10, 20],
      w: 393,
      h: 852,
    });

    render(<PositionSizeSection nodes={[frame]} />);

    expect(screen.getByTestId('mock-frame-preset-dropdown')).toBeTruthy();

    const swapBtn = screen.getByRole('button', { name: /swap orientation/i });
    expect(swapBtn).toBeTruthy();

    fireEvent.click(swapBtn);

    expect(editor.beginTransaction).toHaveBeenCalled();
    expect(editor.setSelectedW).toHaveBeenCalledWith(852);
    expect(editor.setSelectedH).toHaveBeenCalledWith(393);
    expect(editor.commitTransaction).toHaveBeenCalled();
  });

  it('does not render orientation swap button or preset dropdown for a rect shape', () => {
    const doc = createDocument('test doc');
    const editor = createMockEditor(doc);
    mocks.useEditor.mockReturnValue(editor);

    const rect = makeShapeNode('rect-1', { kind: 'rect', x: 0, y: 0, w: 100, h: 200 });

    render(<PositionSizeSection nodes={[rect]} />);

    expect(screen.queryByTestId('mock-frame-preset-dropdown')).toBeNull();
    expect(screen.queryByRole('button', { name: /swap orientation/i })).toBeNull();
  });
});
