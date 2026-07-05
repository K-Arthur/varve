import { useCallback, useEffect, useRef, useState } from 'react';
import type { Tip } from './tips';
import './DidYouKnowTip.css';

interface DidYouKnowTipProps {
  tip: Tip;
  onDismiss: (tipId: string) => void;
  onDontShowAgain: (tipId: string) => void;
}

const AUTO_DISMISS_MS = 8000;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function DidYouKnowTip({ tip, onDismiss, onDontShowAgain }: DidYouKnowTipProps) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [noAnimation] = useState(prefersReducedMotion);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setExiting(true);
      setTimeout(() => {
        onDismiss(tip.id);
      }, 200);
    }, AUTO_DISMISS_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [tip.id, onDismiss]);

  const handleGotIt = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    onDismiss(tip.id);
  }, [tip.id, onDismiss]);

  const handleDontShowAgain = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    onDontShowAgain(tip.id);
  }, [tip.id, onDontShowAgain]);

  const className = [
    'did-you-know-tip',
    exiting ? 'did-you-know-tip--exiting' : '',
    noAnimation ? 'did-you-know-tip--no-animation' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} role="status" aria-live="polite" aria-label={`Tip: ${tip.title}`}>
      <div className="did-you-know-tip__indicator" />
      <div className="did-you-know-tip__icon">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </div>
      <div className="did-you-know-tip__content">
        <div className="did-you-know-tip__title">{tip.title}</div>
        <div className="did-you-know-tip__body">{tip.body}</div>
        <div className="did-you-know-tip__actions">
          <button type="button" className="did-you-know-tip__got-it" onClick={handleGotIt}>
            Got it
          </button>
          <button
            type="button"
            className="did-you-know-tip__dont-show"
            onClick={handleDontShowAgain}
          >
            Don't show again
          </button>
        </div>
      </div>
    </div>
  );
}
