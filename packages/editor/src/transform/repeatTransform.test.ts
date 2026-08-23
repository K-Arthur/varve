// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  clearRepeatTransform,
  getLastRepeatTransform,
  storeRepeatTransform,
} from './repeatTransform';

describe('repeatTransform', () => {
  it('stores and retrieves a transform delta', () => {
    const delta = [2, 0, 0, 2, 10, 20] as const;
    storeRepeatTransform(delta, ['n1', 'n2']);
    const stored = getLastRepeatTransform();
    expect(stored).not.toBeNull();
    expect(stored!.delta).toEqual(delta);
    expect(stored!.selectionSnapshot).toEqual(['n1', 'n2']);
  });

  it('returns null when nothing is stored', () => {
    clearRepeatTransform();
    expect(getLastRepeatTransform()).toBeNull();
  });

  it('does not store identity deltas', () => {
    const identity = [1, 0, 0, 1, 0, 0] as const;
    storeRepeatTransform(identity, ['n1']);
    expect(getLastRepeatTransform()).toBeNull();
  });

  it('clear removes stored transform', () => {
    storeRepeatTransform([2, 0, 0, 2, 0, 0], ['n1']);
    expect(getLastRepeatTransform()).not.toBeNull();
    clearRepeatTransform();
    expect(getLastRepeatTransform()).toBeNull();
  });

  it('stores a copy of the selection array', () => {
    const sel = ['n1', 'n2'];
    storeRepeatTransform([1.5, 0, 0, 1.5, 0, 0], sel);
    sel.push('n3');
    const stored = getLastRepeatTransform();
    expect(stored!.selectionSnapshot).toEqual(['n1', 'n2']);
  });
});
