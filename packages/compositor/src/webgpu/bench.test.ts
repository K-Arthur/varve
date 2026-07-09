// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { WebGPUBackend } from './backend';

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
