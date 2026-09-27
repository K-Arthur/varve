import {
  addChild,
  applyOperation,
  canonicalHistoryHash,
  createDocument,
  createVariableStore,
  type Document,
  makeShapeNode,
  registerBuiltinOperations,
} from '@varve/scene';
import {
  applyImportToSync,
  applyMergePlanToSync,
  ensureImportSource,
  planSourceUpdate,
  previewImport,
} from '@varve/scene/tokens';
import { describe, expect, it } from 'vitest';
import { diffDocuments } from '../diff';

registerBuiltinOperations();

function sourceDocument(primaryValue: unknown): Parameters<typeof planSourceUpdate>[1] {
  const tokens = [
    {
      path: ['color', 'brand', 'primary'],
      name: 'primary',
      type: 'color',
      value: primaryValue,
      description: 'Foundation brand color',
      pointer: '/color/brand/primary',
      valuePointer: '/color/brand/primary/$value',
    },
    {
      path: ['semantic', 'brand', 'curlyAlias'],
      name: 'curlyAlias',
      type: 'color',
      value: '{color.brand.primary}',
      pointer: '/semantic/brand/curlyAlias',
      valuePointer: '/semantic/brand/curlyAlias/$value',
    },
    {
      path: ['semantic', 'brand', 'pointerAlias'],
      name: 'pointerAlias',
      type: 'color',
      value: { $ref: '#/color/brand/primary/$value' },
      pointer: '/semantic/brand/pointerAlias',
      valuePointer: '/semantic/brand/pointerAlias/$value',
    },
  ].map((token) => ({
    kind: 'token' as const,
    ...token,
    references: [],
    isReference: false,
    extensions: {},
  }));
  return {
    tokens: Object.fromEntries(tokens.map((token) => [token.path.join('.'), token])),
    groups: [],
    diagnostics: [],
    specificationVersion: '2025.10',
    sourceFileId: 'brand.tokens.json',
  } as Parameters<typeof planSourceUpdate>[1];
}

function importDocument(): Document {
  const parsed = sourceDocument({ colorSpace: 'srgb', components: [0.2, 0.4, 0.8] });
  const destination = ensureImportSource(undefined, 'brand.tokens.json');
  const variables = createVariableStore();
  const imported = applyImportToSync(
    destination.sync,
    variables,
    previewImport(destination.sync.store, parsed),
    destination.sourceId,
    '2025.10',
    'dtcg-2025.10',
  );
  let doc: Document = {
    ...createDocument('DTCG source update history'),
    variableStore: { ...imported.variables!, tokenSync: imported.sync },
  };
  const curly = Object.values(doc.variableStore!.variables).find(
    (variable) => variable.name === 'semantic.brand.curlyAlias',
  )!;
  const shape = makeShapeNode('n1_token_binding', {
    kind: 'rect',
    x: 0,
    y: 0,
    w: 20,
    h: 20,
  });
  doc = addChild(doc, doc.id, {
    ...shape,
    bindings: { fill: { variableId: curly.id } },
  });
  return doc;
}

function updateSource(before: Document): Document {
  const sourceId = Object.keys(
    before.variableStore!.tokenSync!.store.sources,
  )[0]! as `src_${string}`;
  const parsed = sourceDocument({ colorSpace: 'srgb', components: [0.8, 0.2, 0.1] });
  const planned = planSourceUpdate(before.variableStore!.tokenSync!, parsed, sourceId);
  expect(planned.valid).toBe(true);
  const applied = applyMergePlanToSync(
    before.variableStore!.tokenSync!,
    before.variableStore,
    planned.plan,
    'default',
    { sourceId, at: '2026-09-25T12:00:00.000Z' },
  );
  return {
    ...before,
    variableStore: {
      ...before.variableStore!,
      ...applied.variables,
      tokenSync: applied.sync,
    },
  };
}

