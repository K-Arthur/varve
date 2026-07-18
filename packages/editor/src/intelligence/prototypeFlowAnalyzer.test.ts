import type { Document, NodeId } from '@strata/scene';
import { addInteraction, addNode, createDocument, makeFrameNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { analyzePrototypeFlow } from './prototypeFlowAnalyzer';

function addFrame(doc: Document, id: string, name: string): { doc: Document; id: NodeId } {
  const nid = id as NodeId;
  const node = makeFrameNode(nid, { name, w: 200, h: 400 });
  return { doc: addNode(doc, node), id: nid };
}

function addNavInteraction(
  doc: Document,
  nodeId: NodeId,
  targetId: NodeId,
  transitionKind?: string,
): Document {
  const { doc: d } = addInteraction(doc, nodeId, {
    name: 'Navigate',
    trigger: { kind: 'onClick' },
    actions: [
      {
        kind: 'navigateTo',
        targetId,
        transition: { kind: transitionKind ?? 'dissolve', duration: 300, easing: { kind: 'ease' } },
      },
    ],
    enabled: true,
  });
  return d;
}

function _addGoBackInteraction(doc: Document, nodeId: NodeId): Document {
  const { doc: d } = addInteraction(doc, nodeId, {
    name: 'Go Back',
    trigger: { kind: 'onClick' },
    actions: [{ kind: 'goBack' }],
    enabled: true,
  });
  return d;
}

describe('analyzePrototypeFlow', () => {
  it('returns no critical issues for a well-connected 3-screen flow', () => {
    let doc = createDocument('test', true);
    const r1 = addFrame(doc, 'home', 'Home');
    doc = r1.doc;
    const r2 = addFrame(doc, 'menu', 'Menu');
    doc = r2.doc;
    const r3 = addFrame(doc, 'settings', 'Settings');
    doc = r3.doc;
    doc = addNavInteraction(doc, r1.id, r2.id);
    doc = addNavInteraction(doc, r2.id, r3.id);
    doc = addNavInteraction(doc, r3.id, r1.id);

    const issues = analyzePrototypeFlow(doc);
    const critical = issues.filter((i) => i.type === 'dead-end' || i.type === 'orphan');
    expect(critical).toHaveLength(0);
  });

  it('detects dead-end screens with no interactions', () => {
    let doc = createDocument('test', true);
    const r1 = addFrame(doc, 's1', 'Screen A');
    doc = r1.doc;
    const r2 = addFrame(doc, 's2', 'Screen B');
    doc = r2.doc;
    doc = addNavInteraction(doc, r1.id, r2.id);

    const issues = analyzePrototypeFlow(doc);
    const deadEnds = issues.filter((i) => i.type === 'dead-end');
    expect(deadEnds).toHaveLength(1);
    expect(deadEnds[0].nodeId).toBe('s2');
    expect(deadEnds[0].message).toContain('Screen B');
  });

  it('detects orphan screens not reachable from any other screen', () => {
    let doc = createDocument('test', true);
    const r1 = addFrame(doc, 's1', 'Visible');
    doc = r1.doc;
    const r2 = addFrame(doc, 's2', 'Hidden');
    doc = r2.doc;

    const issues = analyzePrototypeFlow(doc);
    const orphans = issues.filter((i) => i.type === 'orphan');
    expect(orphans.length).toBeGreaterThanOrEqual(1);
    expect(orphans.some((o) => o.nodeId === 's2')).toBe(true);
  });

  it('detects missing back navigation', () => {
    let doc = createDocument('test', true);
    const r1 = addFrame(doc, 's1', 'Home');
    doc = r1.doc;
    const r2 = addFrame(doc, 's2', 'Details');
    doc = r2.doc;
    doc = addNavInteraction(doc, r1.id, r2.id);
    doc = addNavInteraction(doc, r2.id, r1.id);

    const issues = analyzePrototypeFlow(doc);
    const missingBack = issues.filter((i) => i.type === 'missing-back-nav');
    expect(missingBack.length).toBeGreaterThanOrEqual(1);
  });

  it('suggests back navigation for Detail screens to List screens', () => {
    let doc = createDocument('test', true);
    const r1 = addFrame(doc, 'list', 'Item List');
    doc = r1.doc;
    const r2 = addFrame(doc, 'detail', 'Item Detail');
    doc = r2.doc;
    doc = addNavInteraction(doc, r1.id, r2.id);

    const issues = analyzePrototypeFlow(doc);
    const navIssues = issues.filter((i) => i.type === 'missing-back-nav' && i.nodeId === 'detail');
    expect(navIssues.length).toBeGreaterThanOrEqual(1);
    expect(navIssues.some((i) => i.message.toLowerCase().includes('list'))).toBe(true);
  });

  it('detects inconsistent transition kinds across screens', () => {
    let doc = createDocument('test', true);
    const r1 = addFrame(doc, 's1', 'Screen A');
    doc = r1.doc;
    const r2 = addFrame(doc, 's2', 'Screen B');
    doc = r2.doc;
    const r3 = addFrame(doc, 's3', 'Screen C');
    doc = r3.doc;
    doc = addNavInteraction(doc, r1.id, r2.id, 'dissolve');
    doc = addNavInteraction(doc, r2.id, r3.id, 'slide');

    const issues = analyzePrototypeFlow(doc);
    const transitionIssues = issues.filter((i) => i.type === 'inconsistent-transition');
    expect(transitionIssues.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for documents with no frame nodes', () => {
    const doc = createDocument('test', true);
    const issues = analyzePrototypeFlow(doc);
    expect(issues).toHaveLength(0);
  });
});
