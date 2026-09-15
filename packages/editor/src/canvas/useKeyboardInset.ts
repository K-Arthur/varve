/**
 * React lifecycle wrapper for the keyboard/visual-viewport inset publisher.
 *
 * Mount exactly one instance per owner document. It renders nothing and only
 * owns the subscription; all geometry lives in `keyboardInset.ts` so the
 * model stays unit-testable without React.
 */
import { useEffect } from 'react';
import { installKeyboardInsetPublisher } from './keyboardInset';

export function KeyboardInsetPublisher(): null {
  useEffect(() => installKeyboardInsetPublisher(document), []);
  return null;
}
