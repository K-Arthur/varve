// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../context', () => {
  const mockFn = vi.fn();
  return { useEditor: mockFn };
});

import { useEditor } from '../../../../context';
import { BackgroundRemovalSection } from '../BackgroundRemovalSection';

afterEach(cleanup);

const mockedUseEditor = useEditor as unknown as ReturnType<typeof vi.fn>;

vi.mock('@strata/engine', () => ({
  getModelLoaderReady: vi.fn().mockResolvedValue({
    getState: () => 'unavailable',
    isModelAvailable: vi.fn().mockResolvedValue(false),
    subscribe: () => () => {},
  }),
  workerModelIdForMethod: (method: string) =>
    method === 'ai-quality'
      ? 'birefnet-general'
      : method === 'ai-balanced'
        ? 'birefnet-general-lite'
        : null,
}));

vi.mock('../../../BackgroundRemoval/ModelDownloadDialog', () => ({
  ModelDownloadDialog: () => null,
}));

vi.mock('../../controls/DisclosureSection', () => ({
  DisclosureSection: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="disclosure-section" data-title={title}>
      {children}
    </div>
  ),
}));

function makeImageNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    name: 'Image 1',
    kind: 'shape' as const,
    shape: { kind: 'rect', x: 0, y: 0, w: 200, h: 160 },
    transform: [1, 0, 0, 1, 0, 0] as const,
    fills: [
      {
        type: 'image',
        image: { src: 'data:image/png;base64,abc', fit: 'fill', x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
    strokes: [],
    effects: [],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    index: 0,
    order: 'a0',
    ...overrides,
  } as import('@strata/scene').ShapeNode;
}

function createMockEditorContext(overrides: Record<string, unknown> = {}) {
  const mockState = {
    tool: 'select' as const,
    zoom: 1,
    pan: { x: 0, y: 0 },
    selection: ['n1'],
    showOriginalBgNodeId: null,
    ...(overrides.state ?? {}),
  };
  return {
    state: mockState,
    removeBackground: vi.fn().mockResolvedValue(undefined),
    removeBackgroundWithOptions: vi.fn().mockResolvedValue(undefined),
    updateNode: vi.fn(),
    announce: vi.fn(),
    setShowOriginalBg: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mockedUseEditor.mockReturnValue(createMockEditorContext());
});

describe('BackgroundRemovalSection - Preview toggle', () => {
  it('renders preview toggle when background removal exists', () => {
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.95,
        appliedAt: Date.now(),
        feather: 0.5,
        decontaminate: true,
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    expect(screen.getByText('Show Original')).toBeTruthy();
  });

  it('calls setShowOriginalBg when preview toggle is clicked', () => {
    const setShowOriginalBg = vi.fn();
    mockedUseEditor.mockReturnValue(createMockEditorContext({ setShowOriginalBg }));
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.95,
        appliedAt: Date.now(),
        feather: 0.5,
        decontaminate: true,
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    fireEvent.click(screen.getByText('Show Original'));
    expect(setShowOriginalBg).toHaveBeenCalledWith('n1');
  });

  it('shows "Showing Original" when preview is active', () => {
    mockedUseEditor.mockReturnValue(
      createMockEditorContext({
        state: { showOriginalBgNodeId: 'n1' },
      }),
    );
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.95,
        appliedAt: Date.now(),
        feather: 0.5,
        decontaminate: true,
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    expect(screen.getByText('Showing Original')).toBeTruthy();
  });

  it('calls setShowOriginalBg with null when toggling off', () => {
    const setShowOriginalBg = vi.fn();
    mockedUseEditor.mockReturnValue(
      createMockEditorContext({
        setShowOriginalBg,
        state: { showOriginalBgNodeId: 'n1' },
      }),
    );
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.95,
        appliedAt: Date.now(),
        feather: 0.5,
        decontaminate: true,
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    fireEvent.click(screen.getByText('Showing Original'));
    expect(setShowOriginalBg).toHaveBeenCalledWith(null);
  });
});

describe('BackgroundRemovalSection - Feather slider', () => {
  it('renders feather number input with default 0.5', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const input = screen.getByLabelText('Feather') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('0.5');
  });

  it('renders feather number input using existing value', () => {
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.9,
        appliedAt: Date.now(),
        feather: 1.2,
        decontaminate: true,
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    const input = screen.getByLabelText('Feather') as HTMLInputElement;
    expect(input.value).toBe('1.2');
  });

  it('increases feather value on + button click', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const input = screen.getByLabelText('Feather') as HTMLInputElement;
    const incBtn = screen.getByLabelText('Increase feather');
    fireEvent.click(incBtn);
    expect(input.value).toBe('0.6');
  });

  it('decreases feather value on - button click', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const decBtn = screen.getByLabelText('Decrease feather');
    fireEvent.click(decBtn);
    const input = screen.getByLabelText('Feather') as HTMLInputElement;
    expect(input.value).toBe('0.4');
  });

  it('clamps feather to minimum 0', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const input = screen.getByLabelText('Feather') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-1' } });
    expect(input.value).toBe('0');
  });

  it('clamps feather to maximum 3', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const input = screen.getByLabelText('Feather') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    expect(input.value).toBe('3');
  });
});

describe('BackgroundRemovalSection - Decontaminate checkbox', () => {
  it('renders decontaminate checkbox checked by default', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const checkbox = screen.getByText('Decontaminate').previousElementSibling as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(true);
  });

  it('toggles decontaminate off', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const checkbox = screen.getByText('Decontaminate').previousElementSibling as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it('toggles decontaminate on after off', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const checkbox = screen.getByText('Decontaminate').previousElementSibling as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });
});

describe('ExportDialog - Remove background toggle', () => {
  it('renders remove background before export checkbox', async () => {
    const { ExportDialog } = await import('../../../Export/ExportDialog');
    render(<ExportDialog isOpen={true} onClose={() => {}} nodes={[]} onExport={async () => {}} />);
    expect(screen.getByText('Remove background before export')).toBeTruthy();
  });
});
