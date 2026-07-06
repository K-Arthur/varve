// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDownloadModel, mockGetModelLoader } = vi.hoisted(() => ({
  mockDownloadModel: vi.fn(),
  mockGetModelLoader: vi.fn(),
}));

vi.mock('@strata/engine', () => ({
  AVAILABLE_MODELS: [
    {
      id: 'birefnet-general-lite',
      name: 'BiRefNet Lite',
      description: '120 MB — high quality, handles complex edges',
      size: 120_000_000,
      quality: 4.5,
      remoteUrl:
        'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1.0/birefnet-general-lite.onnx',
      checksum: '',
    },
  ],
  getModelLoader: mockGetModelLoader,
}));

import { ModelDownloadDialog } from './ModelDownloadDialog';

describe('ModelDownloadDialog — consent gate', () => {
  beforeEach(() => {
    mockDownloadModel.mockReset().mockResolvedValue(undefined);
    mockGetModelLoader.mockReset().mockReturnValue({ downloadModel: mockDownloadModel });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not start downloading on mount — requires explicit user confirmation', () => {
    render(
      <ModelDownloadDialog
        modelId="birefnet-general-lite"
        onClose={() => {}}
        onComplete={() => {}}
      />,
    );
    expect(mockDownloadModel).not.toHaveBeenCalled();
  });

  it('discloses model name, size, purpose, and network source before download starts', () => {
    render(
      <ModelDownloadDialog
        modelId="birefnet-general-lite"
        onClose={() => {}}
        onComplete={() => {}}
      />,
    );
    expect(screen.getByText(/BiRefNet Lite/)).toBeInTheDocument();
    expect(screen.getByText(/120 MB/)).toBeInTheDocument();
    // Must name the actual network source, not just say "the internet".
    expect(screen.getByText(/github\.com/i)).toBeInTheDocument();
    // Must state what the download is used for / where it's stored, so the
    // user isn't guessing about a surprise multi-hundred-MB transfer.
    expect(screen.getByText(/background removal/i)).toBeInTheDocument();
  });

  it('only calls downloadModel after the user clicks the explicit Download action', () => {
    render(
      <ModelDownloadDialog
        modelId="birefnet-general-lite"
        onClose={() => {}}
        onComplete={() => {}}
      />,
    );
    expect(mockDownloadModel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^download$/i }));
    expect(mockDownloadModel).toHaveBeenCalledTimes(1);
    expect(mockDownloadModel).toHaveBeenCalledWith(
      'birefnet-general-lite',
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('lets the user cancel without ever triggering a download', () => {
    const onClose = vi.fn();
    render(
      <ModelDownloadDialog
        modelId="birefnet-general-lite"
        onClose={onClose}
        onComplete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockDownloadModel).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows actionable copy when storage quota is exceeded', async () => {
    mockDownloadModel.mockRejectedValue(
      new Error('Storage quota exceeded. Free disk space or delete old models in Settings, Offline Models.'),
    );
    render(
      <ModelDownloadDialog
        modelId="birefnet-general-lite"
        onClose={() => {}}
        onComplete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^download$/i }));
    expect(await screen.findByText(/Offline Models/i)).toBeInTheDocument();
  });
});
