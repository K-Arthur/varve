import type { Document as SceneDoc } from '@varve/scene';
import {
  addChild,
  addNode,
  colorConfigWithDefaults,
  createDocument,
  createVariableStore,
  imageFill,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
  nextNodeId,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportNodeToCss } from './css';
import { exportNodeToCssModules } from './css-modules';
import { exportNodeToFlutter } from './flutter';
import { exportIrToHtml } from './html';
import {
  exportDocumentToReact,
  exportDocumentToSvg,
  exportNodeToReact,
  resolveTokenName,
} from './index';
import { sceneToIR } from './ir-converter';
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

  it('minifies output when requested, preserving structure', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }, { name: 'Box' });
    const pretty = exportNodeToSvg(node, doc);
    const minified = exportNodeToSvg(node, doc, { minify: true });
    expect(minified.length).toBeLessThan(pretty.length);
    expect(minified).toContain('<svg');
    expect(minified).toContain('</svg>');
    expect(minified).not.toContain('\n');
    expect(minified).toContain('<rect');
    expect(minified).toContain('viewBox=');
  });

  it('emits multi-line text as tspan elements', () => {
    const doc = createDocument('Test');
    const node = makeTextNode('t1', 'Line 1\nLine 2', {
      fontSize: 16,
      fontFamily: 'Inter',
      lineHeight: 1.4,
    });
    const out = exportNodeToSvg(node, doc);
    expect(out).toContain('<tspan');
    expect(out).toContain('Line 1');
    expect(out).toContain('Line 2');
  });

  it('emits rich text with per-run tspan elements', () => {
    const doc = createDocument('Test');
    const node = makeTextNode('t1', 'Hello World', {
      fontSize: 16,
      fontFamily: 'Inter',
      richText: {
        paragraphs: [
          {
            runs: [
              { text: 'Hello', format: { fontWeight: 400 } },
              { text: 'World', format: { fontWeight: 700, fontSize: 20 } },
            ],
          },
        ],
      },
      variableAxes: { wght: 500 },
      openTypeFeatures: { liga: true },
    });
    const out = exportNodeToSvg(node, doc);
    expect(out).toContain('<tspan');
    expect(out).toContain('font-weight="700"');
    expect(out).toContain('font-size="20"');
    expect(out).toContain('font-variation-settings');
    expect(out).toContain('font-feature-settings');
  });

  it('emits direction="rtl" and unicode-bidi for RTL text nodes', () => {
    const doc = createDocument('Test');
    const node = makeTextNode('t1', 'مرحبا', {
      fontSize: 16,
      fontFamily: 'Inter',
      direction: 'rtl',
    });
    const out = exportNodeToSvg(node, doc);
    expect(out).toContain('direction="rtl"');
    expect(out).toContain('unicode-bidi="bidi-override"');
  });

  it('emits direction="rtl" for rich text with RTL paragraph', () => {
    const doc = createDocument('Test');
    const node = makeTextNode('t1', 'مرحبا', {
      fontSize: 16,
      fontFamily: 'Inter',
      direction: 'rtl',
      richText: {
        paragraphs: [
          {
            format: { direction: 'rtl' },
            runs: [{ text: 'مرحبا', format: { fontWeight: 400 } }],
          },
        ],
      },
    });
    const out = exportNodeToSvg(node, doc);
    expect(out).toContain('direction="rtl"');
  });

  it('does not emit direction for LTR text nodes', () => {
    const doc = createDocument('Test');
    const node = makeTextNode('t1', 'Hello', {
      fontSize: 16,
      fontFamily: 'Inter',
      direction: 'ltr',
    });
    const out = exportNodeToSvg(node, doc);
    expect(out).not.toContain('direction=');
    expect(out).not.toContain('unicode-bidi=');
  });

  it('preserves opacity and extended blend modes', () => {
    const doc = createDocument('Blend SVG');
    const node = makeShapeNode(
      'blend',
      { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
      { opacity: 0.25, blendMode: 'plusDarker' },
    );

    const out = exportNodeToSvg(node, doc);

    expect(out).toContain('opacity="0.25"');
    expect(out).toContain('style="mix-blend-mode: plus-darker;"');
  });

  it('emits <textPath> for text in path mode', () => {
    let doc = createDocument('Path text SVG');
    const circle = makeShapeNode(
      'circle-1',
      { kind: 'circle', cx: 100, cy: 100, r: 80 },
      { name: 'Ring' },
    );
    const text = makeTextNode('text-1', 'HELLO', {
      name: 'Label',
      textMode: 'path',
      pathTextSettings: { pathNodeId: 'circle-1', startOffset: 0.25, side: 'top' },
    });
    doc = addNode(doc, circle);
    doc = addNode(doc, text);
    doc.rootChildren.push(circle.id, text.id);
    const svg = exportNodeToSvg(text, doc);
    expect(svg).toContain('<textPath');
    expect(svg).toContain('href="#varve-circle-1--text-1"');
    expect(svg).toContain('startOffset="25%"');
    expect(svg).toContain('<defs>');
    expect(svg).toContain('<path id="varve-circle-1--text-1"');
  });

  it('emits textLength when fitToPath is enabled', () => {
    let doc = createDocument('Fit text SVG');
    const circle = makeShapeNode(
      'circle-1',
      { kind: 'circle', cx: 100, cy: 100, r: 80 },
      { name: 'Ring' },
    );
    const text = makeTextNode('text-1', 'FIT ME', {
      name: 'FitLabel',
      textMode: 'path',
      pathTextSettings: {
        pathNodeId: 'circle-1',
        startOffset: 0.25,
        endOffset: 0.75,
        side: 'top',
        fitToPath: true,
      },
    });
    doc = addNode(doc, circle);
    doc = addNode(doc, text);
    doc.rootChildren.push(circle.id, text.id);
    const svg = exportNodeToSvg(text, doc);
    expect(svg).toContain('textLength=');
    expect(svg).toContain('lengthAdjust="spacing"');
  });

  it('falls back to flat text when referenced path is missing', () => {
    const doc = createDocument('Orphan path text');
    const text = makeTextNode('text-1', 'LOST', {
      name: 'Orphan',
      textMode: 'path',
      pathTextSettings: { pathNodeId: 'missing-1', startOffset: 0, side: 'top' },
    });
    addNode(doc, text);
    doc.rootChildren.push(text.id);
    const svg = exportNodeToSvg(text, doc);
    expect(svg).toContain('<!-- varve: path text');
    expect(svg).toContain('LOST');
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

  it('escapes image URLs before embedding them in a CSS string', () => {
    const doc = createDocument('CSS image');
    const base = makeShapeNode('img', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const node = {
      ...base,
      fills: [imageFill('asset.png"); color: red; /*', { fit: 'fill' })],
    };

    const css = exportNodeToCss(node, doc);

    expect(css).toContain('background-image: url("asset.png\\"); color: red; /*")');
    expect(css).not.toContain('url("asset.png"); color: red');
  });
});

describe('exportNodeToTailwind', () => {
  it('emits Tailwind classes with arbitrary values', () => {
    const doc: SceneDoc = createDocument('Test');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      { name: 'Rect', fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } },
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
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 10, y: 20, w: 200, h: 100 },
      { name: 'Box' },
    );
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
    expect(fl).toContain('Text(');
    expect(fl).toContain("'Hello'");
    expect(fl).toContain('fontSize: 24');
  });

  it('emits Row with spacing for a frame with Row layout', () => {
    let doc = createDocument('Test');
    const child = makeShapeNode(
      'c1',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      { name: 'Child' },
    );
    const frame = makeFrameNode('f1', { name: 'RowFrame', children: ['c1'] });
    frame.layoutStyle = {
      mode: 'flex',
      direction: 'row',
      gap: 12,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 0,
    };
    doc = addNode(doc, child);
    doc = addNode(doc, frame);
    const fl = exportNodeToFlutter(frame, doc);
    expect(fl).toContain('Row(');
    expect(fl).toContain('spacing: 12');
    expect(fl).toContain('children: [');
  });

  it('emits Stack for a group with children', () => {
    let doc = createDocument('Test');
    const child = makeShapeNode(
      'c1',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      { name: 'Child' },
    );
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
    const child = makeShapeNode(
      'c1',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      { name: 'Child' },
    );
    const frame = makeFrameNode('f1', { name: 'RowFrame', children: ['c1'] });
    frame.layoutStyle = {
      mode: 'flex',
      direction: 'row',
      gap: 8,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 0,
    };
    doc = addNode(doc, child);
    doc = addNode(doc, frame);
    const sw = exportNodeToSwiftUI(frame, doc);
    expect(sw).toContain('HStack(');
    expect(sw).toContain('spacing: 8');
  });

  it('emits ZStack for a group with children', () => {
    let doc = createDocument('Test');
    const child = makeShapeNode(
      'c1',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      { name: 'Child' },
    );
    const group = makeGroupNode('g1', { name: 'Group', children: ['c1'] });
    doc = addNode(doc, child);
    doc = addNode(doc, group);
    const sw = exportNodeToSwiftUI(group, doc);
    expect(sw).toContain('ZStack {');
  });
});

