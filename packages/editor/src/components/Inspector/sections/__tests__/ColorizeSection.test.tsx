// @ts-nocheck
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    setSelection: vi.fn(),
    groupCompoundOperation: vi.fn((_label, action) => action()),
  }),
}));

vi.mock('@varve/engine', () => ({
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
  getModelLoaderReady: vi.fn(async () => ({
    isModelAvailable: vi.fn().mockResolvedValue(false),
    subscribe: vi.fn(() => vi.fn()),
  })),
}));

vi.mock('@varve/scene', () => ({
  imageShapeSrc: vi.fn(() => 'data:image/png;base64,mock'),
  isImageShape: vi.fn(() => true),
}));

vi.mock('@varve/ui', () => ({
  Button: ({ children, onClick, disabled, variant }) => (
    <button type="button" onClick={onClick} disabled={disabled} data-variant={variant}>
      {children}
    </button>
  ),
  // Mirrors the real Select: labelled via aria-label, native <option> children,
  // and onChange handed the option value rather than the event.
  Select: ({ label, value, options, onChange, disabled }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
    >
      {(options ?? []).map((o: { value: string; label: string }) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  Switch: ({ label, checked, disabled, onChange, className }) => (
    <label className={className}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      {label}
    </label>
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
      'Photo Colorization (AI)',
      'Tint / Selective Recolor',
      'Palette Colorize',
      'Reference Transfer',
      'Harmonize',
    ]);
  });

  it('renders recolor controls by default', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText('Target absolute hue in degrees')).toBeTruthy();
    expect(screen.getByLabelText('Saturation scale')).toBeTruthy();
  });

  it('renders quality mode buttons', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    fireEvent.change(screen.getByLabelText('Colorization workflow'), {
      target: { value: 'photo' },
    });
    expect(screen.getByRole('radio', { name: 'Fast' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Balanced' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Quality' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Automatic' })).toBeTruthy();
  });

  it('renders chroma slider for recolor workflow', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText(/chroma strength/i)).toBeTruthy();
  });

  it('renders skin protection switch for recolor workflow', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByRole('switch', { name: /Protect skin-like pixels/ })).toBeTruthy();
  });

  it('renders neutral protection switch for recolor workflow', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByRole('switch', { name: 'Protect near-neutral pixels' })).toBeTruthy();
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
    expect(screen.getByRole('button', { name: 'Choose reference image' })).toBeTruthy();
  });

  it('renders luminance preservation slider', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText(/source lightness preservation/i)).toBeTruthy();
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

  it('shows DDColor model hint when no models available', async () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    fireEvent.change(screen.getByLabelText('Colorization workflow'), {
      target: { value: 'photo' },
    });
    await waitFor(() =>
      expect(screen.getByText(/No verified DDColor model installed/i)).toBeTruthy(),
    );
  });

  it('returns null when no node provided', () => {
    const { container } = render(<ColorizeSection nodes={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
