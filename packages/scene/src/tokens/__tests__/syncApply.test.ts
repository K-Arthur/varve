/**
 * Sync application tests: applying merge plans to the token store and the
 * variable bridge as one coherent transaction (ADR-0108/0116).
 */

import { parseFormatDocument, snapshotFromTokens, threeWayMerge } from '@varve/tokens';
import { describe, expect, it } from 'vitest';
import { createVariableStore } from '../../variables';
import { createEmptyTokenSynchronization } from '../store';
import { applyMergePlanToSync } from '../syncApply';

function parse(text: string) {
  return snapshotFromTokens(parseFormatDocument(text, { sourceFileId: 't' }).tokens);
}

describe('sync apply', () => {
  it('applies a resolved merge plan to the token store and backing variables', () => {
    const plan = threeWayMerge({
      base: parse('{"a": {"$type": "number", "$value": 1}}'),
      local: parse('{"a": {"$type": "number", "$value": 1}}'),
      remote: parse('{"a": {"$type": "number", "$value": 42}}'),
    });
    expect(plan.valid).toBe(true);

    const result = applyMergePlanToSync(
      createEmptyTokenSynchronization(),
      createVariableStore(),
      plan,
    );
    expect(result.applied).toBe(1);
    expect(result.skippedConflicts).toBe(0);
    const token = Object.values(result.sync.store.tokens)[0];
    expect(token?.value).toBe(42);
    expect(result.touchedVariableIds.length).toBeGreaterThan(0);
    const variableId = result.touchedVariableIds[0]!;
    expect(result.variables?.variables[variableId]?.valuesByMode['default']).toBe(42);
  });

  it('preserves token ids across a merged rename (bindings stay intact)', () => {
    const base = parse(
      '{"color": {"brand": {"primary": {"$type": "color", "$value": "#000000"}}}}',
    );
    const local = parse(
      '{"color": {"action": {"primary": {"$type": "color", "$value": "#000000"}}}}',
    );
    const remote = parse(
      '{"color": {"brand": {"primary": {"$type": "color", "$value": "#111111"}}}}',
    );
    // Identity-less snapshots: attach stable ids to prove id preservation.
    for (const token of base.values()) token.id = 'tok_1';
    for (const token of local.values()) token.id = 'tok_1';
    for (const token of remote.values()) token.id = 'tok_1';
    const plan = threeWayMerge({ base, local, remote });
    const merge = plan.merges.find((m) => m.id === 'tok_1');
    expect(merge?.decision).toBe('combined-rename-value');
    const result = applyMergePlanToSync(
      createEmptyTokenSynchronization(),
      createVariableStore(),
      plan,
    );
    const token = Object.values(result.sync.store.tokens)[0];
    expect(token?.id).toBe('tok_1');
    expect(token?.path).toEqual(['color', 'action', 'primary']);
    expect(token?.value).toBe('#111111');
  });

  it('skips conflicted merges without mutating the store', () => {
    const plan = threeWayMerge({
      base: parse('{"a": {"$type": "number", "$value": 1}}'),
      local: parse('{"a": {"$type": "number", "$value": 2}}'),
      remote: parse('{"a": {"$type": "number", "$value": 3}}'),
    });
    expect(plan.valid).toBe(false);
    const result = applyMergePlanToSync(
      createEmptyTokenSynchronization(),
      createVariableStore(),
      plan,
    );
    expect(result.skippedConflicts).toBe(1);
    expect(result.applied).toBe(0);
    expect(Object.keys(result.sync.store.tokens)).toHaveLength(0);
  });
});