describe('resolveTokenName', () => {
  it('returns token name for bound property', () => {
    const store = createVariableStore();
    store.variables.v1 = {
      id: 'v1',
      name: 'primary',
      type: 'color',
      valuesByMode: { default: 'rgba(57,208,198,1.00)' },
    };
    const name = resolveTokenName({ fill: { variableId: 'v1' } }, 'fill', store);
    expect(name).toBe('primary');
  });

  it('returns undefined when no bindings', () => {
    const store = createVariableStore();
    expect(resolveTokenName(undefined, 'fill', store)).toBeUndefined();
  });

  it('returns undefined when property not bound', () => {
    const store = createVariableStore();
    expect(resolveTokenName({}, 'fill', store)).toBeUndefined();
  });

  it('returns undefined when variable not in store', () => {
    const store = createVariableStore();
    expect(resolveTokenName({ fill: { variableId: 'missing' } }, 'fill', store)).toBeUndefined();
  });
});

describe('token-aware codegen', () => {
  function nodeWithBindings(store: ReturnType<typeof createVariableStore>) {
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      { name: 'Box', fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } },
    );
    (node as unknown as Record<string, unknown>).bindings = { fill: { variableId: 'v1' } };
    store.variables.v1 = {
      id: 'v1',
      name: 'primary',
      type: 'color',
      valuesByMode: { default: 'rgba(57,208,198,1.00)' },
    };
    return node;
  }

  it('CSS emits var(--token-name) when fill is bound', () => {
    const doc: SceneDoc = createDocument('Test');
    const store = createVariableStore();
    const node = nodeWithBindings(store);
    const css = exportNodeToCss(node, doc, { variableStore: store });
    expect(css).toContain('var(--primary)');
    expect(css).not.toContain('#39d0c6');
  });

  it('CSS falls back to raw color when no bindings', () => {
    const doc: SceneDoc = createDocument('Test');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      { name: 'Box', fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } },
    );
    const css = exportNodeToCss(node, doc);
    expect(css).toContain('#39d0c6');
    expect(css).not.toContain('var(--');
  });

  it('Tailwind emits bg-[--token-name] when fill is bound', () => {
    const doc: SceneDoc = createDocument('Test');
    const store = createVariableStore();
    const node = nodeWithBindings(store);
    const tw = exportNodeToTailwind(node, doc, { variableStore: store });
    expect(tw).toContain('bg-[--primary]');
    expect(tw).not.toContain('bg-[#39d0c6]');
  });

  it('Tailwind falls back to raw value when no bindings', () => {
    const doc: SceneDoc = createDocument('Test');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      { name: 'Box', fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } },
    );
    const tw = exportNodeToTailwind(node, doc);
    expect(tw).toContain('bg-[#39d0c6]');
  });

  it('CSS Modules emit var(--token-name) when fill is bound', () => {
    const doc: SceneDoc = createDocument('Test');
    const store = createVariableStore();
    const node = nodeWithBindings(store);
    const { css } = exportNodeToCssModules(node, doc, { variableStore: store });
    expect(css).toContain('var(--primary)');
    expect(css).not.toContain('#39d0c6');
  });

  it('Flutter emits VarveTokens extension field when fill is bound', () => {
    const doc: SceneDoc = createDocument('Test');
    const store = createVariableStore();
    const node = nodeWithBindings(store);
    const fl = exportNodeToFlutter(node, doc, { variableStore: store });
    expect(fl).toContain('Theme.of(context).extension<VarveTokens>()!.primary');
    expect(fl).not.toContain('Color(0xFF39D0C6)');
  });

  it('SwiftUI emits named Color when fill is bound', () => {
    const doc: SceneDoc = createDocument('Test');
    const store = createVariableStore();
    const node = nodeWithBindings(store);
    const sw = exportNodeToSwiftUI(node, doc, { variableStore: store });
    expect(sw).toContain('Color("primary")');
    expect(sw).not.toContain('Color(hex: "#39D0C6")');
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

  describe('gradient fill export', () => {
    it('emits linearGradient for linear gradient fills', () => {
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
        { name: 'GradBox' },
      );
      const fill: import('@varve/scene').Fill = {
        type: 'gradient',
        gradient: {
          type: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
        },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      };
      (node as unknown as Record<string, unknown>).fills = [fill];
      const svg = exportNodeToSvg(node, createDocument('Test'));
      expect(svg).toContain('<linearGradient');
      expect(svg).not.toContain('<radialGradient');
      expect(svg).toContain('url(#grad-');
    });

    it('emits radialGradient for radial gradient fills', () => {
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
        { name: 'RadialBox' },
      );
      const fill: import('@varve/scene').Fill = {
        type: 'gradient',
        gradient: {
          type: 'radial',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 255, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 } },
          ],
        },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      };
      (node as unknown as Record<string, unknown>).fills = [fill];
      const svg = exportNodeToSvg(node, createDocument('Test'));
      expect(svg).toContain('<radialGradient');
      expect(svg).toContain('cx="50%"');
      expect(svg).toContain('cy="50%"');
    });

    it('preserves gradient spread mode in SVG', () => {
      const node = makeShapeNode('spread', { kind: 'rect', x: 0, y: 0, w: 80, h: 40 });
      (node as unknown as Record<string, unknown>).fills = [
        {
          type: 'gradient',
          gradient: {
            type: 'linear',
            tilingMode: 'reflect',
            stops: [
              { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
              { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
            ],
          },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ];
      expect(exportNodeToSvg(node, createDocument('Spread'))).toContain('spreadMethod="reflect"');
    });

    it('preserves complete explicit affine geometry in linear and radial SVG gradients', () => {
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
        { name: 'Affine gradients' },
      );
      (node as unknown as Record<string, unknown>).fills = [
        {
          type: 'gradient',
          gradient: {
            type: 'linear',
            stops: [
              { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
              { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
            ],
            transform: [160, 80, -30, 45, 25, 15],
          },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
        {
          type: 'gradient',
          gradient: {
            type: 'radial',
            stops: [
              { position: 0, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
              { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
            ],
            transform: [160, 80, -30, 45, 25, 15],
          },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ];

      const svg = exportNodeToSvg(node, createDocument('Test'));

      expect(svg).toContain('gradientUnits="userSpaceOnUse"');
      expect(svg).toContain('x1="0" y1="0.5" x2="1" y2="0.5"');
      expect(svg).toContain('cx="0.5" cy="0.5" r="0.5"');
      expect(svg).toContain('gradientTransform="matrix(160,80,-30,45,25,15)"');
    });

    it('exports affine gradient strokes and descendant gradient definitions', () => {
      const child = makeShapeNode(
        'child',
        { kind: 'rect', x: 0, y: 0, w: 120, h: 60 },
        { name: 'Gradient child' },
      );
      (child as unknown as Record<string, unknown>).fills = [];
      (child as unknown as Record<string, unknown>).strokes = [
        {
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          weight: 4,
          align: 'center',
          dashPattern: [],
          dashOffset: 0,
          cap: 'round',
          join: 'miter',
          miterLimit: 4,
          visible: true,
          gradient: {
            type: 'linear',
            stops: [
              { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
              { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
            ],
            transform: [120, 20, -10, 60, 5, 8],
          },
        },
      ];
      const group = makeGroupNode('group', { name: 'Group', children: ['child'] });
      const doc = {
        ...createDocument('Stroke gradient'),
        rootChildren: ['group'],
        nodes: { group, child },
      };
      const svg = exportNodeToSvg(group, doc);
      expect(svg).toContain('id="grad-child-stroke-0"');
      expect(svg).toContain('stroke="url(#grad-child-stroke-0)"');
      expect(svg).toContain('gradientTransform="matrix(120,20,-10,60,5,8)"');
    });

    it('emits color-interpolation="linearRGB" for linear-srgb gradients', () => {
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
        { name: 'LinBox' },
      );
      const fill: import('@varve/scene').Fill = {
        type: 'gradient',
        gradient: {
          type: 'linear',
          interpolationSpace: 'linear-srgb',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
        },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      };
      (node as unknown as Record<string, unknown>).fills = [fill];
      const svg = exportNodeToSvg(node, createDocument('Test'));
      expect(svg).toContain('<linearGradient');
      expect(svg).toContain('color-interpolation="linearRGB"');
    });

    it('resolves a document-inherited gradient default during SVG export', () => {
      const base = createDocument('Document default');
      const doc = {
        ...base,
        colorConfig: {
          ...colorConfigWithDefaults(base.colorConfig),
          defaultGradientInterpolation: 'linear-srgb' as const,
        },
      };
      const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 });
      node.fills = [
        {
          type: 'gradient',
          gradient: {
            type: 'linear',
            interpolationSource: 'document',
            stops: [
              { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
              { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
            ],
          },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ];
      const svg = exportNodeToSvg(node, doc);
      expect(svg).toContain('color-interpolation="linearRGB"');
    });

    it('bakes an sRGB ramp for OKLCH gradients with a fidelity comment', () => {
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
        { name: 'OklchBox' },
      );
      const fill: import('@varve/scene').Fill = {
        type: 'gradient',
        gradient: {
          type: 'linear',
          interpolationSpace: 'oklch',
          hueInterpolation: 'shorter',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
        },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      };
      (node as unknown as Record<string, unknown>).fills = [fill];
      const svg = exportNodeToSvg(node, createDocument('Test'));
      // Baked ramp must exceed the two authored stops.
      const stopCount = (svg.match(/<stop /g) ?? []).length;
      expect(stopCount).toBeGreaterThan(2);
      expect(svg).toContain('baked to sRGB stops');
      expect(svg).not.toContain('color-interpolation="linearRGB"');
    });

    it('keeps authored sRGB stops without a color-interpolation attribute', () => {
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
        { name: 'SrgbBox' },
      );
      const fill: import('@varve/scene').Fill = {
        type: 'gradient',
        gradient: {
          type: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
        },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      };
      (node as unknown as Record<string, unknown>).fills = [fill];
      const svg = exportNodeToSvg(node, createDocument('Test'));
      expect(svg).not.toContain('color-interpolation');
      expect(svg).not.toContain('baked to sRGB stops');
    });

    it('carries interpolation metadata into HTML/CSS codegen', () => {
      const base = createDocument('HTML gradient');
      const doc = {
        ...base,
        colorConfig: {
          ...colorConfigWithDefaults(base.colorConfig),
          defaultGradientInterpolation: 'oklch' as const,
        },
      };
      const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 });
      node.fills = [
        {
          type: 'gradient',
          gradient: {
            type: 'linear',
            interpolationSource: 'document',
            hueInterpolation: 'shorter',
            stops: [
              { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
              { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
            ],
          },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ];
      const ir = sceneToIR(addNode(doc, node));
      const html = exportIrToHtml(ir, { includeReset: false, reducedMotion: false });
      expect(html.css).toContain('in oklch shorter hue');
    });

    it('flags angular gradient as needing raster fallback via svgTargetGaps', async () => {
      const { svgTargetGaps } = await import('./svg');
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
        { name: 'AngularBox' },
      );
      const fill: import('@varve/scene').Fill = {
        type: 'gradient',
        gradient: {
          type: 'angular',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 0.5, color: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
        },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      };
      (node as unknown as Record<string, unknown>).fills = [fill];
      const gaps = svgTargetGaps(node, createDocument('Test'));
      const gradGap = gaps.find((g) => g.feature?.includes('angular gradient'));
      expect(gradGap).toBeDefined();
      expect(gradGap!.severity).toBe('warning');
    });

    it('flags unsupported angular gradient strokes via svgTargetGaps', async () => {
      const { svgTargetGaps } = await import('./svg');
      const node = makeShapeNode(
        'stroke-gap',
        { kind: 'rect' },
        {
          strokes: [
            {
              color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
              weight: 2,
              align: 'center',
              dashPattern: [],
              dashOffset: 0,
              cap: 'round',
              join: 'miter',
              miterLimit: 4,
              visible: true,
              gradient: {
                type: 'angular',
                stops: [
                  { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
                  { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
                ],
              },
            },
          ],
        },
      );
      const gap = svgTargetGaps(node, createDocument('Test')).find((entry) =>
        entry.feature?.includes('angular gradient stroke'),
      );
      expect(gap?.severity).toBe('warning');
    });

    it('uses raster asset when provided for angular gradient shape', () => {
      const node = makeShapeNode(
        'n1',
        { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
        { name: 'AngularBox' },
      );
      const fill: import('@varve/scene').Fill = {
        type: 'gradient',
        gradient: {
          type: 'angular',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
        },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      };
      (node as unknown as Record<string, unknown>).fills = [fill];
      const rasterAssets = {
        n1: {
          nodeId: 'n1',
          dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==',
          pixelWidth: 200,
          pixelHeight: 100,
          cssWidth: 200,
          cssHeight: 100,
          dpi: 96,
        },
      };
      const svg = exportNodeToSvg(node, createDocument('Test'), { rasterAssets });
      expect(svg).toContain('<image');
      expect(svg).toContain('href="data:image/png;base64');
      expect(svg).toContain('width="200"');
    });
  });
});

describe('exportNodeToReact', () => {
  it('emits parseable TSX for a selected node and nested children', () => {
    const doc = createDocument('React export');
    const frame = makeFrameNode('frame', {
      transform: [1, 0, 0, 1, 32, 48],
      w: 360,
      h: 220,
    });
    const card = makeGroupNode('card', { name: 'Card' });
    const cardSurface = makeShapeNode(
      'card-surface',
      { kind: 'rect', x: 0, y: 0, w: 360, h: 220 },
      { name: 'Card surface' },
    );
    const title = makeTextNode('title', 'Pro <plan>', { fontSize: 24, name: 'Title' });
    const withFrame = addNode(doc, frame);
    const withCard = addChild(withFrame, 'frame', card);
    const withSurface = addChild(withCard, 'card', cardSurface);
    const withTitle = addChild(withSurface, 'card', title);
    const exported = exportNodeToReact(withTitle.nodes.frame!, withTitle);

    expect(exported).toContain('style={{ transform:');
    expect(exported).toContain('Pro &lt;plan&gt;');
    expect(exported).toContain('<rect');
    expect(exported).toContain('<text');

    const ts = require('typescript') as typeof import('typescript');
    const result = ts.transpileModule(exported, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
      reportDiagnostics: true,
    });
    expect(result.diagnostics ?? []).toHaveLength(0);
  });
});
