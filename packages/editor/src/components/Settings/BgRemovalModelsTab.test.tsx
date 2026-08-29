// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ModelManifestEntry } from '@varve/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListAllModels,
  mockDeleteModel,
  mockDownloadModel,
  mockGetModelLoaderReady,
  mockVerifyBundled,
} = vi.hoisted(() => ({
  mockListAllModels: vi.fn(),
  mockDeleteModel: vi.fn(),
  mockDownloadModel: vi.fn(),
  mockGetModelLoaderReady: vi.fn(),
  mockVerifyBundled: vi.fn().mockResolvedValue('verified'),
}));

vi.mock('@varve/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/engine')>();
  return {
    ...actual,
    deriveAcquisition: (entry: {
      id?: string;
      bundled: boolean;
      remoteUrl: string;
      checksum: string;
    }) => {
      if (entry.bundled)
        return {
          kind: 'bundled',
          assetPath: `/models/${(entry as { id: string }).id}.onnx`,
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
    getModelLoaderReady: mockGetModelLoaderReady,
    listAllModels: mockListAllModels,
    workerModelIdForMethod: (m: string) =>
      m === 'ai-balanced' ? 'u2netp' : m === 'ai-quality' ? 'birefnet-general-lite' : null,
  };
});

vi.mock('../BackgroundRemoval/ModelDownloadDialog', () => ({
  ModelDownloadDialog: ({ modelId, onComplete }: { modelId: string; onComplete: () => void }) => (
    <div data-testid="download-dialog">
      <span>Downloading {modelId}</span>
      <button type="button" onClick={onComplete}>
        Simulate complete
      </button>
    </div>
  ),
}));

import { BgRemovalModelsTab } from './BgRemovalModelsTab';

function entry(overrides: Partial<ModelManifestEntry> & { id: string }): ModelManifestEntry {
  return {
    name: overrides.id,
    description: '',
    sizeBytes: 0,
    remoteUrl: '',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 3,
    category: 'segmentation',
    ...overrides,
  };
}

