/** Source annotations identify tokens; they never authorize changing another source. */
import type { TokenDiagnostic, TokenMergePlan, TokenSnapshotMap } from '@varve/tokens';
import { isTokenId } from './identity';
import type { DesignTokenStore, TokenSourceId } from './model';

export function remoteIdentityDiagnostics(
  store: DesignTokenStore,
  remote: TokenSnapshotMap,
  sourceId: TokenSourceId,
  sourceFileId: string,
): TokenDiagnostic[] {
  const diagnostics: TokenDiagnostic[] = [];
  const existing = new Map(Object.values(store.tokens).map((token) => [token.id as string, token]));
  const seen = new Set<string>();
  for (const token of remote.values()) {
    if (!token.id) continue;
    let code: string | undefined;
    let reason: string | undefined;
    if (!isTokenId(token.id)) {
      code = 'sync.invalid-token-id';
      reason = 'the Varve identity annotation is not a valid tok_ identity';
    } else if (seen.has(token.id)) {
      code = 'sync.duplicate-token-id';
      reason = 'another token in this file carries the same identity';
    } else if (existing.has(token.id) && existing.get(token.id)?.source?.sourceId !== sourceId) {
      code = 'sync.foreign-token-id';
      reason = 'that identity belongs to another source or a local token';
    }
    seen.add(token.id);
    if (code)
      diagnostics.push({
        severity: 'error',
        code,
        sourceFileId,
        message: `${token.path.join('.')}: ${reason}. Remove the conflicting annotation or restore the correct source identity before applying.`,
      });
  }
  return diagnostics;
}

/** Defensive checks also protect direct callers that bypass source-update planning. */
export function assertMergeIdentities(
  store: DesignTokenStore,
  plan: TokenMergePlan,
  sourceId?: TokenSourceId,
): void {
  const unsafePlanDiagnostic = plan.diagnostics.find((diagnostic) =>
    [
      'sync.invalid-token-id',
      'sync.duplicate-token-id',
      'sync.foreign-token-id',
      'sync.path-collision',
    ].includes(diagnostic.code),
  );
  if (unsafePlanDiagnostic) {
    throw new Error(`${unsafePlanDiagnostic.code}: ${unsafePlanDiagnostic.message}`);
  }

  const existing = new Map(Object.values(store.tokens).map((token) => [token.id as string, token]));
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  for (const merge of plan.merges) {
    if (merge.decision === 'conflict' || merge.decision === 'delete-vs-edit') continue;
    const id = merge.result?.id ?? merge.id;
    if (id) {
      if (!isTokenId(id)) throw new Error('sync.invalid-token-id: Invalid Varve token identity.');
      if (seenIds.has(id))
        throw new Error('sync.duplicate-token-id: A merge cannot write one identity twice.');
      seenIds.add(id);
      if (sourceId && existing.has(id) && existing.get(id)?.source?.sourceId !== sourceId)
        throw new Error(
          'sync.foreign-token-id: A merge cannot change a token owned outside its selected source.',
        );
    }
    if (merge.result && !merge.deleted) {
      const path = merge.result.path.join('.');
      if (seenPaths.has(path))
        throw new Error('sync.path-collision: A merge cannot write one path twice.');
      seenPaths.add(path);
    }
  }
}
