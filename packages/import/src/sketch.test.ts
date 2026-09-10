import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createSketchParser } from './sketch';

function sketchZip(entries: Record<string, unknown>): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(entries)) {
    files[name] = strToU8(typeof value === 'string' ? value : JSON.stringify(value));
  }
  return zipSync(files);
}

describe('createSketchParser', () => {
  it('imports Sketch ZIP pages into editable groups, shapes, and text', () => {
    const bytes = sketchZip({
      'document.json': { _class: 'document', pages: [{ _ref: 'pages/page-1' }] },
      'pages/page-1.json': {
        _class: 'page',
        name: 'Landing',
        layers: [
          {
            _class: 'group',
            name: 'Hero',
            frame: { x: 10, y: 20, width: 300, height: 200 },
            layers: [
              {
                _class: 'rectangle',
                name: 'CTA',
                frame: { x: 12, y: 16, width: 120, height: 40 },
              },
              {
                _class: 'text',
                name: 'Headline',
                frame: { x: 20, y: 70, width: 200, height: 32 },
                attributedString: { string: 'Design faster' },
              },
            ],
          },
        ],
      },
    });

    const result = createSketchParser().parse(bytes);

    expect(result.nodeIds).toHaveLength(1);
    const root = result.document.nodes[result.nodeIds[0]!];
    expect(root).toMatchObject({ kind: 'group', name: 'Hero' });
    expect(root && 'children' in root ? root.children : []).toHaveLength(2);
    expect(Object.values(result.document.nodes).some((n) => n.kind === 'text')).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Sketch import is partial: symbols, overrides, shared styles, and constraints are approximated',
      ]),
    );
  });

  it('rejects Sketch ZIP entries that try to escape the archive root', () => {
    const bytes = sketchZip({
      '../evil.json': '{}',
      'document.json': { _class: 'document' },
    });

    const result = createSketchParser().parse(bytes);

    expect(result.nodeIds).toHaveLength(0);
    expect(result.warnings.join('\n')).toContain('unsafe path');
  });

  it.each(['C:/Windows/System32/file', 'file:///etc/passwd', 'pages/./page.json'])(
    'rejects non-portable Sketch entry %s',
    (entryName) => {
      const result = createSketchParser().parse(
        sketchZip({ [entryName]: '{}', 'document.json': { _class: 'document' } }),
      );
      expect(result.warnings.join('\n')).toContain('unsafe path');
    },
  );
});
