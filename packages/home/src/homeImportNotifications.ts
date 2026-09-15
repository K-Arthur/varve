import { type ToastInput, useToast } from '@varve/ui';
import { useCallback } from 'react';

export interface HomeImportOutcome {
  success: number;
  failed: number;
  total: number;
}

export type HomeImportKind = 'asset' | 'file';

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function outcomeToast(outcome: HomeImportOutcome, kind: HomeImportKind): ToastInput {
  const noun = kind === 'asset' ? 'asset' : 'file';
  const added = countLabel(outcome.success, noun);
  const failed = countLabel(outcome.failed, noun);
  const hasFailures = outcome.failed > 0;
  const hasSuccesses = outcome.success > 0;

  return {
    type: hasFailures ? (hasSuccesses ? 'warning' : 'error') : 'success',
    title: hasFailures
      ? hasSuccesses
        ? 'Some files were not added'
        : 'Import failed'
      : kind === 'asset'
        ? 'Assets added'
        : 'Files added',
    message: hasFailures
      ? `${hasSuccesses ? `${added} added locally · ` : ''}${failed} failed`
      : `${added} added locally`,
    description: hasFailures ? 'Review the inline import details for each failed file.' : undefined,
  };
}

/**
 * Home uses the canonical Varve toast provider for one terminal batch summary.
 * Per-file progress and parser details remain in the owning queue or dialog.
 */
export function useHomeImportNotifications() {
  const { toast } = useToast();

  const notifyImportComplete = useCallback(
    (outcome: HomeImportOutcome, kind: HomeImportKind) => {
      if (outcome.total <= 0) return;
      const input = outcomeToast(outcome, kind);
      if (input.type === 'success') toast.success(input);
      else if (input.type === 'error') toast.error(input);
      else toast.warning(input);
    },
    [toast],
  );

  const startHomeDrop = useCallback(
    (total: number) =>
      toast.loading({
        id: 'home:file-drop',
        dedupeKey: 'home:file-drop',
        title: 'Adding files locally',
        message: `Adding ${countLabel(total, 'file')}…`,
      }),
    [toast],
  );

  const finishHomeDrop = useCallback(
    (toastId: string, total: number, failed: number) => {
      const input = outcomeToast({ success: Math.max(0, total - failed), failed, total }, 'file');
      toast.update(toastId, input);
    },
    [toast],
  );

  return { finishHomeDrop, notifyImportComplete, startHomeDrop };
}
