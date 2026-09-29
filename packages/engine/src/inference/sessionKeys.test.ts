import { describe, expect, it } from 'vitest';
import { workerSessionKey } from './sessionKeys';

describe('inference worker session key', () => {
  it('preserves the legacy two-field key for compatibility callers', () => {
    expect(workerSessionKey('depth', '/models/depth.onnx')).toBe('depth:/models/depth.onnx');
  });

  it('separates model artifact, precision, provider, runtime, sidecar, and worker generation', () => {
    const base = {
      modelId: 'depth-small',
      artifactRevision: 'sha256:abc',
      precision: 'int8',
      providerConfiguration: 'wasm-only',
      runtimeConfiguration: 'ort-worker:threads=1',
      deviceGeneration: 4,
      externalDataPath: 'weights.onnx.data',
      externalDataRevision: 'sha256:sidecar',
    } as const;
    const key = workerSessionKey('depth', '/models/depth.onnx', base);

    for (const patch of [
      { artifactRevision: 'sha256:def' },
      { precision: 'fp32' },
      { providerConfiguration: 'accelerator-with-wasm-fallback' },
      { runtimeConfiguration: 'ort-worker:threads=2' },
      { deviceGeneration: 5 },
      { externalDataPath: 'other.onnx.data' },
      { externalDataRevision: 'sha256:new-sidecar' },
    ]) {
      expect(workerSessionKey('depth', '/models/depth.onnx', { ...base, ...patch })).not.toBe(key);
    }
  });

  it('encodes identity delimiters so distinct configurations cannot collide', () => {
    const first = workerSessionKey('model:type', '/path:a', {
      modelId: 'one:model',
      artifactRevision: 'rev:a',
    });
    const second = workerSessionKey('model:type', '/path:a', {
      modelId: 'one',
      artifactRevision: 'model:rev:a',
    });
    expect(first).not.toBe(second);
  });
});
