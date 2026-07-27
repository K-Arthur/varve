/**
 * useFocusVisible — track whether focus should show visible focus indicators.
 *
 * Returns true when:
 * - User navigates via keyboard (Tab, arrows, etc.)
 * - Programmatic focus (only if `programmaticIsVisible` is true)
 *
 * Returns false when:
 * - User clicks or touches
 *
 * This is similar to `:focus-visible` but works in all browsers / WebViews.
 * In modern browsers, :focus-visible in CSS is preferred. This hook is for
 * cases where you need JS-driven focus-visible state (e.g. to conditionally
 * apply CSS classes).
 */
import { useEffect, useState } from 'react';

export interface UseFocusVisibleOptions {
  programmaticIsVisible?: boolean;
}

export function useFocusVisible({
  programmaticIsVisible = false,
}: UseFocusVisibleOptions = {}): boolean {
  const [focusVisible, setFocusVisible] = useState(false);

  useEffect(() => {
    let keyboardActive = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Tab' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'Home' ||
        e.key === 'End' ||
        e.key === 'Enter' ||
        e.key === ' '
      ) {
        keyboardActive = true;
      }
    };

    const handlePointerDown = () => {
      keyboardActive = false;
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;
      const visible = keyboardActive || (programmaticIsVisible && !keyboardActive);
      setFocusVisible(visible);
    };

    const handleFocusOut = () => {
      setFocusVisible(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, [programmaticIsVisible]);

  return focusVisible;
}
