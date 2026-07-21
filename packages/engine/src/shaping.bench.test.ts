// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { shapeText } from './shaping';
import { ShapingCache } from './shapingCache';

function makeCtx(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  return canvas.getContext('2d') as CanvasRenderingContext2D;
}

/**
 * Benchmark: shape a 1000-node multilingual document (Latin + Arabic + CJK).
 * Asserts shaping all nodes completes < 100ms.
 *
 * Note: this is a structural/perf regression guard, not a unit test of
 * shaping correctness (see unicode.test.ts for that).
 */
describe('shaping performance', () => {
  function makeDocs(count: number) {
    const docs: {
      text: string;
      fontFamily: string;
      fontSize: number;
      direction: string;
      language: string;
    }[] = [];
    const samples = [
      {
        text: 'Hello World — Latin sample',
        fontFamily: 'Inter',
        fontSize: 16,
        direction: 'auto',
        language: 'en',
      },
      {
        text: 'مرحبا بالعالم',
        fontFamily: 'Inter',
        fontSize: 16,
        direction: 'rtl',
        language: 'ar',
      },
      { text: '你好世界', fontFamily: 'Inter', fontSize: 16, direction: 'auto', language: 'zh' },
      { text: 'שלום עולם', fontFamily: 'Inter', fontSize: 16, direction: 'rtl', language: 'he' },
      { text: 'नमस्ते दुनिया', fontFamily: 'Inter', fontSize: 16, direction: 'auto', language: 'hi' },
    ];
    for (let i = 0; i < count; i++) {
      docs.push(samples[i % samples.length]);
    }
    return docs;
  }

  it('shapes 1000 multilingual nodes in under 100ms', () => {
    const docs = makeDocs(1000);
    const ctx = makeCtx();
    const start = performance.now();
    for (const d of docs) {
      shapeText(d.text, d.fontFamily, d.fontSize, ctx, {
        direction: d.direction as 'ltr' | 'rtl' | 'auto',
        language: d.language,
      });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('ShapingCache deduplicates repeated shaping calls', () => {
    const cache = new ShapingCache();
    const input = {
      text: 'Hello',
      fontFamily: 'Inter',
      fontSize: 16,
      direction: 'auto',
      language: 'en',
    };
    const ctx = makeCtx();
    const result = shapeText(input.text, input.fontFamily, input.fontSize, ctx, {
      direction: input.direction as 'ltr' | 'rtl' | 'auto',
      language: input.language,
    });
    cache.set(
      input.text,
      input.fontFamily,
      input.fontSize,
      input.direction,
      input.language,
      result,
    );
    const cached = cache.get(
      input.text,
      input.fontFamily,
      input.fontSize,
      input.direction,
      input.language,
    );
    expect(cached).toBe(result);
    expect(cache.size).toBe(1);
  });

  it('ShapingCache evicts LRU entries when full', () => {
    const cache = new ShapingCache(3);
    const ctx = makeCtx();
    for (let i = 0; i < 3; i++) {
      const r = shapeText(`t${i}`, 'Inter', 16, ctx);
      cache.set(`t${i}`, 'Inter', 16, 'auto', '', r);
    }
    expect(cache.size).toBe(3);
    // Access the first entry to make it recently used
    cache.get('t0', 'Inter', 16, 'auto', '');
    // Add a 4th entry — should evict t1 (least recently used)
    const r = shapeText('t3', 'Inter', 16, ctx);
    cache.set('t3', 'Inter', 16, 'auto', '', r);
    expect(cache.size).toBe(3);
    expect(cache.get('t0', 'Inter', 16, 'auto', '')).toBeDefined();
    expect(cache.get('t1', 'Inter', 16, 'auto', '')).toBeUndefined();
  });
});
