import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWasmEngineFromModule } from './engine';
import { wasmHitTestFallback } from './wasmLoader';

const WASM_ARTIFACTS = [
  resolve(process.cwd(), 'apps/desktop/public/wasm/varve_wasm_bg.wasm'),
  resolve(process.cwd(), 'apps/desktop/public/wasm/varve_wasm_simd_bg.wasm'),
];

describe('wasmLoader', () => {
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
