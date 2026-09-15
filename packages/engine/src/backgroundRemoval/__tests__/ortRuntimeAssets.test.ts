import { describe, expect, it, vi } from 'vitest';
import { configureOrtRuntime, resetOrtRuntimeDiagnostics } from '../ortRuntimeAssets';

function fakeOrt() {
  return {
    env: {
      wasm: { wasmPaths: '', numThreads: 0, proxy: false },
      versions: { web: '1.27.0', common: '1.27.0' },
    },
  };
}

describe('configureOrtRuntime thread policy', () => {
  it('pins worker-owned runtimes to a single thread', () => {
    const ort = fakeOrt();
    const previousDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = undefined;
    try {
      resetOrtRuntimeDiagnostics();
      configureOrtRuntime(ort as never);
      expect(ort.env.wasm.numThreads).toBe(1);
      expect(ort.env.wasm.proxy).toBe(false);
      expect(ort.env.wasm.wasmPaths).toContain('ort-wasm');
    } finally {
      if (previousDocument === undefined) {
        Reflect.deleteProperty(globalThis as object, 'document');
      } else {
        (globalThis as { document?: unknown }).document = previousDocument;
      }
    }
  });

  it('does not overwrite the main-thread thread policy', () => {
    const ort = fakeOrt();
    (globalThis as { document?: unknown }).document = {};
    try {
      resetOrtRuntimeDiagnostics();
      configureOrtRuntime(ort as never);
      expect(ort.env.wasm.numThreads).toBe(0);
    } finally {
      Reflect.deleteProperty(globalThis as object, 'document');
    }
  });

  it('keeps the wasm binary and JS loader from the same build', () => {
    const ort = fakeOrt();
    resetOrtRuntimeDiagnostics();
    configureOrtRuntime(ort as never);
    expect(ort.env.wasm.wasmPaths).toContain('/ort-wasm/');
  });

  it('logs the actual thread configuration once per configuration', () => {
    const ort = fakeOrt();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    (globalThis as { document?: unknown }).document = undefined;
    try {
      resetOrtRuntimeDiagnostics();
      configureOrtRuntime(ort as never);
      configureOrtRuntime(ort as never);
      expect(info).toHaveBeenCalledTimes(1);
      const payload = info.mock.calls[0]?.[1] as { wasmThreads?: number } | undefined;
      expect(payload?.wasmThreads).toBe(1);
    } finally {
      info.mockRestore();
      Reflect.deleteProperty(globalThis as object, 'document');
    }
  });
});
