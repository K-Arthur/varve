import { Button } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TourStep } from './tourSteps';

export interface SpotlightOverlayProps {
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onDismiss: () => void;
  step: TourStep;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function SpotlightOverlay({
  stepIndex,
  totalSteps,
  onNext,
  onPrev,
  onDismiss,
  step,
}: SpotlightOverlayProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const titleId = `spotlight-title-${step.id}`;
  const descId = `spotlight-desc-${step.id}`;
  // Element focused before the tour opened, restored on unmount. The tour is
  // deliberately NOT focus-trapped: it spotlights real UI outside the tooltip,
  // so trapping would contradict the feature. It must still take focus (so the
  // step is announced) and hand it back when it closes.
  const restoreRef = useRef<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;
  const reduceMotion = prefersReducedMotion();

  const updatePosition = useCallback(() => {
    if (!step.target) {
      setRect(null);
      setTargetMissing(false);
      return;
    }
    const el = document.querySelector(step.target);
    if (el) {
      const r = el.getBoundingClientRect();
      setRect({
        top: r.top + (step.offset?.y ?? 0),
        left: r.left + (step.offset?.x ?? 0),
        width: r.width,
        height: r.height,
      });
      setTargetMissing(false);
    } else {
      setRect(null);
      setTargetMissing(true);
    }
  }, [step.target, step.offset?.x, step.offset?.y]);

  useEffect(() => {
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    const el = step.target ? document.querySelector(step.target) : null;
    if (el) observer.observe(el);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [updatePosition, step.target]);

  // Move focus into the tour tooltip so the step title/description are
  // announced, and restore the launch element when the tour unmounts.
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) restoreRef.current = active;
    const frame = requestAnimationFrame(() => {
      tooltipRef.current?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      const target = restoreRef.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, []);

  // Escape must dismiss the tour from the overlay itself. The previous code
  // documented "Escape handled by parent keydown handler" but no such handler
  // existed, so keyboard users could not dismiss the tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const tooltipStyle = useMemo(() => {
    if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

    const gap = 12;
    switch (step.placement) {
      case 'top':
        return {
          bottom: `${window.innerHeight - rect.top + gap}px`,
          left: `${rect.left + rect.width / 2}px`,
          transform: 'translateX(-50%)',
        };
      case 'bottom':
        return {
          top: `${rect.top + rect.height + gap}px`,
          left: `${rect.left + rect.width / 2}px`,
          transform: 'translateX(-50%)',
        };
      case 'left':
        return {
          right: `${window.innerWidth - rect.left + gap}px`,
          top: `${rect.top + rect.height / 2}px`,
          transform: 'translateY(-50%)',
        };
      case 'right':
        return {
          left: `${rect.left + rect.width + gap}px`,
          top: `${rect.top + rect.height / 2}px`,
          transform: 'translateY(-50%)',
        };
      default:
        return {
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        };
    }
  }, [rect, step.placement]);

  return (
    <div
      className={`spotlight-overlay${reduceMotion ? ' spotlight-overlay--no-animation' : ''}`}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      aria-modal
    >
      {/* Dark overlay */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop intercepts clicks to dismiss */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape is handled by this component's window keydown listener */}
      <div className="spotlight-overlay__backdrop" onClick={onDismiss} />

      {/* Highlight region (cutout) */}
      {rect && (
        <div
          className={`spotlight-overlay__highlight${reduceMotion ? ' spotlight-overlay__highlight--no-animation' : ''}`}
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      )}

      {/* Target-missing fallback hint */}
      {targetMissing && (
        <div className="spotlight-overlay__missing-hint" role="status" aria-live="polite">
          Could not find the &ldquo;{step.title}&rdquo; element. The tour continues.
        </div>
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className={`spotlight-overlay__tooltip${reduceMotion ? ' spotlight-overlay__tooltip--no-animation' : ''}`}
        style={tooltipStyle}
        // Programmatic focus target so each tour step is announced. tabIndex=-1
        // keeps it out of the Tab sequence.
        tabIndex={-1}
      >
        <div className="spotlight-overlay__tooltip-header">
          <span className="spotlight-overlay__step-indicator">
            {stepIndex + 1} / {totalSteps}
          </span>
        </div>
        <h3 className="spotlight-overlay__title" id={titleId}>
          {step.title}
        </h3>
        <p className="spotlight-overlay__desc" id={descId}>
          {step.description}
        </p>
        <div className="spotlight-overlay__actions">
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Skip
          </Button>
          <div className="spotlight-overlay__nav">
            {!isFirst && (
              <Button variant="ghost" size="sm" onClick={onPrev}>
                Prev
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={onNext}>
              {isLast ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
