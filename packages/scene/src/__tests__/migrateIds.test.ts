/**
 * Legacy sequential-ID migration tests (ADR-0026).
 */
import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import {
  addChild,
  addNode,
  createDocument,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
} from '../document';
import { solidFill } from '../fills';
import { migrateLegacyIds, validateIdReferences } from '../migrateIds';
import { createVariableStore } from '../variables';

const FIXED_RNG = (): string => '0123456789abcdef';

function legacyDoc(): Document {
  const doc = createDocument('legacy', { flat: true });
  const rect = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
  const group = makeGroupNode('n2', {});
  const text = makeTextNode('n3', 'hello', {});
  let d = addNode(doc, rect);
  d = addNode(d, group);
  d = addNode(d, text);
  // children under the group
  const inner = makeShapeNode('n4', { kind: 'ellipse', cx: 0, cy: 0, rx: 5, ry: 5 });
  d = addChild(d, group.id, inner);
  // variables
  const store = createVariableStore(['default']);
  store.variables.v1 = {
    id: 'v1',
    name: 'brand',
    type: 'color',
    valuesByMode: { default: '#000' },
  };
  store.collections['col-1'] = {
    id: 'col-1',
    name: 'Colors',
    modes: ['default'],
    activeMode: 'default',
    variableIds: ['v1'],
  };
  store.activeCollectionId = 'col-1';
  d = { ...d, variableStore: store };
  return { ...d, nextId: 5 };
}

