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

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../icons/Icon';

export interface CopyButtonProps {
  value: string;
  label: string;
  className?: string;
}

export function CopyButton({ value, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [announce, setAnnounce] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveId = useId();

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setAnnounce(`Copied ${label}`);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
        setAnnounce('');
        timerRef.current = null;
      }, 2000);
    } catch {
      setAnnounce('Failed to copy to clipboard');
    }
  }, [value, label]);

  return (
    <>
      <button type="button" className={className} aria-label={`Copy ${label}`} onClick={copy}>
        {copied ? (
          <Icon name="Check" label={undefined} size="0.95em" />
        ) : (
          <Icon name="Copy" label={undefined} size="0.95em" />
        )}
      </button>
      <span id={liveId} role="status" aria-live="polite" className="varve-visually-hidden">
        {announce}
      </span>
    </>
  );
}
