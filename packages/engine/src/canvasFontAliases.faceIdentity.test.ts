// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canResolveCanvasFontFamily,
  resetCanvasFontAliases,
  resolveCanvasFontFamily,
} from './canvasFontAliases';

describe('canvas font aliases and exact face identity', () => {
  let originalStyleSheets: StyleSheetList;

  beforeEach(() => {
    resetCanvasFontAliases();
    originalStyleSheets = document.styleSheets;
    const rule = (source: string, faceKey: string) => ({
      style: {
        getPropertyValue: (property: string) =>
          ({
            'font-family': '"Shared Sans"',
            src: source,
            'font-weight': '400',
            '--varve-face-key': faceKey,
          })[property] ?? '',
      },
    });
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: [
        {
          cssRules: [
            rule('url("/first.woff2") format("woff2")', 'sha256:first:single'),
            rule('url("/second.woff2") format("woff2")', 'sha256:second:single'),
          ],
        },
      ],
    });
  });

  afterEach(() => {
    resetCanvasFontAliases();
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: originalStyleSheets,
    });
  });

  it('isolates an alias to the requested same-family artifact', () => {
    const alias = resolveCanvasFontFamily(
      'Shared Sans',
      undefined,
      undefined,
      'Exact face',
      'sha256:second:single',
    );

    expect(alias).not.toBe('Shared Sans');
    expect(
      canResolveCanvasFontFamily('Shared Sans', undefined, undefined, 'sha256:second:single'),
    ).toBe(true);
    expect(
      canResolveCanvasFontFamily('Shared Sans', undefined, undefined, 'sha256:missing:single'),
    ).toBe(false);
    expect(document.querySelector('style#varve-canvas-font-aliases')?.textContent).toContain(
      '/second.woff2',
    );
    expect(document.querySelector('style#varve-canvas-font-aliases')?.textContent).not.toContain(
      '/first.woff2',
    );
  });
});
