import { describe, expect, it } from 'vitest';
import { layoutRichText } from './textLayout';

describe('layoutRichText', () => {
  const defaultFormat = { fontSize: 16, fontFamily: 'sans-serif' };

  it('returns single line for short text', () => {
    const result = layoutRichText(
      {
        paragraphs: [{ runs: [{ text: 'Hello' }] }],
      },
      200,
      defaultFormat,
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.runs).toHaveLength(1);
    expect(result.lines[0]?.runs[0]?.text).toBe('Hello');
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.overset).toBe(false);
  });

  it('wraps mixed-format runs across lines', () => {
    const result = layoutRichText(
      {
        paragraphs: [
          {
            runs: [
              { text: 'Small ', format: { fontSize: 12 } },
              { text: 'big', format: { fontSize: 32 } },
            ],
          },
        ],
      },
      80,
      defaultFormat,
    );
    expect(result.lines.length).toBeGreaterThanOrEqual(1);
    expect(result.lines[0]?.runs.length).toBeGreaterThanOrEqual(1);
    // The big run should have a larger font size.
    expect(result.lines[0]?.runs.some((r) => r.format.fontSize === 32)).toBe(true);
  });

  it('marks overflow when text exceeds max lines', () => {
    const result = layoutRichText(
      {
        paragraphs: [
          {
            runs: [{ text: 'A B C D E F G H I J' }],
            format: { maxLines: 2 },
          },
        ],
      },
      30,
      defaultFormat,
    );
    expect(result.lines.length).toBeLessThanOrEqual(2);
    expect(result.overset).toBe(true);
  });

  it('produces canvas-ready font strings per run', () => {
    const result = layoutRichText(
      {
        paragraphs: [
          {
            runs: [{ text: 'Test', format: { fontWeight: 700, fontStyle: 'italic' } }],
          },
        ],
      },
      200,
      defaultFormat,
    );
    const run = result.lines[0]?.runs[0];
    expect(run?.font).toContain('italic');
    expect(run?.font).toContain('700');
    expect(run?.font).toContain('16px');
    expect(run?.font).toContain('sans-serif');
  });

  it('builds feature and variation settings per run', () => {
    const result = layoutRichText(
      {
        paragraphs: [
          {
            runs: [
              {
                text: 'Fancy',
                format: {
                  openTypeFeatures: { liga: true, kern: false },
                  variableFontSettings: { wght: 500 },
                },
              },
            ],
          },
        ],
      },
      200,
      defaultFormat,
    );
    const run = result.lines[0]?.runs[0];
    expect(run?.featureSettings).toContain('font-feature-settings');
    expect(run?.variationSettings).toContain('font-variation-settings');
  });
});
