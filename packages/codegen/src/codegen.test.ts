import type { Document as SceneDoc } from '@strata/scene';
import { addNode, createDocument, makeShapeNode, nextNodeId } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { exportNodeToCss } from './css';
import { exportNodeToCssModules } from './css-modules';
import { exportNodeToFlutter } from './flutter';
import { exportDocumentToReact, exportDocumentToSvg } from './index';
import { exportNodeToSvg } from './svg';
import { exportNodeToSwiftUI } from './swiftui';
import { exportNodeToTailwind } from './tailwind';

describe('exportNodeToSvg', () => {
  it('emits SVG for a rect shape', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }, { name: 'Box' });
    const out = exportNodeToSvg(node, doc);
    expect(out).toContain('<svg');
    expect(out).toContain('</svg>');
    expect(out).toContain('rect');
  });
});

describe('exportNodeToCss', () => {
  it('emits CSS class with position and size', () => {
    const doc: SceneDoc = createDocument('Test');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 10, y: 20, w: 200, h: 100 },
      { name: 'Box', transform: [1, 0, 0, 1, 50, 60] },
    );
    const css = exportNodeToCss(node, doc, { unit: 'px' });
    expect(css).toContain('.box');
    expect(css).toContain('left: 60px');
    expect(css).toContain('top: 80px');
    expect(css).toContain('width: 200px');
    expect(css).toContain('height: 100px');
  });
});

describe('exportNodeToTailwind', () => {
  it('emits Tailwind classes with arbitrary values', () => {
    const doc: SceneDoc = createDocument('Test');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      { name: 'Rect', fill: [57, 208, 198, 255] },
    );
    const tw = exportNodeToTailwind(node, doc);
    expect(tw).toContain('absolute');
    expect(tw).toContain('w-[100px]');
    expect(tw).toContain('h-[50px]');
    expect(tw).toContain('bg-[');
  });
});

describe('exportNodeToCssModules', () => {
  it('emits JSX + CSS pair', () => {
    const doc: SceneDoc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Box' });
    const { jsx, css } = exportNodeToCssModules(node, doc);
    expect(jsx).toContain('import styles');
    expect(css).toContain('width: 100px');
  });
});

describe('exportNodeToFlutter', () => {
  it('emits Flutter container widget', () => {
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 10, y: 20, w: 200, h: 100 },
      { name: 'Box' },
    );
    const fl = exportNodeToFlutter(node);
    expect(fl).toContain('Positioned');
    expect(fl).toContain('Container');
  });
});

describe('exportNodeToSwiftUI', () => {
  it('emits SwiftUI view', () => {
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }, { name: 'Box' });
    const sw = exportNodeToSwiftUI(node);
    expect(sw).toContain('.frame');
    expect(sw).toContain('.position');
  });
});

describe('legacy exports', () => {
  it('exportDocumentToSvg still works', () => {
    let doc: SceneDoc = createDocument('Test');
    const r = nextNodeId(doc);
    doc = addNode(
      r.doc,
      makeShapeNode(r.id, { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Box' }),
    );
    const svg = exportDocumentToSvg(doc);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 1920 1080"');
  });

  it('exportDocumentToReact still works', () => {
    let doc: SceneDoc = createDocument('Test');
    const r = nextNodeId(doc);
    doc = addNode(
      r.doc,
      makeShapeNode(r.id, { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Box' }),
    );
    const react = exportDocumentToReact(doc);
    expect(react).toContain('ExportedScene');
    expect(react).toContain('<rect');
  });
});
