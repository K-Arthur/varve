import type { Document } from '@varve/scene';
import type { InspectorRestrictionState } from './inspectorContext';

export interface SelectionRestrictionNotice {
  locked: boolean;
  hidden: boolean;
  lockedCount: number;
  hiddenCount: number;
  totalCount: number;
  lockSourceLabel: string | null;
  visibilitySourceLabel: string | null;
  hasPartialLock: boolean;
  hasPartialHidden: boolean;
}

/**
 * Turn effective restrictions into a compact presentation model. This stays
 * separate from the document and selection models so the Inspector can
 * explain safe read-only behavior without inventing a second mutation path.
 */
export function describeSelectionRestrictions(
  restrictions: InspectorRestrictionState,
  document: Document,
  selectedCount: number,
): SelectionRestrictionNotice {
  const sourceLabel = (ids: readonly string[]) => {
    const names = [...new Set(ids.map((id) => document.nodes[id]?.name ?? id))];
    if (names.length === 0) return null;
    const visible = names.slice(0, 2).join(', ');
    return names.length > 2 ? `${visible}, +${names.length - 2} more` : visible;
  };
  return {
    locked: restrictions.effectiveLockedNodeIds.length > 0,
    hidden: restrictions.effectiveHiddenNodeIds.length > 0,
    lockedCount: restrictions.effectiveLockedNodeIds.length,
    hiddenCount: restrictions.effectiveHiddenNodeIds.length,
    totalCount: selectedCount,
    lockSourceLabel: sourceLabel(restrictions.lockSourceIds),
    visibilitySourceLabel: sourceLabel(restrictions.visibilitySourceIds),
    hasPartialLock: restrictions.hasPartialLock,
    hasPartialHidden: restrictions.hasPartialHidden,
  };
}