function mockLoader(installedIds: Set<string>) {
  return {
    isModelAvailable: vi.fn((id: string) => Promise.resolve(installedIds.has(id))),
    hasDownloadedBlob: vi.fn((id: string) => Promise.resolve(installedIds.has(id))),
    deleteModel: mockDeleteModel.mockResolvedValue(undefined),
    downloadModel: mockDownloadModel.mockImplementation(
      async (_id: string, onProgress?: (loaded: number, total: number) => void) => {
        onProgress?.(100, 100);
      },
    ),
    verifyBundledModel: mockVerifyBundled,
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('BgRemovalModelsTab — storage transparency + control', () => {
  beforeEach(() => {
    mockListAllModels.mockReset();
    mockDeleteModel.mockReset();
    mockDownloadModel.mockReset();
    mockGetModelLoaderReady.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists every known model with size and install status, even before any download', async () => {
    mockListAllModels.mockReturnValue([
      entry({ id: 'u2netp', name: 'U²-Net Light', sizeBytes: 4_574_861, bundled: true }),
      entry({
        id: 'birefnet-general-lite',
        name: 'BiRefNet Lite',
        sizeBytes: 120_000_000,
        remoteUrl: 'https://example.com/lite.onnx',
        checksum: 'lite-checksum',
      }),
      entry({
        id: 'birefnet-general',
        name: 'BiRefNet Full',
        sizeBytes: 380_000_000,
        remoteUrl: 'https://example.com/full.onnx',
        checksum: 'full-checksum',
      }),
    ]);
    mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set(['u2netp'])));

    render(<BgRemovalModelsTab />);

    await waitFor(() => expect(screen.getByText('BiRefNet Lite')).toBeInTheDocument());
    expect(screen.getByText('BiRefNet Full')).toBeInTheDocument();
    expect(screen.getAllByText(/not installed/i)).toHaveLength(2);
    // Storage location must be disclosed, not hidden.
    expect(screen.getByText(/stored in/i)).toBeInTheDocument();
  });

  it('shows a Remove action only for user-downloaded models, never for bundled ones', async () => {
    mockListAllModels.mockReturnValue([
      entry({
        id: 'birefnet-general-lite',
        name: 'BiRefNet Lite',
        sizeBytes: 120_000_000,
        remoteUrl: 'https://example.com/lite.onnx',
        checksum: 'lite-checksum',
      }),
      entry({ id: 'u2netp', name: 'U²-Net Light', sizeBytes: 4_700_000, bundled: true }),
    ]);
    mockGetModelLoaderReady.mockResolvedValue(
      mockLoader(new Set(['birefnet-general-lite', 'u2netp'])),
    );

    render(<BgRemovalModelsTab />);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /remove birefnet lite model/i }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: /remove u²-net light model/i }),
    ).not.toBeInTheDocument();
  });

  it('deletes the model and refreshes the list on click', async () => {
    mockListAllModels.mockReturnValue([
      entry({
        id: 'birefnet-general-lite',
        name: 'BiRefNet Lite',
        sizeBytes: 120_000_000,
        remoteUrl: 'https://example.com/lite.onnx',
        checksum: 'lite-checksum',
      }),
    ]);
    mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set(['birefnet-general-lite'])));

    render(<BgRemovalModelsTab />);
    const deleteBtn = await screen.findByRole('button', { name: /remove birefnet lite model/i });
    fireEvent.click(deleteBtn);

    await waitFor(() => expect(mockDeleteModel).toHaveBeenCalledWith('birefnet-general-lite'));
  });

  it('opens the consent-gated download dialog for a not-installed single-file model', async () => {
    mockListAllModels.mockReturnValue([
      entry({
        id: 'birefnet-general-lite',
        name: 'BiRefNet Lite',
        sizeBytes: 120_000_000,
        remoteUrl: 'https://example.com/lite.onnx',
        checksum: 'lite-checksum',
      }),
    ]);
    mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set()));

    render(<BgRemovalModelsTab />);
    const downloadBtn = await screen.findByRole('button', {
      name: /download birefnet lite model$/i,
    });
    fireEvent.click(downloadBtn);

    expect(screen.getByTestId('download-dialog')).toBeInTheDocument();
    expect(screen.getByText(/downloading birefnet-general-lite/i)).toBeInTheDocument();
  });

  it('surfaces corrupt bundled model warning on first open', async () => {
    mockVerifyBundled.mockResolvedValue('corrupt');
    mockListAllModels.mockReturnValue([
      entry({ id: 'u2netp', name: 'U²-Net Light', sizeBytes: 4_700_000, bundled: true }),
    ]);
    mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set(['u2netp'])));

    render(<BgRemovalModelsTab />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/failed integrity check/i),
    );
    expect(mockVerifyBundled).toHaveBeenCalledWith('u2netp');
  });

  describe('multi-component models (SAM2 encoder + decoder)', () => {
    function sam2Catalog(): ModelManifestEntry[] {
      return [
        entry({
          id: 'sam2-hiera-tiny',
          name: 'SAM2 Tiny',
          sizeBytes: 0,
          multiComponent: true,
          components: [
            {
              id: 'sam2-hiera-tiny-encoder',
              role: 'encoder',
              filename: 'encoder.onnx',
              sizeBytes: 134_000_000,
              remoteUrl: 'https://example.com/encoder.onnx',
            },
            {
              id: 'sam2-hiera-tiny-decoder',
              role: 'decoder',
              filename: 'decoder.onnx',
              sizeBytes: 21_000_000,
              remoteUrl: 'https://example.com/decoder.onnx',
            },
          ],
        }),
        // These are real catalog entries in their own right (other tools
        // address them directly by id) but must not also render as rows.
        entry({
          id: 'sam2-hiera-tiny-encoder',
          name: 'Select Subject — Image Encoder',
          sizeBytes: 134_000_000,
          remoteUrl: 'https://example.com/encoder.onnx',
        }),
        entry({
          id: 'sam2-hiera-tiny-decoder',
          name: 'Select Subject — Prompt Decoder',
          sizeBytes: 21_000_000,
          remoteUrl: 'https://example.com/decoder.onnx',
        }),
      ];
    }

    it('shows exactly one row for the composite model, not one per component', async () => {
      mockListAllModels.mockReturnValue(sam2Catalog());
      mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set()));

      render(<BgRemovalModelsTab />);

      await waitFor(() => expect(screen.getByText('SAM2 Tiny')).toBeInTheDocument());
      expect(screen.queryByText('Select Subject — Image Encoder')).not.toBeInTheDocument();
      expect(screen.queryByText('Select Subject — Prompt Decoder')).not.toBeInTheDocument();
      // Combined size of both components (134MB + 21MB = 155MB).
      expect(screen.getByText(/~155 MB/)).toBeInTheDocument();
    });

    it('reports installed only when every component is installed', async () => {
      mockListAllModels.mockReturnValue(sam2Catalog());
      // Only the encoder is downloaded — decoder still missing.
      mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set(['sam2-hiera-tiny-encoder'])));

      render(<BgRemovalModelsTab />);

      await waitFor(() => expect(screen.getByText('SAM2 Tiny')).toBeInTheDocument());
      expect(screen.getByText(/not installed/i)).toBeInTheDocument();
    });

    it('downloads every component with one click and reports combined progress', async () => {
      mockListAllModels.mockReturnValue(sam2Catalog());
      mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set()));

      render(<BgRemovalModelsTab />);
      const downloadBtn = await screen.findByRole('button', { name: /download sam2 tiny model/i });
      fireEvent.click(downloadBtn);

      await waitFor(() => expect(mockDownloadModel).toHaveBeenCalledTimes(2));
      expect(mockDownloadModel).toHaveBeenCalledWith(
        'sam2-hiera-tiny-encoder',
        expect.any(Function),
        expect.any(AbortSignal),
      );
      expect(mockDownloadModel).toHaveBeenCalledWith(
        'sam2-hiera-tiny-decoder',
        expect.any(Function),
        expect.any(AbortSignal),
      );
      // No per-component dialog — the composite flow never opens one.
      expect(screen.queryByTestId('download-dialog')).not.toBeInTheDocument();
    });
  });
});
