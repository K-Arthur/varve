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

  it('renders quality mode buttons', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByText('Fast')).toBeTruthy();
    expect(screen.getByText('Balanced')).toBeTruthy();
    expect(screen.getByText('Quality')).toBeTruthy();
    expect(screen.getByText('Automatic')).toBeTruthy();
  });

  it('renders correct number of quality mode options', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    const radios = document.querySelectorAll('input[type="radio"]');
    expect(radios).toHaveLength(4);
  });

  it('shows Colorize button for photo workflow', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByText('Colorize')).toBeTruthy();
  });

  it('shows Apply button for selective-recolor workflow', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    const select = screen.getByLabelText('Colorization workflow');
    fireEvent.change(select, { target: { value: 'selective-recolor' } });
    expect(screen.getByText('Apply')).toBeTruthy();
  });

  it('shows Transfer button for reference-transfer workflow', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    const select = screen.getByLabelText('Colorization workflow');
    fireEvent.change(select, { target: { value: 'reference-transfer' } });
    expect(screen.getByText('Transfer')).toBeTruthy();
  });

  it('renders luminance slider for photo workflow', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText(/luminance preservation/i)).toBeTruthy();
  });

  it('renders chroma slider for photo workflow', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText(/chroma strength/i)).toBeTruthy();
  });

  it('renders skin protection checkbox for photo workflow', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByText('Skin tone protection')).toBeTruthy();
  });

  it('renders neutral protection checkbox for photo workflow', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByText('Neutral region protection')).toBeTruthy();
  });

  it('renders adherence slider for palette workflow', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    const select = screen.getByLabelText('Colorization workflow');
    fireEvent.change(select, { target: { value: 'palette-colorize' } });
    expect(screen.getByLabelText(/palette adherence/i)).toBeTruthy();
  });

  it('shows returns null when no node provided', () => {
    const { container } = render(<ColorizeSection nodes={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows model hint when no DDColor models available', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByText(/DDColor model not yet available/i)).toBeTruthy();
  });
});
