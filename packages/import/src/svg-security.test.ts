/**
 * SVG is untrusted document content. These tests pin the two properties that
 * matter and that a refactor could quietly lose: nothing in an imported SVG
 * executes, and nothing in an imported SVG causes Varve to fetch a resource
 * the file did not carry itself.
 *
 * The remote-href case is not theoretical. An `<image>` href survives parsing
 * as an image fill `src`, and the engine's image cache loads any non-inline
 * source with `new Image()` — so before the policy landed, opening a file
 * someone sent you issued a silent outbound request to whatever URL it named.
 */

import { describe, expect, it } from 'vitest';
import { ImportService } from './service';
import { parseSvg } from './svg';

/** Every image-fill src the parse produced, at any depth. */
function imageSources(svg: string): string[] {
  const result = parseSvg(svg);
  const out: string[] = [];
  for (const node of Object.values(result.document.nodes)) {
    const fills = (node as { fills?: { type: string; image?: { src?: string } }[] }).fills ?? [];
    for (const fill of fills) {
      if (fill.type === 'image' && fill.image?.src) out.push(fill.image.src);
    }
  }
  return out;
}

const REMOTE_HREFS = [
  'https://tracker.example.com/beacon.png?id=abc123',
  'http://tracker.example.com/beacon.png',
  '//tracker.example.com/beacon.png',
  '/absolute/path/on/origin.png',
  '../relative/sibling.png',
];

describe('SVG import resource policy', () => {
  it.each(REMOTE_HREFS)('never carries the external href %s into the scene', (href) => {
    const svg = `<svg><image href="${href}" width="40" height="40"/></svg>`;
    expect(imageSources(svg)).toEqual([]);
  });

  it('reports the external reference instead of dropping it silently', () => {
    const result = parseSvg(
      '<svg><image href="https://tracker.example.com/b.png" width="10" height="10"/></svg>',
    );
    expect(result.unsupportedFeatures).toContain('SVG image referencing an external resource');
  });

  it('keeps data: image payloads, which the file already carries', () => {
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l5fNwAAAAABJRU5ErkJggg==';
    const svg = `<svg><image href="${dataUrl}" width="10" height="10"/></svg>`;
    expect(imageSources(svg)).toEqual([dataUrl]);
  });

  it('refuses script-bearing and local-file hrefs', () => {
    for (const href of ['javascript:alert(1)', 'file:///etc/passwd', 'vbscript:msgbox']) {
      const result = parseSvg(`<svg><image href="${href}" width="10" height="10"/></svg>`);
      expect(imageSources(`<svg><image href="${href}" width="10" height="10"/></svg>`)).toEqual([]);
      expect(result.unsupportedFeatures).toContain(
        'SVG image with an executable or local-file href',
      );
    }
  });

  it('honours xlink:href with the same policy', () => {
    const svg =
      '<svg><image xlink:href="https://tracker.example.com/b.png" width="9" height="9"/></svg>';
    expect(imageSources(svg)).toEqual([]);
  });
});

describe('SVG import active content', () => {
  it('drops <script> and says so, while still importing the artwork', () => {
    const result = parseSvg(
      '<svg><script>alert(1)</script><rect width="5" height="5" fill="red"/></svg>',
    );
    expect(result.nodeIds).toHaveLength(1);
    expect(result.unsupportedFeatures).toContain(
      'SVG <script> (removed; imported artwork never executes script)',
    );
    expect(JSON.stringify(result.document)).not.toContain('alert(1)');
  });

  it('drops <foreignObject> HTML rather than importing it', () => {
    const result = parseSvg(
      '<svg><foreignObject width="10" height="10"><div onclick="alert(1)">x</div></foreignObject><rect width="5" height="5"/></svg>',
    );
    expect(result.unsupportedFeatures).toContain(
      'SVG <foreignObject> (HTML content is not imported)',
    );
    expect(JSON.stringify(result.document)).not.toContain('onclick');
  });

  it('never copies inline event handlers onto scene nodes', () => {
    const result = parseSvg(
      '<svg><rect width="5" height="5" onclick="alert(1)" onload="x()"/></svg>',
    );
    const serialized = JSON.stringify(result.document);
    expect(serialized).not.toContain('onclick');
    expect(serialized).not.toContain('alert(1)');
  });

  it('refuses to follow an external <use> reference', () => {
    const result = parseSvg('<svg><use href="https://evil.example.com/x.svg#icon"/></svg>');
    expect(result.nodeIds).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/references unknown id/);
  });

  it('terminates on a cyclic <use> instead of hanging', () => {
    const result = parseSvg(
      '<svg><defs><g id="a"><use href="#a"/></g></defs><use href="#a"/></svg>',
    );
    expect(result.warnings.join(' ')).toMatch(/Circular <use>/);
  });
});

describe('SVG import reporting through ImportService', () => {
  it('marks a remote-image SVG partial and surfaces the reason', async () => {
    const report = await ImportService.importFiles([
      {
        name: 'logo.svg',
        source: 'file-picker',
        text: '<svg><rect width="10" height="10"/><image href="https://tracker.example.com/b.png" width="10" height="10"/></svg>',
      },
    ]);
    const file = report.files[0]!;
    expect(file.status).toBe('partial');
    expect(file.unsupportedFeatures.map((f) => f.feature)).toContain(
      'SVG image referencing an external resource',
    );
  });
});
