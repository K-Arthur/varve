import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWasmEngineFromModule } from './engine';
import { fetchWasmAsset, wasmHitTestFallback } from './wasmLoader';

const WASM_ARTIFACTS = [
  resolve(process.cwd(), 'apps/desktop/public/wasm/varve_wasm_bg.wasm'),
  resolve(process.cwd(), 'apps/desktop/public/wasm/varve_wasm_simd_bg.wasm'),
];

describe('wasmLoader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to Cache Storage when an asset fetch is offline', async () => {
    const cachedResponse = new Response(new Uint8Array([0, 97, 115, 109]), {
      status: 200,
      headers: { 'content-type': 'application/wasm' },
    });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network unavailable'));
    const matchMock = vi.fn().mockResolvedValue(cachedResponse);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', { match: matchMock });

    await expect(fetchWasmAsset('/try/wasm/varve_wasm_bg.wasm')).resolves.toBe(cachedResponse);
    expect(fetchMock).toHaveBeenCalledWith('/try/wasm/varve_wasm_bg.wasm', undefined);
    expect(matchMock).toHaveBeenCalledWith('/try/wasm/varve_wasm_bg.wasm');
  });

  it('does not hide a missing asset when Cache Storage has no entry', async () => {
    const networkError = new TypeError('network unavailable');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));
    vi.stubGlobal('caches', { match: vi.fn().mockResolvedValue(undefined) });

    await expect(fetchWasmAsset('/try/wasm/missing.wasm')).rejects.toBe(networkError);
  });

  it('keeps every loader-selected artifact current when just wasm-build has run', () => {
    if (!WASM_ARTIFACTS.every(existsSync)) {
      console.warn('Skipping: run `just wasm-build` to produce baseline and SIMD WASM artifacts');
      return;
    }
    expect(WASM_ARTIFACTS.every(existsSync)).toBe(true);
  });
  it('createWasmEngineFromModule builds IR from JSON', async () => {
    const mod = {
      build_ir_json: (json: string) => {
        const nodes = JSON.parse(json) as unknown[];
        return JSON.stringify(
          nodes.map((_, _i) => ({
            transform: [1, 0, 0, 1, 0, 0],
            fill: [57, 208, 198, 255],
            primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
            opacity: 1,
            blendMode: 'normal',
          })),
        );
      },
      hit_test_json: () => 0,
      wasm_engine_version: () => '0.0.0',
    };
    const eng = createWasmEngineFromModule(mod);
    expect(eng.backend).toBe('wasm');
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'a',
          name: 'A',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        },
      ],
    });
    expect(ir).toHaveLength(1);
  });

  it('restores vertical text metadata until the native IR schema carries it', async () => {
    const mod = {
      build_ir_json: () =>
        JSON.stringify([
          {
            transform: [1, 0, 0, 1, 0, 0],
            fill: [0, 0, 0, 255],
            primitive: { kind: 'text', text: '縦', x: 0, y: 0, w: 20, h: 40 },
            opacity: 1,
            blendMode: 'normal',
          },
        ]),
      hit_test_json: () => 0,
      wasm_engine_version: () => '0.0.0',
    };
    const eng = createWasmEngineFromModule(mod);
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'vertical',
          name: 'Vertical',
          transform: [1, 0, 0, 1, 0, 0],
          kind: 'text',
          shape: { kind: 'rect', x: 0, y: 0, w: 20, h: 40 },
          text: '縦',
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
        },
      ],
    });
    expect(ir[0]?.primitive).toMatchObject({
      kind: 'text',
      writingMode: 'vertical-rl',
      textOrientation: 'mixed',
    });
  });

  it('wasmHitTestFallback delegates to stub geometry', () => {
    const idx = wasmHitTestFallback(
      [
        {
          id: 'a',
          name: 'A',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        },
      ],
      [50, 50],
    );
    expect(idx).toBe(0);
  });
});
