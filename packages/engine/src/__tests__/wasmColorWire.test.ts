import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface ColorWireModule {
  initSync(options: { module: Uint8Array }): unknown;
  build_ir_json(nodes: string): string;
}

// Exercise the real compiled baseline and preferred SIMD artifacts. A mocked
// build_ir_json cannot detect Rust serde dropping TypeScript color metadata.
describe('compiled WASM managed-color wire contract', () => {
  for (const name of ['varve_wasm', 'varve_wasm_simd']) {
    const directory = resolve(process.cwd(), 'apps/desktop/public/wasm');
    const artifact = resolve(directory, `${name}_bg.wasm`);
    it.skipIf(!existsSync(artifact))(
      `${name} retains float channels, alpha and profile`,
      async () => {
        const moduleUrl = pathToFileURL(resolve(directory, `${name}.js`)).href;
        const wasm = (await import(/* @vite-ignore */ moduleUrl)) as ColorWireModule;
        wasm.initSync({ module: readFileSync(artifact) });
        const fill = {
          space: 'rgb',
          bitDepth: 'float32',
          profile: 'display-p3',
          r: 0.123456789,
          g: 0.4,
          b: 0.8,
          a: 0.25,
        };
        const nodes = [
          {
            id: '1',
            name: 'Managed token color',
            transform: [1, 0, 0, 1, 0, 0],
            shape: { kind: 'rect', x: 0, y: 0, w: 180, h: 160 },
            fill,
            children: [],
          },
        ];
        const ir = JSON.parse(wasm.build_ir_json(JSON.stringify(nodes))) as Array<{
          fill: unknown;
        }>;
        expect(ir[0]?.fill).toEqual(fill);
      },
    );
  }
});
