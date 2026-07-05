import { describe, it, expect } from 'vitest';
import {
  makeShapeNode,
  makeTextNode,
  makeFrameNode,
  makeGroupNode,
  makeImageNode,
  createDocument,
  addNode,
  addChild,
  createComponent,
  instantiate,
} from '@strata/scene';
import { suggestName, renameSelected } from './autoNamer';

function createTestDoc() {
  return createDocument('test');
}

describe('suggestName', () => {
  it('rule 1: component instance gets component name', () => {
    let doc = createTestDoc();
    const master = makeFrameNode('m1', { name: 'Card', w: 200, h: 300 });
    doc = addNode(doc, master);
    const { component, doc: d1 } = createComponent(doc, 'Card', 'm1', []);
    doc = d1;
    const { node: instance, doc: d2 } = instantiate(doc, component);
    doc = addNode(d2, instance);

    const result = suggestName(instance, doc);
    expect(result.name).toBe('Card instance');
    expect(result.confidence).toBe('high');
    expect(result.matchedRule).toBe('1-component-instance');
  });

  it('rule 2: text "Submit" gets "Button: Submit"', () => {
    const doc = createTestDoc();
    const text = makeTextNode('t1', 'Submit', { name: 'Text 1' });
    const result = suggestName(text, doc);
    expect(result.name).toBe('Button: Submit');
    expect(result.confidence).toBe('high');
    expect(result.matchedRule).toBe('2-text-button');
  });

  it('rule 2: text "Sign up now" gets "Button: Sign up now"', () => {
    const doc = createTestDoc();
    const text = makeTextNode('t1', 'Sign up now', { name: 'Text 1' });
    const result = suggestName(text, doc);
    expect(result.name).toBe('Button: Sign up now');
    expect(result.confidence).toBe('high');
  });

  it('rule 3: text with URL gets "Link: ..."', () => {
    const doc = createTestDoc();
    const text = makeTextNode('t1', 'https://example.com', { name: 'Text 1' });
    const result = suggestName(text, doc);
    expect(result.name).toBe('Link: https://example.com');
    expect(result.confidence).toBe('high');
    expect(result.matchedRule).toBe('3-text-link');
  });

  it('rule 3: text "Learn more" gets "Link: Learn more"', () => {
    const doc = createTestDoc();
    const text = makeTextNode('t1', 'Learn more', { name: 'Text 1' });
    const result = suggestName(text, doc);
    expect(result.name).toBe('Link: Learn more');
    expect(result.confidence).toBe('high');
  });

  it('rule 4: large bold text gets "Heading: ..."', () => {
    const doc = createTestDoc();
    const text = makeTextNode('t1', 'Welcome to Strata', {
      name: 'Text 1',
      fontSize: 32,
      fontWeight: 700,
    });
    const result = suggestName(text, doc);
    expect(result.name).toBe('Heading: Welcome to Strata');
    expect(result.confidence).toBe('high');
    expect(result.matchedRule).toBe('4-text-heading');
  });

  it('rule 4: large font size alone triggers heading', () => {
    const doc = createTestDoc();
    const text = makeTextNode('t1', 'Big Text', {
      name: 'Text 1',
      fontSize: 28,
      fontWeight: 400,
    });
    const result = suggestName(text, doc);
    expect(result.name).toBe('Heading: Big Text');
    expect(result.confidence).toBe('high');
  });

  it('rule 4: bold weight alone triggers heading', () => {
    const doc = createTestDoc();
    const text = makeTextNode('t1', 'Bold Title', {
      name: 'Text 1',
      fontSize: 16,
      fontWeight: 800,
    });
    const result = suggestName(text, doc);
    expect(result.name).toBe('Heading: Bold Title');
  });

  it('rule 5: image node gets "Image"', () => {
    const doc = createTestDoc();
    const img = makeImageNode('img1', {
      src: 'data:image/png,...',
      w: 100,
      h: 100,
    });
    const result = suggestName(img, doc);
    expect(result.name).toBe('Image');
    expect(result.confidence).toBe('high');
    expect(result.matchedRule).toBe('5-image');
  });

  it('rule 6: small square rect gets "Icon"', () => {
    const doc = createTestDoc();
    const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 24, h: 24 });
    const result = suggestName(shape, doc);
    expect(result.name).toBe('Icon');
    expect(result.confidence).toBe('medium');
    expect(result.matchedRule).toBe('6-icon-dimensions');
  });

  it('rule 6: 32x32 rect gets "Icon"', () => {
    const doc = createTestDoc();
    const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 32, h: 32 });
    const result = suggestName(shape, doc);
    expect(result.name).toBe('Icon');
  });

  it('rule 6: non-square large rect does not get "Icon"', () => {
    const doc = createTestDoc();
    const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 48, h: 24 });
    const result = suggestName(shape, doc);
    expect(result.matchedRule).not.toBe('6-icon-dimensions');
  });

  it('rule 7: rounded button-sized rect gets "Button"', () => {
    const doc = createTestDoc();
    const shape = makeShapeNode(
      's1',
      { kind: 'rect', x: 0, y: 0, w: 120, h: 40 },
      { cornerRadius: 8 },
    );
    const result = suggestName(shape, doc);
    expect(result.name).toBe('Button');
    expect(result.confidence).toBe('medium');
    expect(result.matchedRule).toBe('7-button-dimensions');
  });

  it('rule 7: non-rounded button-sized rect does not get "Button"', () => {
    const doc = createTestDoc();
    const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 120, h: 40 });
    const result = suggestName(shape, doc);
    expect(result.matchedRule).not.toBe('7-button-dimensions');
  });

  it('rule 8: frame with single child gets "{child name} container"', () => {
    let doc = createTestDoc();
    const inner = makeShapeNode(
      's1',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      { name: 'Avatar' },
    );
    const frame = makeFrameNode('f1', {
      name: 'Frame 1',
      children: ['s1'],
      w: 200,
      h: 200,
    });
    doc = addNode(doc, inner);
    doc = addNode(doc, frame);
    const result = suggestName(frame, doc);
    expect(result.name).toBe('Avatar container');
    expect(result.confidence).toBe('medium');
    expect(result.matchedRule).toBe('8-frame-single-child');
  });

  it('rule 9: frame with 5 children gets "Section"', () => {
    let doc = createTestDoc();
    const frame = makeFrameNode('f1', {
      name: 'Frame 1',
      children: ['s1', 's2', 's3', 's4', 's5'],
      w: 400,
      h: 300,
    });
    for (let i = 1; i <= 5; i++) {
      doc = addNode(doc, makeShapeNode(`s${i}`, { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }));
    }
    doc = addNode(doc, frame);
    const result = suggestName(frame, doc);
    expect(result.name).toBe('Section');
    expect(result.confidence).toBe('medium');
    expect(result.matchedRule).toBe('9-frame-many-children');
  });

  it('rule 10: group with 2 children gets "Group"', () => {
    let doc = createTestDoc();
    const group = makeGroupNode('g1', {
      name: 'Group 1',
      children: ['s1', 's2'],
    });
    doc = addNode(doc, makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc = addNode(doc, makeShapeNode('s2', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc = addNode(doc, group);
    const result = suggestName(group, doc);
    expect(result.name).toBe('Group');
    expect(result.confidence).toBe('low');
    expect(result.matchedRule).toBe('10-group-two-children');
  });

  it('rule 11: frame with layout grid gets "Grid"', () => {
    const doc = createTestDoc();
    const frame = {
      ...makeFrameNode('f1', { name: 'Frame 1', w: 300, h: 200, children: [] }),
      layoutStyle: {
        mode: 'grid' as const,
        direction: 'row' as const,
        gap: 0,
        wrap: false,
        padding: [0, 0, 0, 0] as [number, number, number, number],
        grow: 0,
        shrink: 0,
        gridTemplateColumns: '1fr 1fr 1fr',
      },
    };
    const result = suggestName(frame, doc);
    expect(result.name).toBe('Grid');
    expect(result.confidence).toBe('medium');
    expect(result.matchedRule).toBe('11-frame-grid');
  });

  it('rule 12: frame with flex layout gets "Layout"', () => {
    const doc = createTestDoc();
    const frame = {
      ...makeFrameNode('f1', { name: 'Frame 1', w: 300, h: 200, children: [] }),
      layoutStyle: {
        mode: 'flex' as const,
        direction: 'row' as const,
        gap: 8,
        padding: [0, 0, 0, 0] as [number, number, number, number],
        grow: 0,
        shrink: 0,
        wrap: false,
      },
    };
    const result = suggestName(frame, doc);
    expect(result.name).toBe('Layout');
    expect(result.confidence).toBe('low');
    expect(result.matchedRule).toBe('12-frame-flex');
  });

  it('rule 13: shape with text sibling below gets "Caption"', () => {
    let doc = createTestDoc();
    const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const caption = makeTextNode('t1', 'Some description', { name: 'Text 1' });
    const frame = makeFrameNode('f1', {
      name: 'Frame 1',
      children: [],
      w: 200,
      h: 300,
    });
    doc = addNode(doc, frame);
    doc = addChild(doc, 'f1', shape);
    doc = addChild(doc, 'f1', caption);
    const result = suggestName(doc.nodes['s1']!, doc);
    expect(result.name).toBe('Caption');
    expect(result.confidence).toBe('low');
    expect(result.matchedRule).toBe('13-shape-text-below');
  });

  it('rule 13: shape without text sibling below does not get "Caption"', () => {
    let doc = createTestDoc();
    const caption = makeTextNode('t1', 'Some description', { name: 'Text 1' });
    const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const frame = makeFrameNode('f1', {
      name: 'Frame 1',
      children: [],
      w: 200,
      h: 300,
    });
    doc = addNode(doc, frame);
    doc = addChild(doc, 'f1', caption);
    doc = addChild(doc, 'f1', shape);
    const result = suggestName(doc.nodes['s1']!, doc);
    expect(result.matchedRule).not.toBe('13-shape-text-below');
  });

  it('rule 14: default fallback uses kind and index', () => {
    const doc = createTestDoc();
    const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 });
    const result = suggestName(shape, doc, 3);
    expect(result.name).toBe('Shape 3');
    expect(result.confidence).toBe('low');
    expect(result.matchedRule).toBe('14-default');
  });

  it('rule 14: text fallback uses kind name', () => {
    const doc = createTestDoc();
    const text = makeTextNode('t1', 'regular text', {
      name: 'Text 1',
      fontSize: 14,
      fontWeight: 400,
    });
    const result = suggestName(text, doc, 7);
    expect(result.name).toBe('Text 7');
    expect(result.matchedRule).toBe('14-default');
  });
});

