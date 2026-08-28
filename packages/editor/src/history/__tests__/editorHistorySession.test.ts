/**
 * EditorHistorySession tests (M7 editor wiring core, ADR-0019/0020/0023).
 *
 * Covers: genesis attach, capture → revision chain with monotonic logical
 * sequences, undo/redo head movement with selection journal restore,
 * divergence branching (abandoned paths preserved and materializable),
 * branch deletion protection, checkpoints, and merge-base discovery.
 */
import {
  createMemoryHistoryStore,
  type HistoryStore,
  MemoryRasterTileStore,
  type RasterTileStore,
} from '@varve/history';
import type { Document } from '@varve/scene';
import {
  applyOperation,
  canonicalHistoryHash,
  compositeDabOnNode,
  createDocument,
  makePathNode,
  makeRasterLayerNode,
  makeShapeNode,
  registerBuiltinOperations,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { EditorHistorySession } from '../editorHistorySession';

registerBuiltinOperations();

const DOC_ID = 'session-test-doc';
const ACTOR = 'test-actor';

function baseDoc(): Document {
  const doc = {
    ...createDocument(DOC_ID, { flat: true }),
    id: DOC_ID,
  } as Document;
  const a = makeShapeNode('n1_aaaa', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
  return applyOperation(doc, 'node.create', { node: a });
}

function newSession(store: HistoryStore, rasterTileStore?: RasterTileStore) {
  return new EditorHistorySession({
    store,
    documentId: DOC_ID,
    authorActorId: ACTOR,
    rasterTileStore,
  });
}

describe('EditorHistorySession', () => {
  it('attaches a fresh document with a genesis revision and default branch', async () => {
    const store = createMemoryHistoryStore();
    const session = newSession(store);
    const result = await session.attach(baseDoc());
    expect(result.reconciled).toBe(false);
    expect(result.headRevision.parentRevisionIds).toHaveLength(0);
    expect(result.branch.name).toBe('main');
    expect(session.attached).toBe(true);
    expect(session.canUndo).toBe(false);
    const revisions = await store.listRevisions(DOC_ID);
    expect(revisions).toHaveLength(1);
    const branches = await store.listBranches(DOC_ID);
    expect(branches.map((b) => b.name)).toEqual(['main']);
  });

  it('captures transactions as one-parent revisions with monotonic sequences', async () => {
    const store = createMemoryHistoryStore();
    const session = newSession(store);
    await session.attach(baseDoc());
    let doc = baseDoc();
    for (let i = 1; i <= 4; i++) {
      const next = doc;
      doc = applyOperation(next, 'node.patch', {
        nodeId: 'n1_aaaa',
        path: 'opacity',
        value: i / 10,
      });
      await session.capture(next, doc, [], { label: `Opacity ${i}`, kind: 'modify' });
    }
    const steps = await session.steps();
    expect(steps).toHaveLength(5);
    expect(steps.map((s) => s.label)).toEqual([
      'Genesis',
      'Opacity 1',
      'Opacity 2',
      'Opacity 3',
      'Opacity 4',
    ]);
    expect(steps[4]!.isHead).toBe(true);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.revision.parentRevisionIds).toEqual([steps[i - 1]!.revision.revisionId]);
    }
    const segments = await store.listSegments(DOC_ID);
    const sequences = segments.flatMap((s) => s.operations.map((o) => o.logicalSequence));
    expect(sequences).toEqual([1, 2, 3, 4]);
  });

  it('suppresses empty captures (reference-equal documents)', async () => {
    const store = createMemoryHistoryStore();
    const session = newSession(store);
    await session.attach(baseDoc());
    const doc = baseDoc();
    await session.capture(doc, doc, [], { label: 'No-op', kind: 'modify' });
    const steps = await session.steps();
    expect(steps).toHaveLength(1);
  });

  it('round-trips fractional Bezier geometry and a committed brush stroke exactly', async () => {
    const store = createMemoryHistoryStore();
    const tiles = new MemoryRasterTileStore();
    const path = makePathNode('path_fractional', {
      closed: true,
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: [12.375, -6.625] },
        {
          x: 120.12573,
          y: 83.77311,
          handleIn: [-17.38291, 4.99127],
          handleOut: [23.77831, -11.28441],
        },
        { x: 180.5, y: 140.25, handleIn: [-12.5, 8.25], handleOut: null },
        { x: 20.75, y: 130.5, handleIn: null, handleOut: [-4.5, -13.25] },
      ],
    });
    const raster = makeRasterLayerNode('raster_above', { width: 256, height: 256 });
    const initial: Document = {
      ...baseDoc(),
      nodes: { ...baseDoc().nodes, [path.id]: path, [raster.id]: raster },
      rootChildren: [...baseDoc().rootChildren, path.id, raster.id],
    };
    const session = newSession(store, tiles);
    await session.attach(initial);

    const movedPath = {
      ...path,
      points: path.points.map((point, index) =>
        index === 1 ? { ...point, x: 121.0000004, handleOut: [24.000001, -11.28441] } : point,
      ),
    };
    const vectorAfter: Document = {
      ...initial,
      nodes: { ...initial.nodes, [path.id]: movedPath },
    };
    await session.capture(initial, vectorAfter, [path.id], {
      label: 'Move Path Node',
      kind: 'modify',
    });

    const paintedRaster = compositeDabOnNode(
      raster,
      {
        x: 121,
        y: 84,
        radius: 12.5,
        opacity: 0.92,
        flow: 0.77,
        hardness: 0.4,
        angle: 0,
        roundness: 1,
        strokeT: 0,
        strokeDistance: 0,
      },
      [30, 160, 230, 255],
    );
    const rasterAfter: Document = {
      ...vectorAfter,
      nodes: { ...vectorAfter.nodes, [raster.id]: paintedRaster },
    };
    await session.capture(vectorAfter, rasterAfter, [raster.id], {
      label: 'Brush Stroke',
      kind: 'paint',
    });

    const undoPaint = await session.undo();
    expect(undoPaint).not.toBeNull();
    expect(canonicalHistoryHash(undoPaint!.document)).toBe(canonicalHistoryHash(vectorAfter));
    expect((undoPaint!.document.nodes[path.id] as typeof path).points).toEqual(movedPath.points);

    const undoVector = await session.undo();
    expect(undoVector).not.toBeNull();
    expect(canonicalHistoryHash(undoVector!.document)).toBe(canonicalHistoryHash(initial));
    expect((undoVector!.document.nodes[path.id] as typeof path).points).toEqual(path.points);

    const redoVector = await session.redo();
    expect(redoVector).not.toBeNull();
    expect(canonicalHistoryHash(redoVector!.document)).toBe(canonicalHistoryHash(vectorAfter));
    const redoPaint = await session.redo();
    expect(redoPaint).not.toBeNull();
    expect(canonicalHistoryHash(redoPaint!.document)).toBe(canonicalHistoryHash(rasterAfter));
  });

  it('undo moves the head to the parent and restores the journaled selection', async () => {
    const store = createMemoryHistoryStore();
    const session = newSession(store);
    await session.attach(baseDoc());
    let doc = baseDoc();
    for (let i = 1; i <= 3; i++) {
      const prev = doc;
      doc = applyOperation(prev, 'node.patch', {
        nodeId: 'n1_aaaa',
        path: 'opacity',
        value: i / 10,
      });
      await session.capture(prev, doc, [`sel-${i}`], { label: `Step ${i}`, kind: 'modify' });
    }
    const undone = await session.undo();
    expect(undone).not.toBeNull();
    expect(undone!.selection).toEqual(['sel-2']);
    expect((await session.steps()).find((s) => s.isHead)?.label).toBe('Step 2');
    expect(session.canRedo).toBe(true);

    const redone = await session.redo();
    expect(redone).not.toBeNull();
    expect(redone!.selection).toEqual(['sel-3']);
    expect((await session.steps()).find((s) => s.isHead)?.label).toBe('Step 3');
  });

  it('a new edit after undo preserves the abandoned path and can materialize it', async () => {
    const store = createMemoryHistoryStore();
    const session = newSession(store);
    await session.attach(baseDoc());
    let doc = baseDoc();
    const next1 = applyOperation(doc, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'opacity',
      value: 0.5,
    });
    await session.capture(doc, next1, [], { label: 'Old path', kind: 'modify' });
    doc = next1;
    const next2 = applyOperation(doc, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'opacity',
      value: 0.75,
    });
    const _rev2 = await session.capture(doc, next2, [], {
      label: 'Old head',
      kind: 'modify',
    });
    void _rev2;
    doc = next2;

    await session.undo(); // head → Old path
    const divergent = applyOperation(doc, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'opacity',
      value: 0.25,
    });
    await session.capture(doc, divergent, [], { label: 'New direction', kind: 'modify' });

    const steps = await session.steps();
    expect(steps.map((s) => s.label)).toEqual(['Genesis', 'Old path', 'New direction']);

    // The abandoned head is preserved in the DAG and materializable.
    const materialized = await session.materializeDivergence('Divergence');
    expect(materialized).not.toBeNull();
    const branches = await store.listBranches(DOC_ID);
    expect(branches.map((b) => b.name)).toContain('Divergence');
  });

  it('reload: a new session attaches to the existing history', async () => {
    const store = createMemoryHistoryStore();
    const first = newSession(store);
    await first.attach(baseDoc());
    const doc = baseDoc();
    const next = applyOperation(doc, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'opacity',
      value: 0.4,
    });
    await first.capture(doc, next, [], { label: 'Before reload', kind: 'modify' });

    const second = newSession(store);
    const result = await second.attach(next);
    expect(result.reconciled).toBe(false);
    const steps = await second.steps();
    expect(steps.map((s) => s.label)).toEqual(['Genesis', 'Before reload']);
    expect(steps[1]!.isHead).toBe(true);
  });

  it('reconciles a working document that differs from the recorded head', async () => {
    const store = createMemoryHistoryStore();
    const first = newSession(store);
    await first.attach(baseDoc());
    const doc = baseDoc();
    const next = applyOperation(doc, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'opacity',
      value: 0.4,
    });
    await first.capture(doc, next, [], { label: 'Recorded', kind: 'modify' });

    // The working document moved on (e.g. external change) without a capture.
    const moved = applyOperation(next, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'opacity',
      value: 0.9,
    });
    const second = newSession(store);
    const result = await second.attach(moved);
    expect(result.reconciled).toBe(true);
    const steps = await second.steps();
    expect(steps).toHaveLength(3);
    expect(steps[2]!.label).toBe('Loaded working state');
    expect(steps[2]!.revision.canonicalDocumentHash).toBe(canonicalHistoryHash(moved));
  });

  it('protects the attached branch and branches with unique work from deletion', async () => {
    const store = createMemoryHistoryStore();
    const session = newSession(store);
    await session.attach(baseDoc());
    const main = session.branch!;
    // Branch with unique work: create, switch, edit — main no longer reaches
    // the branch head, so its revisions are unreachable from elsewhere.
    const branch = await session.createBranch('experiment');
    expect(branch).not.toBeNull();
    await session.switchBranch(branch!.branchId);
    const headDoc = await session.loadRevisionDocument(branch!.headRevisionId);
    await session.capture(
      headDoc!,
      applyOperation(headDoc!, 'node.patch', {
        nodeId: 'n1_aaaa',
        path: 'opacity',
        value: 0.3,
      }),
      [],
      { label: 'Experiment edit', kind: 'modify' },
    );
    // Attached branch: protected.
    expect(await session.deleteBranch(branch!.branchId)).toBe(false);
    // Unique work (unreachable from main): protected even when not attached.
    await session.switchBranch(main.branchId);
    expect(await session.deleteBranch(branch!.branchId)).toBe(false);
    // Attached main: protected.
    expect(await session.deleteBranch(main.branchId)).toBe(false);
    // A branch pointing at a revision reachable from another branch is deletable.
    const twin = await session.createBranch('twin');
    expect(await session.deleteBranch(twin!.branchId)).toBe(true);
    const branches = await store.listBranches(DOC_ID);
    expect(branches.map((b) => b.name)).not.toContain('twin');
  });

  it('checkpoints: create, rename, pin, delete', async () => {
    const store = createMemoryHistoryStore();
    const session = newSession(store);
    await session.attach(baseDoc());
    const checkpoint = await session.addCheckpoint('Client review 2', { pinned: true });
    expect(checkpoint).not.toBeNull();
    expect((await session.checkpoints())[0]!.name).toBe('Client review 2');
    expect((await session.checkpoints())[0]!.pinned).toBe(true);
    await session.renameCheckpoint(checkpoint!.checkpointId, 'Client review 3');
    expect((await session.checkpoints())[0]!.name).toBe('Client review 3');
    await session.setCheckpointPinned(checkpoint!.checkpointId, false);
    expect((await session.checkpoints())[0]!.pinned).toBe(false);
    await session.deleteCheckpoint(checkpoint!.checkpointId);
    expect(await session.checkpoints()).toHaveLength(0);
  });

  it('rejects invalid branch and checkpoint names', async () => {
    const store = createMemoryHistoryStore();
    const session = newSession(store);
    await session.attach(baseDoc());
    await expect(session.createBranch('bad name!')).rejects.toThrow();
    await expect(session.createBranch('')).rejects.toThrow();
    await expect(session.addCheckpoint('')).rejects.toThrow();
  });

  it('merge base discovery finds the common ancestor', async () => {
    const store = createMemoryHistoryStore();
    const session = newSession(store);
    await session.attach(baseDoc());
    let doc = baseDoc();
    const step1 = applyOperation(doc, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'opacity',
      value: 0.3,
    });
    const rev1 = await session.capture(doc, step1, [], { label: 'Base step', kind: 'modify' });
    doc = step1;
    const step2 = applyOperation(doc, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'opacity',
      value: 0.4,
    });
    await session.capture(doc, step2, [], { label: 'Main head', kind: 'modify' });

    const branch = await session.createBranch('alt', rev1!.revisionId);
    expect(branch).not.toBeNull();
    expect(branch!.headRevisionId).toBe(rev1!.revisionId);

    // The merge base of the main branch and the alt branch is rev1.
    const merged = await session.mergeWithBranch(branch!.branchId);
    expect(merged).not.toBeNull();
    expect(merged!.status).toBe('clean');
    expect(merged!.mergedDocument).not.toBeNull();
  });

  it('deterministically merges disjoint edits between branches', async () => {
    const store = createMemoryHistoryStore();
    const session = newSession(store);
    await session.attach(baseDoc());
    let doc = baseDoc();
    const rev1 = await session.capture(
      doc,
      applyOperation(doc, 'node.patch', {
        nodeId: 'n1_aaaa',
        path: 'opacity',
        value: 0.5,
      }),
      [],
      { label: 'Base', kind: 'modify' },
    );
    doc = applyOperation(doc, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'opacity',
      value: 0.5,
    });
    // Main branch: rename the node.
    const mainNext = applyOperation(doc, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'name',
      value: 'Main Name',
    });
    await session.capture(doc, mainNext, [], { label: 'Rename on main', kind: 'modify' });
    // Alt branch from the base: move the node.
    const branch = await session.createBranch('alt', rev1!.revisionId);
    await session.switchBranch(branch!.branchId);
    const altDoc = await session.loadRevisionDocument(rev1!.revisionId);
    expect(altDoc).not.toBeNull();
    const altNext = applyOperation(altDoc!, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'opacity',
      value: 0.7,
    });
    await session.capture(altDoc!, altNext, [], { label: 'Opacity on alt', kind: 'modify' });

    // Merge alt into main (disjoint properties → clean merge).
    await session.switchBranch(
      (await store.listBranches(DOC_ID)).find((b) => b.name === 'main')!.branchId,
    );
    const merged = await session.mergeWithBranch(branch!.branchId);
    expect(merged).not.toBeNull();
    expect(merged!.status).toBe('clean');
  });

  it('completeMerge creates a two-parent merge revision for a clean merge', async () => {
    const store = createMemoryHistoryStore();
    const session = newSession(store);
    await session.attach(baseDoc());
    let doc = baseDoc();
    const rev1 = await session.capture(
      doc,
      applyOperation(doc, 'node.patch', {
        nodeId: 'n1_aaaa',
        path: 'opacity',
        value: 0.5,
      }),
      [],
      { label: 'Base', kind: 'modify' },
    );
    doc = applyOperation(doc, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'opacity',
      value: 0.5,
    });
    await session.capture(
      doc,
      applyOperation(doc, 'node.patch', {
        nodeId: 'n1_aaaa',
        path: 'name',
        value: 'Main Name',
      }),
      [],
      { label: 'Rename on main', kind: 'modify' },
    );
    const branch = await session.createBranch('alt', rev1!.revisionId);
    await session.switchBranch(branch!.branchId);
    const altDoc = await session.loadRevisionDocument(rev1!.revisionId);
    await session.capture(
      altDoc!,
      applyOperation(altDoc!, 'node.patch', {
        nodeId: 'n1_aaaa',
        path: 'opacity',
        value: 0.7,
      }),
      [],
      { label: 'Opacity on alt', kind: 'modify' },
    );
    await session.switchBranch(
      (await store.listBranches(DOC_ID)).find((b) => b.name === 'main')!.branchId,
    );

    const result = await session.completeMerge(branch!.branchId);
    expect(result.status).toBe('clean');
    expect(result.revision).toBeDefined();
    expect(result.revision!.parentRevisionIds).toHaveLength(2);
    const steps = await session.steps();
    expect(steps[steps.length - 1]!.revision.parentRevisionIds).toHaveLength(2);
    expect(steps[steps.length - 1]!.label).toMatch(/merge/i);
  });

  it('completeMerge resolves scalar conflicts through resolutions', async () => {
    const store = createMemoryHistoryStore();
    const session = newSession(store);
    await session.attach(baseDoc());
    let doc = baseDoc();
    const rev1 = await session.capture(
      doc,
      applyOperation(doc, 'node.patch', {
        nodeId: 'n1_aaaa',
        path: 'opacity',
        value: 0.5,
      }),
      [],
      { label: 'Base', kind: 'modify' },
    );
    doc = applyOperation(doc, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'opacity',
      value: 0.5,
    });
    // Both branches change the SAME property differently → scalar conflict.
    await session.capture(
      doc,
      applyOperation(doc, 'node.patch', {
        nodeId: 'n1_aaaa',
        path: 'opacity',
        value: 0.2,
      }),
      [],
      { label: 'Ours opacity', kind: 'modify' },
    );
    const branch = await session.createBranch('alt', rev1!.revisionId);
    await session.switchBranch(branch!.branchId);
    const altDoc = await session.loadRevisionDocument(rev1!.revisionId);
    await session.capture(
      altDoc!,
      applyOperation(altDoc!, 'node.patch', {
        nodeId: 'n1_aaaa',
        path: 'opacity',
        value: 0.9,
      }),
      [],
      { label: 'Theirs opacity', kind: 'modify' },
    );
    await session.switchBranch(
      (await store.listBranches(DOC_ID)).find((b) => b.name === 'main')!.branchId,
    );

    const preMerge = await session.mergeWithBranch(branch!.branchId);
    expect(preMerge!.status).toBe('conflicted');
    expect(preMerge!.conflicts).toHaveLength(1);

    const conflict = preMerge!.conflicts[0]!;
    const result = await session.completeMerge(branch!.branchId, [
      { conflictId: conflict.conflictId, choice: 'theirs' },
    ]);
    expect(result.status).toBe('clean');
    expect(result.revision!.parentRevisionIds).toHaveLength(2);
    // The merged document carries the chosen (theirs) opacity.
    const headDoc = await session.loadRevisionDocument(result.revision!.revisionId);
    expect((headDoc!.nodes.n1_aaaa as { opacity?: number }).opacity).toBe(0.9);
  });

  it('completeMerge refuses to commit when conflicts remain unresolved', async () => {
    const store = createMemoryHistoryStore();
    const session = newSession(store);
    await session.attach(baseDoc());
    let doc = baseDoc();
    const rev1 = await session.capture(
      doc,
      applyOperation(doc, 'node.patch', {
        nodeId: 'n1_aaaa',
        path: 'opacity',
        value: 0.5,
      }),
      [],
      { label: 'Base', kind: 'modify' },
    );
    doc = applyOperation(doc, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'opacity',
      value: 0.5,
    });
    await session.capture(
      doc,
      applyOperation(doc, 'node.patch', {
        nodeId: 'n1_aaaa',
        path: 'opacity',
        value: 0.2,
      }),
      [],
      { label: 'Ours opacity', kind: 'modify' },
    );
    const branch = await session.createBranch('alt', rev1!.revisionId);
    await session.switchBranch(branch!.branchId);
    const altDoc = await session.loadRevisionDocument(rev1!.revisionId);
    await session.capture(
      altDoc!,
      applyOperation(altDoc!, 'node.patch', {
        nodeId: 'n1_aaaa',
        path: 'opacity',
        value: 0.9,
      }),
      [],
      { label: 'Theirs opacity', kind: 'modify' },
    );
    await session.switchBranch(
      (await store.listBranches(DOC_ID)).find((b) => b.name === 'main')!.branchId,
    );

    // No resolutions → merge stays conflicted, no revision is committed.
    const result = await session.completeMerge(branch!.branchId);
    expect(result.status).toBe('conflicted');
    expect(result.revision).toBeUndefined();
    const steps = await session.steps();
    expect(steps[steps.length - 1]!.revision.parentRevisionIds).toHaveLength(1);
  });
});
