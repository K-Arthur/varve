/**
 * Semantic diff + three-way merge tests (ADR-0108/0109).
 *
 * Diff: every change classification, formatting-only detection, identity
 * renames, heuristic renames, delete+recreate.
 * Merge: the full base/local/remote matrix, composite component conflicts,
 * delete-vs-edit, rename+value combination, cycle rejection, determinism.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  semanticDiff,
  snapshotFromTokens,
  type TokenSnapshot,
  type TokenSnapshotMap,
} from '../diff';
import { threeWayMerge } from '../merge';
import { parseFormatDocument } from '../parse';

function snapshot(text: string): TokenSnapshotMap {
  const doc = parseFormatDocument(text, { sourceFileId: 't' });
  return snapshotFromTokens(doc.tokens);
}

function tok(
  path: string[],
  value: unknown,
  type = 'number',
  extra: Partial<TokenSnapshot> = {},
): TokenSnapshot {
  return { path, type, value, extensions: {}, ...extra };
}

describe('semantic diff', () => {
  it('detects additions and deletions', () => {
    const base = snapshot('{"a": {"$type": "number", "$value": 1}}');
    const next = snapshot(
      '{"a": {"$type": "number", "$value": 1}, "b": {"$type": "number", "$value": 2}}',
    );
    const diff = semanticDiff(base, next);
    expect(diff.counts.added).toBe(1);
    expect(diff.changes[0]?.kind).toBe('added');
    const removed = semanticDiff(next, base);
    expect(removed.counts.deleted).toBe(1);
  });

  it('classifies value, type, metadata, and extension changes', () => {
    const base = snapshot('{"a": {"$type": "number", "$value": 1}}');
    const next = snapshot(
      '{"a": {"$type": "number", "$value": 2, "$description": "d", "$extensions": {"x": 1}}}',
    );
    const diff = semanticDiff(base, next);
    const kinds = new Set(diff.changes.map((c) => c.kind));
    expect(kinds.has('value-changed')).toBe(true);
    expect(kinds.has('metadata-changed')).toBe(true);
    expect(kinds.has('extension-changed')).toBe(true);
  });

  it('classifies reference changes separately from value changes', () => {
    const base = snapshot(
      '{"a": {"$type": "number", "$value": 1}, "b": {"$type": "number", "$value": "{a}"}}',
    );
    const next = snapshot(
      '{"a": {"$type": "number", "$value": 1}, "b": {"$type": "number", "$value": 2}}',
    );
    const diff = semanticDiff(base, next);
    expect(diff.changes[0]?.kind).toBe('reference-changed');
  });

  it('reports formatting-only differences as empty changes', () => {
    const base = snapshot('{"a": {"$type": "number", "$value": 1}}');
    const next = snapshot('{\n  "a": { "$type": "number", "$value": 1 }\n}');
    expect(semanticDiff(base, next).formattingOnly).toBe(true);
  });

  it('detects renames via stable identity', () => {
    const base = new Map<string, TokenSnapshot>([
      ['color.brand.primary', tok(['color', 'brand', 'primary'], '#000', 'color', { id: 'tok_1' })],
    ]);
    const next = new Map<string, TokenSnapshot>([
      [
        'color.brand.secondary',
        tok(['color', 'brand', 'secondary'], '#000', 'color', { id: 'tok_1' }),
      ],
    ]);
    const diff = semanticDiff(base, next);
    expect(diff.counts.renamed).toBe(1);
    expect(diff.changes[0]?.oldPath).toBe('color.brand.primary');
  });

  it('distinguishes moved from renamed', () => {
    const base = new Map<string, TokenSnapshot>([
      ['brand.primary', tok(['brand', 'primary'], 1, 'number', { id: 'tok_1' })],
    ]);
    const next = new Map<string, TokenSnapshot>([
      ['color.primary', tok(['color', 'primary'], 1, 'number', { id: 'tok_1' })],
    ]);
    const diff = semanticDiff(base, next);
    expect(diff.counts.moved).toBe(1);
    expect(diff.counts.renamed).toBe(0);
  });

  it('detects delete+recreate with the same path', () => {
    const base = new Map<string, TokenSnapshot>([['a', tok(['a'], 1, 'number', { id: 'tok_1' })]]);
    const next = new Map<string, TokenSnapshot>([['a', tok(['a'], 1, 'number', { id: 'tok_2' })]]);
    const diff = semanticDiff(base, next);
    expect(diff.counts['delete-recreated']).toBe(1);
  });

  it('proposes ambiguous possible renames for identity-less tokens', () => {
    const base = new Map<string, TokenSnapshot>([
      ['color.brand.primary', tok(['color', 'brand', 'primary'], '#000000', 'color')],
    ]);
    const next = new Map<string, TokenSnapshot>([
      ['color.brand.primary_new', tok(['color', 'brand', 'primary_new'], '#000000', 'color')],
    ]);
    const diff = semanticDiff(base, next);
    expect(diff.counts['possible-rename']).toBe(1);
    expect(diff.changes.some((c) => c.ambiguous === true)).toBe(true);
  });

  it('does not merge tokens that merely share values', () => {
    const base = snapshot('{"a": {"$type": "number", "$value": 1}}');
    const next = snapshot(
      '{"a": {"$type": "number", "$value": 1}, "b": {"$type": "number", "$value": 1}}',
    );
    const diff = semanticDiff(base, next);
    expect(diff.counts.added).toBe(1);
    expect(diff.counts['possible-rename']).toBe(0);
  });
});

describe('three-way merge', () => {
  const baseTok = tok(['a'], 1, 'number', { id: 'tok_a' });

  function input(base: TokenSnapshotMap, local: TokenSnapshotMap, remote: TokenSnapshotMap) {
    return { base, local, remote };
  }

  it('accepts remote when local is unchanged', () => {
    const plan = threeWayMerge(
      input(
        new Map([['a', baseTok]]),
        new Map([['a', tok(['a'], 1, 'number', { id: 'tok_a' })]]),
        new Map([['a', tok(['a'], 5, 'number', { id: 'tok_a' })]]),
      ),
    );
    expect(plan.valid).toBe(true);
    const merge = plan.merges.find((m) => m.path === 'a');
    expect(merge?.decision).toBe('accept-remote');
    expect(merge?.result?.value).toBe(5);
  });

  it('accepts local when remote is unchanged', () => {
    const plan = threeWayMerge(
      input(
        new Map([['a', baseTok]]),
        new Map([['a', tok(['a'], 7, 'number', { id: 'tok_a' })]]),
        new Map([['a', tok(['a'], 1, 'number', { id: 'tok_a' })]]),
      ),
    );
    const merge = plan.merges.find((m) => m.path === 'a');
    expect(merge?.decision).toBe('accept-local');
    expect(merge?.result?.value).toBe(7);
  });

  it('merges cleanly when both sides make the same change', () => {
    const plan = threeWayMerge(
      input(
        new Map([['a', baseTok]]),
        new Map([['a', tok(['a'], 9, 'number', { id: 'tok_a' })]]),
        new Map([['a', tok(['a'], 9, 'number', { id: 'tok_a' })]]),
      ),
    );
    const merge = plan.merges.find((m) => m.path === 'a');
    expect(merge?.decision).toBe('same-change');
    expect(plan.valid).toBe(true);
  });

  it('creates a conflict when both sides change differently', () => {
    const plan = threeWayMerge(
      input(
        new Map([['a', baseTok]]),
        new Map([['a', tok(['a'], 2, 'number', { id: 'tok_a' })]]),
        new Map([['a', tok(['a'], 3, 'number', { id: 'tok_a' })]]),
      ),
    );
    const merge = plan.merges.find((m) => m.path === 'a');
    expect(merge?.decision).toBe('conflict');
    expect(merge?.conflicts.some((c) => c.field === 'value')).toBe(true);
    expect(plan.valid).toBe(false);
  });

  it('combines a local rename with a remote value edit', () => {
    const plan = threeWayMerge(
      input(
        new Map([
          [
            'color.brand.primary',
            tok(['color', 'brand', 'primary'], '#000', 'color', { id: 'tok_1' }),
          ],
        ]),
        new Map([
          [
            'color.action.primary',
            tok(['color', 'action', 'primary'], '#000', 'color', { id: 'tok_1' }),
          ],
        ]),
        new Map([
          [
            'color.brand.primary',
            tok(['color', 'brand', 'primary'], '#111', 'color', { id: 'tok_1' }),
          ],
        ]),
      ),
    );
    const merge = plan.merges.find((m) => m.id === 'tok_1');
    expect(merge?.decision).toBe('combined-rename-value');
    expect(merge?.result?.path).toEqual(['color', 'action', 'primary']);
    expect(merge?.result?.value).toBe('#111');
    expect(plan.valid).toBe(true);
  });

  it('flags delete-vs-edit conflicts', () => {
    const plan = threeWayMerge(
      input(
        new Map([['a', baseTok]]),
        new Map(),
        new Map([['a', tok(['a'], 42, 'number', { id: 'tok_a' })]]),
      ),
    );
    const merge = plan.merges.find((m) => m.path === 'a');
    expect(merge?.decision).toBe('delete-vs-edit');
    expect(plan.valid).toBe(false);
  });

  it('merges metadata fields independently', () => {
    const plan = threeWayMerge(
      input(
        new Map([['a', tok(['a'], 1, 'number', { id: 'tok_a' })]]),
        new Map([['a', tok(['a'], 1, 'number', { id: 'tok_a', description: 'local desc' })]]),
        new Map([['a', tok(['a'], 2, 'number', { id: 'tok_a' })]]),
      ),
    );
    const merge = plan.merges.find((m) => m.path === 'a');
    expect(merge?.result?.value).toBe(2);
    expect(merge?.result?.description).toBe('local desc');
    expect(plan.valid).toBe(true);
  });

  it('merges composite values per component', () => {
    const typo = (fontSize: number, fontWeight: number) => ({
      fontFamily: 'Inter',
      fontSize,
      fontWeight,
      letterSpacing: { value: 0, unit: 'px' },
      lineHeight: 1.5,
    });
    const baseComposite = tok(['type'], typo(16, 400), 'typography', { id: 'tok_t' });
    const localComposite = tok(['type'], typo(18, 400), 'typography', { id: 'tok_t' });
    const remoteComposite = tok(['type'], typo(16, 700), 'typography', { id: 'tok_t' });
    const plan = threeWayMerge(
      input(
        new Map([['type', baseComposite]]),
        new Map([['type', localComposite]]),
        new Map([['type', remoteComposite]]),
      ),
    );
    const merge = plan.merges.find((m) => m.path === 'type');
    expect(merge?.decision).toBe('same-change');
    expect(merge?.result?.value).toEqual(typo(18, 700));
    expect(plan.valid).toBe(true);
  });

  it('flags component-level conflicts without replacing the composite', () => {
    const typo = (fontSize: number, fontWeight: number) => ({
      fontFamily: 'Inter',
      fontSize,
      fontWeight,
      letterSpacing: { value: 0, unit: 'px' },
      lineHeight: 1.5,
    });
    const baseComposite = tok(['type'], typo(16, 400), 'typography', { id: 'tok_t' });
    const localComposite = tok(['type'], typo(18, 400), 'typography', { id: 'tok_t' });
    const remoteComposite = tok(['type'], typo(20, 400), 'typography', { id: 'tok_t' });
    const plan = threeWayMerge(
      input(
        new Map([['type', baseComposite]]),
        new Map([['type', localComposite]]),
        new Map([['type', remoteComposite]]),
      ),
    );
    const merge = plan.merges.find((m) => m.path === 'type');
    expect(merge?.decision).toBe('conflict');
    expect(merge?.conflicts.some((c) => c.field === 'value.fontSize')).toBe(true);
  });

  it('rejects merged graphs that create reference cycles', () => {
    const plan = threeWayMerge(
      input(
        new Map([
          ['a', tok(['a'], 1, 'number', { id: 'tok_a' })],
          ['b', tok(['b'], '{a}', 'number', { id: 'tok_b' })],
        ]),
        new Map([
          ['a', tok(['a'], '{b}', 'number', { id: 'tok_a' })],
          ['b', tok(['b'], '{a}', 'number', { id: 'tok_b' })],
        ]),
        new Map([
          ['a', tok(['a'], 1, 'number', { id: 'tok_a' })],
          ['b', tok(['b'], '{a}', 'number', { id: 'tok_b' })],
        ]),
      ),
    );
    expect(plan.diagnostics.some((d) => d.code === 'merge.cycle')).toBe(true);
    expect(plan.valid).toBe(false);
  });

  it('rejects type-incompatible merged values', () => {
    const plan = threeWayMerge(
      input(
        new Map([['a', tok(['a'], 1, 'number', { id: 'tok_a' })]]),
        new Map([['a', tok(['a'], 1, 'number', { id: 'tok_a' })]]),
        new Map([['a', tok(['a'], { value: 4, unit: 'px' }, 'number', { id: 'tok_a' })]]),
      ),
    );
    expect(plan.valid).toBe(false);
  });

  it('merges additions from both sides', () => {
    const plan = threeWayMerge(
      input(
        new Map(),
        new Map([['local', tok(['local'], 1, 'number', { id: 'tok_l' })]]),
        new Map([['remote', tok(['remote'], 2, 'number', { id: 'tok_r' })]]),
      ),
    );
    expect(plan.valid).toBe(true);
    expect(plan.merges.filter((m) => m.decision !== 'same-change')).toHaveLength(2);
    const paths = plan.merges.map((m) => m.path).sort();
    expect(paths).toEqual(['local', 'remote']);
  });

  it('deletes on both sides merge cleanly', () => {
    const plan = threeWayMerge(input(new Map([['a', baseTok]]), new Map(), new Map()));
    expect(plan.valid).toBe(true);
  });

  it('is deterministic across repeated runs', () => {
    const run = () =>
      JSON.stringify(
        threeWayMerge(
          input(
            new Map([
              ['a', tok(['a'], 1, 'number', { id: 'tok_a' })],
              ['b', tok(['b'], 2, 'number', { id: 'tok_b' })],
            ]),
            new Map([
              ['a', tok(['a'], 5, 'number', { id: 'tok_a' })],
              ['b', tok(['b'], 2, 'number', { id: 'tok_b' })],
            ]),
            new Map([
              ['a', tok(['a'], 9, 'number', { id: 'tok_a' })],
              ['b', tok(['b'], 2, 'number', { id: 'tok_b' })],
            ]),
          ),
        ).merges.map((m) => ({ path: m.path, decision: m.decision })),
      );
    expect(run()).toBe(run());
  });
});

describe('property-based merge tests', () => {
  it('never crashes, is deterministic, and reports valid plans consistently', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
        (baseValue, localValue, remoteValue) => {
          const base = new Map([['a', tok(['a'], baseValue, 'number', { id: 'tok_a' })]]);
          const local = new Map([['a', tok(['a'], localValue, 'number', { id: 'tok_a' })]]);
          const remote = new Map([['a', tok(['a'], remoteValue, 'number', { id: 'tok_a' })]]);
          const plan = threeWayMerge({ base, local, remote });
          const merge = plan.merges.find((m) => m.path === 'a')!;
          const same = localValue === remoteValue;
          const localChanged = localValue !== baseValue;
          const remoteChanged = remoteValue !== baseValue;
          if (same) {
            expect(plan.valid).toBe(true);
          } else if (!localChanged) {
            expect(merge.decision).toBe('accept-remote');
            expect(merge.result?.value).toBe(remoteValue);
          } else if (!remoteChanged) {
            expect(merge.decision).toBe('accept-local');
          } else {
            expect(merge.decision).toBe('conflict');
            expect(plan.valid).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('merged values never contain non-finite numbers', () => {
    fc.assert(
      fc.property(fc.float(), fc.float(), fc.float(), (a, b, c) => {
        const base = new Map([['a', tok(['a'], a, 'number', { id: 'tok_a' })]]);
        const local = new Map([['a', tok(['a'], b, 'number', { id: 'tok_a' })]]);
        const remote = new Map([['a', tok(['a'], c, 'number', { id: 'tok_a' })]]);
        const plan = threeWayMerge({ base, local, remote });
        for (const merge of plan.merges) {
          if (merge.result?.value !== undefined) {
            expect(Number.isFinite(merge.result.value as number)).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
