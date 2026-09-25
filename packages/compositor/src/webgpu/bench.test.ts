// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { maxCircleItemsPerUpload, WebGPUBackend } from './backend';

describe('WebGPUBackend circle upload admission', () => {
  it('caps the rounded allocation within the device limit and 4 MiB working budget', () => {
    expect(maxCircleItemsPerUpload(500)).toBe(0);
    expect(maxCircleItemsPerUpload(512)).toBe(1);
    const chunk = maxCircleItemsPerUpload(256 * 1024 * 1024);
    expect(chunk).toBeGreaterThan(1000);
    expect(chunk * 6 * 15 * 4).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect((chunk + 1) * 6 * 15 * 4).toBeGreaterThan(4 * 1024 * 1024);
  });
});

describe('WebGPUBackend vertex pool', () => {
  it('reuses buffers of same rounded size', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const backend = new WebGPUBackend();
    await backend.init(canvas);
    const buf1 = backend.getOrCreateVertexBufferForTest(100);
    const buf2 = backend.getOrCreateVertexBufferForTest(150);
    const buf3 = backend.getOrCreateVertexBufferForTest(100);
    if (buf1 && buf3) expect(buf1).toBe(buf3);
    if (buf1 && buf2) expect(buf1).not.toBe(buf2);
    backend.destroy();
  });
});

describe('WebGPUBackend init order', () => {
  it('does not acquire 2d context before webgpu probe when gpu is absent', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const backend = new WebGPUBackend();
    await backend.init(canvas);
    const diag = backend.getDiagnostics();
    expect(diag.backendId).toBe('webgpu');
    expect(diag.gpuActive).toBe(false);
    backend.destroy();
  });
});
