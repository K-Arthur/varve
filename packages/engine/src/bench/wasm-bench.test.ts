import { describe, expect, it } from 'vitest';
import { loadWasmEngineModule } from '../wasmLoader';

describe('WASM engine throughput', () => {
  it.skipIf(typeof WebAssembly === 'undefined')(
    'loads and builds IR when artifact present',
    async () => {
      const mod = await loadWasmEngineModule();
      if (!mod) return;
      const nodes = JSON.stringify(generateTestScene(100));
      const start = performance.now();
      const result = mod.build_ir_json(nodes);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(200);
      expect(() => JSON.parse(result)).not.toThrow();
    },
  );
});

function generateTestScene(count: number): unknown[] {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      id: `n${i}`,
      name: `Node ${i}`,
      transform: [1, 0, 0, 1, i * 10, i * 10],
      shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 30 },
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      opacity: 1,
      blend_mode: 'normal',
      rotation: 0,
      strokes: [],
      effects: [],
    });
  }
  return nodes;
}
