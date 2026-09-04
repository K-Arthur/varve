import type { HTMLAttributes, Ref, RefObject } from 'react';
import { forwardRef, useEffect, useRef } from 'react';
import './ScrollArea.css';

export type ScrollAreaOrientation = 'vertical' | 'horizontal' | 'both';

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  /** Which native overflow axes the viewport should expose. */
  orientation?: ScrollAreaOrientation;
  /** Ref to the actual scrolling element, not the wrapper. */
  viewportRef?: Ref<HTMLDivElement>;
  /** Additional classes for the actual scrolling element. */
  viewportClassName?: string;
  /** Attributes for the actual scrolling element, including tabIndex. */
  viewportProps?: HTMLAttributes<HTMLDivElement>;
}

function joinClasses(...classes: Array<string | undefined>): string | undefined {
  const result = classes.filter(Boolean).join(' ');
  return result || undefined;
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  {
    orientation = 'vertical',
    viewportRef,
    viewportClassName,
    viewportProps,
    className,
    children,
    ...rootProps
  },
  ref,
) {
  const localViewportRef = useRef<HTMLDivElement>(null);
  const setViewportRef = (element: HTMLDivElement | null) => {
    localViewportRef.current = element;
    if (!viewportRef) return;
    if (typeof viewportRef === 'function') {
      viewportRef(element);
    } else {
      viewportRef.current = element;
    }
  };

  return (
    <div
      {...rootProps}
      ref={ref}
      className={joinClasses('varve-scroll-area', className)}
      data-orientation={orientation}
      data-slot="scroll-area"
    >
      <div
        {...viewportProps}
        ref={setViewportRef}
        className={joinClasses(
          'varve-scroll-area__viewport',
          viewportClassName,
          viewportProps?.className,
        )}
        data-slot="scroll-area-viewport"
      >
        {children}
      </div>
    </div>
  );
});

ScrollArea.displayName = 'ScrollArea';

export interface ScrollProgressProps {
  viewportRef: RefObject<HTMLElement | null>;
  className?: string;
  'aria-label'?: string;
}

/** A deliberately separate, low-cost progress indicator for long-form content. */
export function ScrollProgress({
  viewportRef,
  className,
  'aria-label': ariaLabel,
}: ScrollProgressProps) {
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const progress = progressRef.current;
    if (!viewport || !progress) return;

    let frame = 0;
    const update = () => {
      const range = viewport.scrollHeight - viewport.clientHeight;
      const value = range > 0 ? Math.min(1, Math.max(0, viewport.scrollTop / range)) : 0;
      progress.style.transform = `scaleX(${value})`;
      progress.setAttribute('aria-valuenow', String(Math.round(value * 100)));
      progress.parentElement?.toggleAttribute('data-overflow', range > 0);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(viewport);
    viewport.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      viewport.removeEventListener('scroll', schedule);
    };
  }, [viewportRef]);

  return (
    <div
      className={joinClasses('varve-scroll-progress', className)}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <div
        ref={progressRef}
        className="varve-scroll-progress__value"
        role="progressbar"
        aria-label={ariaLabel ?? 'Scroll progress'}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}
