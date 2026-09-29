import type { Document } from '@varve/scene';
import {
  addChild,
  addNode,
  createDocument,
  imageFill,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
  nextNodeId,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportNodeToCssModules, exportNodeToCssModulesBundle } from './css-modules';

interface Built {
  doc: Document;
  frameId: string;
  childIds: string[];
}

/** A frame with a nested group, a shape, and text — not "a rectangle called Box". */
function nestedCard(): Built {
  let doc = createDocument('Card');
  const { id, doc: withId } = nextNodeId(doc);
  doc = withId;
  doc = addNode(doc, makeFrameNode(id, { name: 'Card', w: 320, h: 200 }));
  doc = addChild(doc, id, makeGroupNode('group-1', { name: 'Header' }));
  doc = addChild(
    doc,
    'group-1',
    makeShapeNode('badge', { kind: 'rect', x: 4, y: 6, w: 40, h: 20 }, { name: 'Badge-2' }),
  );
  doc = addChild(
    doc,
    'group-1',
    makeTextNode('label', 'A & B <tag>', { name: 'Label', fontSize: 14 }),
  );
  doc = addChild(
    doc,
    id,
    makeShapeNode('panel', { kind: 'rect', x: 0, y: 40, w: 320, h: 160 }, { name: 'Panel' }),
  );
  return { doc, frameId: id, childIds: ['group-1', 'panel'] };
}

function entries(doc: Document, frameId: string) {
  const bundle = exportNodeToCssModulesBundle(doc.nodes[frameId]!, doc);
  const entry = bundle.files.find((file) => file.entry);
  const css = bundle.files.find((file) => file.language === 'css');
  if (!entry || !css) throw new Error('bundle missing entry or stylesheet');
  return { bundle, entry, css };
}

describe('exportNodeToCssModulesBundle — packaging', () => {
  it('emits two real files that share a stem and import each other', () => {
    const { doc, frameId } = nestedCard();
    const { bundle, entry, css } = entries(doc, frameId);

    expect(bundle.deliverable).toBe('component');
    expect(bundle.files).toHaveLength(2);
    expect(css.path).toBe('card.module.css');
    expect(entry.path).toBe('card.tsx');
    expect(entry.language).toBe('tsx');
    expect(css.language).toBe('css');
    // The import must name the stylesheet that was actually emitted.
    expect(entry.contents).toContain(`import styles from './card.module.css';`);
    expect(bundle.dependencies).toEqual({ react: '>=18' });
  });

  it('does not append raw CSS to the TSX payload', () => {
    const { doc, frameId } = nestedCard();
    const { entry, css } = entries(doc, frameId);

    expect(entry.contents).not.toContain('position: absolute');
    expect(entry.contents).not.toContain('/* CSS Module */');
    expect(css.contents).not.toContain('export function');
    expect(css.contents).not.toContain('import ');
  });

  it('states the deliverable and the files a consumer needs', () => {
    const { doc, frameId } = nestedCard();
    const { bundle } = entries(doc, frameId);

    expect(bundle.setup?.join(' ')).toContain('card.tsx');
    expect(bundle.setup?.join(' ')).toContain('card.module.css');
    expect(bundle.setup?.join(' ')).toContain('CSS Modules support');
  });
});

describe('exportNodeToCssModulesBundle — tree and naming integrity', () => {
  it('preserves every descendant, including nested groups', () => {
    const { doc, frameId } = nestedCard();
    const { entry, css } = entries(doc, frameId);

    // Three levels: Card > Header (group) > Badge/Label, plus Panel.
    expect(css.contents).toContain('.card {');
    expect(css.contents).toContain('.header {');
    expect(css.contents).toContain('.badge-2 {');
    expect(css.contents).toContain('.label {');
    expect(css.contents).toContain('.panel {');
    // And the JSX nests them, so the group is not flattened away.
    expect(entry.contents).toContain('className={styles.header}');
    expect(entry.contents).toContain('className={styles["badge-2"]}');
    expect(entry.contents).toContain('className={styles.label}');
  });

  it('uses bracket access for hyphenated class keys instead of invalid JS', () => {
    const { doc, frameId } = nestedCard();
    const { entry, css } = entries(doc, frameId);

    expect(entry.contents).toContain('styles["badge-2"]');
    expect(entry.contents).not.toMatch(/styles\.[a-z0-9_]*-[a-z0-9]/);
    expect(css.contents).toContain('.badge-2 {');
  });

  it('encodes design text exactly once', () => {
    const { doc, frameId } = nestedCard();
    const { entry } = entries(doc, frameId);

    expect(entry.contents).toContain('{"A & B <tag>"}');
    expect(entry.contents).not.toContain('&amp;');
    expect(entry.contents).not.toContain('&lt;');
  });

  it('produces a valid component name for adversarial layer names', () => {
    // The emoji is written as an escape so the zero-emoji gate can scan the
    // source; the fixture value is unchanged.
    const names = ['', 'Hero-Card', '2 columns', 'class', '\u{1F389}', 'a b c'];
    for (const name of names) {
      let doc = createDocument('Names');
      const node = makeShapeNode('n', { kind: 'rect', x: 0, y: 0, w: 4, h: 4 }, { name });
      doc = addNode(doc, node);
      const { entry } = entries(doc, node.id);
      const match = /export function ([A-Za-z_$][A-Za-z0-9_$]*)\(/.exec(entry.contents);
      expect(match, `no valid component name for ${JSON.stringify(name)}`).not.toBeNull();
      expect(entry.contents).not.toContain('undefined');
    }
  });

  it('keeps sibling class names unique when two layers share a name', () => {
    let doc = createDocument('Collide');
    const frame = makeFrameNode('frame', { name: 'Card' });
    doc = addNode(doc, frame);
    doc = addChild(
      doc,
      'frame',
      makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 4, h: 4 }, { name: 'Card' }),
    );
    doc = addChild(
      doc,
      'frame',
      makeShapeNode('b', { kind: 'rect', x: 0, y: 0, w: 4, h: 4 }, { name: 'card' }),
    );

    const { css, entry } = entries(doc, 'frame');
    expect(css.contents).toContain('.card {');
    expect(css.contents).toContain('.card-2 {');
    expect(css.contents).toContain('.card-3 {');
    expect(entry.contents).toContain('styles.card');
    expect(entry.contents).toContain('styles["card-2"]');
  });

  it('is deterministic across repeated generation', () => {
    const first = nestedCard();
    const second = nestedCard();
    const a = entries(first.doc, first.frameId);
    const b = entries(second.doc, second.frameId);

    expect(a.entry.contents).toBe(b.entry.contents);
    expect(a.css.contents).toBe(b.css.contents);
  });
});

