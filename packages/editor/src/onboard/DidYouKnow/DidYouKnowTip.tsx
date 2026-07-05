import { useEffect, useRef, useState } from 'react';
import type { Tip } from './tips';
import './DidYouKnowTip.css';

interface DidYouKnowTipProps {
  tip: Tip;
  onDismiss: (tipId: string) => void;
  onDontShowAgain: (tipId: string) => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  shortcuts: 'Keyboard',
  editing: 'Pencil',
  panels: 'PanelsRightBottom',
  layers: 'Layers',
  text: 'Type',
  color: 'Palette',
  export: 'Download',
  prototype: 'Play',
  grids: 'Grid3x3',
};

const AUTO_DISMISS_MS = 8000;

export function DidYouKnowTip({ tip, onDismiss, onDontShowAgain }: DidYouKnowTipProps) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    prefersReducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setExiting(true);
      // Allow exit animation to complete before actually dismissing
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

  function handleGotIt() {
    if (timerRef.current) clearTimeout(timerRef.current);
    onDismiss(tip.id);
  }

  function handleDontShowAgain() {
    if (timerRef.current) clearTimeout(timerRef.current);
    onDontShowAgain(tip.id);
  }

  return (
    <div
      className={`did-you-know-tip${exiting ? ' did-you-know-tip--exiting' : ''}${prefersReducedMotion.current ? ' did-you-know-tip--no-animation' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={`Tip: ${tip.title}`}
    >
      <div className="did-you-know-tip__indicator" />
      <div className="did-you-know-tip__icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
          <button type="button" className="did-you-know-tip__dont-show" onClick={handleDontShowAgain}>
            Don't show again
          </button>
        </div>
      </div>
    </div>
  );
}
