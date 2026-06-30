import { Button } from '@strata/ui';
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

export function SpotlightOverlay({
  stepIndex,
  totalSteps,
  onNext,
  onPrev,
  onDismiss,
  step,
}: SpotlightOverlayProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;

  const updatePosition = useCallback(() => {
    if (!step.target) {
      setRect(null);
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
    <div className="spotlight-overlay" role="dialog" aria-label="Tour step" aria-modal>
      {/* Dark overlay */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop intercepts clicks to dismiss */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape handled by parent keydown handler */}
      <div className="spotlight-overlay__backdrop" onClick={onDismiss} />

      {/* Highlight region (cutout) */}
      {rect && (
        <div
          className="spotlight-overlay__highlight"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      )}

      {/* Tooltip */}
      <div ref={tooltipRef} className="spotlight-overlay__tooltip" style={tooltipStyle}>
        <div className="spotlight-overlay__tooltip-header">
          <span className="spotlight-overlay__step-indicator">
            {stepIndex + 1} / {totalSteps}
          </span>
        </div>
        <h3 className="spotlight-overlay__title">{step.title}</h3>
        <p className="spotlight-overlay__desc">{step.description}</p>
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
