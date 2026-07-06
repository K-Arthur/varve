// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListInstalledModels, mockDeleteModel, mockGetModelLoaderReady } = vi.hoisted(() => ({
  mockListInstalledModels: vi.fn(),
  mockDeleteModel: vi.fn(),
  mockGetModelLoaderReady: vi.fn(),
}));

vi.mock('@strata/engine', () => ({
  AVAILABLE_MODELS: [
    {
      id: 'birefnet-general-lite',
      name: 'BiRefNet Lite',
      description: 'Balanced quality/speed AI model',
      size: 120_000_000,
      quality: 4,
      remoteUrl: 'https://github.com/example/birefnet-general-lite.onnx',
      checksum: '',
    },
    {
      id: 'birefnet-general',
      name: 'BiRefNet Full',
      description: 'Best quality AI model',
      size: 380_000_000,
      quality: 5,
      remoteUrl: 'https://github.com/example/birefnet-general.onnx',
      checksum: '',
    },
  ],
  getModelLoaderReady: mockGetModelLoaderReady,
  workerModelIdForMethod: (m: string) =>
    m === 'ai-balanced'
      ? 'birefnet-general-lite'
      : m === 'ai-quality'
        ? 'birefnet-general'
        : null,
}));

vi.mock('../BackgroundRemoval/ModelDownloadDialog', () => ({
  ModelDownloadDialog: ({
    modelId,
    onComplete,
  }: {
    modelId: string;
    onComplete: () => void;
  }) => (
    <div data-testid="download-dialog">
      <span>Downloading {modelId}</span>
      <button type="button" onClick={onComplete}>
        Simulate complete
      </button>
    </div>
  ),
}));

import { BgRemovalModelsTab } from './BgRemovalModelsTab';

function mockLoader(
  rows: Array<{
    id: string;
    name: string;
    size: number;
    installed: boolean;
    source: 'bundled' | 'downloaded' | 'none';
  }>,
) {
  return {
    listInstalledModels: mockListInstalledModels.mockResolvedValue(rows),
    deleteModel: mockDeleteModel.mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('BgRemovalModelsTab — storage transparency + control', () => {
  beforeEach(() => {
    mockListInstalledModels.mockReset();
    mockDeleteModel.mockReset();
    mockGetModelLoaderReady.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists every known model with size and install status, even before any download', async () => {
    mockGetModelLoaderReady.mockResolvedValue(
      mockLoader([
        { id: 'birefnet-general-lite', name: 'BiRefNet Lite', size: 120_000_000, installed: false, source: 'none' },
        { id: 'birefnet-general', name: 'BiRefNet Full', size: 380_000_000, installed: false, source: 'none' },
      ]),
    );

    render(<BgRemovalModelsTab />);

    await waitFor(() => expect(screen.getByText('BiRefNet Lite')).toBeInTheDocument());
    expect(screen.getByText('BiRefNet Full')).toBeInTheDocument();
    expect(screen.getAllByText(/not installed/i)).toHaveLength(2);
    // Storage location must be disclosed, not hidden.
    expect(screen.getByText(/stored in/i)).toBeInTheDocument();
  });

  it('shows a Delete action only for user-downloaded models, never for bundled ones', async () => {
    mockGetModelLoaderReady.mockResolvedValue(
      mockLoader([
        { id: 'birefnet-general-lite', name: 'BiRefNet Lite', size: 120_000_000, installed: true, source: 'downloaded' },
        { id: 'birefnet-general', name: 'BiRefNet Full', size: 380_000_000, installed: true, source: 'bundled' },
      ]),
    );

    render(<BgRemovalModelsTab />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /delete birefnet lite model/i })).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: /delete birefnet full model/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/bundled with app/i)).toBeInTheDocument();
  });

  it('deletes the model and refreshes the list on click', async () => {
    mockGetModelLoaderReady.mockResolvedValue(
      mockLoader([
        { id: 'birefnet-general-lite', name: 'BiRefNet Lite', size: 120_000_000, installed: true, source: 'downloaded' },
      ]),
    );

    render(<BgRemovalModelsTab />);
    const deleteBtn = await screen.findByRole('button', { name: /delete birefnet lite model/i });
    fireEvent.click(deleteBtn);

    await waitFor(() => expect(mockDeleteModel).toHaveBeenCalledWith('birefnet-general-lite'));
    // Called once on mount, once after delete.
    await waitFor(() => expect(mockListInstalledModels).toHaveBeenCalledTimes(2));
  });

  it('opens the consent-gated download dialog for a not-installed model instead of downloading directly', async () => {
    mockGetModelLoaderReady.mockResolvedValue(
      mockLoader([
        { id: 'birefnet-general-lite', name: 'BiRefNet Lite', size: 120_000_000, installed: false, source: 'none' },
      ]),
    );

    render(<BgRemovalModelsTab />);
    const downloadBtn = await screen.findByRole('button', { name: /download birefnet lite model/i });
    fireEvent.click(downloadBtn);

    expect(screen.getByTestId('download-dialog')).toBeInTheDocument();
    expect(screen.getByText(/downloading birefnet-general-lite/i)).toBeInTheDocument();
  });
});
