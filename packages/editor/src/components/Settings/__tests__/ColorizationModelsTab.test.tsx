// @ts-nocheck
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockIsModelAvailable: vi.fn().mockResolvedValue(false),
  mockHasDownloadedBlob: vi.fn().mockResolvedValue(false),
  mockSubscribe: vi.fn(() => () => {}),
}));

vi.mock('@varve/engine', () => ({
  resolveAcquisition: (entry: { bundled: boolean; remoteUrl: string; checksum: string }) => {
    if (entry.bundled)
      return {
        kind: 'bundled',
        assetPath: `/models/${entry.id}.onnx`,
        sha256: entry.checksum || '',
      };
    if (entry.remoteUrl && entry.checksum)
      return {
        kind: 'remote',
        sources: [{ url: entry.remoteUrl, sha256: entry.checksum }],
        sha256: entry.checksum,
      };
    return {
      kind: 'unavailable',
      reasonCode: 'source-unavailable',
      detail: 'No download source available',
    };
  },
  getModelLoaderReady: vi.fn().mockResolvedValue({
    isModelAvailable: mocks.mockIsModelAvailable,
    hasDownloadedBlob: mocks.mockHasDownloadedBlob,
    subscribe: mocks.mockSubscribe,
    deleteModel: vi.fn(),
  }),
  listAllModels: vi.fn(() => [
    {
      id: 'ddcolor',
      name: 'DDColor',
      sizeBytes: 156_000_000,
      bundled: false,
      remoteUrl: 'https://huggingface.co/piddnad/ddcolor_modelscope/resolve/main/ddcolor.onnx',
      checksum: 'abc123',
      description: 'Photo-realistic grayscale colorization',
      precision: 'fp32',
    },
    {
      id: 'ddcolor-tiny',
      name: 'DDColor Tiny',
      sizeBytes: 50_000_000,
      bundled: false,
      remoteUrl: 'https://huggingface.co/piddnad/ddcolor_paper_tiny/resolve/main/ddcolor-tiny.onnx',
      checksum: 'def456',
      description: 'Fast preview colorization',
      precision: 'fp32',
    },
  ]),
}));

vi.mock('@varve/ui', () => ({
  Button: ({ children, onClick, disabled, variant }) => (
    <button type="button" onClick={onClick} disabled={disabled} data-variant={variant}>
      {children}
    </button>
  ),
  RegionLoader: ({ children, label, loading }) =>
    loading ? (
      <div role="status" aria-label={label}>
        Loading...
      </div>
    ) : (
      <div role="none">{children}</div>
    ),
}));

vi.mock('../../BackgroundRemoval/ModelDownloadDialog', () => ({
  ModelDownloadDialog: ({ modelId, onClose }) => (
    <div data-testid="model-download-dialog" data-model-id={modelId}>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

import { ColorizationModelsTab } from '../ColorizationModelsTab';

afterEach(cleanup);

describe('ColorizationModelsTab', () => {
  beforeEach(() => {
    mocks.mockIsModelAvailable.mockResolvedValue(false);
    mocks.mockHasDownloadedBlob.mockResolvedValue(false);
  });

  it('renders section title', async () => {
    render(<ColorizationModelsTab />);
    expect(await screen.findByText('Colorization Models')).toBeTruthy();
  });

  it('renders hint text about DDColor models', async () => {
    render(<ColorizationModelsTab />);
    expect(await screen.findByText(/DDColor models bring grayscale/i)).toBeTruthy();
  });

  it('renders model rows for ddcolor and ddcolor-tiny', async () => {
    render(<ColorizationModelsTab />);
    expect(await screen.findByText('DDColor')).toBeTruthy();
    expect(await screen.findByText('DDColor Tiny')).toBeTruthy();
  });

  it('shows download buttons for uninstalled models', async () => {
    render(<ColorizationModelsTab />);
    const dlButtons = await screen.findAllByText('Download');
    expect(dlButtons).toHaveLength(2);
  });

  it('shows Remove button for installed downloaded models', async () => {
    mocks.mockIsModelAvailable.mockResolvedValue(true);
    mocks.mockHasDownloadedBlob.mockResolvedValue(true);
    render(<ColorizationModelsTab />);
    const removeButtons = await screen.findAllByText('Remove');
    expect(removeButtons.length).toBeGreaterThan(0);
  });

  it('shows size info for each model', async () => {
    render(<ColorizationModelsTab />);
    expect(await screen.findByText(/156 MB/)).toBeTruthy();
    expect(await screen.findByText(/50 MB/)).toBeTruthy();
  });
});