describe('exportNodeToCssModulesBundle — layout invariants', () => {
  it('preserves the authored frame box instead of inventing 200x160', () => {
    const { doc, frameId } = nestedCard();
    const { css } = entries(doc, frameId);
    const rootRule = css.contents.slice(0, css.contents.indexOf('}\n'));

    expect(rootRule).toContain('width: 320px');
    expect(rootRule).toContain('height: 200px');
    expect(rootRule).not.toContain('width: 200px');
    expect(rootRule).not.toContain('height: 160px');
  });

  it('moves the whole frame without changing its internal layout', () => {
    const { doc, frameId } = nestedCard();
    const before = entries(doc, frameId);

    const movedFrame = doc.nodes[frameId]!;
    const moved = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [frameId]: { ...movedFrame, transform: [1, 0, 0, 1, 500, 300] },
      },
    } as Document;
    const after = entries(moved, frameId);

    // Only the root rule's left/top may change; every descendant rule body and
    // the root's own box must be byte-identical.
    const normalizeRootBox = (css: string) => {
      const rules = css.split('\n\n');
      return [
        rules[0]!.replace(/left: [^;]+;/, 'left: X;').replace(/top: [^;]+;/, 'top: X;'),
        ...rules.slice(1),
      ].join('\n\n');
    };
    expect(normalizeRootBox(after.css.contents)).toBe(normalizeRootBox(before.css.contents));
    expect(after.css.contents).toContain('left: 500px');
    expect(after.css.contents).toContain('top: 300px');
    // A descendant's own offset is untouched.
    expect(after.css.contents).toContain('left: 4px');
  });

  it('does not paint a group box the canvas renderer never painted', () => {
    const { doc, frameId } = nestedCard();
    const { css } = entries(doc, frameId);
    const headerRule = css.contents.slice(css.contents.indexOf('.header {'));

    expect(headerRule.slice(0, headerRule.indexOf('}'))).not.toContain('background:');
    expect(headerRule.slice(0, headerRule.indexOf('}'))).not.toContain('width:');
  });
});

describe('exportNodeToCssModulesBundle — diagnostics and fallbacks', () => {
  it('reports a session-only blob image source instead of quietly emitting it', () => {
    const doc = createDocument('Blob');
    const node = makeShapeNode(
      'img',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Photo' },
    );
    const withFill = { ...node, fills: [imageFill('blob:http://localhost/abc', { fit: 'fill' })] };
    const docWithNode: Document = { ...doc, nodes: { ...doc.nodes, img: withFill } };

    const { bundle } = entries(docWithNode, 'img');
    const error = bundle.diagnostics.find((d) => d.severity === 'error');
    expect(error?.message).toContain('blob:');
    expect(error?.nodeId).toBe('img');
  });

  it('accepts a data URL image source without diagnostics about portability', () => {
    const doc = createDocument('Inline');
    const node = makeShapeNode(
      'img',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Photo' },
    );
    const withFill = {
      ...node,
      fills: [imageFill('data:image/png;base64,AAAA', { fit: 'fill' })],
    };
    const docWithNode: Document = { ...doc, nodes: { ...doc.nodes, img: withFill } };

    const { bundle } = entries(docWithNode, 'img');
    expect(bundle.diagnostics.some((d) => d.feature === 'unportable image source')).toBe(false);
  });

  it('omits hidden layers rather than emitting empty elements', () => {
    let doc = createDocument('Hidden');
    doc = addNode(doc, makeFrameNode('frame', { name: 'Card' }));
    doc = addChild(
      doc,
      'frame',
      makeShapeNode('shown', { kind: 'rect', x: 0, y: 0, w: 4, h: 4 }, { name: 'Shown' }),
    );
    doc = addChild(doc, 'frame', {
      ...makeShapeNode('hidden', { kind: 'rect', x: 0, y: 0, w: 4, h: 4 }, { name: 'Hidden' }),
      visible: false,
    });

    const { css, entry } = entries(doc, 'frame');
    expect(css.contents).toContain('.shown {');
    expect(css.contents).not.toContain('.hidden {');
    expect(entry.contents).not.toContain('hidden');
  });
});

describe('exportNodeToCssModules — string adapter', () => {
  it('returns the same content as the bundle files', () => {
    const { doc, frameId } = nestedCard();
    const { entry, css } = entries(doc, frameId);
    const pair = exportNodeToCssModules(doc.nodes[frameId]!, doc);

    expect(pair.jsx).toBe(entry.contents);
    expect(pair.css).toBe(css.contents);
  });
});
