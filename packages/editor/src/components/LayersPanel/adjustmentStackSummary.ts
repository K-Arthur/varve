import { type Adjustment, filterKindDisplayName } from '@varve/engine';

const INLINE_NAME_LIMIT = 2;

export interface AdjustmentStackSummary {
  /** Names kept short enough to share the layer row with its controls. */
  label: string;
  /** Full state description for the hover/focus tooltip. */
  tooltip: string;
  totalCount: number;
  activeCount: number;
  inactiveCount: number;
}

function isActive(adjustment: Adjustment): boolean {
  return adjustment.visible !== false && (adjustment.opacity ?? 1) > 0;
}

function compactNames(names: string[]): string {
  if (names.length === 0) return 'No adjustments';
  if (names.length <= INLINE_NAME_LIMIT) return names.join(' + ');

  const remaining = names.length - INLINE_NAME_LIMIT;
  return `${names.slice(0, INLINE_NAME_LIMIT).join(' + ')} + ${remaining} more`;
}

/**
 * Build a stable, derived identity for an ordered adjustment stack.
 *
 * The scene node's name remains user-editable and is never rewritten when the
 * stack changes. This summary is presentation-only, so adding, reordering, or
 * disabling an entry cannot create rename churn or extra undo history.
 */
export function summarizeAdjustmentStack(
  adjustments: readonly Adjustment[],
): AdjustmentStackSummary {
  const names = adjustments.map((adjustment) => filterKindDisplayName(adjustment.kind));
  const totalCount = adjustments.length;
  const activeCount = adjustments.filter(isActive).length;
  const inactiveCount = totalCount - activeCount;
  const label = compactNames(names);

  if (totalCount === 0) {
    return {
      label,
      tooltip: 'No adjustments applied',
      totalCount,
      activeCount,
      inactiveCount,
    };
  }

  const fullNames = adjustments
    .map((adjustment, index) => `${names[index]}${isActive(adjustment) ? '' : ' (off)'}`)
    .join(', ');
  const activeState = `${activeCount} of ${totalCount} active`;

  return {
    label,
    tooltip: `${fullNames}. ${activeState}.`,
    totalCount,
    activeCount,
    inactiveCount,
  };
}
