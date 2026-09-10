import { describe, expect, it } from 'vitest';
import { normalizeSavedAreaSelections } from './savedAreaSelection';

describe('saved area selection persistence', () => {
  it('drops malformed and duplicate entries at the boundary', () => {
    const result = normalizeSavedAreaSelections([
      {
        id: 'valid',
        name: 'Selection',
        createdAt: 10,
        selection: {
          coordinateSpace: 'document',
          generation: 1,
          expression: {
            kind: 'shape',
            shape: {
              kind: 'rectangle',
              x: 0,
              y: 0,
              w: 20,
              h: 10,
              feather: 0,
              antialias: true,
            },
          },
        },
      },
      {
        id: 'valid',
        name: 'Duplicate',
        createdAt: 11,
        selection: {},
      },
      {
        id: 'bad',
        name: 'Bad',
        createdAt: 12,
        selection: { coordinateSpace: 'document', generation: 0, expression: { kind: 'shape' } },
      },
    ]);

    expect(result.selections).toHaveLength(1);
    expect(result.selections[0]?.id).toBe('valid');
    expect(result.dropped).toBe(2);
    expect(result.changed).toBe(true);
  });
});
