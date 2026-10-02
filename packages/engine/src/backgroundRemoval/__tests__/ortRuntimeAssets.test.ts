import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  configureOrtRuntime,
  REQUIRED_ORT_RUNTIME_FILES,
  resetOrtRuntimeDiagnostics,
} from '../ortRuntimeAssets';

/** Resolve only the compiled loader's literal boolean ternaries; never execute dependency code. */
function selectedRuntimeAsset(expression: string): string {
  const value = expression.trim();
  const literal = /^"([a-z0-9.-]+)"$/.exec(value);
  if (literal) return literal[1]!;
  const branch = /^(true|false)\s*\?\s*"([a-z0-9.-]+)"\s*:\s*(.+)$/.exec(value);
  if (!branch) throw new Error(`ORT loader selection changed; review its runtime assets: ${value}`);
  return branch[1] === 'true' ? branch[2]! : selectedRuntimeAsset(branch[3]!);
}

describe('installed ONNX Runtime asset contract', () => {
  it('stages the real loader and WASM companion selected by each application entry point', () => {
    const require = createRequire(import.meta.url);
    const dist = dirname(require.resolve('onnxruntime-web'));
    const script = readFileSync(
      new URL('../../../../../scripts/copy-onnx-wasm.mjs', import.meta.url),
      'utf8',
    );
    const staged = script.match(/const requiredFiles = \[([\s\S]*?)\];/)?.[1];
    expect(staged).toBeDefined();
    for (const file of ['ort.mjs', 'ort.wasm.mjs', 'ort.webgpu.mjs']) {
      const source = readFileSync(resolve(dist, file), 'utf8');
      const expression = source.match(/const wasmModuleFilename = ([^;]+);/)?.[1];
      expect(expression, `${file} must expose its compiled companion selection`).toBeDefined();
      const loader = selectedRuntimeAsset(expression!);
      for (const companion of [loader, loader.replace(/\.mjs$/, '.wasm')]) {
        expect(REQUIRED_ORT_RUNTIME_FILES).toContain(companion);
        expect(staged).toContain(`'${companion}'`);
        expect(readFileSync(resolve(dist, companion)).byteLength).toBeGreaterThan(0);
      }
    }
  });
});

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
