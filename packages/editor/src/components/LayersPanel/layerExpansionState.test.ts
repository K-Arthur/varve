import { describe, expect, it } from 'vitest';
import { decodeExpansionTransfer, encodeExpansionTransfer } from './layerExpansionState';

describe('layer expansion transfer', () => {
  it('preserves an explicitly empty disclosure set', () => {
    const encoded = encodeExpansionTransfer([]);
    expect(decodeExpansionTransfer(encoded)).toEqual(new Set());
  });

  it('round-trips large disclosure sets without array truncation', () => {
    const ids = Array.from({ length: 1_250 }, (_, index) => `node-${index}`);
    const decoded = decodeExpansionTransfer(encodeExpansionTransfer(ids));
    expect(decoded?.size).toBe(ids.length);
    expect([...decoded!]).toEqual(ids);
  });

  it('rejects untagged legacy values instead of treating empty as missing', () => {
    expect(decodeExpansionTransfer([])).toBeNull();
    expect(decodeExpansionTransfer({ initialized: false, encodedIds: '' })).toBeNull();
  });
});
