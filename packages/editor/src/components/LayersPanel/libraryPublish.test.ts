import { addNode, createComponent, createDocument, makeFrameNode, nextNodeId } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { buildComponentLibraryPackage, findComponentByMasterRootId } from './libraryPublish';

function makeDocWithComponent() {
  let doc = createDocument();

  const { id: masterId, doc: d1 } = nextNodeId(doc);
  doc = d1;
  doc = addNode(
    doc,
    makeFrameNode(masterId, { name: 'Button Master', w: 100, h: 40, children: [] }),
  );

  const { component, doc: d2 } = createComponent(doc, 'Button', masterId, []);
  doc = d2;

  const { id: plainFrameId, doc: d3 } = nextNodeId(doc);
  doc = d3;
  doc = addNode(
    doc,
    makeFrameNode(plainFrameId, { name: 'Not a component', w: 10, h: 10, children: [] }),
  );

  return { doc, masterId, plainFrameId, component };
}

describe('findComponentByMasterRootId', () => {
  it('finds the component definition for its master root node', () => {
    const { doc, masterId, component } = makeDocWithComponent();
    expect(findComponentByMasterRootId(doc, masterId)?.id).toBe(component.id);
  });

  it('returns undefined for a node that is not a component master', () => {
    const { doc, plainFrameId } = makeDocWithComponent();
    expect(findComponentByMasterRootId(doc, plainFrameId)).toBeUndefined();
  });
});

describe('buildComponentLibraryPackage', () => {
  it('builds a package containing the published component and its subtree bundle', () => {
    const { doc, masterId, component } = makeDocWithComponent();
    const result = buildComponentLibraryPackage(doc, masterId);

    expect(result).not.toBeNull();
    expect(result?.component.id).toBe(component.id);
    expect(result?.pkg.library.components).toHaveLength(1);
    expect(result?.pkg.library.components[0]?.id).toBe(component.id);
    expect(result?.pkg.library.nodeBundles?.[masterId]?.[masterId]).toBeDefined();
    expect(result?.pkg.formatVersion).toBe('1.0');
  });

  it('returns null for a node that is not a component master', () => {
    const { doc, plainFrameId } = makeDocWithComponent();
    expect(buildComponentLibraryPackage(doc, plainFrameId)).toBeNull();
  });

  it('returns null for an unknown node id', () => {
    const { doc } = makeDocWithComponent();
    expect(buildComponentLibraryPackage(doc, 'does-not-exist')).toBeNull();
  });
});
