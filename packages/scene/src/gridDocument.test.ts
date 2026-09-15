/**
 * Active isometric grid resolution and mutation.
 *
 * The previous resolution (`Object.values(grids)[0]`) depended on object
 * insertion order; these tests pin the explicit, stable precedence.
 */

import { describe, expect, it } from 'vitest';
import {
  createDocument,
  resolveActiveIsometricGrid,
  setActiveIsometricGrid,
  setIsometricGrid,
} from './document';
import { createDefaultIsometricGrid } from './gridTypes';

function makeGrid(id: string, overrides: Record<string, unknown> = {}) {
  return { ...createDefaultIsometricGrid(), id, ...overrides };
}

describe('resolveActiveIsometricGrid', () => {
  it('returns undefined when no grids exist', () => {
    expect(resolveActiveIsometricGrid(createDocument())).toBeUndefined();
  });

  it('prefers the explicit active id, not insertion order', () => {
    const doc = createDocument();
    const withGrids = {
      ...doc,
      gridSettings: {
        isometricGrids: {
          zzz: makeGrid('zzz'),
          aaa: makeGrid('aaa'),
        },
        activeIsometricGridId: 'zzz',
      },
    };
    expect(resolveActiveIsometricGrid(withGrids)?.id).toBe('zzz');
  });

  it('falls back to the well-known default id, then lexicographic order', () => {
    const doc = createDocument();
    const withDefault = {
      ...doc,
      gridSettings: {
        isometricGrids: {
          zzz: makeGrid('zzz'),
          'grid-isometric-default': makeGrid('grid-isometric-default'),
        },
      },
    };
    expect(resolveActiveIsometricGrid(withDefault)?.id).toBe('grid-isometric-default');

    const withoutDefault = {
      ...doc,
      gridSettings: {
        isometricGrids: {
          zzz: makeGrid('zzz'),
          aaa: makeGrid('aaa'),
        },
      },
    };
    expect(resolveActiveIsometricGrid(withoutDefault)?.id).toBe('aaa');
  });

  it('ignores a dangling active id', () => {
    const doc = createDocument();
    const withGrids = {
      ...doc,
      gridSettings: {
        isometricGrids: { bbb: makeGrid('bbb') },
        activeIsometricGridId: 'missing',
      },
    };
    expect(resolveActiveIsometricGrid(withGrids)?.id).toBe('bbb');
  });
});

describe('grid mutation keeps the active choice explicit', () => {
  it('activates the first created grid', () => {
    const doc = createDocument();
    const next = setIsometricGrid(doc, 'grid-isometric-default', createDefaultIsometricGrid());
    expect(next.gridSettings?.activeIsometricGridId).toBe('grid-isometric-default');
    expect(resolveActiveIsometricGrid(next)?.id).toBe('grid-isometric-default');
  });

  it('does not steal the active id when editing a second grid', () => {
    const doc = createDocument();
    const first = setIsometricGrid(doc, 'one', makeGrid('one'));
    const withTwo = setIsometricGrid(first, 'two', makeGrid('two'));
    expect(withTwo.gridSettings?.activeIsometricGridId).toBe('one');
    const activated = setActiveIsometricGrid(withTwo, 'two');
    expect(resolveActiveIsometricGrid(activated)?.id).toBe('two');
  });

  it('rejects an unknown active id without changing the document', () => {
    const doc = createDocument();
    const withGrid = setIsometricGrid(doc, 'one', makeGrid('one'));
    expect(setActiveIsometricGrid(withGrid, 'nope')).toBe(withGrid);
  });

  it('sanitizes the grid before storing it', () => {
    const doc = createDocument();
    const next = setIsometricGrid(doc, 'nan-grid', {
      ...makeGrid('nan-grid'),
      spacing: Number.NaN,
    } as ReturnType<typeof makeGrid>);
    const stored = next.gridSettings?.isometricGrids?.['nan-grid'];
    expect(stored).toBeDefined();
    expect(Number.isFinite(stored!.spacing)).toBe(true);
    expect(stored!.spacingMode).toBe('axis-step');
  });
});