function firstDifference(left: unknown, right: unknown, path = '$'): string | undefined {
  if (Object.is(left, right)) return undefined;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return `${path}: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return `${path}: array shape differs`;
    }
    for (let index = 0; index < left.length; index++) {
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return undefined;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  for (const key of [
    ...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]),
  ].sort()) {
    const difference = firstDifference(leftRecord[key], rightRecord[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return undefined;
}

function replayExact(before: Document, after: Document): Document {
  const diff = diffDocuments(before, after, { epsilonPolicy: 'exact' });
  return applyOperation(before, 'document.transaction-capture', {
    transactionId: 'source-update-regression',
    changes: diff.changes,
    summary: { label: 'Update source', kind: 'modify', affectedEntityIds: [] },
    beforeHash: diff.baseHash,
    afterHash: diff.targetHash,
  });
}

function extensionPayload(revision: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    'org.varve.id': revision,
    '色/brand': { revision },
  };
  Object.defineProperty(payload, '__proto__', {
    configurable: true,
    enumerable: true,
    value: { revision },
    writable: true,
  });
  return payload;
}

function withDottedMetadata(document: Document, revision: string): Document {
  const variableStore = document.variableStore!;
  const tokenSync = variableStore.tokenSync!;
  const token = Object.values(tokenSync.store.tokens).find(
    (entry) => entry.path.join('.') === 'color.brand.primary',
  )!;
  return {
    ...document,
    variableStore: {
      ...variableStore,
      tokenSync: {
        ...tokenSync,
        store: {
          ...tokenSync.store,
          tokens: {
            ...tokenSync.store.tokens,
            [token.id]: { ...token, extensions: extensionPayload(revision) },
          },
          groupMeta: {
            'color.brand': {
              description: `Brand group ${revision}`,
              extensions: extensionPayload(revision),
            },
          },
        },
      },
    },
  };
}

describe('source update history capture', () => {
  it('replays a structured-color DTCG source edit exactly with bound aliases present', () => {
    const before = importDocument();
    const after = updateSource(before);
    const replayed = replayExact(before, after);
    const primary = Object.values(after.variableStore!.tokenSync!.store.tokens).find(
      (entry) => entry.path.join('.') === 'color.brand.primary',
    )!;
    expect(primary.value).toEqual({ colorSpace: 'srgb', components: [0.8, 0.2, 0.1] });
    // Source provenance intentionally remains the value last observed before
    // this remote edit; capture replay must not mutate it through a shared
    // object that also backs the token's previous value.
    expect(primary.source?.lastExternallyObservedValue).toEqual({
      colorSpace: 'srgb',
      components: [0.2, 0.4, 0.8],
    });
    const difference = firstDifference(after, replayed);
    expect(
      canonicalHistoryHash(replayed),
      difference ?? 'history replay must reproduce the source update document',
    ).toBe(canonicalHistoryHash(after));
  });

  it('replays dotted group paths and arbitrary extension keys without path splitting or prototype loss', () => {
    const before = withDottedMetadata(importDocument(), 'before');
    const after = withDottedMetadata(before, 'after');
    const replayed = replayExact(before, after);
    const difference = firstDifference(after, replayed);
    const targetToken = Object.values(after.variableStore!.tokenSync!.store.tokens).find(
      (entry) => entry.path.join('.') === 'color.brand.primary',
    )!;
    const replayedToken = replayed.variableStore!.tokenSync!.store.tokens[targetToken.id]!;

    expect(Object.hasOwn(replayedToken.extensions, '__proto__')).toBe(true);
    expect(replayedToken.extensions).toEqual(targetToken.extensions);
    expect(replayed.variableStore!.tokenSync!.store.groupMeta).toEqual(
      after.variableStore!.tokenSync!.store.groupMeta,
    );
    expect(
      canonicalHistoryHash(replayed),
      difference ?? 'history replay must preserve complete extension and group metadata',
    ).toBe(canonicalHistoryHash(after));
  });
});
