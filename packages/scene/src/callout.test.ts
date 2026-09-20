import { describe, expect, it } from 'vitest';
import {
  addCalloutTail,
  addNode,
  createCallout,
  createDocument,
  detachCalloutRecipe,
  fitCalloutToText,
  getCalloutFitReport,
  getParent,
  makeTextNode,
  updateCalloutKind,
  updateCalloutPadding,
  updateCalloutTailEndpoint,
  wrapTextInCallout,
} from './index';
import type { GroupNode } from './types';

describe('comic callouts', () => {
  it('creates ordinary body, tail, and editable text children', () => {
    const result = createCallout(createDocument('callout', true), {
      x: 40,
      y: 60,
      w: 240,
      h: 100,
      text: 'Hello',
    });
    const group = result.document.nodes[result.groupId] as GroupNode;
    expect(group?.kind).toBe('group');
    expect(group?.callout?.textNodeId).toBe(result.textId);
    expect(group?.children).toEqual([result.bodyId, ...result.tailNodeIds, result.textId]);
    expect(result.document.nodes[result.bodyId]?.kind).toBe('shape');
    expect(result.document.nodes[result.tailNodeIds[0]!]?.kind).toBe('path');
    expect(result.document.nodes[result.textId]?.kind).toBe('text');
  });

  it('wraps existing text without duplicating its source node', () => {
    const text = makeTextNode('text-1', 'Dialogue', {
      transform: [1, 0, 0, 1, 80, 90],
      w: 160,
      h: 48,
    });
    const doc = addNode(createDocument('wrap', true), text);
    const result = wrapTextInCallout(doc, text.id, { kind: 'caption' });
    expect(result).not.toBeNull();
    const wrapped = result!;
    expect(wrapped.document.nodes[text.id]?.kind).toBe('text');
    expect((wrapped.document.nodes[wrapped.groupId] as GroupNode).callout?.textNodeId).toBe(
      text.id,
    );
    expect(getParent(wrapped.document, text.id)).toBe(wrapped.groupId);
    expect(
      Object.values(wrapped.document.nodes).filter((node) => node.kind === 'text'),
    ).toHaveLength(1);
  });

  it('changes recipe styling and padding without replacing identities', () => {
    const created = createCallout(createDocument('style', true), {
      x: 0,
      y: 0,
      w: 100,
      h: 60,
      text: 'Hi',
    });
    let doc = updateCalloutKind(created.document, created.groupId, 'shout');
    doc = updateCalloutPadding(doc, created.groupId, 24);
    const group = doc.nodes[created.groupId] as GroupNode;
    expect(group?.callout?.kind).toBe('shout');
    expect(group?.callout?.padding).toBe(24);
    expect(group?.callout?.bodyNodeId).toBe(created.bodyId);
    expect(group?.callout?.textNodeId).toBe(created.textId);
  });

  it('supports multiple tails and editable tail endpoints', () => {
    const created = createCallout(createDocument('tails', true), {
      x: 0,
      y: 0,
      w: 100,
      h: 60,
    });
    const withSecondTail = addCalloutTail(created.document, created.groupId, { x: 80, y: 110 });
    const group = withSecondTail.nodes[created.groupId] as GroupNode;
    expect(group?.callout?.tailNodeIds).toHaveLength(2);
    const secondTail = group?.callout?.tailNodeIds[1];
    expect(secondTail).toBeDefined();
    const moved = updateCalloutTailEndpoint(withSecondTail, created.groupId, secondTail!, {
      x: 88,
      y: 124,
    });
    const tail = moved.nodes[secondTail!];
    expect(tail?.kind === 'path' ? tail.points.at(-1) : undefined).toMatchObject({ x: 88, y: 124 });
  });

  it('marks a callout detached while retaining ordinary geometry', () => {
    const created = createCallout(createDocument('detach', true), {
      x: 0,
      y: 0,
      w: 100,
      h: 60,
    });
    const doc = detachCalloutRecipe(created.document, created.groupId);
    expect((doc.nodes[created.groupId] as GroupNode).callout?.parametric).toBe(false);
    expect(doc.nodes[created.bodyId]?.kind).toBe('shape');
  });

  it('fits body geometry around the bound text without changing text', () => {
    const created = createCallout(createDocument('fit', true), {
      x: 0,
      y: 0,
      w: 200,
      h: 120,
      text: 'Fit me',
    });
    const before = created.document.nodes[created.textId];
    const doc = fitCalloutToText(created.document, created.groupId);
    expect(doc.nodes[created.textId]).toMatchObject({
      id: created.textId,
      kind: 'text',
      text: before?.kind === 'text' ? before.text : undefined,
    });
    expect((doc.nodes[created.groupId] as GroupNode).callout?.fitToText).toBe(true);
    expect((doc.nodes[created.groupId] as GroupNode).callout?.fitPolicy).toBe('fit-balloon');
  });

  it('reports overflow from shared text geometry without mutating the document', () => {
    const created = createCallout(createDocument('overflow', true), {
      x: 0,
      y: 0,
      w: 96,
      h: 48,
      padding: 12,
      text: 'This dialogue is deliberately much longer than the balloon.',
    });
    const before = created.document.nodes[created.groupId];
    const report = getCalloutFitReport(created.document, created.groupId);
    expect(report?.status).toBe('overflow');
    expect(report?.policy).toBe('reflow');
    expect(created.document.nodes[created.groupId]).toBe(before);
  });

  it('moves tail bases when the balloon grows but keeps tail targets', () => {
    const created = createCallout(createDocument('grow', true), {
      x: 0,
      y: 0,
      w: 80,
      h: 40,
      text: 'A very long line that needs more room',
      tailEndpoint: { x: 12, y: 100 },
    });
    const beforeTail = created.document.nodes[created.tailNodeIds[0]!];
    const beforeEndpoint = beforeTail?.kind === 'path' ? beforeTail.points.at(-1) : null;
    const doc = fitCalloutToText(created.document, created.groupId);
    const afterTail = doc.nodes[created.tailNodeIds[0]!];
    expect(afterTail?.kind === 'path' ? afterTail.points.at(-1) : null).toEqual(beforeEndpoint);
    expect(afterTail?.kind === 'path' ? afterTail.points[0] : null).not.toEqual(
      beforeTail?.kind === 'path' ? beforeTail.points[0] : null,
    );
  });
});
