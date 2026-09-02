/**
 * CopyButton — accessible copy-to-clipboard button.
 *
 * - aria-label describes what is being copied
 * - Copies value to clipboard via navigator.clipboard.writeText
 * - Shows check icon for 2s on success, then reverts to copy icon
 * - Announces "Copied {label}" via aria-live region
 *
 * Research basis: WCAG 2.2 — status messages via aria-live (4.1.3);
 * clipboard accessibility testing with NVDA/JAWS.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ButtonSize, ButtonVariant } from './Button';
import { IconButton } from './IconButton';

export interface CopyButtonProps {
  value: string;
  label: string;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
}

type CopyState = 'idle' | 'copied' | 'error';

export function CopyButton({
  value,
  label,
  className,
  variant = 'ghost',
  size = 'icon-sm',
  disabled = false,
}: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');
  const [copying, setCopying] = useState(false);
  const [announce, setAnnounce] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const operationRef = useRef(0);
  const copyingRef = useRef(false);
  const copyKey = `${value}\u0000${label}`;
  const previousCopyKeyRef = useRef(copyKey);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      operationRef.current += 1;
    };
  }, []);

  // A prop change means an earlier clipboard completion no longer describes
  // the current value. Invalidate it before resetting the visible state.
  useEffect(() => {
    if (previousCopyKeyRef.current === copyKey) return;
    previousCopyKeyRef.current = copyKey;
    operationRef.current += 1;
    copyingRef.current = false;
    setCopying(false);
    setState('idle');
    setAnnounce('');
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [copyKey]);

  const copy = useCallback(async () => {
    if (copyingRef.current || disabled) return;
    copyingRef.current = true;
    setCopying(true);
    const operation = operationRef.current + 1;
    operationRef.current = operation;

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(value);
      if (operationRef.current !== operation) return;
      setState('copied');
      setAnnounce(`Copied ${label}`);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (operationRef.current !== operation) return;
        setState('idle');
        setAnnounce('');
        timerRef.current = null;
      }, 2000);
    } catch {
      if (operationRef.current !== operation) return;
      setState('error');
      setAnnounce('Failed to copy to clipboard');
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (operationRef.current !== operation) return;
        setState('idle');
        setAnnounce('');
        timerRef.current = null;
      }, 3000);
    } finally {
      if (operationRef.current === operation) {
        copyingRef.current = false;
        setCopying(false);
      }
    }
  }, [disabled, label, value]);

  return (
    <>
      <IconButton
        icon={state === 'copied' ? 'Check' : 'Copy'}
        label={`Copy ${label}`}
        aria-label={
          state === 'copied'
            ? `Copied ${label}`
            : state === 'error'
              ? `Copy failed for ${label}`
              : undefined
        }
        variant={variant}
        size={size}
        className={className}
        disabled={disabled}
        loading={copying}
        loadingLabel={`Copying ${label}`}
        onClick={() => void copy()}
      />
      <span role="status" aria-live="polite" className="varve-visually-hidden">
        {announce}
      </span>
    </>
  );
}
