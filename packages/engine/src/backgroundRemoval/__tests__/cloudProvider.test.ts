// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MOCK_CONFIG = {
  apiUrl: 'https://api.strata.dev/v1/remove-background',
  apiKey: 'sk-test-key-12345',
  timeout: 30000,
  maxRetries: 2,
  usePreview: true,
  maxDimension: 2048,
  enabled: true,
};

const { mockLoadCloudConfig } = vi.hoisted(() => ({
  mockLoadCloudConfig: vi.fn(),
}));

vi.mock('../cloudConfig', () => ({
  loadCloudConfig: mockLoadCloudConfig,
}));

function makeImageData(w = 4, h = 4): ImageData {
  return new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
}

function stubOffscreenCanvas(): void {
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return { putImageData: vi.fn() };
      }
      convertToBlob() {
        return Promise.resolve(new Blob(['fake-png'], { type: 'image/png' }));
      }
    },
  );
}

describe('cloudRemovalProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    mockLoadCloudConfig.mockReset();
    stubOffscreenCanvas();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isAvailable', () => {
    it('returns false when no config saved (loadCloudConfig returns null)', async () => {
      mockLoadCloudConfig.mockReturnValue(null);
      const { cloudRemovalProvider } = await import('../providers/cloudProvider');
      const available = await cloudRemovalProvider.isAvailable({ method: 'ai-balanced' });
      expect(available).toBe(false);
    });

    it('returns false when config is incomplete (empty apiUrl)', async () => {
      mockLoadCloudConfig.mockReturnValue({
        ...MOCK_CONFIG,
        apiUrl: '',
        enabled: true,
      });
      const { cloudRemovalProvider } = await import('../providers/cloudProvider');
      const available = await cloudRemovalProvider.isAvailable({ method: 'ai-balanced' });
      expect(available).toBe(false);
    });

    it('returns false when config is incomplete (empty apiKey)', async () => {
      mockLoadCloudConfig.mockReturnValue({
        ...MOCK_CONFIG,
        apiKey: '',
        enabled: true,
      });
      const { cloudRemovalProvider } = await import('../providers/cloudProvider');
      const available = await cloudRemovalProvider.isAvailable({ method: 'ai-balanced' });
      expect(available).toBe(false);
    });

    it('returns false when cloud is not enabled', async () => {
      mockLoadCloudConfig.mockReturnValue({ ...MOCK_CONFIG, enabled: false });
      const { cloudRemovalProvider } = await import('../providers/cloudProvider');
      const available = await cloudRemovalProvider.isAvailable({ method: 'ai-balanced' });
      expect(available).toBe(false);
    });

    it('returns true when fully configured and enabled', async () => {
      mockLoadCloudConfig.mockReturnValue(MOCK_CONFIG);
      const { cloudRemovalProvider } = await import('../providers/cloudProvider');
      const available = await cloudRemovalProvider.isAvailable({ method: 'ai-balanced' });
      expect(available).toBe(true);
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
      mockLoadCloudConfig.mockReturnValue(MOCK_CONFIG);
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('throws when config is not available', async () => {
      mockLoadCloudConfig.mockReturnValue(null);
      const { cloudRemovalProvider } = await import('../providers/cloudProvider');
      await expect(
        cloudRemovalProvider.remove(makeImageData(), { method: 'ai-balanced' }),
      ).rejects.toThrow('Cloud provider is not configured');
    });

    it('completes a successful inference and returns correct result shape', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            maskDataUrl: 'data:image/png;base64,cloudmask',
            confidence: 0.92,
            width: 4,
            height: 4,
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { cloudRemovalProvider } = await import('../providers/cloudProvider');
      const result = await cloudRemovalProvider.remove(makeImageData(), {
        method: 'ai-balanced',
      });

      expect(result.maskDataUrl).toBe('data:image/png;base64,cloudmask');
      expect(result.confidence).toBe(0.92);
      expect(result.method).toBe('ai-balanced');
      expect(result.width).toBe(4);
      expect(result.height).toBe(4);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const callUrl = mockFetch.mock.calls[0]![0];
      expect(callUrl).toBe(MOCK_CONFIG.apiUrl);

      const callOpts = mockFetch.mock.calls[0]![1] as RequestInit;
      expect(callOpts.method).toBe('POST');
      expect((callOpts.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${MOCK_CONFIG.apiKey}`,
      );
      expect(callOpts.body).toBeInstanceOf(FormData);
    });

    it('retries with exponential backoff on failure', async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Gateway timeout'))
        .mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              maskDataUrl: 'data:image/png;base64,retried',
              confidence: 0.85,
              width: 4,
              height: 4,
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const { cloudRemovalProvider } = await import('../providers/cloudProvider');
      const result = await cloudRemovalProvider.remove(makeImageData(), {
        method: 'ai-balanced',
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.maskDataUrl).toContain('retried');
    });

    it('throws when all retries are exhausted', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Service unavailable'));
      vi.stubGlobal('fetch', mockFetch);

      const { cloudRemovalProvider } = await import('../providers/cloudProvider');

      await expect(
        cloudRemovalProvider.remove(makeImageData(), { method: 'ai-balanced' }),
      ).rejects.toThrow('Service unavailable');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('throws immediately when an already-aborted signal is passed', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const { cloudRemovalProvider } = await import('../providers/cloudProvider');
      const aborted = new AbortController();
      aborted.abort();

      await expect(
        cloudRemovalProvider.remove(makeImageData(), { method: 'ai-balanced' }, aborted.signal),
      ).rejects.toThrow('cancelled');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws on non-200 response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });
      vi.stubGlobal('fetch', mockFetch);

      const { cloudRemovalProvider } = await import('../providers/cloudProvider');

      await expect(
        cloudRemovalProvider.remove(makeImageData(), { method: 'ai-balanced' }),
      ).rejects.toThrow('Cloud API returned 401: Unauthorized');
    });
  });
});
