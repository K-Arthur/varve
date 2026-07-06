import { describe, expect, it } from 'vitest';
import { createDocument, addInteraction } from '@strata/scene';
import { createRuntimeFromDocument, interactionsMapFromDocument } from './prototypeRuntime';

describe('prototypeRuntime', () => {
  it('loads interactions from document into runtime', () => {
    let doc = createDocument();
    const { doc: next } = addInteraction(doc, 'n1', {
      name: 'Navigate',
      trigger: { kind: 'onClick' },
      actions: [
        {
          kind: 'navigateTo',
          targetId: 'frame-1',
          transition: { kind: 'instant', duration: 0, easing: { kind: 'linear' } },
        },
      ],
      enabled: true,
    });
    doc = next;

    const { runtime } = createRuntimeFromDocument(doc);
    expect(runtime.interactions).toHaveLength(1);
    expect(runtime.interactions[0]?.name).toBe('Navigate');
  });

  it('interactionsMapFromDocument preserves node buckets', () => {
    let doc = createDocument();
    const { doc: next } = addInteraction(doc, 'n1', {
      name: 'A',
      trigger: { kind: 'onClick' },
      actions: [],
      enabled: true,
    });
    const map = interactionsMapFromDocument(next);
    expect(map.n1).toHaveLength(1);
  });
});
