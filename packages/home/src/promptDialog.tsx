/**
 * Async replacement for window.prompt — renders a styled dialog.
 *
 * Usage: `const name = await promptDialog('Title', 'default value');`
 */
import { Button } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

interface PromptState {
  title: string;
  defaultValue: string;
  resolve: (value: string | null) => void;
}

let setPromptState: ((s: PromptState | null) => void) | null = null;

export function promptDialog(title: string, defaultValue = ''): Promise<string | null> {
  return new Promise((resolve) => {
    if (setPromptState) {
      setPromptState({ title, defaultValue, resolve });
    } else {
      resolve(null);
    }
  });
}

export function PromptDialogProvider() {
  const [state, setState] = useState<PromptState | null>(null);
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
      aria-labelledby="home-prompt-title"
      onClose={handleCancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleConfirm();
      }}
    >
      <div className="varve-dialog__content">
        <h3 id="home-prompt-title" className="varve-dialog__title">
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
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm}>
            Confirm
          </Button>
        </div>
      </div>
    </dialog>
  );
}
