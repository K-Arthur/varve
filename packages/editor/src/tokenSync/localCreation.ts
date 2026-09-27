/** Local authored tokens use the same document store, standards engine, and backing Variables. */
import { addVariable, type VariableStore } from '@varve/scene';
import {
  addToken,
  bindVariableToToken,
  createEmptyTokenSynchronization,
  formatDocumentFromTokenRecords,
  mintTokenId,
  variableTypeForToken,
} from '@varve/scene/tokens';
import { buildReferenceGraph, validateResolvedTokenValues } from '@varve/tokens';
import { parseAuthoredTokenEdit } from './variableEditing';

export interface LocalTokenDraft {
  path: string;
  type: 'color' | 'number' | 'dimension' | 'fontFamily' | 'fontWeight';
  value: string;
  unit?: 'px' | 'rem';
  reference?: string;
}

export function createLocalToken(store: VariableStore, draft: LocalTokenDraft): VariableStore {
  const sync = store.tokenSync ?? createEmptyTokenSynchronization();
  const path = draft.path.trim().split('.');
  if (
    path.some(
      (segment, index) =>
        /[{}]/.test(segment) ||
        (segment.startsWith('$') && !(segment === '$root' && index === path.length - 1)),
    )
  )
    throw new Error(
      'Token path segments cannot start with $ or contain braces; $root is allowed as the final segment.',
    );
  const value = parseAuthoredTokenEdit(
    draft.type,
    draft.type === 'dimension' ? { unit: draft.unit } : undefined,
    draft.reference ? `{${draft.reference}}` : draft.value,
  );
  const inserted = addToken(sync.store, {
    id: mintTokenId(),
    path,
    displayName: path.at(-1) ?? '',
    type: draft.type,
    value,
    extensions: {},
    localState: {
      createdLocally: true,
      detachedFromSource: false,
      locallyModified: true,
      unresolved: false,
      conflicted: false,
    },
  });
  if (inserted.diagnostics.length > 0) throw new Error(inserted.diagnostics[0]!.message);
  const document = formatDocumentFromTokenRecords(
    Object.values(inserted.store.tokens),
    inserted.store.groupMeta,
  );
  const diagnostics = [
    ...document.diagnostics,
    ...buildReferenceGraph(document).diagnostics,
    ...validateResolvedTokenValues(document),
  ];
  const invalid = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (invalid) throw new Error(`${invalid.code}: ${invalid.message}`);
  const backing = addVariable(store, {
    name: path.join('.'),
    type: variableTypeForToken(draft.type),
    valuesByMode: { default: value },
  });
  return {
    ...backing.store,
    tokenSync: {
      ...sync,
      store: bindVariableToToken(inserted.store, backing.variable.id, inserted.token.id),
    },
  };
}
