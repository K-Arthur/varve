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

  it('shows layout-computed axes read-only with their sizing mode (calculated state)', () => {
    const doc = createDocument('test doc');
    // makeShapeNode's opts do not carry layout sizing — attach it after
    // construction, exactly as the layout engine does.
    const child = {
      ...makeShapeNode('child-1', { kind: 'rect', x: 0, y: 0, w: 428, h: 120 }),
      layoutSizingWidth: 'fill',
    } as import('@varve/scene').ShapeNode;
    const frame = makeFrameNode('frame-1', {
      w: 800,
      h: 600,
      children: ['child-1'],
      layoutStyle: {
        mode: 'flex',
        direction: 'row',
        gap: 0,
        wrap: false,
        padding: [0, 0, 0, 0],
        grow: 0,
        shrink: 1,
      },
    });
    doc.nodes['child-1'] = child;
    doc.nodes['frame-1'] = frame;
    const editor = createMockEditor(doc);
    mocks.useEditor.mockReturnValue(editor);

    render(<PositionSizeSection nodes={[child]} />);

    // Width is Fill: the actual size is still shown, but the field is
    // read-only and describes itself (the "Sizing mode: Fill / Actual size"
    // pattern — never hide the computed size).
    const w = screen.getByRole('spinbutton', { name: 'W (px)' }) as HTMLInputElement;
    expect(w.value).toBe('428');
    expect(w.readOnly).toBe(true);
    expect(screen.getByText('Calculated value: Fill container')).toBeTruthy();

    // Height is Fixed: directly editable, no calculated state.
    const h = screen.getByRole('spinbutton', { name: 'H (px)' }) as HTMLInputElement;
    expect(h.readOnly).toBe(false);
    expect(screen.queryByText(/Calculated value: Hug contents/)).toBeNull();
  });
});
