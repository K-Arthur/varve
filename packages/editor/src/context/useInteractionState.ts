import { useCallback, useRef, useState } from 'react';

export interface InteractionState {
  bindingField: string | null;
  setBindingField: (field: string | null) => void;
  focusedField: string | null;
  setFocusedField: (field: string | null) => void;
  registerCanvasInteractionCancellation: (sessionId: string, cancel: () => void) => () => void;
  cancelCanvasInteraction: (sessionId: string) => boolean;
}

export function useInteractionState(): InteractionState {
  const [bindingField, setBindingField] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const canvasCancellations = useRef(new Map<string, () => void>());
  const registerCanvasInteractionCancellation = useCallback(
    (sessionId: string, cancel: () => void) => {
      canvasCancellations.current.set(sessionId, cancel);
      return () => {
        if (canvasCancellations.current.get(sessionId) === cancel) {
          canvasCancellations.current.delete(sessionId);
        }
      };
    },
    [],
  );
  const cancelCanvasInteraction = useCallback((sessionId: string) => {
    const cancel = canvasCancellations.current.get(sessionId);
    if (!cancel) return false;
    cancel();
    return true;
  }, []);
  return {
    bindingField,
    setBindingField,
    focusedField,
    setFocusedField,
    registerCanvasInteractionCancellation,
    cancelCanvasInteraction,
  };
}
