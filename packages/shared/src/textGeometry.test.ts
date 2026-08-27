import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveTextGeometry,
  resolveTextGeometryMode,
  type TextGeometryInput,
} from './textGeometry';
import { setTextAdvanceMeasurer, textMeasureRevision } from './textMeasure';

const BASE: TextGeometryInput = {
  text: '',
  fontSize: 20,
  fontFamily: 'Test Sans',
  lineHeight: 1.4,
};
const LINE = 20 * 1.4;

function geom(overrides: Partial<TextGeometryInput>) {
  return resolveTextGeometry({ ...BASE, ...overrides });
}

afterEach(() => {
  setTextAdvanceMeasurer(null);
});

describe('resolveTextGeometryMode', () => {
  it('takes textResizing as authoritative when set', () => {
    expect(resolveTextGeometryMode({ text: 'a', textResizing: 'fixed' })).toBe('fixed');
    expect(resolveTextGeometryMode({ text: 'a', textResizing: 'autoHeight' })).toBe('autoHeight');
    expect(resolveTextGeometryMode({ text: 'a', textResizing: 'autoWidth', w: 40 })).toBe(
      'autoWidth',
    );
  });

  it('reads legacy intent from textMode and the presence of a width', () => {
    // Imported area boxes predate textResizing; a width plus area mode is a
    // container, a width alone is a wrap constraint, neither is auto-width.
    expect(resolveTextGeometryMode({ text: 'a', textMode: 'area', w: 200 })).toBe('fixed');
    expect(resolveTextGeometryMode({ text: 'a', w: 200 })).toBe('autoHeight');
    expect(resolveTextGeometryMode({ text: 'a' })).toBe('autoWidth');
  });

  it('recognises path text ahead of every other signal', () => {
    expect(resolveTextGeometryMode({ text: 'a', textMode: 'path', textResizing: 'fixed' })).toBe(
      'path',
    );
  });
});

describe('multi-line layout', () => {
  it('grows with each explicit line break', () => {
    const one = geom({ text: 'One' });
    const three = geom({ text: 'One\nTwo\nThree' });
    expect(one.bounds.h).toBeCloseTo(LINE);
    expect(three.bounds.h).toBeCloseTo(LINE * 3);
    expect(three.lines).toHaveLength(3);
  });

  it('keeps a line box for a blank middle line', () => {
    const withBlank = geom({ text: 'One\n\nThree' });
    expect(withBlank.lines.map((l) => l.text)).toEqual(['One', '', 'Three']);
    expect(withBlank.bounds.h).toBeCloseTo(LINE * 3);
  });

  it('keeps a line box for a trailing break', () => {
    expect(geom({ text: 'Hello\n' }).lines).toHaveLength(2);
    expect(geom({ text: 'Hello\n\n' }).lines).toHaveLength(3);
  });

  it('reports the widest line, not the last one', () => {
    const g = geom({ text: 'a\nlonger line here\nb' });
    expect(g.layout.w).toBeGreaterThan(geom({ text: 'a' }).layout.w);
    expect(g.bounds.w).toBeCloseTo(g.layout.w);
  });
});

describe('resizing modes', () => {
  it('autoWidth ignores a stale explicit height so added lines are enclosed', () => {
    // A single-line `h` left over from an earlier state (imports and older
    // documents both produce these) must not pin the box to one line.
    const g = geom({ text: 'One\nTwo\nThree', h: 28, textResizing: 'autoWidth' });
    expect(g.bounds.h).toBeCloseTo(LINE * 3);
  });

  it('autoWidth ignores a stale explicit width instead of wrapping to it', () => {
    const g = geom({ text: 'A single unwrapped line', w: 40, textResizing: 'autoWidth' });
    expect(g.lines).toHaveLength(1);
    expect(g.bounds.w).toBeGreaterThan(40);
  });

  it('autoHeight keeps its width constraint and derives height from the wrap', () => {
    const g = geom({
      text: 'This sentence is long enough that it has to wrap several times.',
      w: 120,
      h: 30,
      textResizing: 'autoHeight',
    });
    expect(g.bounds.w).toBe(120);
    expect(g.lines.length).toBeGreaterThan(1);
    expect(g.bounds.h).toBeCloseTo(LINE * g.lines.length);
    expect(g.bounds.h).toBeGreaterThan(30);
  });

  it('fixed keeps its container even when the content overflows it', () => {
    const g = geom({
      text: 'This sentence is long enough that it has to wrap several times.',
      w: 120,
      h: 60,
      textResizing: 'fixed',
    });
    expect(g.bounds).toMatchObject({ w: 120, h: 60 });
    expect(g.container).toEqual({ w: 120, h: 60 });
    // The overflow is still measurable — the container simply does not follow.
    expect(g.layout.h).toBeGreaterThan(60);
  });

  it('separates container bounds from layout bounds', () => {
    const g = geom({ text: 'One\nTwo\nThree', w: 300, h: 40, textResizing: 'fixed' });
    expect(g.container).toEqual({ w: 300, h: 40 });
    expect(g.layout.h).toBeCloseTo(LINE * 3);
  });
});

