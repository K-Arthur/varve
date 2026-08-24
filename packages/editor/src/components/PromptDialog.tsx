import { Button } from '@varve/ui';
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

export function PromptDialog() {
  const [state, setState] = useState<PromptDialogState | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPromptState = setState;
    return () => {
      setPromptState = null;
    };
  }, []);

  useEffect(() => {
    if (state) {
      dialogRef.current?.showModal();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [state]);

  const handleConfirm = useCallback(() => {
    const val = inputRef.current?.value ?? '';
    state?.resolve(val);
    setState(null);
    dialogRef.current?.close();
  }, [state]);

  const handleCancel = useCallback(() => {
    state?.resolve(null);
    setState(null);
    dialogRef.current?.close();
  }, [state]);

  if (!state) return null;

  return (
    <dialog
      ref={dialogRef}
      className="varve-dialog"
      aria-labelledby="prompt-title"
      onClose={handleCancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleConfirm();
      }}
    >
      <div className="varve-dialog__content">
        <h3 id="prompt-title" className="varve-dialog__title">
          {state.title}
        </h3>
        <input
          ref={inputRef}
          type="text"
          className="varve-dialog__input"
          defaultValue={state.defaultValue}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <div className="varve-dialog__actions">
          <Button variant="primary" onClick={handleConfirm}>
            Confirm
          </Button>
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </dialog>
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

export function ConfirmDialog() {
  const [state, setState] = useState<ConfirmDialogState | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setConfirmState = setState;
    return () => {
      setConfirmState = null;
    };
  }, []);

  useEffect(() => {
    if (state) {
      dialogRef.current?.showModal();
    }
  }, [state]);

  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
    dialogRef.current?.close();
  }, [state]);

  const handleCancel = useCallback(() => {
    state?.resolve(false);
    setState(null);
    dialogRef.current?.close();
  }, [state]);

  if (!state) return null;

  return (
    <dialog
      ref={dialogRef}
      className="varve-dialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-desc"
      onClose={handleCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') handleCancel();
      }}
    >
      <div className="varve-dialog__content">
        <h3 id="confirm-title" className="varve-dialog__title">
          {state.title}
        </h3>
        <p id="confirm-desc" className="varve-dialog__desc">
          {state.description}
        </p>
        <div className="varve-dialog__actions">
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant={state.variant ?? 'primary'} onClick={handleConfirm}>
            {state.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
