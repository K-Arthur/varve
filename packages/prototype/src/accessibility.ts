/**
 * Accessibility system for prototype playback.
 *
 * Provides reduced-motion detection, keyboard navigation helpers,
 * focus management, ARIA live region announcements, and WCAG-conformant
 * transition duration clamping.
 *
 * Research basis: WCAG 2.2 AA (SC 2.2.2 Pause/Stop/Hide, SC 2.1.1 Keyboard,
 * SC 1.4.4 Resize Text), prefers-reduced-motion media query, ARIA Authoring
 * Practices Guide (APG), Figma prototype player accessibility gaps analysis.
 */

import type { TransitionConfig } from './types';

/**
 * Check if the user prefers reduced motion.
 * Defaults to false in non-browser environments.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

/**
 * Minimum animation duration in ms for WCAG 2.2 compliance.
 * Animations shorter than 200ms may trigger vestibular disorders.
 */
export const MIN_ANIMATION_DURATION = 200;

/**
 * Adjust transition duration based on accessibility preferences.
 * - If reduced motion is preferred, duration is clamped to 0
 * - Duration below MIN_ANIMATION_DURATION is raised to minimum
 */
export function adjustTransitionForAccessibility(
  transition: TransitionConfig,
  reducedMotion?: boolean,
): TransitionConfig {
  const prefersReduced = reducedMotion ?? prefersReducedMotion();

  if (prefersReduced) {
    return { ...transition, duration: 0 };
  }

  // Ensure minimum duration for WCAG compliance
  if (transition.duration > 0 && transition.duration < MIN_ANIMATION_DURATION) {
    return { ...transition, duration: MIN_ANIMATION_DURATION };
  }

  return transition;
}

/**
 * ARIA live region announcement for prototype state changes.
 * Used to announce navigation, overlay changes, and dynamic content changes
 * to screen reader users.
 */
export function announceToScreenReader(
  message: string,
  priority: 'polite' | 'assertive' = 'polite',
): void {
  if (typeof document === 'undefined') return;

  const id = 'varve-prototype-announcer';
  let announcer = document.getElementById(id) as HTMLElement | null;

  if (!announcer) {
    announcer = document.createElement('div');
    announcer.id = id;
    announcer.setAttribute('aria-live', priority);
    announcer.setAttribute('aria-relevant', 'additions text');
    announcer.setAttribute('role', 'status');
    announcer.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
    document.body.appendChild(announcer);
  } else {
    announcer.setAttribute('aria-live', priority);
  }

  // Clear and re-set to ensure announcement fires even for identical text
  announcer.textContent = '';
  requestAnimationFrame(() => {
    announcer!.textContent = message;
  });
}

/**
 * Get focusable elements within a container, sorted by DOM order.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable]',
  ];
  const elements = container.querySelectorAll<HTMLElement>(selectors.join(','));
  return Array.from(elements).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

/**
 * Generate an ARIA label for a prototype interaction target.
 */
export function generateAriaLabel(
  nodeName: string,
  triggerType: string,
  actionsDescription: string,
): string {
  const triggerLabels: Record<string, string> = {
    onClick: 'Click',
    onTap: 'Tap',
    onHover: 'Hover',
    onKeyPress: 'Press key',
    afterDelay: 'Auto',
  };

  const triggerLabel = triggerLabels[triggerType] ?? triggerType;
  return `${nodeName}. ${triggerLabel} to ${actionsDescription}`;
}
