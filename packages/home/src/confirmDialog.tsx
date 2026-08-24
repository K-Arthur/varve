/**
 * Async replacement for window.confirm — renders a styled AlertDialog.
 *
 * Usage: `const ok = await confirmDialog('Title', 'Description');`
 */
import { AlertDialog } from '@varve/ui';
import { useCallback, useEffect, useState } from 'react';

interface ConfirmState {
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: 'danger' | 'primary';
  resolve: (value: boolean) => void;
}

let setConfirmState: ((s: ConfirmState | null) => void) | null = null;

export function confirmDialog(
  title: string,
  description: string,
  options?: { confirmLabel?: string; variant?: 'danger' | 'primary' },
): Promise<boolean> {
  return new Promise((resolve) => {
    if (setConfirmState) {
      setConfirmState({
        title,
        description,
        confirmLabel: options?.confirmLabel,
        variant: options?.variant,
        resolve,
      });
    } else {
      resolve(false);
    }
  });
}

export function ConfirmDialogProvider() {
  const [state, setState] = useState<ConfirmState | null>(null);

  useEffect(() => {
    setConfirmState = setState;
    return () => {
      setConfirmState = null;
    };
  }, []);

  const handleClose = useCallback(() => {
    state?.resolve(false);
    setState(null);
  }, [state]);

  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
  }, [state]);

  return (
    <AlertDialog
      open={!!state}
      onClose={handleClose}
      onConfirm={handleConfirm}
      title={state?.title ?? ''}
      description={state?.description ?? ''}
      confirmLabel={state?.confirmLabel}
      variant={state?.variant}
    />
  );
}
