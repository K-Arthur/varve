import { describe, expect, it } from 'vitest';
import type { Document } from '../../document';
import {
  addChild,
  addMasterOverride,
  createDocument,
  createMaster,
  makeShapeNode,
  nextNodeId,
} from '../../document';
import { registerBuiltinOperations } from '../bootstrap';
import { applyOperation, hasOperation, preconditionFailure, validatePayload } from '../registry';

registerBuiltinOperations();

function firstMaster(doc: Document) {
  const master = Object.values(doc.masters ?? {})[0];
  if (!master) throw new Error('expected a master');
  return master;
}

function firstPageId(doc: Document): string {
  const pageId = doc.pages?.[0]?.id;
  if (!pageId) throw new Error('expected a page');
  return pageId;
}

describe('master operations', () => {
  it('registers the complete master mutation family', () => {
    expect(
      [
        'master.create',
        'master.delete',
        'master.rename',
        'master.duplicate',
        'master.set-applies-to',
        'master.assign',
        'master.override',
        'master.remove-override',
        'master.reset-overrides',
      ].every(hasOperation),
    ).toBe(true);
  });

  it('validates masterId payloads using their actual wire key', () => {
    expect(validatePayload('master.delete', { masterId: 'm1' })).toEqual({
      ok: true,
      value: { masterId: 'm1' },
    });
    expect(validatePayload('master.delete', { id: 'm1' }).ok).toBe(false);
  });

  it('creates, assigns, and changes a master through registered operations', () => {
    let doc = createDocument();
    doc = applyOperation(doc, 'master.create', {
      name: 'Grid',
      width: 1200,
      height: 800,
      appliesTo: 'left',
    });
    const master = firstMaster(doc);
    const pageId = firstPageId(doc);

    expect(master.appliesTo).toBe('left');
    expect(preconditionFailure(doc, 'master.assign', { pageId, masterId: master.id })).toBeNull();
    doc = applyOperation(doc, 'master.assign', { pageId, masterId: master.id });
    doc = applyOperation(doc, 'master.rename', { masterId: master.id, name: 'Renamed grid' });

    expect(doc.pages?.[0]?.masterPageId).toBe(master.id);
    expect(doc.masters?.[master.id]?.name).toBe('Renamed grid');
  });

  it('keeps override state sparse and supports remove/reset operations', () => {
    let doc = createDocument();
    doc = createMaster(doc, { name: 'Header', width: 1200, height: 800 });
    const master = firstMaster(doc);
    const pageId = firstPageId(doc);
    const { id: nodeId, doc: withId } = nextNodeId(doc);
    doc = addChild(
      withId,
      master.contentRoot,
      makeShapeNode(nodeId, { kind: 'rect', x: 0, y: 0, w: 100, h: 20 }),
    );
    doc = applyOperation(doc, 'master.assign', { pageId, masterId: master.id });

    doc = applyOperation(doc, 'master.override', {
      pageId,
      masterNodeId: nodeId,
      type: 'hidden',
    });
    expect(doc.pages?.[0]?.masterOverrides?.[nodeId]?.type).toBe('hidden');

    doc = applyOperation(doc, 'master.remove-override', { pageId, masterNodeId: nodeId });
    expect(doc.pages?.[0]?.masterOverrides).toBeUndefined();

    doc = addMasterOverride(doc, pageId, nodeId, 'deleted');
    doc = applyOperation(doc, 'master.reset-overrides', { pageId });
    expect(doc.pages?.[0]?.masterOverrides).toBeUndefined();
  });

  it('rejects overrides for an unrelated source node', () => {
    let doc = createDocument();
    doc = createMaster(doc, { name: 'Header', width: 1200, height: 800 });
    const master = firstMaster(doc);
    const pageId = firstPageId(doc);
    doc = applyOperation(doc, 'master.assign', { pageId, masterId: master.id });

    expect(
      preconditionFailure(doc, 'master.override', {
        pageId,
        masterNodeId: 'not-a-master-node',
        type: 'hidden',
      }),
    ).toContain('master source node does not exist');
  });
});
