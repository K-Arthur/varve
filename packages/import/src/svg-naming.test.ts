import { describe, expect, it } from 'vitest';
import { parseSvg } from './svg';
import { isMeaningfulLayerName, parseAttrs, svgLayerName } from './svg/shared';

describe('isMeaningfulLayerName', () => {
  it('accepts authored names from design tools', () => {
    for (const name of ['Status Bar', 'Card 1 Title', 'hero_background', 'Group 2']) {
      expect(isMeaningfulLayerName(name), name).toBe(true);
    }
  });

  it('rejects machine identifiers and empty values', () => {
    for (const name of [
      '',
      '12',
      'deadbeefdeadbeef',
      '3f2a1b4c-1111-2222-3333-444455556666',
      'path1234',
      'rect',
      'Group',
      'linearGradient3',
      'clipPath',
      'text',
      'XMLID_000000',
    ]) {
      expect(isMeaningfulLayerName(name), name).toBe(false);
    }
  });

  it('rejects names beyond the length cap', () => {
    expect(isMeaningfulLayerName('Long layer name '.repeat(9))).toBe(false);
    expect(isMeaningfulLayerName('Long layer name '.repeat(7).trim())).toBe(true);
  });
});

describe('svgLayerName', () => {
  function el(attrs: Record<string, string>) {
    return { tag: 'rect', attrs, children: [], textContent: '' };
  }

  it('prefers aria-label, then inkscape:label, then data-name, then id', () => {
    expect(svgLayerName(el({ 'aria-label': 'From ARIA', id: 'from-id' }), 'Rectangle')).toBe(
      'From ARIA',
    );
    expect(
      svgLayerName(el({ 'inkscape:label': 'From Inkscape', id: 'from-id' }), 'Rectangle'),
    ).toBe('From Inkscape');
    expect(svgLayerName(el({ 'data-name': 'From data-name', id: 'from-id' }), 'Rectangle')).toBe(
      'From data-name',
    );
    expect(svgLayerName(el({ id: 'from-id' }), 'Rectangle')).toBe('from-id');
  });

  it('falls back to the element type when the export has only generated ids', () => {
    expect(svgLayerName(el({ id: 'path1234' }), 'Path')).toBe('Path');
    expect(svgLayerName(el({}), 'Rectangle')).toBe('Rectangle');
  });

  it('decodes XML entities in authored names', () => {
    expect(svgLayerName(el({ id: 'Ben &amp; Jerry&#x27;s' }), 'Rectangle')).toBe("Ben & Jerry's");
  });

  it('reads namespaced xml:id', () => {
    expect(svgLayerName(el({ 'xml:id': 'Namespaced' }), 'Rectangle')).toBe('Namespaced');
  });
});

describe('parseSvg layer naming', () => {
  it('names imported layers from ids so the Layers panel stays navigable', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
      <g id="Hero Card">
        <rect id="Card Surface" x="0" y="0" width="200" height="100" fill="#fff"/>
        <text id="Card Title" x="10" y="50">Hello</text>
      </g>
      <rect id="rect1234" x="0" y="80" width="10" height="10" fill="#000"/>
    </svg>`;
    const result = parseSvg(svg);
    const names = Object.values(result.document.nodes).map((node) => node.name);
    expect(names).toContain('Hero Card');
    expect(names).toContain('Card Surface');
    expect(names).toContain('Card Title');
    // A generated exporter id still falls back to the element type.
    expect(names).toContain('Rectangle');
    expect(names).not.toContain('rect1234');
  });

  it('parses namespaced label attributes', () => {
    expect(parseAttrs('inkscape:label="Layers" id="g1"')).toEqual({
      'inkscape:label': 'Layers',
      id: 'g1',
    });
  });
});
