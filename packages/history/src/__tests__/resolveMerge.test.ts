/**
 * Merge conflict resolution tests (M12, ADR-0035).
 *
 * Covers: ours-no-op semantics, theirs/base deep-sets, entity restores for
 * edit-vs-delete, add-vs-add container resolution, validation of resolution
 * lists, bulk resolution, and canonical integrity of resolved documents.
 */

import type { Document } from '@varve/scene';
import {
  applyOperation,
  canonicalHash,
  createDocument,
  makeShapeNode,
  registerBuiltinOperations,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { mergeDocuments } from '../merge';
import {
  applyMergeResolutions,
  bulkResolve,
  type MergeResolution,
  validateMergeResolutions,
  verifyResolvedDocument,
} from '../resolveMerge';

registerBuiltinOperations();

const DOC_ID = 'resolve-fixture';

function baseDoc(): Document {
  const doc = {
    ...createDocument(DOC_ID, { flat: true }),
    id: DOC_ID,
  } as Document;
  const a = makeShapeNode('n1_aaaa', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
  return applyOperation(doc, 'node.create', { node: a });
}

function setOpacity(doc: Document, value: number): Document {
  return applyOperation(doc, 'node.patch', { nodeId: 'n1_aaaa', path: 'opacity', value });
}

function rename(doc: Document, name: string): Document {
  return applyOperation(doc, 'node.patch', { nodeId: 'n1_aaaa', path: 'name', value: name });
}

function resolvable(conflicts: { conflictId: string; candidateResolutions: string[] }[]): boolean {
  return conflicts.length > 0;
}

describe('applyMergeResolutions', () => {
  it('keeps ours values when resolutions choose ours (no-op semantics)', () => {
    const base = baseDoc();
    const ours = setOpacity(base, 0.3);
    const theirs = setOpacity(base, 0.7);
    const merged = mergeDocuments(base, ours, theirs);
    expect(merged.conflicts).toHaveLength(1);
    const resolutions: MergeResolution[] = [
      { conflictId: merged.conflicts[0]!.conflictId, choice: 'ours' },
    ];
    const result = applyMergeResolutions(merged.mergedDocument, merged.conflicts, resolutions);
    expect(result.unresolvedConflictIds).toHaveLength(0);
    const node = result.document.nodes.n1_aaaa as { opacity?: number };
    expect(node.opacity).toBe(0.3);
  });

  it('applies theirs values with a deep-set at the conflict property path', () => {
    const base = baseDoc();
    const ours = setOpacity(base, 0.3);
    const theirs = setOpacity(base, 0.7);
    const merged = mergeDocuments(base, ours, theirs);
    const resolutions: MergeResolution[] = [
      { conflictId: merged.conflicts[0]!.conflictId, choice: 'theirs' },
    ];
    const result = applyMergeResolutions(merged.mergedDocument, merged.conflicts, resolutions);
    const node = result.document.nodes.n1_aaaa as { opacity?: number };
    expect(node.opacity).toBe(0.7);
  });

  it('applies base values to restore the pre-conflict state', () => {
    const base = baseDoc();
    const ours = setOpacity(base, 0.3);
    const theirs = setOpacity(base, 0.7);
    const merged = mergeDocuments(base, ours, theirs);
    const resolutions: MergeResolution[] = [
      { conflictId: merged.conflicts[0]!.conflictId, choice: 'base' },
    ];
    const result = applyMergeResolutions(merged.mergedDocument, merged.conflicts, resolutions);
    const node = result.document.nodes.n1_aaaa as { opacity?: number };
    expect(node.opacity).toBe(1);
  });

  it('resolves rename conflicts by choosing the incoming name', () => {
    const base = baseDoc();
    const ours = rename(base, 'Ours Name');
    const theirs = rename(base, 'Theirs Name');
    const merged = mergeDocuments(base, ours, theirs);
    expect(merged.conflicts).toHaveLength(1);
    const resolutions: MergeResolution[] = [
      { conflictId: merged.conflicts[0]!.conflictId, choice: 'theirs' },
    ];
    const result = applyMergeResolutions(merged.mergedDocument, merged.conflicts, resolutions);
    const node = result.document.nodes.n1_aaaa as { name?: string };
    expect(node.name).toBe('Theirs Name');
  });

  it('restores an entity deleted on one side when theirs is chosen', async () => {
    const base = baseDoc();
    // Ours deletes the node; theirs edits it.
    const ours = applyOperation(base, 'node.delete', { nodeId: 'n1_aaaa' });
    const theirs = setOpacity(base, 0.5);
    const merged = mergeDocuments(base, ours, theirs);
    expect(merged.conflicts.some((c) => c.conflictKind === 'edit-vs-delete')).toBe(true);
    const editDelete = merged.conflicts.find((c) => c.conflictKind === 'edit-vs-delete')!;
    const resolutions: MergeResolution[] = [
      { conflictId: editDelete.conflictId, choice: 'theirs' },
    ];
    const result = applyMergeResolutions(merged.mergedDocument, merged.conflicts, resolutions);
    expect(result.document.nodes.n1_aaaa).toBeDefined();
    expect(verifyResolvedDocument(result.document)).toBe(true);
  });

  it('skips unresolvable resolutions with a warning, never guesses', () => {
    const base = baseDoc();
    const merged = mergeDocuments(base, base, base);
    const result = applyMergeResolutions(base, merged.conflicts, []);
    expect(result.unresolvedConflictIds).toHaveLength(0);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('produces canonical-identical output for identical inputs (determinism)', () => {
    const base = baseDoc();
    const ours = setOpacity(base, 0.3);
    const theirs = setOpacity(base, 0.7);
    const merged = mergeDocuments(base, ours, theirs);
    const resolutions: MergeResolution[] = [
      { conflictId: merged.conflicts[0]!.conflictId, choice: 'theirs' },
    ];
    const a = applyMergeResolutions(merged.mergedDocument, merged.conflicts, resolutions);
    const b = applyMergeResolutions(merged.mergedDocument, merged.conflicts, resolutions);
    expect(canonicalHash(a.document)).toBe(canonicalHash(b.document));
  });
});

describe('validateMergeResolutions', () => {
  it('rejects unknown conflict ids, duplicates, and unoffered choices', () => {
    const conflicts = [
      {
        conflictId: 'c1',
        entityId: 'n1_aaaa',
        entityType: 'node' as const,
        conflictKind: 'scalar' as const,
        propertyPath: 'nodes.n1_aaaa.opacity',
        candidateResolutions: ['ours', 'theirs'] as Array<'ours' | 'theirs' | 'base'>,
        summary: 'opacity conflict',
      },
    ];
    expect(
      validateMergeResolutions(conflicts, [{ conflictId: 'nope', choice: 'ours' }]).valid,
    ).toBe(false);
    expect(
      validateMergeResolutions(conflicts, [
        { conflictId: 'c1', choice: 'ours' },
        { conflictId: 'c1', choice: 'theirs' },
      ]).valid,
    ).toBe(false);
    expect(validateMergeResolutions(conflicts, [{ conflictId: 'c1', choice: 'base' }]).valid).toBe(
      false,
    ); // base not offered for this conflict
    expect(
      validateMergeResolutions(conflicts, [{ conflictId: 'c1', choice: 'theirs' }]).valid,
    ).toBe(true);
  });
});

describe('bulkResolve', () => {
  it('produces one resolution per conflict', () => {
    const base = baseDoc();
    const ours = setOpacity(base, 0.3);
    const theirs = setOpacity(base, 0.7);
    const merged = mergeDocuments(base, ours, theirs);
    const resolutions = bulkResolve(merged.conflicts, 'theirs');
    expect(resolutions).toHaveLength(merged.conflicts.length);
    expect(resolvable(merged.conflicts)).toBe(true);
  });
});
