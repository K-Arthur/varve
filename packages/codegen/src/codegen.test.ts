import type { Document as SceneDoc } from '@strata/scene';
import { addNode, createDocument, makeFrameNode, makeGroupNode, makeShapeNode, makeTextNode, nextNodeId } from '@strata/scene';
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
  it('emits Positioned/Container for a shape', () => {
    const node = makeShapeNode('n1', { kind: 'rect', x: 10, y: 20, w: 200, h: 100 }, { name: 'Box' });
    const fl = exportNodeToFlutter(node);
    expect(fl).toContain('Positioned(');
    expect(fl).toContain('Container(');
    expect(fl).toContain('left: 10');
    expect(fl).toContain('top: 20');
    expect(fl).toContain('width: 200');
    expect(fl).toContain('height: 100');
  });

  it('emits Text widget for a text node', () => {
    const node = makeTextNode('t1', 'Hello', { fontSize: 24 });
    const fl = exportNodeToFlutter(node);
    expect(fl).toContain("Text(");
    expect(fl).toContain("'Hello'");
    expect(fl).toContain('fontSize: 24');
  });

  it('emits Row with spacing for a frame with Row layout', () => {
    let doc = createDocument('Test');
    const child = makeShapeNode('c1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }, { name: 'Child' });
    const frame = makeFrameNode('f1', { name: 'RowFrame', children: ['c1'] });
    frame.layoutStyle = { mode: 'flex', direction: 'row', gap: 12, wrap: false, padding: [0, 0, 0, 0], grow: 0, shrink: 0 };
    doc = addNode(doc, child);
    doc = addNode(doc, frame);
    const fl = exportNodeToFlutter(frame, doc);
    expect(fl).toContain('Row(');
    expect(fl).toContain('spacing: 12');
    expect(fl).toContain('children: [');
  });

  it('emits Stack for a group with children', () => {
    let doc = createDocument('Test');
    const child = makeShapeNode('c1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }, { name: 'Child' });
    const group = makeGroupNode('g1', { name: 'Group', children: ['c1'] });
    doc = addNode(doc, child);
    doc = addNode(doc, group);
    const fl = exportNodeToFlutter(group, doc);
    expect(fl).toContain('Stack(');
    expect(fl).toContain('children: [');
  });
});

describe('exportNodeToSwiftUI', () => {
  it('emits .frame/.position for a shape', () => {
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }, { name: 'Box' });
    const sw = exportNodeToSwiftUI(node);
    expect(sw).toContain('.frame(width: 200');
    expect(sw).toContain('.position');
  });

  it('emits Text with font for a text node', () => {
    const node = makeTextNode('t1', 'Hello', { fontSize: 24 });
    const sw = exportNodeToSwiftUI(node);
    expect(sw).toContain('Text("Hello")');
    expect(sw).toContain('.font(.system(size: 24))');
  });

  it('emits HStack for a frame with Row layout', () => {
    let doc = createDocument('Test');
    const child = makeShapeNode('c1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }, { name: 'Child' });
    const frame = makeFrameNode('f1', { name: 'RowFrame', children: ['c1'] });
    frame.layoutStyle = { mode: 'flex', direction: 'row', gap: 8, wrap: false, padding: [0, 0, 0, 0], grow: 0, shrink: 0 };
    doc = addNode(doc, child);
    doc = addNode(doc, frame);
    const sw = exportNodeToSwiftUI(frame, doc);
    expect(sw).toContain('HStack(');
    expect(sw).toContain('spacing: 8');
  });

  it('emits ZStack for a group with children', () => {
    let doc = createDocument('Test');
    const child = makeShapeNode('c1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }, { name: 'Child' });
    const group = makeGroupNode('g1', { name: 'Group', children: ['c1'] });
    doc = addNode(doc, child);
    doc = addNode(doc, group);
    const sw = exportNodeToSwiftUI(group, doc);
    expect(sw).toContain('ZStack {');
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
