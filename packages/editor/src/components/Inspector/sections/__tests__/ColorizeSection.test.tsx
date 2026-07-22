// @ts-nocheck
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../controls/FieldRow', () => ({
  FieldRow: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div data-testid="field-row" data-label={label}>
      {children}
    </div>
  ),
}));

vi.mock('../../controls/DisclosureSection', () => ({
  DisclosureSection: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="disclosure-section" data-title={title}>
      {children}
    </div>
  ),
}));

vi.mock('../../../../context', () => ({
  useEditor: () => ({
    state: { document: { nodes: {} }, sectionVisibility: {}, selection: [] },
    selectedNodes: () => [],
    announce: vi.fn(),
    updateDoc: vi.fn(),
  }),
}));

vi.mock('@strata/engine', () => ({
  colorizationPipeline: {
    resolveRuntime: vi.fn(),
    execute: vi.fn().mockRejectedValue(new Error('not mocked')),
  },
  analyzeImageData: vi.fn(() => ({
    meanLuminance: 0.5,
    saturationStd: 0.02,
    fractionNearNeutral: 0.9,
    fractionLowSaturation: 0.95,
    edgeDensity: 0.05,
    width: 100,
    height: 100,
  })),
  classifyTask: vi.fn(() => ({
    sourceKind: 'photo',
    recommendedWorkflow: 'photo-colorize',
    confidence: 0.9,
  })),
  listAllModels: vi.fn(() => []),
}));

vi.mock('@strata/scene', () => ({
  imageShapeSrc: vi.fn(() => 'data:image/png;base64,mock'),
  isImageShape: vi.fn(() => true),
}));

vi.mock('@strata/ui', () => ({
  Button: ({ children, onClick, disabled, variant }) => (
    <button type="button" onClick={onClick} disabled={disabled} data-variant={variant}>
      {children}
    </button>
  ),
}));

import { ColorizeSection } from '../ColorizeSection';

afterEach(cleanup);

const makeImageNode = (overrides = {}) => ({
  id: 'node-1',
  kind: 'shape',
  name: 'Test Image',
  shape: { kind: 'rect', w: 100, h: 100 },
  fills: [{ type: 'image', src: 'data:image/png;base64,dummy', fit: 'fill' }],
  ...overrides,
});

describe('ColorizeSection', () => {
  it('renders workflow selector', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText('Colorization workflow')).toBeTruthy();
  });

  it('renders all workflow options', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    const select = screen.getByLabelText('Colorization workflow');
    expect(select).toBeTruthy();
    const options = Array.from(select.querySelectorAll('option'));
    expect(options.map((o) => o.textContent)).toEqual([
      'Recolor (Hue Shift)',
      'Palette Colorize',
      'Reference Transfer',
      'Harmonize',
    ]);
  });

  it('renders recolor controls by default', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText('Target hue shift in degrees')).toBeTruthy();
    expect(screen.getByLabelText('Saturation scale')).toBeTruthy();
  });

  it('renders palette hint when palette workflow selected', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    const select = screen.getByLabelText('Colorization workflow');
    fireEvent.change(select, { target: { value: 'palette' } });
    expect(screen.getByText(/Select document swatches/i)).toBeTruthy();
  });

  it('renders transfer hint when transfer workflow selected', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    const select = screen.getByLabelText('Colorization workflow');
    fireEvent.change(select, { target: { value: 'transfer' } });
    expect(screen.getByText(/Pick a reference image/i)).toBeTruthy();
  });

  it('renders luminance preservation slider', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText(/luminance preservation strength/i)).toBeTruthy();
  });

  it('renders blend strength slider', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText(/blend strength/i)).toBeTruthy();
  });

  it('renders palette adherence slider when palette workflow selected', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    const select = screen.getByLabelText('Colorization workflow');
    fireEvent.change(select, { target: { value: 'palette' } });
    expect(screen.getByLabelText(/palette adherence/i)).toBeTruthy();
  });

  it('renders preview button by default', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByRole('button', { name: /preview/i })).toBeTruthy();
  });

  it('does not render cancel button when idle', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });

  it('shows returns null when no node provided', () => {
    const { container } = render(<ColorizeSection nodes={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
