// @ts-nocheck
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../context', () => {
  const { createContext } = require('react');
  return {
    EditorCtx: createContext(null),
    useEditor: () => ({
      state: { document: {} },
      trimToSubject: vi.fn().mockResolvedValue(undefined),
      expandImageBounds: vi.fn(),
      resetImageBounds: vi.fn(),
      applyFaceAwareCrop: mockApplyFaceAwareCrop,
      openCafDialog: mockOpenCafDialog,
    }),
  };
});

const { mockApplyFaceAwareCrop, mockOpenCafDialog } = vi.hoisted(() => ({
  mockApplyFaceAwareCrop: vi.fn(),
  mockOpenCafDialog: vi.fn(),
}));

const { mockIsModelAvailable, mockDownloadModel } = vi.hoisted(() => ({
  mockIsModelAvailable: vi.fn(),
  mockDownloadModel: vi.fn(),
}));

const { mockAnalyzeFaceAwareCrop } = vi.hoisted(() => ({
  mockAnalyzeFaceAwareCrop: vi.fn(),
}));

vi.mock('../../../../imageCrop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../imageCrop')>();
  return { ...actual, analyzeFaceAwareCrop: mockAnalyzeFaceAwareCrop };
});

function analysis(faces: Array<{ id: string; confidence: number }>) {
  return {
    faces: faces.map((face, index) => ({
      ...face,
      box: { x: index * 10, y: 0, width: 100, height: 120 },
    })),
    suggestion: {
      crop: { x: 0, y: 0, width: 300, height: 300 },
      detectedFaces: faces.length,
      coveredFaceIds: faces.map((face) => face.id),
      usedFallback: false,
    },
    sourceWidth: 640,
    sourceHeight: 480,
  };
}

vi.mock('@varve/engine', () => ({
  getModelLoader: () => ({
    isModelAvailable: mockIsModelAvailable,
    downloadModel: mockDownloadModel,
  }),
}));

vi.mock('@varve/scene', () => ({
  isImageShape: () => true,
  getImageFill: () => ({
    image: { src: 'data:image/png;base64,mock', fit: 'fill', x: 0, y: 0, scale: 1 },
  }),
}));

vi.mock('@varve/ui', () => ({
  Button: ({ children, onClick, disabled, 'aria-label': ariaLabel, loading }) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {loading ? 'Loading...' : children}
    </button>
  ),
  Icon: () => null,
  Switch: ({ checked, onChange, disabled, 'aria-label': ariaLabel }) => (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      aria-checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  ),
  Tooltip: ({ children, label }) => <span title={label}>{children}</span>,
}));

vi.mock('../../controls/DisclosureSection', () => ({
  DisclosureSection: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="disclosure-section" data-title={title}>
      {children}
    </div>
  ),
}));

vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
  autoUpdate: vi.fn(() => vi.fn()),
  hide: vi.fn(),
}));

afterEach(cleanup);