describe('renameSelected', () => {
  it('renames matching nodes in document', () => {
    let doc = createTestDoc();
    const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    doc = addNode(doc, shape);

    const result = renameSelected(doc, ['s1']);
    expect(result.nodes.s1?.name).toBe('Shape 0');
  });

  it('rule 13 integration: shape with text below gets "Caption" via renameSelected', () => {
    let doc = createTestDoc();
    const shape = makeShapeNode(
      's1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { name: 'Shape 1' },
    );
    const caption = makeTextNode('t1', 'Description text', { name: 'Text 1' });
    const frame = makeFrameNode('f1', {
      name: 'Frame 1',
      children: [],
      w: 200,
      h: 300,
    });
    doc = addNode(doc, frame);
    doc = addChild(doc, 'f1', shape);
    doc = addChild(doc, 'f1', caption);

    const result = renameSelected(doc, ['s1']);
    expect(result.nodes.s1?.name).toBe('Caption');
  });

  it('onlyIfDefault: renames default-named nodes but not custom-named ones', () => {
    let doc = createTestDoc();
    const shape1 = makeShapeNode(
      's1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { name: 'Rectangle 47' },
    );
    const shape2 = makeShapeNode(
      's2',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      { name: 'My Custom Shape' },
    );
    doc = addNode(doc, shape1);
    doc = addNode(doc, shape2);

    const result = renameSelected(doc, ['s1', 's2'], true);
    expect(result.nodes.s1?.name).toBe('Shape 0');
    expect(result.nodes.s2?.name).toBe('My Custom Shape');
  });

  it('onlyIfDefault: preserves custom names', () => {
    let doc = createTestDoc();
    const text = makeTextNode('t1', 'Signup', {
      name: 'Signup Button',
      fontSize: 14,
      fontWeight: 400,
    });
    doc = addNode(doc, text);

    const result = renameSelected(doc, ['t1'], true);
    expect(result.nodes.t1?.name).toBe('Signup Button');
  });

  it('does not modify document when no nodes match', () => {
    let doc = createTestDoc();
    const result = renameSelected(doc, ['nonexistent']);
    expect(result.nodes).toBe(doc.nodes);
  });
});
