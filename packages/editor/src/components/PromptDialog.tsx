import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@strata/ui';

interface PromptDialogState {
  title: string;
  defaultValue: string;
  resolve: (value: string | null) => void;
}

let promptState: PromptDialogState | null = null;
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
    return () => { setPromptState = null; };
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
      className="strata-dialog"
      aria-labelledby="prompt-title"
      onClose={handleCancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleConfirm();
      }}
    >
      <div className="strata-dialog__content">
        <h3 id="prompt-title" className="strata-dialog__title">{state.title}</h3>
        <input
          ref={inputRef}
          type="text"
          className="strata-dialog__input"
          defaultValue={state.defaultValue}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <div className="strata-dialog__actions">
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
