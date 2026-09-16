// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDocument, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useEditor: vi.fn(),
}));

vi.mock('../../../context', () => ({
  useEditor: mocks.useEditor,
}));

import { CornerRadiusSection } from './CornerRadiusSection';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function createMockEditor(doc: any) {
  return {
    state: {
      document: doc,
      sectionVisibility: { 'corner-radius': { collapsed: false } },
    },
    setSelectedCornerRadius: vi.fn(),
    setSelectedCornerSmoothing: vi.fn(),
    toggleSectionCollapse: vi.fn(),
    hideInspectorSection: vi.fn(),
    setBindingField: vi.fn(),
    bindingField: null,
  };
}

describe('CornerRadiusSection', () => {
  it('renders uniform radius input and toggles independent corners', () => {
    const doc = createDocument('test doc');
    const editor = createMockEditor(doc);
    mocks.useEditor.mockReturnValue(editor);

    const rect = makeShapeNode('rect-1', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    });
    rect.cornerRadius = 8;

    render(<CornerRadiusSection nodes={[rect]} />);

    const radiusField = screen.getByRole('spinbutton', { name: 'Radius (px)' });
    expect(radiusField).toHaveValue('8');

    const toggleBtn = screen.getByRole('button', { name: 'Edit individual corners' });
    expect(toggleBtn).toBeInTheDocument();

    fireEvent.click(toggleBtn);

    expect(screen.getByRole('spinbutton', { name: 'Top left (px)' })).toHaveValue('8');
    expect(screen.getByRole('spinbutton', { name: 'Top right (px)' })).toHaveValue('8');
    expect(screen.getByRole('spinbutton', { name: 'Bottom left (px)' })).toHaveValue('8');
    expect(screen.getByRole('spinbutton', { name: 'Bottom right (px)' })).toHaveValue('8');
  });

  it('automatically surfaces independent corner inputs for asymmetric shapes', () => {
    const doc = createDocument('test doc');
    const editor = createMockEditor(doc);
    mocks.useEditor.mockReturnValue(editor);

    const rect = makeShapeNode('rect-1', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    });
    rect.cornerRadius = [4, 8, 12, 16];

    render(<CornerRadiusSection nodes={[rect]} />);

    expect(screen.getByRole('spinbutton', { name: 'Top left (px)' })).toHaveValue('4');
    expect(screen.getByRole('spinbutton', { name: 'Top right (px)' })).toHaveValue('8');
    expect(screen.getByRole('spinbutton', { name: 'Bottom right (px)' })).toHaveValue('12');
    expect(screen.getByRole('spinbutton', { name: 'Bottom left (px)' })).toHaveValue('16');
  });

  it('displays corner smoothing slider when rounding exists', () => {
    const doc = createDocument('test doc');
    const editor = createMockEditor(doc);
    mocks.useEditor.mockReturnValue(editor);

    const rect = makeShapeNode('rect-1', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    });
    rect.cornerRadius = 12;
    rect.cornerSmoothing = 60;

    render(<CornerRadiusSection nodes={[rect]} />);

    expect(screen.getByLabelText('Corner smoothing')).toBeInTheDocument();
  });
});