function makeImageNode() {
  return {
    id: 'n1',
    name: 'Image 1',
    kind: 'shape',
    shape: { kind: 'rect', x: 0, y: 0, w: 640, h: 480 },
    transform: [1, 0, 0, 1, 0, 0],
    fills: [
      {
        type: 'image',
        image: {
          src: 'data:image/png;base64,abc',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          imageWidth: 640,
          imageHeight: 480,
        },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    strokes: [],
    effects: [],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    index: 0,
    order: 'a0',
  } as import('@varve/scene').ShapeNode;
}

describe('ImageCropSection - Protect Faces', () => {
  beforeEach(() => {
    mockApplyFaceAwareCrop.mockReset();
    mockOpenCafDialog.mockReset();
    mockAnalyzeFaceAwareCrop.mockReset();
    mockIsModelAvailable.mockReset().mockResolvedValue(true);
    mockDownloadModel.mockReset().mockResolvedValue(undefined);
  });

  const detectButton = () =>
    screen.getByRole('button', {
      name: /detect faces and reposition the crop to keep them in frame/i,
    });

  it('opens the shared Generative Edit session from Crop & Bounds', () => {
    render(<ImageCropSection nodes={[makeImageNode()]} />);
    fireEvent.click(screen.getByRole('button', { name: /generative expand/i }));
    expect(mockOpenCafDialog).toHaveBeenCalledWith('n1');
  });

  it('renders the Protect Faces entry for a single image node', () => {
    render(<ImageCropSection nodes={[makeImageNode()]} />);
    expect(detectButton()).toBeTruthy();
  });

  it('analyzes without touching the document, then applies the reviewed faces', async () => {
    mockIsModelAvailable.mockResolvedValue(true);
    mockAnalyzeFaceAwareCrop.mockResolvedValue(
      analysis([
        { id: 'onnx-yunet-face:0', confidence: 0.91 },
        { id: 'onnx-yunet-face:1', confidence: 0.66 },
      ]),
    );
    mockApplyFaceAwareCrop.mockResolvedValue(true);
    render(<ImageCropSection nodes={[makeImageNode()]} />);

    fireEvent.click(detectButton());

    // Analysis alone must not commit anything.
    await waitFor(() => {
      expect(screen.getByText(/2 faces detected/i)).toBeTruthy();
    });
    expect(mockApplyFaceAwareCrop).not.toHaveBeenCalled();

    // Reject the second face, then apply.
    fireEvent.click(screen.getByRole('checkbox', { name: /protect face 2/i }));
    fireEvent.click(screen.getByRole('button', { name: /apply crop/i }));

    await waitFor(() => {
      expect(mockApplyFaceAwareCrop).toHaveBeenCalledWith({
        safetyMargin: 0.35,
        excludedFaceIds: ['onnx-yunet-face:1'],
      });
    });
    expect(mockDownloadModel).not.toHaveBeenCalled();
  });

  it('lets the reviewed protection margin be changed with real percentage units', async () => {
    mockAnalyzeFaceAwareCrop.mockResolvedValue(analysis([{ id: 'f0', confidence: 0.9 }]));
    mockApplyFaceAwareCrop.mockResolvedValue(true);
    render(<ImageCropSection nodes={[makeImageNode()]} />);
    fireEvent.click(detectButton());
    await waitFor(() => expect(screen.getByRole('button', { name: /apply crop/i })).toBeTruthy());

    const margin = screen.getByLabelText(/protection margin as a percentage of face size/i);
    fireEvent.change(margin, { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /apply crop/i }));

    await waitFor(() => {
      expect(mockApplyFaceAwareCrop).toHaveBeenCalledWith({
        safetyMargin: 0.5,
        excludedFaceIds: [],
      });
    });
  });

  it('discards a reviewed analysis without committing', async () => {
    mockAnalyzeFaceAwareCrop.mockResolvedValue(analysis([{ id: 'f0', confidence: 0.9 }]));
    render(<ImageCropSection nodes={[makeImageNode()]} />);
    fireEvent.click(detectButton());
    await waitFor(() => expect(screen.getByRole('button', { name: /discard/i })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(screen.queryByRole('button', { name: /apply crop/i })).toBeNull();
    expect(mockApplyFaceAwareCrop).not.toHaveBeenCalled();
  });

  it('downloads the model on first use before detecting', async () => {
    mockIsModelAvailable.mockResolvedValue(false);
    mockAnalyzeFaceAwareCrop.mockResolvedValue(analysis([{ id: 'f0', confidence: 0.9 }]));
    mockApplyFaceAwareCrop.mockResolvedValue(true);
    render(<ImageCropSection nodes={[makeImageNode()]} />);
    fireEvent.click(detectButton());
    await waitFor(() => {
      expect(mockDownloadModel).toHaveBeenCalledWith('yunet-face-detect', expect.any(Function));
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /apply crop/i })).toBeTruthy();
    });
  });

  it('surfaces a "no faces" message when detection finds nothing', async () => {
    mockAnalyzeFaceAwareCrop.mockResolvedValue(null);
    render(<ImageCropSection nodes={[makeImageNode()]} />);
    fireEvent.click(detectButton());
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('No faces detected');
    });
    expect(mockApplyFaceAwareCrop).not.toHaveBeenCalled();
  });

  it('surfaces detection errors', async () => {
    mockApplyFaceAwareCrop.mockRejectedValue(new Error('worker crashed'));
    mockAnalyzeFaceAwareCrop.mockRejectedValue(new Error('worker crashed'));
    render(<ImageCropSection nodes={[makeImageNode()]} />);
    fireEvent.click(detectButton());
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('worker crashed');
    });
  });
});

// Local import after mocks so the mocked modules are in effect.
import { ImageCropSection } from '../ImageCropSection';
