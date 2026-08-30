import { type Adjustment, filterKindDisplayName, getEffectStudioTreatment } from '@varve/engine';

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

interface StackDisplayEntry {
  firstIndex: number;
  label: string;
  detail: string;
}

interface NamedTreatmentGroup {
  firstIndex: number;
  treatmentName: string;
  memberNames: string[];
  memberDetails: string[];
  customized: boolean;
}

function displayEntries(adjustments: readonly Adjustment[]): StackDisplayEntry[] {
  const namedTreatments = new Map<string, NamedTreatmentGroup>();
  const rawEntries: StackDisplayEntry[] = [];

  for (const [index, adjustment] of adjustments.entries()) {
    const metadata = adjustment.studioTreatment;
    const treatment = metadata ? getEffectStudioTreatment(metadata.treatmentId) : undefined;
    if (!metadata || !treatment) {
      const name = filterKindDisplayName(adjustment.kind);
      rawEntries.push({
        firstIndex: index,
        label: name,
        detail: `${name}${isActive(adjustment) ? '' : ' (off)'}`,
      });
      continue;
    }

    const key = `${metadata.treatmentId}\u0000${metadata.instanceId}`;
    const memberName = filterKindDisplayName(adjustment.kind);
    const group = namedTreatments.get(key);
    if (group) {
      group.memberNames.push(memberName);
      group.memberDetails.push(`${memberName}${isActive(adjustment) ? '' : ' (off)'}`);
      group.customized ||= metadata.customized === true;
      continue;
    }

    namedTreatments.set(key, {
      firstIndex: index,
      treatmentName: treatment.name,
      memberNames: [memberName],
      memberDetails: [`${memberName}${isActive(adjustment) ? '' : ' (off)'}`],
      customized: metadata.customized === true,
    });
  }

  const namedEntries = [...namedTreatments.values()].map((group) => {
    const label = `${group.treatmentName}${group.customized ? ' (customized)' : ''}`;
    return {
      firstIndex: group.firstIndex,
      label,
      detail: `${label} (${group.memberDetails.join(', ')})`,
    };
  });

  return [...rawEntries, ...namedEntries].sort((left, right) => left.firstIndex - right.firstIndex);
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
  const entries = displayEntries(adjustments);
  const names = entries.map((entry) => entry.label);
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

  const fullNames = entries.map((entry) => entry.detail).join(', ');
  const activeState = `${activeCount} of ${totalCount} active`;

  return {
    label,
    tooltip: `${fullNames}. ${activeState}.`,
    totalCount,
    activeCount,
    inactiveCount,
  };
}
