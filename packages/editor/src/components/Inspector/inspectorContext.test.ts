import {
  addChild,
  createDesignCanvas,
  createDocument,
  makeFrameNode,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import type { EditorState } from '../../context/types';
import type { InspectorContextInput } from './inspectorContext';
import { deriveInspectorContext } from './inspectorContext';

function baseInput(overrides: Partial<InspectorContextInput> = {}): InspectorContextInput {
  const document = createDocument('Inspector context test');
  return {
    document,
    workspaceMode: 'design',
    tool: 'select',
    prototypeMode: false,
    selection: [],
    primaryId: null,
    focusedNodeId: null,
    selectionRange: null,
    tableEdit: null,
    currentPageId: null,
    masterEditId: null,
    areaSelection: null,
    quickMask: {
      active: false,
      color: [0, 0, 0, 0],
      coverage: null,
      width: 0,
      height: 0,
    } as EditorState['quickMask'],
    ...overrides,
  };
}

describe('deriveInspectorContext', () => {
  it('uses the document scope for an empty legacy document selection', () => {
    const context = deriveInspectorContext(baseInput());

    expect(context.scope).toBe('document');
    expect(context.target.label).toBe('Inspector context test');
    expect(context.selectionKind).toBe('empty');
    expect(context.selectedNodeIds).toEqual([]);
  });

  it('uses the active design canvas when the document has one', () => {
    const document = createDesignCanvas(createDocument('Canvas context test', true), {
      name: 'Canvas X',
    });
    const context = deriveInspectorContext(baseInput({ document }));

    expect(context.scope).toBe('canvas');
    expect(context.target.label).toBe('Canvas X');
  });

  it('drops stale selection IDs instead of exposing a phantom target', () => {
    const context = deriveInspectorContext(baseInput({ selection: ['missing-node'] }));

    expect(context.scope).toBe('document');
    expect(context.selectedNodeIds).toEqual([]);
    expect(context.primaryNodeId).toBeNull();
  });

  it('uses an explicit tool scope when no object is selected', () => {
    const context = deriveInspectorContext(baseInput({ tool: 'paint' }));

    expect(context.scope).toBe('tool');
    expect(context.target).toMatchObject({ id: 'paint', label: 'paint options' });
  });

  it('keeps a temporary crop workflow distinct from object selection', () => {
    const document = createDocument('Crop context test');
    const rootId = document.pages?.[0]?.contentRoot;
    const image = makeShapeNode(
      'image',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      { name: 'Image' },
    );
    if (!rootId) throw new Error('test document has no design canvas');
    const nextDocument = addChild(document, rootId, image);

    const context = deriveInspectorContext(
      baseInput({
        document: nextDocument,
        selection: [image.id],
        primaryId: image.id,
        selectedNodes: [image],
        tool: 'crop',
      }),
    );

    expect(context.scope).toBe('temporary-workflow');
    expect(context.target).toMatchObject({ id: image.id, label: 'Image' });
  });

  it('reports ancestor lock and visibility sources without mutating the document', () => {
    const document = createDocument('Restriction context test');
    const rootId = document.pages?.[0]?.contentRoot;
    if (!rootId) throw new Error('test document has no design canvas');
    const parent = makeFrameNode('parent', { locked: true, visible: false });
    const withParent = addChild(document, rootId, parent);
    const child = makeShapeNode(
      'child',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      { locked: false, visible: true },
    );
    const withChild = addChild(withParent, parent.id, child);

    const context = deriveInspectorContext(
      baseInput({
        document: withChild,
        selection: [child.id],
        primaryId: child.id,
        selectedNodes: [child],
      }),
    );

    expect(context.restrictions.inheritedLockedNodeIds).toEqual([child.id]);
    expect(context.restrictions.inheritedHiddenNodeIds).toEqual([child.id]);
    expect(context.restrictions.lockSourceIds).toEqual([parent.id]);
    expect(context.restrictions.visibilitySourceIds).toEqual([parent.id]);
    expect(context.restrictions.canEditSelection).toBe(false);
    expect(context.restrictions.canSeeSelectionFeedback).toBe(false);
    expect(withChild.nodes[parent.id]?.locked).toBe(true);
    expect(withChild.nodes[child.id]?.locked).toBe(false);
  });

  it('rejects a partial batch edit while identifying the safe subset', () => {
    const document = createDocument('Partial restriction test');
    const rootId = document.pages?.[0]?.contentRoot;
    if (!rootId) throw new Error('test document has no design canvas');
    const locked = makeShapeNode(
      'locked',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      { locked: true },
    );
    const withLocked = addChild(document, rootId, locked);
    const editable = makeShapeNode('editable', { kind: 'rect', x: 60, y: 0, w: 50, h: 50 });
    const withBoth = addChild(withLocked, rootId, editable);

    const context = deriveInspectorContext(
      baseInput({
        document: withBoth,
        selection: [locked.id, editable.id],
        primaryId: locked.id,
        selectedNodes: [locked, editable],
      }),
    );

    expect(context.restrictions.hasPartialLock).toBe(true);
    expect(context.restrictions.editableNodeIds).toEqual([editable.id]);
    expect(context.restrictions.canEditSelection).toBe(false);
  });
});
