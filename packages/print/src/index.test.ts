import { describe, expect, it } from 'vitest';
import { createPrintEngine, createStubPrintEngine, PACKAGE } from './index';

describe('PACKAGE', () => {
  it('exposes package marker', () => {
    expect(PACKAGE).toBe('@varve/print');
  });
});

describe('createPrintEngine', () => {
  it('returns stub engine by default (no Tauri in test env)', async () => {
    const engine = await createPrintEngine();
    expect(engine.backend).toBe('stub');
  });

  it('returns stub engine when explicitly requested', async () => {
    const engine = await createPrintEngine('stub');
    expect(engine.backend).toBe('stub');
  });
});

describe('colour WASM loader exports', () => {
  it('exports loadColourWasmModule as a function', async () => {
    const { loadColourWasmModule } = await import('./index');
    expect(typeof loadColourWasmModule).toBe('function');
  });

  it('exports prewarmColourWasm as a function', async () => {
    const { prewarmColourWasm } = await import('./index');
    expect(typeof prewarmColourWasm).toBe('function');
  });

  it('exports ColourEngine type', async () => {
    const mod = await import('./index');
    // Type-only export; verify the method names are documented
    const engine = mod.createColourEngineFromModule;
    expect(typeof engine).toBe('function');
  });
});

describe('createStubPrintEngine', () => {
  it('exportPdf returns minimal PDF bytes', async () => {
    const engine = createStubPrintEngine();
    const result = await engine.exportPdf(JSON.stringify({ test: true }), {
      format: 'pdf-screen',
      title: 'test',
    });
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(result.format).toBe('pdf-screen');
    expect(result.name).toBe('test');
  });

  it('outlineText returns a message about native requirement', async () => {
    const engine = createStubPrintEngine();
    const result = await engine.outlineText('Hello', 16, new Uint8Array([]));
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('native');
  });
});
