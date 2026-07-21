import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectVideoCapabilities } from './videoEncoder';

describe('detectVideoCapabilities', () => {
  const originalVideoEncoder = globalThis.VideoEncoder;
  const originalVideoFrame = globalThis.VideoFrame;
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;

  beforeEach(() => {
    // Reset all APIs.
    // @ts-expect-error — intentionally deleting for test
    delete globalThis.VideoEncoder;
    // @ts-expect-error
    delete globalThis.VideoFrame;
    // @ts-expect-error
    delete globalThis.MediaRecorder;
    // @ts-expect-error
    delete globalThis.OffscreenCanvas;
  });

  afterEach(() => {
    globalThis.VideoEncoder = originalVideoEncoder;
    globalThis.VideoFrame = originalVideoFrame;
    globalThis.MediaRecorder = originalMediaRecorder;
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
    vi.restoreAllMocks();
  });

  it('returns "none" when no APIs are available', async () => {
    const caps = await detectVideoCapabilities();
    expect(caps.supported).toBe(false);
    expect(caps.provider).toBe('none');
  });

  it('detects image-sequence when only canvas is available', async () => {
    globalThis.OffscreenCanvas = class {} as typeof OffscreenCanvas;
    const caps = await detectVideoCapabilities();
    expect(caps.provider).toBe('image-sequence');
    expect(caps.supported).toBe(true);
    expect(caps.alphaSupport).toBe(true);
  });

  it('detects MediaRecorder when available but no WebCodecs', async () => {
    globalThis.OffscreenCanvas = class {} as typeof OffscreenCanvas;
    const isTypeSupported = vi.fn().mockReturnValue(true);
    globalThis.MediaRecorder = {
      isTypeSupported,
    } as unknown as typeof MediaRecorder;
    const caps = await detectVideoCapabilities();
    expect(caps.provider).toBe('mediarecorder');
    expect(caps.supported).toBe(true);
  });

  it('prefers WebCodecs when VideoEncoder + VideoFrame exist', async () => {
    globalThis.OffscreenCanvas = class {} as typeof OffscreenCanvas;
    const isConfigSupported = vi.fn().mockResolvedValue({ supported: true });
    globalThis.VideoEncoder = {
      isConfigSupported,
    } as unknown as typeof VideoEncoder;
    globalThis.VideoFrame = class {} as typeof VideoFrame;
    const caps = await detectVideoCapabilities();
    expect(caps.provider).toBe('webcodecs');
    expect(caps.supported).toBe(true);
  });

  it('does not use UA sniffing — only API detection', async () => {
    globalThis.OffscreenCanvas = class {} as typeof OffscreenCanvas;
    globalThis.MediaRecorder = {
      isTypeSupported: vi.fn().mockReturnValue(true),
    } as unknown as typeof MediaRecorder;
    const caps = await detectVideoCapabilities();
    // Should detect MediaRecorder purely from API, not from UA.
    expect(caps.provider).toBe('mediarecorder');
  });

  it('returns maxResolution for known providers', async () => {
    globalThis.OffscreenCanvas = class {} as typeof OffscreenCanvas;
    globalThis.MediaRecorder = {
      isTypeSupported: vi.fn().mockReturnValue(true),
    } as unknown as typeof MediaRecorder;
    const caps = await detectVideoCapabilities();
    expect(caps.maxResolution).toEqual({ width: 4096, height: 4096 });
  });
});
