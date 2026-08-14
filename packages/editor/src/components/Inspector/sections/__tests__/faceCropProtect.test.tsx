// @ts-nocheck
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../context', () => {
  const { createContext } = require('react');
  return {
    EditorCtx: createContext(null),
    useEditor: () => ({
      trimToSubject: vi.fn().mockResolvedValue(undefined),
      expandImageBounds: vi.fn(),
      resetImageBounds: vi.fn(),
      applyFaceAwareCrop: mockApplyFaceAwareCrop,
    }),
  };
});

const { mockApplyFaceAwareCrop } = vi.hoisted(() => ({
  mockApplyFaceAwareCrop: vi.fn(),
}));

const { mockIsModelAvailable, mockDownloadModel } = vi.hoisted(() => ({
  mockIsModelAvailable: vi.fn(),
  mockDownloadModel: vi.fn(),
}));

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
    mockIsModelAvailable.mockReset().mockResolvedValue(true);
    mockDownloadModel.mockReset().mockResolvedValue(undefined);
  });

  it('renders the Protect Faces entry for a single image node', () => {
    render(<ImageCropSection nodes={[makeImageNode()]} />);
    expect(
      screen.getByRole('button', {
        name: /detect faces and reposition the crop to keep them in frame/i,
      }),
    ).toBeTruthy();
  });

  it('calls applyFaceAwareCrop when the model is already available', async () => {
    mockIsModelAvailable.mockResolvedValue(true);
    mockApplyFaceAwareCrop.mockResolvedValue(true);
    render(<ImageCropSection nodes={[makeImageNode()]} />);
    fireEvent.click(
      screen.getByRole('button', {
        name: /detect faces and reposition the crop to keep them in frame/i,
      }),
    );
    await waitFor(() => {
      expect(mockApplyFaceAwareCrop).toHaveBeenCalledWith({ safetyMargin: 0.35 });
    });
    expect(mockDownloadModel).not.toHaveBeenCalled();
  });

  it('downloads the model on first use before detecting', async () => {
    mockIsModelAvailable.mockResolvedValue(false);
    mockApplyFaceAwareCrop.mockResolvedValue(true);
    render(<ImageCropSection nodes={[makeImageNode()]} />);
    fireEvent.click(
      screen.getByRole('button', {
        name: /detect faces and reposition the crop to keep them in frame/i,
      }),
    );
    await waitFor(() => {
      expect(mockDownloadModel).toHaveBeenCalledWith('yunet-face-detect', expect.any(Function));
    });
    await waitFor(() => {
      expect(mockApplyFaceAwareCrop).toHaveBeenCalled();
    });
  });

  it('surfaces a "no faces" message when detection finds nothing', async () => {
    mockApplyFaceAwareCrop.mockResolvedValue(false);
    render(<ImageCropSection nodes={[makeImageNode()]} />);
    fireEvent.click(
      screen.getByRole('button', {
        name: /detect faces and reposition the crop to keep them in frame/i,
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('No faces detected');
    });
  });

  it('surfaces detection errors', async () => {
    mockApplyFaceAwareCrop.mockRejectedValue(new Error('worker crashed'));
    render(<ImageCropSection nodes={[makeImageNode()]} />);
    fireEvent.click(
      screen.getByRole('button', {
        name: /detect faces and reposition the crop to keep them in frame/i,
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('worker crashed');
    });
  });
});

// Local import after mocks so the mocked modules are in effect.
import { ImageCropSection } from '../ImageCropSection';
