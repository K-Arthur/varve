// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { resolveCanvasFontSource } from './canvasOpenTypeRenderer';

describe('canvas font source privacy boundary', () => {
  it('keeps data and same-origin sources available', () => {
    expect(resolveCanvasFontSource('url(data:font/woff2;base64,AA==)')).toBe(
      'data:font/woff2;base64,AA==',
    );
    expect(resolveCanvasFontSource('url(/fonts/fixture.woff2) format("woff2")')).toBe(
      'http://localhost:3000/fonts/fixture.woff2',
    );
  });

  it('skips local() and remote sources without crossing the origin', () => {
    expect(
      resolveCanvasFontSource(
        'local("Fixture Sans"), url(https://fonts.example.test/fixture.woff2) format("woff2")',
      ),
    ).toBeNull();
  });

  it('uses a later same-origin source after a local or remote candidate', () => {
    expect(
      resolveCanvasFontSource(
        'local("Fixture Sans"), url(https://fonts.example.test/fixture.woff2), url(/fonts/local.woff2)',
      ),
    ).toBe('http://localhost:3000/fonts/local.woff2');
  });
});
