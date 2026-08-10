import { describe, expect, it } from 'vitest';
import { createSavePlan } from '../savePlan';
import { createFakeApi, type FakeApiControls } from './testHarness';

const DOC_A = { sessionId: 'a', name: 'A.varve', filePath: '/p/a.varve', untitled: false };
const DOC_B = { sessionId: 'b', name: 'Untitled', untitled: true };

describe('save plan', () => {
  it('saves each document exactly once and reports saved', async () => {
    const controls: FakeApiControls = createFakeApi([
      { id: 'a', name: 'A.varve', dirty: true, filePath: '/p/a.varve' },
      { id: 'b', name: 'Untitled', dirty: true },
    ]);
    const plan = createSavePlan(controls.api);
    const result = await plan.execute([DOC_A, DOC_B]);
    expect(result.aborted).toBe(false);
    expect(result.failures).toHaveLength(0);
    expect(result.results).toEqual([
      { kind: 'saved', sessionId: 'a' },
      { kind: 'saved', sessionId: 'b' },
    ]);
    expect(controls.saveCalls).toEqual(['a', 'b']);
  });

  it('stays dirty after a stale save: edits landing mid-save trigger a re-save', async () => {
    const controls = createFakeApi([
      { id: 'a', name: 'A.varve', dirty: true, filePath: '/p/a.varve' },
    ]);
    // Simulate: save succeeds but an edit landed during the write, so the
    // document is still dirty after the first attempt.
    controls.setClearDirtyOnSave(false);
    controls.setDirty('a', true);
    let call = 0;
    const plan = createSavePlan(
      {
        ...controls.api,
        saveSession: async () => {
          call++;
          if (call === 1) return { ok: true }; // stale save
          controls.setDirty('a', false); // second save persists the new revision
          return { ok: true };
        },
      },
      { maxRetries: 2 },
    );
    const result = await plan.execute([DOC_A]);
    expect(result.results).toEqual([{ kind: 'saved', sessionId: 'a' }]);
    expect(call).toBe(2);
  });

  it('fails with conflict when the document stays dirty past the retry budget', async () => {
    const controls = createFakeApi([
      { id: 'a', name: 'A.varve', dirty: true, filePath: '/p/a.varve' },
    ]);
    controls.setClearDirtyOnSave(false);
    const plan = createSavePlan(controls.api, { maxRetries: 1 });
    const result = await plan.execute([DOC_A]);
    expect(result.results).toEqual([{ kind: 'failed', sessionId: 'a', category: 'conflict' }]);
    expect(result.failures).toHaveLength(1);
  });

  it('aborts the transaction when a Save As picker is cancelled — never discard', async () => {
    const controls = createFakeApi([{ id: 'b', name: 'Untitled', dirty: true }]);
    controls.setSaveResult({ ok: false, cancelled: true });
    const plan = createSavePlan(controls.api);
    const result = await plan.execute([DOC_B]);
    expect(result.aborted).toBe(true);
    expect(result.results).toEqual([{ kind: 'cancelled', sessionId: 'b' }]);
  });

  it('reports a structured failure category for failed saves', async () => {
    const controls = createFakeApi([
      { id: 'a', name: 'A.varve', dirty: true, filePath: '/p/a.varve' },
    ]);
    controls.setSaveResult({ ok: false, cancelled: false });
    controls.setLastSaveFailure('disk-full');
    const plan = createSavePlan(controls.api);
    const result = await plan.execute([DOC_A]);
    expect(result.results).toEqual([{ kind: 'failed', sessionId: 'a', category: 'disk-full' }]);
    expect(result.failures).toEqual([{ kind: 'failed', sessionId: 'a', category: 'disk-full' }]);
    expect(result.aborted).toBe(false);
  });

  it('does not write the same session twice (save dedup within one plan)', async () => {
    const controls = createFakeApi([
      { id: 'a', name: 'A.varve', dirty: true, filePath: '/p/a.varve' },
    ]);
    const plan = createSavePlan(controls.api);
    await plan.execute([DOC_A, DOC_A]);
    expect(controls.saveCalls).toEqual(['a']);
  });
});
