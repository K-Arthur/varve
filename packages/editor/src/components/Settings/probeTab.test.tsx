// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { beforeEach, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAllModels: vi.fn(),
  getDownloadState: vi.fn(),
  subscribeDownloadProgress: vi.fn(),
  storeListAll: vi.fn(),
}));

vi.mock('@varve/engine', () => ({
  DownloadManager: vi.fn().mockImplementation(() => ({
    registerModel: vi.fn(),
    getDownloadState: mocks.getDownloadState,
    startDownload: vi.fn(),
    deleteModel: vi.fn(),
    subscribeDownloadProgress: mocks.subscribeDownloadProgress,
  })),
  listAllModels: mocks.listAllModels,
}));

vi.mock('@varve/platform', () => ({
  IndexedDbSemanticEmbeddingStore: vi.fn().mockImplementation(() => ({
    clear: vi.fn(),
    listAll: mocks.storeListAll,
  })),
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
];

beforeEach(() => {
  vi.clearAllMocks();
});

it('probe dom', async () => {
  mocks.listAllModels.mockReturnValue(ENTRIES);
  mocks.getDownloadState.mockResolvedValue('not-downloaded');
  mocks.storeListAll.mockResolvedValue([]);
  mocks.subscribeDownloadProgress.mockReturnValue(() => undefined);
  const { SemanticSearchTab } = await import('./SemanticSearchTab');
  render(<SemanticSearchTab />);
  await waitFor(() => expect(mocks.getDownloadState).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 100));
  process.stdout.write(`DOM-START>>>${document.body.innerHTML.slice(0, 3000)}<<<DOM-END\n`);
});
