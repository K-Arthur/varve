import { describe, expect, it } from 'vitest';
import { parseClipboardRichText } from './clipboardRichText';

describe('parseClipboardRichText', () => {
  it('keeps paragraphs, line breaks, and supported inline formatting', () => {
    const result = parseClipboardRichText(
      '<p>Hello <strong>world</strong><br><span style="color:#ff0000">red</span></p><p><em>Next</em></p>',
    );
    expect(result?.plainText).toBe('Hello world\nred\nNext');
    expect(result?.richText.paragraphs[0]?.runs).toEqual([
      { text: 'Hello ' },
      { text: 'world', format: { fontWeight: 700 } },
      { text: '\n' },
      { text: 'red', format: { color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } } },
    ]);
    expect(result?.warnings).toEqual([]);
  });

  it('omits unsafe or external content and reports the loss', () => {
    const result = parseClipboardRichText(
      '<p>Keep</p><img src="https://example.com/a.png"><script>alert(1)</script>',
    );
    expect(result?.plainText).toBe('Keep');
    expect(result?.warnings).toEqual(
      expect.arrayContaining(['img content was omitted', 'script content was omitted']),
    );
  });

  it('rejects oversized HTML before parsing', () => {
    expect(parseClipboardRichText(`<p>${'x'.repeat(4 * 1024 * 1024)}</p>`)).toBeNull();
  });
});
