// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDownloadModel, mockGetModelLoader } = vi.hoisted(() => ({
  mockDownloadModel: vi.fn(),
  mockGetModelLoader: vi.fn(),
}));

vi.mock('@varve/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/engine')>();
  return {
    ...actual,
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
  };
});

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
      new Error(
        'Storage quota exceeded. Free disk space or delete old models in Settings, Offline Models.',
      ),
    );
    render(
      <ModelDownloadDialog
        modelId="birefnet-general-lite"
        onClose={() => {}}
        onComplete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^download$/i }));
    expect(await screen.findByText(/not enough free storage/i)).toBeInTheDocument();
  });

  it('never renders a blank error panel for a string rejection (Tauri Err(String))', async () => {
    mockDownloadModel.mockRejectedValue('permission denied');
    render(
      <ModelDownloadDialog
        modelId="birefnet-general-lite"
        onClose={() => {}}
        onComplete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^download$/i }));
    const title = await screen.findByText(/The app could not write the model file/i);
    expect(title.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(screen.queryByText(/Download failed:\s*$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Download failed: undefined/i)).not.toBeInTheDocument();
  });

  it('never renders a blank error panel for an object rejection', async () => {
    mockDownloadModel.mockRejectedValue({ code: 'command_error', message: 'connection refused' });
    render(
      <ModelDownloadDialog
        modelId="birefnet-general-lite"
        onClose={() => {}}
        onComplete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^download$/i }));
    const title = await screen.findByText(/couldn't download the model/i);
    expect(title.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it('shows a Retry button only when the failure is retryable', async () => {
    mockDownloadModel.mockRejectedValue('Model download failed: connection refused');
    render(
      <ModelDownloadDialog
        modelId="birefnet-general-lite"
        onClose={() => {}}
        onComplete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^download$/i }));
    await screen.findByText(/couldn't download the model/i);
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument();
  });

  it('omits Retry for permanent integrity failures', async () => {
    mockDownloadModel.mockRejectedValue(new Error('Model failed SHA-256 verification'));
    render(
      <ModelDownloadDialog
        modelId="birefnet-general-lite"
        onClose={() => {}}
        onComplete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^download$/i }));
    await screen.findByText(/integrity verification/i);
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument();
  });
});
