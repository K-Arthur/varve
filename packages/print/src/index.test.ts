import { describe, expect, it } from 'vitest';
import { createPrintEngine, createStubPrintEngine, PACKAGE } from './index';

describe('PACKAGE', () => {
  it('exposes package marker', () => {
    expect(PACKAGE).toBe('@strata/print');
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
    const result = await engine.outlineText('Hello', 16, 'Inter');
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('native');
  });
});
