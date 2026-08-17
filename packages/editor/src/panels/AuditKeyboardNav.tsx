/**
 * Audit Keyboard Navigation
 *
 * Provides keyboard navigation for audit findings.
 * Supports arrow keys, Enter, Escape, and other shortcuts.
 *
 * @module AuditKeyboardNav
 */

import type { AuditFinding } from '@varve/shared';
import { useCallback, useEffect, useRef } from 'react';
import './audit.css';

interface AuditKeyboardNavOptions {
  /** Current findings */
  findings: AuditFinding[];

  /** Currently selected finding index */
  selectedIndex: number;

  /** On selection change */
  onSelect: (index: number) => void;

  /** On finding action (Enter key) */
  onAction?: (finding: AuditFinding) => void;

  /** On dismiss (Delete key) */
  onDismiss?: (finding: AuditFinding) => void;

  /** On escape (Escape key) */
  onEscape?: () => void;

  /** Whether navigation is enabled */
  enabled?: boolean;
}

/**
 * Audit keyboard navigation hook.
 */
export function useAuditKeyboardNav({
  findings,
  selectedIndex,
  onSelect,
  onAction,
  onDismiss,
  onEscape,
  enabled = true,
}: AuditKeyboardNavOptions) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Navigate to next finding
  const navigateNext = useCallback(() => {
    if (findings.length === 0) return;
    const nextIndex = (selectedIndex + 1) % findings.length;
    onSelect(nextIndex);
  }, [findings.length, selectedIndex, onSelect]);

  // Navigate to previous finding
  const navigatePrevious = useCallback(() => {
    if (findings.length === 0) return;
    const prevIndex = selectedIndex === 0 ? findings.length - 1 : selectedIndex - 1;
    onSelect(prevIndex);
  }, [findings.length, selectedIndex, onSelect]);

  // Navigate to first finding
  const navigateFirst = useCallback(() => {
    if (findings.length === 0) return;
    onSelect(0);
  }, [findings.length, onSelect]);

  // Navigate to last finding
  const navigateLast = useCallback(() => {
    if (findings.length === 0) return;
    onSelect(findings.length - 1);
  }, [findings.length, onSelect]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Check if the event target is an input or textarea
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          navigateNext();
          break;
        case 'ArrowUp':
          event.preventDefault();
          navigatePrevious();
          break;
        case 'Home':
          event.preventDefault();
          navigateFirst();
          break;
        case 'End':
          event.preventDefault();
          navigateLast();
          break;
        case 'Enter':
        case ' ': {
          event.preventDefault();
          const actionFinding = findings[selectedIndex];
          if (actionFinding) {
            onAction?.(actionFinding);
          }
          break;
        }
        case 'Delete':
        case 'Backspace': {
          event.preventDefault();
          const dismissFinding = findings[selectedIndex];
          if (dismissFinding) {
            onDismiss?.(dismissFinding);
          }
          break;
        }
        case 'Escape':
          event.preventDefault();
          onEscape?.();
          break;
      }
    },
    [
      enabled,
      navigateNext,
      navigatePrevious,
      navigateFirst,
      navigateLast,
      selectedIndex,
      findings,
      onAction,
      onDismiss,
      onEscape,
    ],
  );

  // Set up keyboard event listener
  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);

  // Focus container when enabled
  useEffect(() => {
    if (enabled && containerRef.current) {
      containerRef.current.focus();
    }
  }, [enabled]);

  return {
    containerRef,
    navigateNext,
    navigatePrevious,
    navigateFirst,
    navigateLast,
  };
}

/**
 * Keyboard shortcut description.
 */
export interface KeyboardShortcut {
  /** Key combination */
  keys: string;

  /** Description */
  description: string;

  /** Action callback */
  action: () => void;
}

/**
 * Default keyboard shortcuts for audit navigation.
 */
export const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  { keys: 'Down / J', description: 'Next finding', action: () => {} },
  { keys: 'Up / K', description: 'Previous finding', action: () => {} },
  { keys: 'Home', description: 'First finding', action: () => {} },
  { keys: 'End', description: 'Last finding', action: () => {} },
  { keys: 'Enter / Space', description: 'View details / Apply fix', action: () => {} },
  { keys: 'Delete / Backspace', description: 'Dismiss finding', action: () => {} },
  { keys: 'Escape', description: 'Close panel / Deselect', action: () => {} },
];

/**
 * Keyboard shortcuts help component.
 */
export function KeyboardShortcutsHelp() {
  return (
    <div className="audit-keyboard-shortcuts">
      <h4>Keyboard Shortcuts</h4>
      <ul>
        {DEFAULT_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.keys}>
            <kbd>{shortcut.keys}</kbd>
            <span>{shortcut.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
