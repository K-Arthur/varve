import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { makeTextNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlyphTypographySection } from './GlyphTypographySection';

vi.mock('../../context', () => ({ useEditor: () => ({ updateDoc: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('glyph inspector', () => {
  it('keeps segmentation work linear when listing long text', () => {
    const segment = Intl.Segmenter.prototype.segment;
    let processedCharacters = 0;
    vi.spyOn(Intl.Segmenter.prototype, 'segment').mockImplementation(function (
      this: Intl.Segmenter,
      text,
    ) {
      processedCharacters += text.length;
      return segment.call(this, text);
    });
    const text = 'A'.repeat(500);
    render(<GlyphTypographySection node={makeTextNode('text', text)} />);
    // A budget on work rather than wall time catches repeated full-text
    // segmentation without depending on how fast the test machine is.
    expect(processedCharacters).toBeLessThan(text.length * 20);
  });

  it('preserves combined graphemes and visible whitespace in cluster labels', async () => {
    render(<GlyphTypographySection node={makeTextNode('text', 'e\u0301 A')} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Cluster' }));
    expect(await screen.findByRole('option', { name: '1 · e\u0301' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: '2 · ␣' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: '3 · A' })).toBeInTheDocument();
  });
});