describe('typographic properties that change the box', () => {
  it('includes tracking in the measured width', () => {
    const plain = geom({ text: 'Hello' });
    const tracked = geom({ text: 'Hello', tracking: 100 });
    // 100/1000 em at 20px = 2px per gap, four gaps in "Hello".
    expect(tracked.bounds.w - plain.bounds.w).toBeCloseTo(8);
  });

  it('includes letter spacing in the measured width', () => {
    const plain = geom({ text: 'Hello' });
    const spaced = geom({ text: 'Hello', letterSpacing: 3 });
    expect(spaced.bounds.w - plain.bounds.w).toBeCloseTo(12);
  });

  it('leads paragraphs after the first by paragraphSpacing', () => {
    const tight = geom({ text: 'A\nB\nC' });
    const loose = geom({ text: 'A\nB\nC', paragraphSpacing: 10 });
    expect(loose.bounds.h - tight.bounds.h).toBeCloseTo(20);
  });

  it('scales the box with line height', () => {
    expect(geom({ text: 'A\nB', lineHeight: 2 }).bounds.h).toBeCloseTo(20 * 2 * 2);
    expect(geom({ text: 'A\nB', lineHeight: 0.8 }).bounds.h).toBeCloseTo(20 * 0.8 * 2);
  });

  it('measures the transformed text when a text case is applied', () => {
    setTextAdvanceMeasurer({
      // Uppercase letters are wider in nearly every face; a case transform
      // therefore changes the box, which a raw-source measurement misses.
      measureAdvance: (text) =>
        [...text].reduce((sum, ch) => sum + (ch === ch.toUpperCase() ? 14 : 10), 0),
      revision: () => 'case-test',
    });
    expect(geom({ text: 'abcd' }).bounds.w).toBeCloseTo(40);
    expect(geom({ text: 'abcd', textCase: 'uppercase' }).bounds.w).toBeCloseTo(56);
  });
});

describe('rich text', () => {
  it('uses the rich paragraphs rather than a lagging plain-text mirror', () => {
    const g = geom({
      text: 'One',
      richText: {
        paragraphs: [
          { runs: [{ text: 'One' }] },
          { runs: [{ text: 'Two' }] },
          { runs: [{ text: 'Three' }] },
        ],
      },
    });
    expect(g.lines).toHaveLength(3);
    expect(g.bounds.h).toBeCloseTo(LINE * 3);
  });

  it('sets a line height from the tallest run on that line', () => {
    const g = geom({
      text: 'small big',
      richText: {
        paragraphs: [{ runs: [{ text: 'small' }, { text: 'big', format: { fontSize: 60 } }] }],
      },
    });
    expect(g.bounds.h).toBeCloseTo(60 * 1.4);
  });

  it('measures each run in its own face', () => {
    setTextAdvanceMeasurer({
      measureAdvance: (text, options) => text.length * (options.fontSize ?? 16) * 0.5,
      revision: () => 'run-test',
    });
    const g = geom({
      text: 'ab',
      richText: {
        paragraphs: [{ runs: [{ text: 'a' }, { text: 'b', format: { fontSize: 40 } }] }],
      },
    });
    expect(g.bounds.w).toBeCloseTo(20 * 0.5 + 40 * 0.5);
  });

  it('keeps an empty rich paragraph as a line box', () => {
    const g = geom({
      text: '',
      richText: {
        paragraphs: [{ runs: [{ text: 'A' }] }, { runs: [] }, { runs: [{ text: 'B' }] }],
      },
    });
    expect(g.lines).toHaveLength(3);
  });
});

describe('empty text', () => {
  it('keeps a clickable editing affordance without inventing content', () => {
    const g = geom({ text: '' });
    expect(g.bounds.w).toBeCloseTo(60);
    expect(g.bounds.h).toBeCloseTo(LINE);
    // The affordance is not content: layout bounds stay honest about the void.
    expect(g.layout.w).toBe(0);
  });

  it('does not report a container for a node that has no w or h', () => {
    expect(geom({ text: 'One' }).container).toBeNull();
  });
});

describe('font readiness', () => {
  it('changes the box when the usable face changes, with no document edit', () => {
    const node: TextGeometryInput = { ...BASE, text: 'Hello world' };
    const fallback = resolveTextGeometry(node).bounds.w;

    setTextAdvanceMeasurer({
      measureAdvance: (text, options) => text.length * (options.fontSize ?? 16) * 0.9,
      revision: () => 'loaded',
    });
    const loaded = resolveTextGeometry(node).bounds.w;

    expect(loaded).not.toBeCloseTo(fallback);
    expect(textMeasureRevision()).toBe('loaded');
  });

  it('reports an estimated identity while no backend is installed', () => {
    expect(textMeasureRevision()).toBe('text-measure:estimated');
  });
});

describe('path text', () => {
  it('keeps an explicit box so an on-path node stays where the document put it', () => {
    const g = geom({ text: 'Along a path', textMode: 'path', w: 500, h: 120 });
    expect(g.mode).toBe('path');
    expect(g.bounds).toMatchObject({ w: 500, h: 120 });
  });
});
