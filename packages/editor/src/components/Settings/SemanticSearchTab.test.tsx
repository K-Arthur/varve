/**
 * SemanticSearchTab tests — model states, downloads, removal, and the
 * derived-index controls. The engine DownloadManager and the platform
 * embedding store are mocked; only the tab's orchestration is exercised.
 */
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticSearchTab } from './SemanticSearchTab';

const {
  mockListAllModels,
  mockGetDownloadState,
  mockStartDownload,
  mockDeleteModel,
  mockSubscribeDownloadProgress,
  mockStoreClear,
  mockStoreListAll,
} = vi.hoisted(() => ({
  mockListAllModels: vi.fn(),
  mockGetDownloadState: vi.fn(),
  mockStartDownload: vi.fn(),
  mockDeleteModel: vi.fn(),
  mockSubscribeDownloadProgress: vi.fn(),
  mockStoreClear: vi.fn().mockResolvedValue(undefined),
  mockStoreListAll: vi.fn(),
}));

vi.mock('@varve/engine', () => ({
  ADJUSTMENT_KINDS: ['brightness'],
  // A class (not an arrow) so `new DownloadManager()` works — biome would
  // rewrite a `function` expression mock into a non-constructible arrow.
  DownloadManager: vi.fn().mockImplementation(
    class {
      registerModel = vi.fn();
      getDownloadState = mockGetDownloadState;
      startDownload = mockStartDownload;
      deleteModel = mockDeleteModel;
      subscribeDownloadProgress = mockSubscribeDownloadProgress;
    } as unknown as () => Record<string, unknown>,
  ),
  listAllModels: mockListAllModels,
}));

vi.mock('@varve/platform', () => ({
  IndexedDbSemanticEmbeddingStore: vi.fn().mockImplementation(
    class {
      clear = mockStoreClear;
      listAll = mockStoreListAll;
    } as unknown as () => Record<string, unknown>,
  ),
}));

const ENTRIES = [
  {
    id: 'siglip-base-patch16-224',
    name: 'Find Similar Images',
    description: 'image tower',
    sizeBytes: 210_977_441,
    remoteUrl: 'https://example.invalid/siglip.onnx',
    checksum: 'a'.repeat(64),
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'int8',
    category: 'embedding',
  },
  {
    id: 'siglip-base-patch16-224-text',
    name: 'Natural-Language Asset Search',
    description: 'text tower',
    sizeBytes: 111_475_220,
    remoteUrl: 'https://example.invalid/siglip-text.onnx',
    checksum: 'b'.repeat(64),
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'int8',
    category: 'embedding',
  },
  {
    id: 'siglip-tokenizer',
    name: 'SigLIP Text Tokenizer',
    description: 'tokenizer',
    sizeBytes: 2_399_357,
    remoteUrl: 'https://example.invalid/tokenizer.json',
    checksum: 'c'.repeat(64),
    bundled: false,
    inputSpec: null,
    quality: 4,
    category: 'embedding',
  },
] as const;

async function renderTab() {
  mockListAllModels.mockReturnValue(ENTRIES);
  return render(<SemanticSearchTab />);
}

beforeEach(() => {
  // clearAllMocks keeps the constructor implementations and hoisted resolved
  // values; per-test mocks are set before renderTab.
  vi.clearAllMocks();
});

afterEach(() => {
  // Static import — no need for vi.resetModules()
});

describe('SemanticSearchTab', () => {
  it('lists the three semantic artifacts with sizes and states', async () => {
    mockGetDownloadState.mockResolvedValue('not-downloaded');
    await renderTab();
    await waitFor(() => {
      expect(screen.getByText('Visual search model (image encoder)')).toBeDefined();
      expect(screen.getByText('Natural-language search model (text encoder)')).toBeDefined();
      expect(screen.getByText('Text tokenizer')).toBeDefined();
    });
    expect(screen.getByText(/211.0 MB — Not installed/)).toBeDefined();
    expect(screen.getByText(/111.5 MB — Not installed/)).toBeDefined();
    expect(screen.getByText(/2.4 MB — Not installed/)).toBeDefined();
  });

  it('offers Download for missing models and Remove for installed ones', async () => {
    mockGetDownloadState.mockImplementation(async (id: string) =>
      id === 'siglip-base-patch16-224' ? 'ready' : 'not-downloaded',
    );
    await renderTab();
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /download/i }).length).toBe(2);
      expect(screen.getAllByRole('button', { name: /remove/i }).length).toBe(1);
    });
  });

  it('starts a download and reflects progress', async () => {
    mockGetDownloadState.mockResolvedValue('not-downloaded');
    // Keep the download pending so the progress state stays visible.
    mockStartDownload.mockReturnValue(new Promise(() => {}));
    mockSubscribeDownloadProgress.mockImplementation(
      (_id: string, fn: (progress: { loaded: number; total: number }) => void) => {
        fn({ loaded: 50, total: 100 });
        return () => undefined;
      },
    );
    await renderTab();
    const downloadButtons = await screen.findAllByRole('button', { name: /download/i });
    fireEvent.click(downloadButtons[0]!);
    await waitFor(() => {
      expect(mockStartDownload).toHaveBeenCalledWith('siglip-base-patch16-224');
    });
    const progressbar = await screen.findByRole('progressbar');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('50');
  });

  it('removes an installed model on Remove', async () => {
    mockGetDownloadState.mockResolvedValue('ready');
    await renderTab();
    const removeButtons = await screen.findAllByRole('button', { name: /remove/i });
    fireEvent.click(removeButtons[0]!);
    await waitFor(() => {
      expect(mockDeleteModel).toHaveBeenCalledWith('siglip-base-patch16-224');
    });
  });

  it('shows the tokenizer dependency note when the text model is installed without it', async () => {
    mockGetDownloadState.mockImplementation(async (id: string) =>
      id === 'siglip-base-patch16-224-text' ? 'ready' : 'not-downloaded',
    );
    await renderTab();
    await waitFor(() => {
      expect(screen.getByText(/Requires the text tokenizer/)).toBeDefined();
    });
  });

  it('reports index statistics and clears the index', async () => {
    mockGetDownloadState.mockResolvedValue('not-downloaded');
    mockStoreListAll.mockResolvedValue([
      { bytes: new ArrayBuffer(768 * 4), identity: { contentHash: 'x' } },
      { bytes: new ArrayBuffer(768 * 4), identity: { contentHash: 'y' } },
    ]);
    await renderTab();
    await waitFor(() => {
      expect(screen.getByText(/Indexed assets: 2/)).toBeDefined();
    });
    expect(screen.getByText(/Search index: 6 KB/)).toBeDefined();
    const clearButton = screen.getByRole('button', { name: /clear index/i });
    fireEvent.click(clearButton);
    await waitFor(() => {
      expect(mockStoreClear).toHaveBeenCalled();
    });
  });

  it('rebuild clears the index and reports the re-index path', async () => {
    mockGetDownloadState.mockResolvedValue('not-downloaded');
    mockStoreListAll.mockResolvedValue([]);
    // Keep the clear pending so the re-index status line stays visible.
    mockStoreClear.mockReturnValue(new Promise(() => {}));
    await renderTab();
    const rebuildButton = await screen.findByRole('button', { name: /rebuild index/i });
    fireEvent.click(rebuildButton);
    await waitFor(() => {
      expect(mockStoreClear).toHaveBeenCalled();
    });
    expect(screen.getByText(/assets re-index when the Asset Browser opens/i)).toBeDefined();
  });
});