describe('migrateLegacyIds', () => {
  it('remaps node ids and every node reference atomically', () => {
    const doc = legacyDoc();
    const result = migrateLegacyIds(doc, { rng: FIXED_RNG });
    expect(result.migratedCount).toBeGreaterThan(0);
    const d = result.document;

    expect(d.nodes.n1_0123456789abcdef).toBeDefined();
    expect(d.nodes.n2_0123456789abcdef).toBeDefined();
    expect(d.nodes.n3_0123456789abcdef).toBeDefined();
    expect(d.nodes.n4_0123456789abcdef).toBeDefined();
    expect(d.nodes.n1).toBeUndefined();
    expect(d.rootChildren).toEqual([
      'n1_0123456789abcdef',
      'n2_0123456789abcdef',
      'n3_0123456789abcdef',
    ]);
    expect((d.nodes.n2_0123456789abcdef as { children?: string[] }).children).toEqual([
      'n4_0123456789abcdef',
    ]);
    expect(validateIdReferences(d)).toEqual([]);
  });

  it('is idempotent: migrating a migrated document is a no-op', () => {
    const once = migrateLegacyIds(legacyDoc(), { rng: FIXED_RNG });
    const twice = migrateLegacyIds(once.document, { rng: FIXED_RNG });
    expect(twice.migratedCount).toBe(0);
    expect(twice.document).toBe(once.document);
    expect(twice.warnings).toEqual([]);
  });

  it('does not mutate the input document', () => {
    const doc = legacyDoc();
    const snapshot = JSON.stringify(doc);
    migrateLegacyIds(doc, { rng: FIXED_RNG });
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('is deterministic given a fixed rng', () => {
    const input = legacyDoc();
    const a = migrateLegacyIds(input, { rng: FIXED_RNG });
    const b = migrateLegacyIds(input, { rng: FIXED_RNG });
    expect(JSON.stringify(a.document)).toBe(JSON.stringify(b.document));
  });

  it('remaps component references (masterRootId, slots, instances)', () => {
    const doc = legacyDoc();
    const withComponent = {
      ...doc,
      components: {
        n9: {
          id: 'n9',
          name: 'Button',
          masterRootId: 'n1',
          slots: [{ id: 'slot1', name: 'Content', kind: 'single', defaultContentId: 'n4' }],
        },
      },
    } as Document;
    const frame = {
      ...doc.nodes.n2!,
      componentId: 'n9',
      slots: { slot1: 'n4' },
    } as never;
    withComponent.nodes.n2 = frame as (typeof withComponent.nodes)[string];

    const result = migrateLegacyIds(withComponent, { rng: FIXED_RNG });
    const d = result.document;
    const component = d.components.n9_0123456789abcdef!;
    expect(component).toBeDefined();
    expect(component.masterRootId).toBe('n1_0123456789abcdef');
    expect(component.slots[0]!.defaultContentId).toBe('n4_0123456789abcdef');
    const frame2 = d.nodes.n2_0123456789abcdef as {
      componentId?: string;
      slots?: Record<string, string>;
    };
    expect(frame2.componentId).toBe('n9_0123456789abcdef');
    expect(frame2.slots).toEqual({
      slot1: 'n4_0123456789abcdef',
    });
    expect(validateIdReferences(d)).toEqual([]);
  });

  it('remaps style ids and styleId references', () => {
    const doc = legacyDoc();
    const withStyles = {
      ...doc,
      styles: {
        s3: {
          id: 's3',
          type: 'color',
          name: 'Teal',
          fill: solidFill({ space: 'rgb', r: 0, g: 1, b: 2, a: 255 }),
        },
      },
      nodes: {
        ...doc.nodes,
        n1: { ...doc.nodes.n1!, styleId: 's3' },
      },
    } as unknown as Document;
    const result = migrateLegacyIds(withStyles, { rng: FIXED_RNG });
    const d = result.document;
    expect(d.styles?.s3_0123456789abcdef).toBeDefined();
    expect((d.nodes.n1_0123456789abcdef as { styleId?: string }).styleId).toBe(
      's3_0123456789abcdef',
    );
    expect(validateIdReferences(d)).toEqual([]);
  });

  it('remaps variable ids and bindings including expression references', () => {
    const doc = legacyDoc();
    const node = doc.nodes.n1! as Document['nodes'][string];
    doc.nodes.n1 = {
      ...node,
      bindings: { fill: { variableId: 'v1', expression: '{v1} * 2' } },
    };
    const result = migrateLegacyIds(doc, { rng: FIXED_RNG });
    const d = result.document;
    const store = d.variableStore!;
    expect(store.collections['col-0123456789abcdef']).toBeDefined();
    expect(store.variables['v-0123456789abcdef']).toBeDefined();
    expect(store.activeCollectionId).toBe('col-0123456789abcdef');
    const bindings = (
      d.nodes.n1_0123456789abcdef as {
        bindings?: Record<string, { variableId: string; expression: string }>;
      }
    ).bindings!;
    expect(bindings.fill!.variableId).toBe('v-0123456789abcdef');
    expect(bindings.fill!.expression).toBe('{v-0123456789abcdef} * 2');
  });

  it('remaps page content roots, masters, interactions, and selection sets', () => {
    const doc = legacyDoc();
    const rich: Document = {
      ...doc,
      pages: [
        {
          id: 'p-1234',
          name: 'Page 1',
          width: 800,
          height: 600,
          order: 'a0',
          backgrounds: ['n1'],
          contentRoot: 'n2',
        },
      ],
      masters: {
        m1: {
          id: 'm1',
          name: 'Master',
          width: 800,
          height: 600,
          contentRoot: 'n2',
          appliesTo: 'all',
        },
      },
      interactions: {
        n3: [{ id: 'i1', nodeId: 'n3', name: 'Tap', trigger: {}, actions: [], enabled: true }],
      },
      selectionSets: {
        version: 1,
        sets: [
          {
            id: 'set1',
            name: 'Sel',
            nodeIds: ['n1', 'n4'],
            scope: { type: 'page', id: 'p-1234' },
            createdAt: 'x',
            updatedAt: 'y',
          },
        ],
      },
    };
    const result = migrateLegacyIds(rich, { rng: FIXED_RNG });
    const d = result.document;
    expect(d.pages![0]!.contentRoot).toBe('n2_0123456789abcdef');
    expect(d.pages![0]!.backgrounds).toEqual(['n1_0123456789abcdef']);
    expect(d.masters!.m1!.contentRoot).toBe('n2_0123456789abcdef');
    expect(d.interactions!.n3_0123456789abcdef![0]!.nodeId).toBe('n3_0123456789abcdef');
    expect(d.selectionSets!.sets[0]!.nodeIds).toEqual([
      'n1_0123456789abcdef',
      'n4_0123456789abcdef',
    ]);
    expect(validateIdReferences(d)).toEqual([]);
  });

  it('no-ops on a fully minted document', () => {
    const result = migrateLegacyIds(createDocument('modern', { flat: true }), { rng: FIXED_RNG });
    expect(result.migratedCount).toBe(0);
    expect(result.warnings).toEqual([]);
  });
});
