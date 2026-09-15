import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import {
  addInteraction,
  clearInteractionsForNode,
  flattenInteractions,
  getInteractionsForNode,
  removeInteraction,
  updateInteraction,
} from './interactions';

describe('interactions', () => {
  const nodeId = 'n1';

  it('addInteraction stores on node', () => {
    const doc = createDocument();
    const { doc: next, id } = addInteraction(doc, nodeId, {
      name: 'Click to navigate',
      trigger: { kind: 'onClick' },
      actions: [
        {
          kind: 'navigateTo',
          targetId: 'n2',
          transition: { kind: 'dissolve', duration: 300, easing: { kind: 'ease' } },
        },
      ],
      enabled: true,
    });
    expect(id).toMatch(/^ix-/);
    expect(getInteractionsForNode(next, nodeId)).toHaveLength(1);
    expect(getInteractionsForNode(next, nodeId)[0]?.name).toBe('Click to navigate');
  });

  it('flattenInteractions returns all entries', () => {
    const doc = createDocument();
    const { doc: d1 } = addInteraction(doc, 'n1', {
      name: 'A',
      trigger: { kind: 'onClick' },
      actions: [],
      enabled: true,
    });
    const { doc: d2 } = addInteraction(d1, 'n2', {
      name: 'B',
      trigger: { kind: 'onHover' },
      actions: [],
      enabled: true,
    });
    expect(flattenInteractions(d2)).toHaveLength(2);
  });

  it('removeInteraction deletes by id', () => {
    let doc = createDocument();
    const { doc: d2, id } = addInteraction(doc, nodeId, {
      name: 'X',
      trigger: { kind: 'onClick' },
      actions: [],
      enabled: true,
    });
    doc = removeInteraction(d2, id);
    expect(getInteractionsForNode(doc, nodeId)).toHaveLength(0);
  });

  it('updateInteraction patches fields', () => {
    let doc = createDocument();
    const { doc: d2, id } = addInteraction(doc, nodeId, {
      name: 'Old',
      trigger: { kind: 'onClick' },
      actions: [],
      enabled: true,
    });
    doc = updateInteraction(d2, id, { name: 'New', enabled: false });
    const ix = getInteractionsForNode(doc, nodeId)[0];
    expect(ix?.name).toBe('New');
    expect(ix?.enabled).toBe(false);
  });

  it('clearInteractionsForNode removes node bucket', () => {
    let doc = createDocument();
    const { doc: d2 } = addInteraction(doc, nodeId, {
      name: 'X',
      trigger: { kind: 'onClick' },
      actions: [],
      enabled: true,
    });
    doc = clearInteractionsForNode(d2, nodeId);
    expect(doc.interactions).toBeUndefined();
  });
});
