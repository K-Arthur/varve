import { AlertDialog, Button, Dialog } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

/* ---------------------------------------------------------------------------
 * Prompt dialog (async replacement for window.prompt)
 * ------------------------------------------------------------------------ */

interface PromptDialogState {
  title: string;
  defaultValue: string;
  resolve: (value: string | null) => void;
}

let setPromptState: ((s: PromptDialogState | null) => void) | null = null;

export function promptDialog(title: string, defaultValue = ''): Promise<string | null> {
  return new Promise((resolve) => {
    if (setPromptState) {
      setPromptState({ title, defaultValue, resolve });
    } else {
      resolve(null);
    }
  });
}

// Built on @varve/ui's Dialog rather than a hand-rolled <dialog> — Dialog
// already gets focus containment, Escape, and backdrop dismissal right, so
// this only needs to own the prompt's own input/actions.
export function PromptDialog() {
  const [state, setState] = useState<PromptDialogState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPromptState = setState;
    return () => {
      setPromptState = null;
    };
  }, []);

  useEffect(() => {
    if (state) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [state]);

  const handleConfirm = useCallback(() => {
    const val = inputRef.current?.value ?? '';
    state?.resolve(val);
    setState(null);
  }, [state]);

  const handleCancel = useCallback(() => {
    state?.resolve(null);
    setState(null);
  }, [state]);

  return (
    <Dialog
      open={!!state}
      onClose={handleCancel}
      title={state?.title ?? ''}
      footer={
        <div className="varve-dialog__actions">
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm}>
            Confirm
          </Button>
        </div>
      }
    >
      <input
        ref={inputRef}
        type="text"
        className="varve-dialog__input"
        aria-label={state?.title ?? ''}
        defaultValue={state?.defaultValue ?? ''}
        onKeyDown={(e) => {
          // Stop propagation so global canvas/editor shortcuts don't fire
          // while typing, but still act on Enter ourselves first — this
          // dialog has no <form> to submit, so nothing else will.
          e.stopPropagation();
          if (e.key === 'Enter') handleConfirm();
        }}
      />
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------
 * Confirm dialog (async replacement for window.confirm)
 * ------------------------------------------------------------------------ */

interface ConfirmDialogState {
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: 'danger' | 'primary';
  resolve: (value: boolean) => void;
}

let setConfirmState: ((s: ConfirmDialogState | null) => void) | null = null;

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

// Mirrors packages/home/src/confirmDialog.tsx's ConfirmDialogProvider — same
// shared AlertDialog, same provider shape. AlertDialog already sets
// dismissible={false} internally, so destructive confirmations can't be
// backdrop-clicked away.
export function ConfirmDialog() {
  const [state, setState] = useState<ConfirmDialogState | null>(null);

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
