import { useState } from 'react';

export interface InteractionState {
  bindingField: string | null;
  setBindingField: (field: string | null) => void;
  focusedField: string | null;
  setFocusedField: (field: string | null) => void;
}

export function useInteractionState(): InteractionState {
  const [bindingField, setBindingField] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  return {
    bindingField,
    setBindingField,
    focusedField,
    setFocusedField,
  };
}
